import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  ArrowDownToLine,
  ArrowUpDown,
  Download,
  Music,
  PanelLeftOpen,
  RefreshCw,
  Share2,
  Upload,
} from 'lucide-react';
import type { LibraryRoot, Playlist, RepeatMode, Song } from './types';
import { useMetadataExtractor } from './hooks/useMetadataExtractor';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMediaSession } from './hooks/useMediaSession';
import { useAudioEngine } from './hooks/useAudioEngine';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingHero } from './components/NowPlayingHero';
import * as storage from './lib/storage';
import { ingestDirectoryHandle } from './lib/ingest';
import { filterSongs } from './lib/filter';
import { sortSongs, SORT_LABELS, type SortKey } from './lib/sort';
import { nextInPlaylist } from './lib/queue';
import type { EqPreset } from './lib/eq';
import { useDominantColor } from './hooks/useDominantColor';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { MiniPlayer } from './components/MiniPlayer';
import { parseM3U, parsePLS, matchImportEntries } from './lib/playlist-import';
import { parseLRC } from './lib/lrc';
import { LyricsPanel } from './components/LyricsPanel';
import { ConfirmModal } from './components/ConfirmModal';
import { PromptModal } from './components/PromptModal';
import { serializeM3U, sanitizeFilename } from './lib/playlist-export';
import { encodeSharePayload, decodeSharePayload, type SharedTrack } from './lib/share';
import { SharedTrackModal } from './components/SharedTrackModal';

type LibraryStatus = 'loading' | 'ready' | 'needs-prompt';

function ensureLibrary(playlists: Playlist[]): Playlist[] {
  if (playlists.some((p) => p.id === 'library')) return playlists;
  return [
    { id: 'library', name: 'Library', songs: [], createdAt: new Date() },
    ...playlists,
  ];
}

export default function App() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [libraryRoots, setLibraryRoots] = useState<LibraryRoot[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>('loading');

  const [activePlaylistId, setActivePlaylistId] = useState<string>('library');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [shuffle, setShuffle] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('manual');
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [eqPreset, setEqPreset] = useState<EqPreset>('Off');
  const [volume, setVolume] = useState(1);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [sharedTrack, setSharedTrack] = useState<SharedTrack | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [promptState, setPromptState] = useState<{
    title: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    onConfirm: (value: string) => void;
  } | null>(null);

  const requestConfirm = useCallback(
    (
      title: string,
      message: string,
      onConfirm: () => void,
      confirmLabel?: string,
    ) => {
      setConfirm({ title, message, confirmLabel, onConfirm });
    },
    [],
  );

  const loadedRef = useRef(false);
  const persistRequestedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { extractMetadata } = useMetadataExtractor();

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId);
  const filteredSongs = filterSongs(activePlaylist?.songs ?? [], searchQuery);
  // View-only ordering for the list; playback still walks the playlist order.
  const visibleSongs = sortSongs(filteredSongs, sortBy);
  // Memoized so the engine's gapless preload and `playNext` agree on the *same*
  // next song — critical under shuffle, where recomputing would re-roll the
  // random pick and desync the preloaded element from what actually plays.
  const nextSong = useMemo(
    () => nextInPlaylist(currentSong, activePlaylist?.songs ?? [], repeatMode, shuffle),
    [currentSong, activePlaylist?.songs, repeatMode, shuffle],
  );
  const tintColor = useDominantColor(currentSong?.coverArt);
  const { canInstall, promptInstall, isIOS } = useInstallPrompt();

  const onEndedRef = useRef<() => void>(() => {});

  const {
    audioRefA,
    audioRefB,
    currentTime,
    duration,
    isPlaying,
    visualizerData,
    togglePlayPause,
    seek,
  } = useAudioEngine({
    song: currentSong,
    nextSong,
    eqPreset,
    volume,
    onEnded: () => onEndedRef.current(),
  });

  // Mount: load roots + playlists from IndexedDB
  useEffect(() => {
    (async () => {
      try {
        const roots = await storage.getLibraryRoots();
        let needsPrompt = false;
        for (const root of roots) {
          const perm = await root.handle.queryPermission?.({ mode: 'read' });
          if (perm !== 'granted') {
            needsPrompt = true;
            break;
          }
        }

        const loaded = needsPrompt ? [] : await storage.getPlaylists();
        const storedEq = await storage.getEqPreset();
        const storedVolume = await storage.getVolume();
        setLibraryRoots(roots);
        setPlaylists(ensureLibrary(loaded));
        setEqPreset(storedEq);
        setVolume(storedVolume);
        setLibraryStatus(needsPrompt ? 'needs-prompt' : 'ready');
      } catch (err) {
        console.error('Library load failed:', err);
        setPlaylists(ensureLibrary([]));
        setLibraryStatus('ready');
      } finally {
        loadedRef.current = true;
      }
    })();
  }, []);

  // Revoke object URLs for songs that have been removed from playlists.
  // Without this, each song's audio URL + cover-art URL pins its blob in
  // memory forever — a quiet leak that adds up over hundreds of songs.
  const prevSongsRef = useRef<Map<string, Song>>(new Map());
  const currentSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSongIdRef.current = currentSong?.id ?? null;
  }, [currentSong]);

  useEffect(() => {
    const next = new Map<string, Song>();
    for (const p of playlists) {
      for (const s of p.songs) {
        if (!next.has(s.id)) next.set(s.id, s);
      }
    }

    const toRevoke: Song[] = [];
    for (const [id, song] of prevSongsRef.current) {
      if (next.has(id)) continue;
      // Skip the currently-playing song — the <audio> element may still
      // reference the URL during the brief currentSong-becoming-null
      // transition. The next diff catches it once currentSong updates.
      if (currentSongIdRef.current === id) continue;
      toRevoke.push(song);
    }

    prevSongsRef.current = next;

    if (toRevoke.length > 0) {
      // Defer revoke past React's commit so any consequential teardown
      // (e.g., <audio> dropping its src) completes first.
      setTimeout(() => {
        for (const song of toRevoke) {
          if (song.url) URL.revokeObjectURL(song.url);
          if (song.coverArt) URL.revokeObjectURL(song.coverArt);
        }
      }, 0);
    }
  }, [playlists]);

  // Persist playlists with a 500ms debounce. Bursty mutations (folder ingest,
  // batch delete, reorder) collapse into one save instead of one per change.
  // Trade-off: changes within 500ms of tab close may be lost.
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      storage.savePlaylists(playlists).catch((err) => {
        console.error('Save failed:', err);
        if (err instanceof storage.StorageQuotaError) {
          setNotification(
            'Storage full. New songs may not survive a reload — free space or remove tracks.',
          );
        }
      });
      saveTimerRef.current = null;
    }, 500);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [playlists]);

  // Self-heal cover art for songs persisted before the coverBlob fix (Phase 5.5).
  // Runs once after initial load; re-extracts metadata for any song missing both
  // coverArt and coverBlob and updates state, which triggers a save with the blob.
  const healedCoversRef = useRef(false);
  useEffect(() => {
    if (!loadedRef.current || healedCoversRef.current) return;
    if (libraryStatus !== 'ready') return;
    healedCoversRef.current = true;

    (async () => {
      const updates = new Map<string, { coverArt?: string; coverBlob?: Blob }>();
      for (const p of playlists) {
        for (const s of p.songs) {
          if (s.coverArt || s.coverBlob || updates.has(s.id)) continue;
          try {
            const { parseBlob } = await import('music-metadata');
            const meta = await parseBlob(s.file);
            const pic = meta.common.picture?.[0];
            if (pic) {
              const blob = new Blob([pic.data as BlobPart], { type: pic.format });
              updates.set(s.id, { coverArt: URL.createObjectURL(blob), coverBlob: blob });
            } else {
              updates.set(s.id, {});
            }
          } catch {
            updates.set(s.id, {});
          }
        }
      }
      const realUpdates = new Map(
        [...updates].filter(([, v]) => v.coverArt && v.coverBlob),
      );
      if (realUpdates.size === 0) return;

      setPlaylists((prev) =>
        prev.map((p) => ({
          ...p,
          songs: p.songs.map((s) => {
            const u = realUpdates.get(s.id);
            return u ? { ...s, ...u } : s;
          }),
        })),
      );
    })();
  }, [libraryStatus, playlists]);

  // Persist EQ preset on change — same guard
  useEffect(() => {
    if (!loadedRef.current) return;
    storage.saveEqPreset(eqPreset).catch((err) => console.error('EQ save failed:', err));
  }, [eqPreset]);

  useEffect(() => {
    if (!loadedRef.current) return;
    storage.saveVolume(volume).catch((err) => console.error('Volume save failed:', err));
  }, [volume]);

  const requestPersistOnce = useCallback(() => {
    if (persistRequestedRef.current) return;
    persistRequestedRef.current = true;
    storage.ensurePersisted().catch(() => {
      // Persist denied or unsupported — IDB still works, just evictable
    });
  }, []);

  const PLAYLIST_EXTS = new Set(['.m3u', '.m3u8', '.pls']);
  const isPlaylistFile = (f: File) =>
    PLAYLIST_EXTS.has(f.name.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1'));
  const isLrcFile = (f: File) => f.name.toLowerCase().endsWith('.lrc');

  const handlePlaylistImport = useCallback(
    async (files: File[]) => {
      const libraryPlaylist = playlists.find((p) => p.id === 'library');
      const librarySongs = libraryPlaylist?.songs ?? [];

      for (const file of files) {
        const text = await file.text();
        const ext = file.name.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
        const entries = ext === '.pls' ? parsePLS(text) : parseM3U(text);
        if (entries.length === 0) continue;

        const { matched, unmatched } = matchImportEntries(entries, librarySongs);
        const name = file.name.replace(/\.[^.]+$/, '');
        const playlist = {
          id: crypto.randomUUID(),
          name,
          songs: matched,
          createdAt: new Date(),
        };

        setPlaylists((prev) => [...prev, playlist]);
        setNotification(
          `Created "${name}" with ${matched.length} of ${entries.length} tracks` +
            (unmatched.length > 0 ? ` (${unmatched.length} not found)` : ''),
        );
      }
      setShowUpload(false);
    },
    [playlists],
  );

  const handleLrcImport = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const text = await file.text();
        const lyrics = parseLRC(text);
        if (lyrics.length === 0) continue;

        const baseName = file.name.replace(/\.lrc$/i, '').toLowerCase();

        setPlaylists((prev) =>
          prev.map((p) => ({
            ...p,
            songs: p.songs.map((s) => {
              const songBase = s.file.name.replace(/\.[^.]+$/, '').toLowerCase();
              if (songBase === baseName && !s.lyrics) return { ...s, lyrics };
              return s;
            }),
          })),
        );
        setCurrentSong((prev) => {
          if (!prev) return prev;
          const songBase = prev.file.name.replace(/\.[^.]+$/, '').toLowerCase();
          if (songBase === baseName && !prev.lyrics) return { ...prev, lyrics };
          return prev;
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  // On arrival via a share link (`#s=...`), pop the shared-track card once,
  // then strip the hash so a reload doesn't re-open it. Ref-guarded so
  // StrictMode's double-invoke is harmless.
  const shareHandledRef = useRef(false);
  useEffect(() => {
    if (shareHandledRef.current) return;
    shareHandledRef.current = true;
    const track = decodeSharePayload(window.location.hash);
    if (track) {
      setSharedTrack(track);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!currentSong) return;
    const url =
      window.location.origin +
      window.location.pathname +
      encodeSharePayload(currentSong);
    const shareData = {
      title: 'Vibes',
      text: `${currentSong.title} — ${currentSong.artist}`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // User cancelled the native share sheet — fall through to clipboard.
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotification("Link copied — share what you're listening to.");
    } catch {
      setNotification('Could not copy the share link.');
    }
  }, [currentSong]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const allFiles = Array.from(files);
      const playlistFiles = allFiles.filter(isPlaylistFile);
      const lrcFiles = allFiles.filter(isLrcFile);
      const arr = allFiles.filter((f) => f.type.startsWith('audio/'));
      if (arr.length === 0 && playlistFiles.length === 0 && lrcFiles.length === 0) {
        alert('Please select audio files (MP3, WAV, FLAC, etc.)');
        return;
      }
      if (playlistFiles.length > 0) await handlePlaylistImport(playlistFiles);
      let firstIngestThisCall = false;
      for (const file of arr) {
        try {
          const song = await extractMetadata(file);
          setPlaylists((prev) =>
            prev.map((p) =>
              p.id === activePlaylistId ? { ...p, songs: [...p.songs, song] } : p,
            ),
          );
          if (!firstIngestThisCall) {
            firstIngestThisCall = true;
            requestPersistOnce();
          }
        } catch (err) {
          console.error('Error processing file:', file.name, err);
        }
      }
      if (lrcFiles.length > 0) await handleLrcImport(lrcFiles);
      setShowUpload(false);
    },
    [activePlaylistId, extractMetadata, requestPersistOnce, handlePlaylistImport, handleLrcImport],
  );

  const addFolderHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      const root = await storage.addLibraryRoot(handle.name, handle);
      if (!root) return; // dedupe — already added

      const ingested = await ingestDirectoryHandle(handle);
      const songs: Song[] = [];
      for (const { file, fileHandle, relativePath } of ingested) {
        try {
          const base = await extractMetadata(file);
          songs.push({ ...base, id: `${root.id}/${relativePath}`, fileHandle });
        } catch (err) {
          console.error('Error processing', relativePath, err);
        }
      }

      setLibraryRoots((prev) => [...prev, root]);
      setPlaylists((prev) =>
        prev.map((p) =>
          p.id === activePlaylistId ? { ...p, songs: [...p.songs, ...songs] } : p,
        ),
      );
      setShowUpload(false);
      if (songs.length > 0) requestPersistOnce();
    },
    [activePlaylistId, extractMetadata, requestPersistOnce],
  );

  const restoreLibrary = useCallback(async () => {
    for (const root of libraryRoots) {
      const perm = await root.handle.requestPermission?.({ mode: 'read' });
      if (perm !== 'granted') return;
    }
    const loaded = await storage.getPlaylists();
    setPlaylists(ensureLibrary(loaded));
    setLibraryStatus('ready');
  }, [libraryRoots]);

  const playNext = () => {
    if (!activePlaylist || !currentSong) return;
    if (repeatMode === 'one') {
      seek(0);
      if (!isPlaying) togglePlayPause();
      return;
    }
    // Consume the memoized `nextSong` so the song that plays is exactly the one
    // the engine preloaded for gapless (matters under shuffle — see useMemo).
    if (nextSong) setCurrentSong(nextSong);
  };

  const playPrev = () => {
    if (!activePlaylist || !currentSong) return;
    const idx = activePlaylist.songs.findIndex((s) => s.id === currentSong.id);
    const prev = idx - 1;
    if (prev >= 0) setCurrentSong(activePlaylist.songs[prev]);
  };

  // Keep the engine's onEnded ref pointing at the freshest playNext closure
  onEndedRef.current = playNext;

  const cycleRepeat = () => {
    setRepeatMode((m) => (m === 'none' ? 'all' : m === 'all' ? 'one' : 'none'));
  };

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      const playlistName =
        playlists.find((p) => p.id === activePlaylistId)?.name ?? 'this playlist';
      requestConfirm(
        `Delete ${ids.length} ${ids.length === 1 ? 'song' : 'songs'}?`,
        `${ids.length} ${ids.length === 1 ? 'song' : 'songs'} will be removed from "${playlistName}".`,
        () => {
          const idSet = new Set(ids);
          setPlaylists((prev) =>
            prev.map((p) => ({ ...p, songs: p.songs.filter((s) => !idSet.has(s.id)) })),
          );
          setCurrentSong((prev) => (prev && idSet.has(prev.id) ? null : prev));
        },
      );
    },
    [playlists, activePlaylistId, requestConfirm],
  );

  const handleReorder = useCallback(
    (reorderedSongs: Song[]) => {
      setPlaylists((prev) =>
        prev.map((p) => (p.id === activePlaylistId ? { ...p, songs: reorderedSongs } : p)),
      );
    },
    [activePlaylistId],
  );

  const handlePlaySong = useCallback((song: Song) => {
    setCurrentSong(song);
  }, []);

  // Stable ref to filteredSongs and activePlaylistId so handleDeleteSong
  // doesn't recreate on every list/playlist change (would defeat row memo).
  const filteredSongsRef = useRef<Song[]>([]);
  const activePlaylistIdRef = useRef(activePlaylistId);
  const playlistsRef = useRef(playlists);

  useEffect(() => {
    filteredSongsRef.current = filteredSongs;
  }, [filteredSongs]);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);
  useEffect(() => {
    playlistsRef.current = playlists;
  }, [playlists]);

  const handleDeleteSong = useCallback(
    (id: string) => {
      const song = filteredSongsRef.current.find((s) => s.id === id);
      if (!song) return;
      const aid = activePlaylistIdRef.current;
      const playlistName =
        playlistsRef.current.find((p) => p.id === aid)?.name ?? 'this playlist';
      requestConfirm(
        `Delete "${song.title}"?`,
        `Removes from "${playlistName}". ${aid === 'library' ? '' : 'Song remains in Library.'}`,
        () => {
          setPlaylists((prev) =>
            prev.map((p) => ({ ...p, songs: p.songs.filter((s) => s.id !== id) })),
          );
          setCurrentSong((prev) => (prev?.id === id ? null : prev));
        },
      );
    },
    [requestConfirm],
  );

  const exportPlaylist = useCallback(
    (playlistId: string) => {
      const playlist = playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      const text = serializeM3U(playlist);
      const blob = new Blob([text], { type: 'audio/x-mpegurl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(playlist.name)}.m3u`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [playlists],
  );

  const refreshLibrary = useCallback(async () => {
    if (libraryRoots.length === 0) return;
    for (const root of libraryRoots) {
      const perm = await root.handle.requestPermission?.({ mode: 'read' });
      if (perm !== 'granted') {
        setNotification('Permission denied for library folder');
        return;
      }
    }

    const existingIds = new Set(
      playlists
        .find((p) => p.id === 'library')
        ?.songs.map((s) => s.id) ?? [],
    );
    const seenIds = new Set<string>();
    const newSongs: Song[] = [];

    for (const root of libraryRoots) {
      const ingested = await ingestDirectoryHandle(root.handle);
      for (const { file, fileHandle, relativePath } of ingested) {
        const id = `${root.id}/${relativePath}`;
        seenIds.add(id);
        if (existingIds.has(id)) continue;
        try {
          const base = await extractMetadata(file);
          newSongs.push({ ...base, id, fileHandle });
        } catch (err) {
          console.error('Refresh: skipping', file.name, err);
        }
      }
    }

    const removedIds = new Set(
      Array.from(existingIds).filter((id) => !seenIds.has(id)),
    );

    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id === 'library') {
          const kept = p.songs.filter((s) => !removedIds.has(s.id));
          return { ...p, songs: [...kept, ...newSongs] };
        }
        // Also drop orphans from user playlists
        return {
          ...p,
          songs: p.songs.filter((s) => !removedIds.has(s.id)),
        };
      }),
    );
    setCurrentSong((prev) => (prev && removedIds.has(prev.id) ? null : prev));

    if (newSongs.length === 0 && removedIds.size === 0) {
      setNotification('Library is up to date');
    } else {
      setNotification(
        `Refreshed: +${newSongs.length} ${newSongs.length === 1 ? 'song' : 'songs'}, -${removedIds.size} removed`,
      );
    }
  }, [libraryRoots, playlists, extractMetadata]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over, activatorEvent } = event;
      if (!over) return;

      const overId = String(over.id);

      // Drop on a Sidebar playlist row
      if (overId.startsWith('playlist-')) {
        const targetId = overId.slice('playlist-'.length);
        if (targetId === activePlaylistId) return;
        const ids = (active.data.current?.ids as string[] | undefined) ?? [
          String(active.id),
        ];
        const songsToCopy = playlists
          .find((p) => p.id === activePlaylistId)
          ?.songs.filter((s) => ids.includes(s.id)) ?? [];
        if (songsToCopy.length === 0) return;

        const isMove =
          ((activatorEvent as PointerEvent | KeyboardEvent | MouseEvent | null)?.ctrlKey ||
            (activatorEvent as PointerEvent | KeyboardEvent | MouseEvent | null)?.metaKey) ??
          false;
        // Special case: never move from Library (always copy)
        const effectiveMove = isMove && activePlaylistId !== 'library';

        setPlaylists((prev) =>
          prev.map((p) => {
            if (p.id === targetId) {
              const existing = new Set(p.songs.map((s) => s.id));
              const toAdd = songsToCopy.filter((s) => !existing.has(s.id));
              return { ...p, songs: [...p.songs, ...toAdd] };
            }
            if (effectiveMove && p.id === activePlaylistId) {
              const idSet = new Set(ids);
              return { ...p, songs: p.songs.filter((s) => !idSet.has(s.id)) };
            }
            return p;
          }),
        );

        const targetName =
          playlists.find((p) => p.id === targetId)?.name ?? 'playlist';
        setNotification(
          `${effectiveMove ? 'Moved' : 'Added'} ${songsToCopy.length} ${
            songsToCopy.length === 1 ? 'song' : 'songs'
          } ${effectiveMove ? 'to' : 'to'} "${targetName}"`,
        );
        setSelectionMode(false);
        return;
      }

      // Drop on another song row → reorder (only when not in selection mode)
      if (selectionMode) return;
      if (active.id === over.id) return;
      const activePlaylist = playlists.find((p) => p.id === activePlaylistId);
      if (!activePlaylist) return;
      const oldIndex = activePlaylist.songs.findIndex((s) => s.id === active.id);
      const newIndex = activePlaylist.songs.findIndex((s) => s.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        handleReorder(arrayMove(activePlaylist.songs, oldIndex, newIndex));
      }
    },
    [playlists, activePlaylistId, selectionMode, handleReorder],
  );

  const togglePip = useCallback(async () => {
    if (pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      return;
    }
    if (!window.documentPictureInPicture) return;
    try {
      const pip = await window.documentPictureInPicture.requestWindow({
        width: 380,
        height: 220,
      });
      for (const sheet of document.styleSheets) {
        try {
          if (sheet.href) {
            const link = pip.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            pip.document.head.appendChild(link);
          } else if (sheet.cssRules) {
            const style = pip.document.createElement('style');
            style.textContent = Array.from(sheet.cssRules)
              .map((r) => r.cssText)
              .join('\n');
            pip.document.head.appendChild(style);
          }
        } catch {
          // cross-origin stylesheet — skip
        }
      }
      pip.addEventListener('pagehide', () => setPipWindow(null));
      setPipWindow(pip);
    } catch (err) {
      console.error('PiP open failed:', err);
    }
  }, [pipWindow]);

  useEffect(() => {
    if (!pipWindow) return;
    return () => {
      pipWindow.close();
    };
  }, [pipWindow]);

  useEffect(() => {
    if (pipWindow && !currentSong) {
      pipWindow.close();
      setPipWindow(null);
    }
  }, [pipWindow, currentSong]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer?.items;
    if (items?.length) {
      const sessionFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        if (typeof item.getAsFileSystemHandle === 'function') {
          try {
            const h = await item.getAsFileSystemHandle();
            if (h?.kind === 'directory') {
              await addFolderHandle(h as FileSystemDirectoryHandle);
              continue;
            }
          } catch (err) {
            console.warn('getAsFileSystemHandle failed:', err);
          }
        }
        const f = item.getAsFile();
        if (f) sessionFiles.push(f);
      }
      if (sessionFiles.length) await handleFiles(sessionFiles);
      return;
    }

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) await handleFiles(files);
  };

  const supportsFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  useMediaSession({
    song: currentSong,
    isPlaying,
    currentTime,
    duration,
    onPlay: togglePlayPause,
    onPause: togglePlayPause,
    onNext: playNext,
    onPrev: playPrev,
    onSeek: seek,
  });

  useKeyboardShortcuts(
    {
      Space: togglePlayPause,
      ArrowRight: playNext,
      ArrowLeft: playPrev,
      Slash: () => searchInputRef.current?.focus(),
      KeyL: () => setShowLyrics((v) => !v),
      Escape: () => {
        if (selectionMode) {
          setSelectionMode(false);
          return;
        }
        if (showUpload) {
          setShowUpload(false);
          return;
        }
        if (searchQuery.length > 0) {
          setSearchQuery('');
          return;
        }
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        }
      },
    },
    { isBlocked: showUpload },
  );

  return (
    <div
      className="h-screen text-white flex flex-col overflow-hidden"
      style={{ ['--vibe']: tintColor ?? '#FF9E5E' } as CSSProperties}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
    >
      {/* Persistent AFTERGLOW aurora (z-[-1]); the per-track tint layers above it. */}
      <div className="aurora-bg" />
      <div
        className="fixed inset-0 pointer-events-none transition-colors duration-[1500ms]"
        style={{
          background: tintColor
            ? `radial-gradient(ellipse at 50% 100%, ${tintColor} 0%, transparent 70%)`
            : 'none',
        }}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >

      {isDragging && (
        <div className="fixed inset-0 bg-amber/20 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-amber">
          <div className="text-center">
            <Upload className="h-16 w-16 mx-auto mb-4 text-amber" />
            <p className="text-2xl font-bold font-display text-cream">Drop your music files here!</p>
            <p className="text-cream/70 mt-2">Supports MP3, WAV, FLAC, and more</p>
          </div>
        </div>
      )}

      {libraryStatus === 'needs-prompt' && (
        <div className="bg-amber/20 border-b border-amber/30 px-4 py-2 flex items-center justify-between text-sm">
          <span className="text-cream">Welcome back. Click to restore your library.</span>
          <button
            onClick={restoreLibrary}
            className="bg-gradient-to-r from-amber to-coral hover:brightness-110 text-deep px-3 py-1 rounded-md text-xs font-medium shadow"
          >
            Restore library
          </button>
        </div>
      )}

      {libraryStatus === 'loading' ? (
        <div className="flex-1 flex items-center justify-center text-white/50">Loading…</div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <Sidebar
            playlists={playlists}
            activePlaylistId={activePlaylistId}
            onSelect={setActivePlaylistId}
            onCreate={() => {
              setPromptState({
                title: 'New playlist',
                placeholder: 'Playlist name',
                confirmLabel: 'Create',
                onConfirm: (name) => {
                  setPlaylists((prev) => [
                    ...prev,
                    { id: crypto.randomUUID(), name, songs: [], createdAt: new Date() },
                  ]);
                },
              });
            }}
            onDelete={(id) => {
              if (id === 'library') return;
              const playlist = playlists.find((p) => p.id === id);
              if (!playlist) return;
              requestConfirm(
                `Delete playlist "${playlist.name}"?`,
                'Songs remain in Library.',
                () => {
                  setPlaylists((prev) => prev.filter((p) => p.id !== id));
                  if (activePlaylistId === id) setActivePlaylistId('library');
                },
              );
            }}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <header className="p-4 lg:p-6 border-b border-white/10">
              {!sidebarOpen && (
                <div className="flex items-center justify-center space-x-3 mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-amber to-coral rounded-xl flex items-center justify-center shadow-lg">
                    <Music className="h-7 w-7 text-deep" />
                  </div>
                  <h1 className="text-2xl lg:text-3xl font-bold font-display bg-gradient-to-r from-amber to-coral bg-clip-text text-transparent">
                    Vibes
                  </h1>
                </div>
              )}
              <div className="flex items-center justify-between mb-4">
                {!sidebarOpen && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Open sidebar"
                  >
                    <PanelLeftOpen className="h-5 w-5" />
                  </button>
                )}
                {sidebarOpen && (
                  <h2 className="text-xl lg:text-2xl font-bold font-display bg-gradient-to-r from-amber to-coral bg-clip-text text-transparent">
                    {activePlaylist?.name}
                    {searchQuery.trim() && activePlaylist && (
                      <span className="ml-2 text-sm font-normal text-white/50 bg-clip-border bg-none [-webkit-text-fill-color:initial]">
                        {filteredSongs.length} of {activePlaylist.songs.length}
                      </span>
                    )}
                  </h2>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="relative flex items-center">
                    <ArrowUpDown className="pointer-events-none absolute left-2 h-4 w-4 text-white/60" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortKey)}
                      className="appearance-none rounded-lg border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm font-medium text-white/80 transition-all hover:bg-white/10 focus:border-amber focus:outline-none cursor-pointer"
                      title="Sort songs"
                      aria-label="Sort songs"
                    >
                      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                        <option key={k} value={k} className="bg-surface text-white">
                          {SORT_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setSelectionMode((v) => !v)}
                    className={`px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium ${
                      selectionMode
                        ? 'bg-amber/20 text-amber border border-amber/30'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                    title="Toggle selection mode"
                    aria-label="Toggle selection mode"
                  >
                    Select
                  </button>
                  <button
                    onClick={() => setShowLyrics((v) => !v)}
                    className={`px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium ${
                      showLyrics
                        ? 'bg-amber/20 text-amber border border-amber/30'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                    title="Toggle lyrics"
                    aria-label="Toggle lyrics"
                  >
                    Lyrics
                  </button>
                  {currentSong && (
                    <button
                      onClick={handleShare}
                      className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                      title="Share what you're listening to"
                      aria-label="Share current track"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  )}
                  {activePlaylistId === 'library' && libraryRoots.length > 0 && (
                    <button
                      onClick={refreshLibrary}
                      className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                      title="Refresh library from disk"
                      aria-label="Refresh library"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  {activePlaylist && activePlaylist.songs.length > 0 && (
                    <button
                      onClick={() => exportPlaylist(activePlaylistId)}
                      className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                      title="Export as M3U"
                      aria-label="Export playlist"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                  {(canInstall || isIOS) && (
                    <button
                      onClick={
                        canInstall
                          ? promptInstall
                          : () =>
                              setNotification(
                                'To install: tap the Share button, then "Add to Home Screen".',
                              )
                      }
                      className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                      title="Install Vibes"
                      aria-label="Install Vibes"
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowUpload(true)}
                    className="bg-gradient-to-r from-amber to-coral hover:brightness-110 text-deep px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium shadow-lg"
                  >
                    Add Music
                  </button>
                </div>
              </div>
            </header>

            <div className="px-4 lg:px-6 pt-3">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search this playlist… (press / to focus)"
                className="w-full bg-white/5 text-sm text-white placeholder-white/40 rounded-lg border border-white/10 focus:border-amber focus:outline-none px-3 py-2 transition-colors"
              />
            </div>

            {currentSong && (
              <NowPlayingHero
                song={currentSong}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onSeek={seek}
                onGenreClick={setSearchQuery}
              />
            )}

            <div className="flex flex-1 min-h-0">
              <SongList
                songs={visibleSongs}
                currentSong={currentSong}
                isPlaying={isPlaying}
                onPlay={handlePlaySong}
                onPause={togglePlayPause}
                onDelete={handleDeleteSong}
                onBatchDelete={handleBatchDelete}
                onReorder={handleReorder}
                isFilterActive={searchQuery.trim().length > 0 || sortBy !== 'manual'}
                selectionMode={selectionMode}
                onSelectionModeChange={setSelectionMode}
                emptyHint={
                  searchQuery.trim()
                    ? {
                        primary: `No matches for "${searchQuery.trim()}"`,
                        secondary: 'Try a different search',
                      }
                    : undefined
                }
              />
              {showLyrics && (
                <LyricsPanel
                  lyrics={currentSong?.lyrics}
                  currentTime={currentTime}
                  onClose={() => setShowLyrics(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <PlayerBar
        song={currentSong}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        visualizerData={visualizerData}
        repeatMode={repeatMode}
        shuffle={shuffle}
        eqPreset={eqPreset}
        onPlayPause={togglePlayPause}
        onPrev={playPrev}
        onNext={playNext}
        onToggleShuffle={() => setShuffle((s) => !s)}
        onSeek={seek}
        onCycleRepeat={cycleRepeat}
        onEqPresetChange={setEqPreset}
        volume={volume}
        onVolumeChange={setVolume}
        onTogglePip={togglePip}
        supportsPip={'documentPictureInPicture' in window}
        isPipOpen={pipWindow !== null}
      />

      </DndContext>

      {pipWindow &&
        currentSong &&
        createPortal(
          <MiniPlayer
            song={currentSong}
            isPlaying={isPlaying}
            tintColor={tintColor}
            onPlayPause={togglePlayPause}
            onPrev={playPrev}
            onNext={playNext}
          />,
          pipWindow.document.body,
        )}

      {showUpload && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowUpload(false)}
        >
          <div
            className="bg-surface/90 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-white/10 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="border-2 border-dashed border-white/20 hover:border-amber rounded-xl p-8 text-center transition-all cursor-pointer block">
              <input
                type="file"
                multiple
                accept="audio/*,.m3u,.m3u8,.pls,.lrc"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="text-white/80 mb-2">Click to browse or drag files here</p>
              <p className="text-sm text-white/50">Supports MP3, WAV, FLAC, and more</p>
            </label>

            {supportsFolderPicker && (
              <button
                onClick={async () => {
                  try {
                    const handle = await window.showDirectoryPicker!();
                    await addFolderHandle(handle);
                  } catch (err) {
                    // User cancelled the picker (AbortError) — silent
                    if ((err as Error).name !== 'AbortError') {
                      console.error('Folder pick failed:', err);
                    }
                  }
                }}
                className="w-full bg-gradient-to-r from-amber to-coral hover:brightness-110 text-deep px-4 py-2 rounded-lg text-sm font-medium shadow"
              >
                Choose Folder
              </button>
            )}
          </div>
        </div>
      )}

      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-800/95 backdrop-blur-xl border border-white/10 rounded-lg px-4 py-2 text-sm text-white shadow-xl">
          {notification}
        </div>
      )}

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />

      <PromptModal
        open={promptState !== null}
        title={promptState?.title ?? ''}
        placeholder={promptState?.placeholder}
        defaultValue={promptState?.defaultValue}
        confirmLabel={promptState?.confirmLabel}
        onConfirm={(value) => {
          promptState?.onConfirm(value);
          setPromptState(null);
        }}
        onCancel={() => setPromptState(null)}
      />

      <SharedTrackModal track={sharedTrack} onClose={() => setSharedTrack(null)} />

      <audio ref={audioRefA} className="hidden" crossOrigin="anonymous" />
      <audio ref={audioRefB} className="hidden" crossOrigin="anonymous" />
    </div>
  );
}
