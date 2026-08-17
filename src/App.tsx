import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
  ListChecks,
  Mic2,
  Music,
  PanelLeftOpen,
  RefreshCw,
  ScanLine,
  Share2,
  Upload,
} from 'lucide-react';
import type { LibraryRoot, LyricLine, Playlist, RepeatMode, Song } from './types';
import { useMetadataExtractor } from './hooks/useMetadataExtractor';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDialogFocus } from './hooks/useDialogFocus';
import { useMediaSession } from './hooks/useMediaSession';
import { useAudioEngine } from './hooks/useAudioEngine';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingHero } from './components/NowPlayingHero';
import { HeaderMenu, type HeaderAction } from './components/HeaderMenu';
import * as storage from './lib/storage';
import { ingestDirectoryHandle, ingestDataTransferItems } from './lib/ingest';
import { filterSongs } from './lib/filter';
// Tiny sync-needed predicate only (file routing + the Refresh walk); the
// parse/match half of playlist-import stays dynamically imported.
import { isAudioFile, isPlaylistFileName, isLrcFileName } from './lib/file-types';
import type { ImportEntry } from './lib/playlist-import';
import { sortSongs, SORT_LABELS, type SortKey } from './lib/sort';
import { SLEEP_FADE_SECONDS } from './lib/sleep';
import { extractLyrics } from './lib/lyrics';
import { downscaleCover } from './lib/cover';
import { mergeRescan, hasMetaChanged, type RescanReplacements } from './lib/rescan';
import { extractMeta } from './lib/metadata-client';
import type { ExtractedMeta } from './lib/metadata-core';
import { resolveNextSong, safeQueueMove, upNextPreview } from './lib/queue';
import type { EqPreset } from './lib/eq';
import { useDominantColor } from './hooks/useDominantColor';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { encodeSharePayload, decodeSharePayload, type SharedTrack } from './lib/share';

// Code-split: these surfaces aren't needed for first paint, so they load on
// demand (first open) instead of sitting in the startup chunk. The import/
// export libs (playlist-import, lrc, playlist-export, lyrics-online) are
// likewise `await import()`ed inside their handlers.
const MobileNowPlaying = lazy(() =>
  import('./components/MobileNowPlaying').then((m) => ({ default: m.MobileNowPlaying })),
);
const MiniPlayer = lazy(() =>
  import('./components/MiniPlayer').then((m) => ({ default: m.MiniPlayer })),
);
const LyricsPanel = lazy(() =>
  import('./components/LyricsPanel').then((m) => ({ default: m.LyricsPanel })),
);
const QueuePanel = lazy(() =>
  import('./components/QueuePanel').then((m) => ({ default: m.QueuePanel })),
);
const ConfirmModal = lazy(() =>
  import('./components/ConfirmModal').then((m) => ({ default: m.ConfirmModal })),
);
const PromptModal = lazy(() =>
  import('./components/PromptModal').then((m) => ({ default: m.PromptModal })),
);
const SharedTrackModal = lazy(() =>
  import('./components/SharedTrackModal').then((m) => ({ default: m.SharedTrackModal })),
);

type LibraryStatus = 'loading' | 'ready' | 'needs-prompt';

const FAVORITES_CREATED = new Date(0); // stable identity for the virtual playlist

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
  const [mobilePlayerOpen, setMobilePlayerOpen] = useState(false);
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  const [fetchLyricsError, setFetchLyricsError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [eqPreset, setEqPreset] = useState<EqPreset>('Off');
  const [volume, setVolume] = useState(1);
  const [crossfade, setCrossfade] = useState(0);
  /**
   * Sleep timer deadline as an epoch ms, or null when disarmed.
   * Session-only — deliberately never persisted (queue precedent; a timer
   * that survived a reload would fire at a moment nobody asked for).
   */
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null);
  /** Ticks once a second purely to re-render the countdown label. */
  const [, setSleepTick] = useState(0);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const statsEverOpenedRef = useRef(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const lyricsEverOpenedRef = useRef(false);
  const [showQueue, setShowQueue] = useState(false);
  const queueEverOpenedRef = useRef(false);
  const mobilePlayerEverOpenedRef = useRef(false);
  // Focus trap for the inline upload dialog (component modals own theirs).
  const uploadPanelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(showUpload, uploadPanelRef);
  const [selectionMode, setSelectionMode] = useState(false);
  const [sharedTrack, setSharedTrack] = useState<SharedTrack | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    destructive?: boolean;
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
      destructive?: boolean,
    ) => {
      setConfirm({ title, message, confirmLabel, destructive, onConfirm });
    },
    [],
  );

  const loadedRef = useRef(false);
  // Separate from loadedRef: prefs mirror storage even when the library is
  // permission-gated, so they stay saveable (see the persistence effects).
  const prefsLoadedRef = useRef(false);
  const persistRequestedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { extractMetadata } = useMetadataExtractor();

  // Derived from ALL playlists, deduped by id (Library first in state order):
  // ingest adds songs only to the active playlist, so Library is NOT a strict
  // superset. toggleFavorite maps over all playlists, so duplicates agree.
  const favoriteSongs = useMemo(() => {
    const seen = new Set<string>();
    const out: Song[] = [];
    for (const p of playlists) {
      for (const s of p.songs) {
        if (s.favorite && !seen.has(s.id)) {
          seen.add(s.id);
          out.push(s);
        }
      }
    }
    return out;
  }, [playlists]);
  const virtualFavorites = useMemo<Playlist>(
    () => ({ id: 'favorites', name: 'Favorites', songs: favoriteSongs, createdAt: FAVORITES_CREATED }),
    [favoriteSongs],
  );
  // Display list only — 'favorites' must never enter `playlists` state.
  const sidebarPlaylists = useMemo(() => {
    const idx = playlists.findIndex((p) => p.id === 'library');
    const arr = [...playlists];
    arr.splice(idx + 1, 0, virtualFavorites);
    return arr;
  }, [playlists, virtualFavorites]);
  const activePlaylist =
    activePlaylistId === 'favorites'
      ? virtualFavorites
      : playlists.find((p) => p.id === activePlaylistId);
  const filteredSongs = filterSongs(activePlaylist?.songs ?? [], searchQuery);
  // View-only ordering for the list; playback still walks the playlist order.
  const visibleSongs = sortSongs(filteredSongs, sortBy);

  const [queue, setQueue] = useState<Song[]>([]);
  // Spotify-style bookmark: the last song that played via the PLAYLIST FLOW
  // (row click, prev/next walk) — deliberately NOT updated when a song
  // arrives from the queue, so a queued detour returns to where the listener
  // left off. Updated imperatively at the three sites that set a NEW current
  // song (playNext's walk branch, playPrev, handlePlaySong) — an effect can't
  // tell how a song arrived, so don't convert this back into one.
  const lastPlaylistSongRef = useRef<Song | null>(null);

  // Memoized so the engine's gapless preload and `playNext` agree on the *same*
  // next song — critical under shuffle, where recomputing would re-roll the
  // random pick and desync the preloaded element from what actually plays.
  const nextSong = useMemo(
    () =>
      resolveNextSong({
        current: currentSong,
        queue,
        songs: activePlaylist?.songs ?? [],
        repeatMode,
        shuffle,
        anchor: lastPlaylistSongRef.current,
      }),
    // Keyed on track IDENTITY (currentSong?.id), not the object, so metadata
    // merges (favorite toggle, lyrics fetch) on the PLAYING song don't re-roll
    // shuffle's random pick. NOT fully protected: activePlaylist?.songs is
    // still a reference dep, so mutating a song INSIDE the active playlist
    // (e.g. hearting it) recomputes and may re-roll shuffle; the audio engine
    // self-heals the preload on the next timeupdate, so worst case is a rare
    // non-gapless track boundary, never a wrong song or a stall.
    // `queue` is a dep on purpose: queuing a song MUST retarget the preload.
    [currentSong?.id, activePlaylist?.songs, repeatMode, shuffle, queue],
  );

  // Read-only "up next" for the queue panel. Under shuffle only the memoized
  // pick is knowable (and only when it isn't the queue head we already show).
  const upNext = useMemo(() => {
    const songs = activePlaylist?.songs ?? [];
    // Mirror resolveNextSong's Spotify-style base: valid bookmark first,
    // then current-if-in-playlist — so the preview matches what will play.
    const anchor = lastPlaylistSongRef.current;
    const base =
      anchor && songs.some((s) => s.id === anchor.id)
        ? anchor
        : currentSong && songs.some((s) => s.id === currentSong.id)
          ? currentSong
          : null;
    if (shuffle) {
      const pending = queue.filter((s) => s.id !== currentSong?.id);
      return nextSong && pending.length === 0 ? [nextSong] : [];
    }
    return upNextPreview(base, songs, repeatMode);
  }, [activePlaylist?.songs, currentSong, shuffle, repeatMode, nextSong, queue]);

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
    fadeOutAndPause,
    cancelSleepFade,
  } = useAudioEngine({
    song: currentSong,
    nextSong,
    eqPreset,
    volume,
    crossfadeSeconds: crossfade,
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
        const storedCrossfade = await storage.getCrossfade();
        setLibraryRoots(roots);
        setPlaylists(ensureLibrary(loaded));
        setEqPreset(storedEq);
        setVolume(storedVolume);
        setCrossfade(storedCrossfade);
        setLibraryStatus(needsPrompt ? 'needs-prompt' : 'ready');
        // ONLY now may saving begin — and only when the in-memory library
        // actually mirrors storage. Under `needsPrompt` it is an empty
        // placeholder (Chromium forgets FS Access grants across restarts),
        // and the debounced save would overwrite the real stored library
        // before the restore banner can read it back. restoreLibrary() flips
        // this once the user grants permission and the real data is loaded.
        loadedRef.current = !needsPrompt;
        prefsLoadedRef.current = true;
      } catch (err) {
        console.error('Library load failed:', err);
        setPlaylists(ensureLibrary([]));
        setLibraryStatus('ready');
        // loadedRef stays false: we don't know what's in storage, so we must
        // not overwrite it with this empty placeholder. Say so out loud —
        // silent non-saving is how "my library reset itself" happens.
        setNotification("Couldn't read your library. Reload to retry — changes aren't being saved.");
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
  const storageWarnedRef = useRef(false); // early 90% warning fires once per session
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      storage
        .savePlaylists(playlists)
        .then(() => {
          if (storageWarnedRef.current) return;
          storage
            .getStorageEstimate()
            .then((est) => {
              const warning = storage.formatStorageWarning(est);
              if (warning) {
                storageWarnedRef.current = true;
                setNotification(warning);
              }
            })
            .catch(() => {
              // estimate unavailable — never surface as a save error
            });
        })
        .catch((err) => {
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
              // Downscale before persisting, same as fresh ingest. The parse
              // itself deliberately stays main-thread here — this is a rare,
              // one-shot background migration path, not bulk ingest.
              const raw = new Blob([pic.data as BlobPart], { type: pic.format });
              const blob = await downscaleCover(raw);
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

  // Preferences use their OWN gate: unlike playlists, eqPreset/volume are read
  // from storage unconditionally at mount, so they always mirror it — a
  // permission-gated session may still save them (blocking those would drop
  // the user's EQ/volume changes for no safety benefit).
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage.saveEqPreset(eqPreset).catch((err) => console.error('EQ save failed:', err));
  }, [eqPreset]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage.saveVolume(volume).catch((err) => console.error('Volume save failed:', err));
  }, [volume]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage
      .saveCrossfade(crossfade)
      .catch((err) => console.error('Crossfade save failed:', err));
  }, [crossfade]);

  // ---- Sleep timer ----
  // Read at fire time, not captured: putting `isPlaying` in the effect deps
  // would tear down and rebuild both timers on every play/pause.
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    if (sleepDeadline === null) return;
    const timeout = window.setTimeout(
      () => {
        setSleepDeadline(null);
        // Already paused? Just disarm — no point fading over silence.
        if (!isPlayingRef.current) return;
        fadeOutAndPause(SLEEP_FADE_SECONDS);
        setNotification('Sleep timer — fading out.');
      },
      // The deadline is absolute, so a late mount still fires on time.
      Math.max(0, sleepDeadline - Date.now()),
    );
    // Sole purpose: re-render so the countdown label ticks down.
    const interval = window.setInterval(() => setSleepTick((t) => t + 1), 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [sleepDeadline, fadeOutAndPause]);

  const handleSetSleepTimer = useCallback(
    (minutes: number | null) => {
      // Covers disarming while a fade is already running: restore full level.
      cancelSleepFade();
      if (minutes === null) {
        setSleepDeadline(null);
        setNotification('Sleep timer off.');
        return;
      }
      setSleepDeadline(Date.now() + minutes * 60_000);
      setNotification(`Sleep timer set for ${minutes} minutes.`);
    },
    [cancelSleepFade],
  );

  /**
   * Lyrics, Queue and Stats all occupy the same right-edge slot, so exactly one
   * may be open. Toggling used to be hand-paired at every call site
   * ("open me, close the other"), which was survivable with two panels and
   * combinatorial with three — one missed line stacks two panels on top of each
   * other. Every opener goes through here instead.
   *
   * Also closes the full-screen now-playing view: it's `z-[60]` and the panels
   * are `z-40`, so leaving it open would show the panel hidden behind it.
   */
  const togglePanel = useCallback((panel: 'lyrics' | 'queue' | 'stats') => {
    setShowLyrics((v) => (panel === 'lyrics' ? !v : false));
    setShowQueue((v) => (panel === 'queue' ? !v : false));
    setShowStats((v) => (panel === 'stats' ? !v : false));
    setMobilePlayerOpen(false);
  }, []);

  const requestPersistOnce = useCallback(() => {
    if (persistRequestedRef.current) return;
    persistRequestedRef.current = true;
    storage.ensurePersisted().catch(() => {
      // Persist denied or unsupported — IDB still works, just evictable
    });
  }, []);

  const isPlaylistFile = (f: File) => isPlaylistFileName(f.name);
  const isLrcFile = (f: File) => isLrcFileName(f.name);

  const handlePlaylistImport = useCallback(
    /**
     * Import playlist files. A playlist remembers the file it came from
     * (`importSource`), so re-importing that file UPDATES the same playlist
     * (replace semantics — the file is the source of truth) instead of
     * creating a duplicate.
     *
     * `justIngested` carries songs extracted moments ago in the same drop:
     * React state isn't committed yet, so the `playlists` closure can't see
     * them, and without this a combined songs+.m3u drop yields empty playlists.
     */
    async (files: File[], justIngested: Song[] = []) => {
      const libraryPlaylist = playlists.find((p) => p.id === 'library');
      const librarySongs = [...(libraryPlaylist?.songs ?? []), ...justIngested];
      const { parseM3U, parsePLS, matchImportEntries, findLinkedPlaylist, diffSongSets } =
        await import('./lib/playlist-import');

      // Plan first, apply once: state updaters don't run synchronously, so the
      // toast text has to be computed out here. `working` walks forward across
      // files so two files in one drop can't both target the same playlist.
      type Op =
        | { kind: 'update'; id: string; songs: Song[]; source: string }
        | { kind: 'create'; playlist: Playlist };
      const ops: Op[] = [];
      const messages: string[] = [];
      let working = playlists;

      for (const file of files) {
        let text: string;
        try {
          text = await file.text();
        } catch (err) {
          // One unreadable file must not discard the whole batch (mirrors
          // refreshLibrary's per-file tolerance).
          console.warn('playlist import: could not read', file.name, err);
          messages.push(`Could not read "${file.name}"`);
          continue;
        }
        const ext = file.name.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
        const entries = ext === '.pls' ? parsePLS(text) : parseM3U(text);
        if (entries.length === 0) {
          messages.push(`No tracks found in "${file.name}"`);
          continue;
        }

        const { matched, unmatched } = matchImportEntries(entries, librarySongs);
        const existing = findLinkedPlaylist(working, file.name);

        if (existing) {
          // Never annihilate a populated linked playlist on a total miss:
          // that's a library that isn't loaded yet / a file pointing at another
          // root, not "the user emptied this playlist". Replace semantics are
          // for real content, not for an all-miss accident.
          if (matched.length === 0 && existing.songs.length > 0) {
            messages.push(
              `Nothing matched — "${existing.name}" left unchanged (0 of ${entries.length} found)`,
            );
            continue;
          }
          const { added, removed } = diffSongSets(existing.songs, matched);
          ops.push({ kind: 'update', id: existing.id, songs: matched, source: file.name });
          working = working.map((p) =>
            p.id === existing.id ? { ...p, songs: matched, importSource: file.name } : p,
          );
          messages.push(
            `Updated "${existing.name}" — ${matched.length} ${
              matched.length === 1 ? 'track' : 'tracks'
            }` + (added || removed ? ` (+${added}, -${removed})` : ' (no change)'),
          );
        } else {
          const name = file.name.replace(/\.[^.]+$/, '');
          const playlist: Playlist = {
            id: crypto.randomUUID(),
            name,
            songs: matched,
            createdAt: new Date(),
            importSource: file.name,
          };
          ops.push({ kind: 'create', playlist });
          working = [...working, playlist];
          messages.push(
            `Created "${name}" with ${matched.length} of ${entries.length} tracks` +
              (unmatched.length > 0 ? ` (${unmatched.length} not found)` : ''),
          );
        }
      }

      if (ops.length > 0) {
        setPlaylists((prev) =>
          ops.reduce(
            (acc, op) =>
              op.kind === 'update'
                ? acc.map((p) =>
                    p.id === op.id ? { ...p, songs: op.songs, importSource: op.source } : p,
                  )
                : [...acc, op.playlist],
            prev,
          ),
        );
      }
      // Always report — a drop that changed nothing must not look ignored.
      if (messages.length > 0) setNotification(messages.join(' · '));
      setShowUpload(false);
    },
    [playlists],
  );

  const handleLrcImport = useCallback(
    async (files: File[]) => {
      const { parseLRC } = await import('./lib/lrc');
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

  // "Find lyrics": re-parse the file (recovers embedded lyrics the old ingest
  // missed), then fall back to LRCLIB. Merges + persists onto the song.
  const handleFetchLyrics = useCallback(async () => {
    const song = currentSong;
    if (!song || fetchingLyrics) return;
    setFetchingLyrics(true);
    setFetchLyricsError(null);
    try {
      let lyrics: LyricLine[] | null | undefined;
      if (song.file) {
        try {
          // Dynamic import so `music-metadata` (~99KB + parser chunks) stays out
          // of the startup bundle — it's only needed for this on-demand re-parse.
          const { parseBlob } = await import('music-metadata');
          lyrics = extractLyrics(await parseBlob(song.file));
        } catch {
          // re-parse failed — fall through to the online lookup
        }
      }
      if (!lyrics || lyrics.length === 0) {
        const { fetchLyricsOnline } = await import('./lib/lyrics-online');
        lyrics = await fetchLyricsOnline({
          title: song.title,
          artist: song.artist,
          album: song.album,
          duration: song.duration,
        });
      }
      if (lyrics && lyrics.length > 0) {
        const found = lyrics;
        setPlaylists((prev) =>
          prev.map((p) => ({
            ...p,
            songs: p.songs.map((s) => (s.id === song.id ? { ...s, lyrics: found } : s)),
          })),
        );
        setCurrentSong((cur) => (cur && cur.id === song.id ? { ...cur, lyrics: found } : cur));
      } else {
        setFetchLyricsError('No lyrics found.');
      }
    } finally {
      setFetchingLyrics(false);
    }
  }, [currentSong, fetchingLyrics]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const allFiles = Array.from(files);
      const playlistFiles = allFiles.filter(isPlaylistFile);
      const lrcFiles = allFiles.filter(isLrcFile);
      // Playlist files must be excluded EXPLICITLY: Chromium reports .m3u as
      // `audio/x-mpegurl`, which passes the audio/ prefix check and would
      // double-process the file as both a playlist and a bogus "song".
      const arr = allFiles.filter(
        isAudioFile, // MIME *or* known extension; excludes playlist/lrc files
      );
      if (arr.length === 0 && playlistFiles.length === 0 && lrcFiles.length === 0) {
        // No native alert(): it blocks the main thread and pauses the audio
        // engine (CLAUDE.md "Prompt modal").
        setNotification(
          `Nothing to add — ${allFiles.length === 1 ? 'that file is' : 'those files are'} not audio, playlist (.m3u/.pls) or lyric (.lrc) files.`,
        );
        return;
      }
      // Audio FIRST, playlists after: a combined drop (songs + .m3u) must
      // match the playlist entries against the songs from this very drop,
      // which is why the ingested list is threaded into the import below.
      const ingestedNow: Song[] = [];
      if (arr.length > 0) {
        // Parallel extraction (the metadata client's pool bounds concurrency)
        // with ORDER-STABLE PROGRESSIVE flushes: results land in an
        // index-addressed array and only the contiguous ready prefix is
        // appended, so songs appear in drop order every ~8 completions
        // instead of the list staying empty until the whole batch finishes.
        // extractMetadata never rejects (fallback Song), so Promise.all is safe.
        // 'favorites' is a virtual view — route ingested songs to Library.
        const targetId = activePlaylistId === 'favorites' ? 'library' : activePlaylistId;
        const results: (Song | undefined)[] = new Array(arr.length);
        let completed = 0;
        let flushedUpTo = 0;
        const flushReadyPrefix = () => {
          const ready: Song[] = [];
          while (flushedUpTo < arr.length && results[flushedUpTo] !== undefined) {
            ready.push(results[flushedUpTo] as Song);
            flushedUpTo++;
          }
          if (ready.length > 0) {
            setPlaylists((prev) =>
              prev.map((p) =>
                p.id === targetId ? { ...p, songs: [...p.songs, ...ready] } : p,
              ),
            );
          }
        };
        await Promise.all(
          arr.map(async (file, i) => {
            results[i] = await extractMetadata(file);
            completed++;
            if (completed % 8 === 0) flushReadyPrefix();
          }),
        );
        flushReadyPrefix();
        ingestedNow.push(...(results.filter(Boolean) as Song[]));
        requestPersistOnce();
      }
      if (playlistFiles.length > 0) await handlePlaylistImport(playlistFiles, ingestedNow);
      if (lrcFiles.length > 0) await handleLrcImport(lrcFiles);
      setShowUpload(false);
    },
    [activePlaylistId, extractMetadata, requestPersistOnce, handlePlaylistImport, handleLrcImport],
  );

  const addFolderHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      const root = await storage.addLibraryRoot(handle.name, handle);
      if (!root) return; // dedupe — already added

      // Exclude playlist files explicitly: Chromium reports `.m3u` as
      // `audio/x-mpegurl`, so the default audio filter would ingest them as
      // unplayable junk "songs" — which Refresh would then mass-delete.
      const ingested = await ingestDirectoryHandle(
        handle,
        '',
        isAudioFile,
      );
      // Parallel extraction (worker pool bounds concurrency); `map` preserves
      // the walk order so path-based ids line up with stable playlist order.
      const songs: Song[] = await Promise.all(
        ingested.map(async ({ file, fileHandle, relativePath }) => {
          const base = await extractMetadata(file);
          return { ...base, id: `${root.id}/${relativePath}`, fileHandle };
        }),
      );

      setLibraryRoots((prev) => [...prev, root]);
      // 'favorites' is a virtual view — route ingested songs to Library.
      const targetId = activePlaylistId === 'favorites' ? 'library' : activePlaylistId;
      setPlaylists((prev) =>
        prev.map((p) =>
          p.id === targetId ? { ...p, songs: [...p.songs, ...songs] } : p,
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
    // The in-memory library now mirrors storage — saving is safe again.
    loadedRef.current = true;
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
    if (nextSong) {
      // Consuming from the queue? Drop everything up to AND including the
      // consumed entry — resolveNextSong may have skipped leading entries
      // equal to the (old) current song, and they must not linger at the head.
      // When nextSong came from the playlist walk instead, findIndex is
      // almost always -1 (the queue held only current-duplicates); the one
      // exception — single-song playlist under repeat-all, where the walk
      // wraps to current itself and can match a stale queued duplicate — is
      // also safe: slicing off that duplicate is harmless, it could never
      // have played anyway.
      const cameFromQueue = queue.some((s) => s.id === nextSong.id);
      setQueue((q) => {
        const qi = q.findIndex((s) => s.id === nextSong.id);
        return qi === -1 ? q : q.slice(qi + 1);
      });
      // Advancing through the playlist moves the Spotify-style bookmark;
      // consuming from the queue leaves it where the listener left off.
      if (!cameFromQueue) lastPlaylistSongRef.current = nextSong;
      setCurrentSong(nextSong);
    }
  };

  const playPrev = () => {
    if (!activePlaylist || !currentSong) return;
    const idx = activePlaylist.songs.findIndex((s) => s.id === currentSong.id);
    const prev = idx - 1;
    if (prev >= 0) {
      lastPlaylistSongRef.current = activePlaylist.songs[prev];
      setCurrentSong(activePlaylist.songs[prev]);
    }
  };

  // Keep the engine's onEnded ref pointing at the freshest playNext closure
  onEndedRef.current = playNext;

  const cycleRepeat = () => {
    setRepeatMode((m) => (m === 'none' ? 'all' : m === 'all' ? 'one' : 'none'));
  };

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      // Same scoped-vs-app-wide split as handleDeleteSong.
      const scoped = activePlaylistId !== 'library' && activePlaylistId !== 'favorites';
      const playlistName =
        activePlaylistId === 'favorites'
          ? 'Favorites'
          : playlists.find((p) => p.id === activePlaylistId)?.name ?? 'this playlist';
      const noun = ids.length === 1 ? 'song' : 'songs';
      requestConfirm(
        `Delete ${ids.length} ${noun}?`,
        scoped
          ? `${ids.length} ${noun} will be removed from "${playlistName}". Songs remain in Library.`
          : `${ids.length} ${noun} will be permanently removed from your library and all playlists.`,
        () => {
          const idSet = new Set(ids);
          setPlaylists((prev) =>
            scoped
              ? prev.map((p) =>
                  p.id === activePlaylistId
                    ? { ...p, songs: p.songs.filter((s) => !idSet.has(s.id)) }
                    : p,
                )
              : prev.map((p) => ({ ...p, songs: p.songs.filter((s) => !idSet.has(s.id)) })),
          );
          if (!scoped) {
            setCurrentSong((prev) => (prev && idSet.has(prev.id) ? null : prev));
            setQueue((q) => q.filter((s) => !idSet.has(s.id)));
          }
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
    // A manual pick re-bookmarks the walk (the clicked song is always in the
    // visible/active playlist).
    lastPlaylistSongRef.current = song;
    setCurrentSong(song);
  }, []);

  const playNextInQueue = useCallback((id: string) => {
    // The currently-playing song can't be queued: the engine's replay-in-place
    // path (next.url === active.src) never calls onEnded, so it could never
    // dequeue — see the spec's amended edge case.
    if (currentSongIdRef.current === id) {
      setNotification('Already playing');
      return;
    }
    const song = filteredSongsRef.current.find((s) => s.id === id);
    if (!song) return;
    setQueue((q) => [song, ...q]);
    setNotification(`Playing next: ${song.title}`);
  }, []);

  const addToQueue = useCallback((id: string) => {
    if (currentSongIdRef.current === id) {
      setNotification('Already playing');
      return;
    }
    const song = filteredSongsRef.current.find((s) => s.id === id);
    if (!song) return;
    setQueue((q) => [...q, song]);
    setNotification(`Added to queue: ${song.title}`);
  }, []);

  const removeFromQueue = useCallback((index: number, id: string) => {
    // Stale-index guard: the queue can shrink between paint and click
    // (auto-advance dequeues the head). Only remove when index and id still
    // agree — a mismatched click is dropped rather than removing a neighbor.
    setQueue((q) => (q[index]?.id === id ? q.filter((_, i) => i !== index) : q));
  }, []);
  const reorderQueue = useCallback((from: number, to: number) => {
    setQueue((q) => safeQueueMove(q, from, to));
  }, []);
  const clearQueue = useCallback(() => setQueue([]), []);

  const toggleFavorite = useCallback((id: string) => {
    setPlaylists((prev) =>
      prev.map((p) =>
        p.songs.some((s) => s.id === id)
          ? { ...p, songs: p.songs.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s)) }
          : p,
      ),
    );
    setCurrentSong((prev) =>
      prev?.id === id ? { ...prev, favorite: !prev.favorite } : prev,
    );
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
      // Scoped delete: from a user playlist, remove only there (the song stays
      // in Library — matching what the dialog promises). From Library or the
      // Favorites view, delete is app-wide and permanent.
      const scoped = aid !== 'library' && aid !== 'favorites';
      const playlistName =
        aid === 'favorites'
          ? 'Favorites'
          : playlistsRef.current.find((p) => p.id === aid)?.name ?? 'this playlist';
      requestConfirm(
        `Delete "${song.title}"?`,
        scoped
          ? `Removes from "${playlistName}". Song remains in Library.`
          : 'Permanently removes from your library and all playlists.',
        () => {
          setPlaylists((prev) =>
            scoped
              ? prev.map((p) =>
                  p.id === aid ? { ...p, songs: p.songs.filter((s) => s.id !== id) } : p,
                )
              : prev.map((p) => ({ ...p, songs: p.songs.filter((s) => s.id !== id) })),
          );
          // Scoped removal keeps the song in the library — don't stop playback.
          if (!scoped) {
            setCurrentSong((prev) => (prev?.id === id ? null : prev));
            setQueue((q) => q.filter((s) => s.id !== id));
          }
        },
      );
    },
    [requestConfirm],
  );

  const exportPlaylist = useCallback(
    async (playlistId: string) => {
      const playlist =
        playlistId === 'favorites' ? virtualFavorites : playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      const { serializeM3U, sanitizeFilename } = await import('./lib/playlist-export');
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
    [playlists, virtualFavorites],
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
    // Linked playlists whose source file was found on disk this sweep:
    // { playlistId → parsed entries }. Parsing is async so it happens here;
    // MATCHING happens inside the state updater below, where the
    // post-refresh Library song list is known.
    const { parseM3U, parsePLS, findLinkedPlaylist, matchImportEntries } =
      await import('./lib/playlist-import');
    const resyncs: { playlistId: string; entries: ImportEntry[] }[] = [];

    for (const root of libraryRoots) {
      // ONE walk collecting songs AND playlist files (getFile runs before the
      // filter either way, so the wider predicate is free).
      const walked = await ingestDirectoryHandle(
        root.handle,
        '',
        (f) => isAudioFile(f) || isPlaylistFileName(f.name),
      );
      const ingested = walked.filter((w) => !isPlaylistFileName(w.file.name));

      for (const { file } of walked.filter((w) => isPlaylistFileName(w.file.name))) {
        // Only files already LINKED to a playlist are re-synced — Refresh
        // must never spontaneously create playlists the user didn't import.
        const linked = findLinkedPlaylist(playlists, file.name);
        if (!linked) continue;
        // Same name in two roots/folders: first found wins, and the toast
        // must not count the playlist twice.
        if (resyncs.some((r) => r.playlistId === linked.id)) continue;
        try {
          const text = await file.text();
          const entries = file.name.toLowerCase().endsWith('.pls')
            ? parsePLS(text)
            : parseM3U(text);
          // A file that parses to zero entries is treated as truncated/corrupt
          // rather than "the user emptied this playlist" — the two are
          // indistinguishable here, and refusing to wipe is the safe reading.
          if (entries.length > 0) resyncs.push({ playlistId: linked.id, entries });
        } catch (err) {
          console.warn('refresh: could not read playlist', file.name, err);
        }
      }

      const fresh = ingested.filter(({ relativePath }) => {
        const id = `${root.id}/${relativePath}`;
        seenIds.add(id);
        return !existingIds.has(id);
      });
      // Parallel extraction of only the NEW files (worker pool bounds
      // concurrency); order within a root is preserved by `map`.
      const extracted = await Promise.all(
        fresh.map(async ({ file, fileHandle, relativePath }) => {
          const base = await extractMetadata(file);
          return { ...base, id: `${root.id}/${relativePath}`, fileHandle };
        }),
      );
      newSongs.push(...extracted);
    }

    const removedIds = new Set(
      Array.from(existingIds).filter((id) => !seenIds.has(id)),
    );

    const resyncById = new Map(resyncs.map((r) => [r.playlistId, r.entries]));

    setPlaylists((prev) => {
      const libraryAfter = [
        ...(prev.find((p) => p.id === 'library')?.songs.filter((s) => !removedIds.has(s.id)) ??
          []),
        ...newSongs,
      ];
      return prev.map((p) => {
        if (p.id === 'library') return { ...p, songs: libraryAfter };
        // Linked playlist with a source file on disk: replace from the file
        // (matched against the POST-refresh library, so orphans can't survive).
        const entries = resyncById.get(p.id);
        if (entries) {
          const { matched } = matchImportEntries(entries, libraryAfter);
          // Same all-miss guard as the import path (see handlePlaylistImport):
          // keep the existing songs rather than wiping a populated playlist.
          if (matched.length === 0 && p.songs.length > 0) {
            return { ...p, songs: p.songs.filter((s) => !removedIds.has(s.id)) };
          }
          return { ...p, songs: matched };
        }
        // Everything else: just drop orphans
        return {
          ...p,
          songs: p.songs.filter((s) => !removedIds.has(s.id)),
        };
      });
    });
    setCurrentSong((prev) => (prev && removedIds.has(prev.id) ? null : prev));
    setQueue((q) => q.filter((s) => !removedIds.has(s.id)));

    const resyncNote =
      resyncs.length > 0
        ? ` · ${resyncs.length} ${resyncs.length === 1 ? 'playlist' : 'playlists'} re-synced`
        : '';
    if (newSongs.length === 0 && removedIds.size === 0) {
      setNotification(`Library is up to date${resyncNote}`);
    } else {
      setNotification(
        `Refreshed: +${newSongs.length} ${newSongs.length === 1 ? 'song' : 'songs'}, -${removedIds.size} removed${resyncNote}`,
      );
    }
  }, [libraryRoots, playlists, extractMetadata]);

  // Re-scan: re-read embedded tags for songs Vibes already knows. Refresh only
  // diffs PATHS, so an external tagger (beets) rewriting tags in place is
  // invisible to it — this is the counterpart that re-reads known files.
  // Handle-backed songs only: a blob-persisted song's bytes were copied at
  // ingest, so re-parsing them could never see a later edit.
  const [rescanning, setRescanning] = useState(false);
  const rescanningRef = useRef(false);

  const rescanTags = useCallback(async () => {
    // libraryStatus/libraryRoots below are belt-and-braces: the button is
    // only rendered when they hold, and the `⋯` menu entry carries the same
    // `libraryStatus === 'ready'` gate (see headerActions below). The
    // IN-PROGRESS case is different — neither surface disables itself while
    // a scan is running, so tell the user instead of swallowing the click.
    if (rescanningRef.current) {
      setNotification('Re-scan already running…');
      return;
    }
    if (libraryStatus !== 'ready' || libraryRoots.length === 0) return;

    // Deduped across playlists by id: ingest adds songs only to the active
    // playlist, so Library is NOT a strict superset.
    const candidates: Song[] = [];
    const seen = new Set<string>();
    for (const p of playlists) {
      for (const s of p.songs) {
        if (s.fileHandle && !seen.has(s.id)) {
          seen.add(s.id);
          candidates.push(s);
        }
      }
    }

    if (candidates.length === 0) {
      setNotification('Re-scan needs a folder-based library (Chrome). Nothing to re-scan.');
      return;
    }

    const total = candidates.length;
    requestConfirm(
      'Re-scan tags',
      `Re-read embedded tags for ${total} ${total === 1 ? 'track' : 'tracks'}? Hearts, playlists and the queue are kept.`,
      () => {
        void runRescan(candidates).catch((err) => {
          // requestPermission can throw (e.g. SecurityError) before the
          // rescanning flag is even set — without this catch that surfaces
          // as an unhandled rejection instead of a toast. The try/finally
          // inside runRescan already guarantees the flag itself can't get
          // stuck; this is purely about giving the user SOME feedback.
          console.warn('re-scan: unexpected failure', err);
          setNotification('Re-scan failed unexpectedly.');
        });
      },
      'Re-scan',
      false, // not destructive — keep the confirm button off the `danger` token
    );

    async function runRescan(songs: Song[]) {
      for (const root of libraryRoots) {
        const perm = await root.handle.requestPermission?.({ mode: 'read' });
        if (perm !== 'granted') {
          setNotification('Permission denied for library folder');
          return;
        }
      }

      rescanningRef.current = true;
      setRescanning(true);
      try {
        setNotification(`Re-scanning tags… 0/${songs.length}`);

        // Store the RAW inputs, not a merged Song. Merging here against the
        // pre-sweep SNAPSHOT (`song`, captured when the sweep started) and
        // writing that wholesale at apply time would silently REVERT any
        // live-state mutation that happened mid-sweep — a heart toggled, or
        // lyrics just fetched via LRCLIB — because every field not sourced
        // from the file would revert to its snapshot value. The merge must
        // happen against the LIVE song, at apply time, inside `apply` below.
        const patches = new Map<string, { meta: ExtractedMeta; replacements: RescanReplacements }>();
        // Original url per id, for songs whose url/file get swapped — keyed
        // by id (not a flat array) so the playing song's entry can be
        // pulled back out by id at apply time instead of by value.
        const staleUrls = new Map<string, string>();
        // Old cover-art urls to revoke — no playing-song exception needed
        // here, swapping cover art never restarts playback.
        const staleCovers: string[] = [];
        let changed = 0;
        let failed = 0;
        let done = 0;

        await Promise.all(
          songs.map(async (song) => {
            try {
              // Fresh read: song.file is a snapshot from load time and
              // throws NotReadableError once the bytes on disk have changed.
              const file = await song.fileHandle!.getFile();
              const meta = await extractMeta(file);
              if (!meta) throw new Error('unparseable');

              // Always build the file/url replacement here — whether it
              // actually gets USED depends on which song is playing at
              // APPLY time (see the single playingId checkpoint below), not
              // on this fetch-time snapshot, which can be stale by the time
              // the whole sweep's batch write happens (a minute-plus later
              // on a large library).
              const replacements: RescanReplacements = { file, url: URL.createObjectURL(file) };
              staleUrls.set(song.id, song.url);

              if (meta.picData && meta.picFormat) {
                const raw = new Blob([meta.picData as BlobPart], { type: meta.picFormat });
                const blob = await downscaleCover(raw);
                // Same bytes re-embedded (the common beets `embedart`
                // case): skip the swap so a no-op scan stays a no-op — no
                // fresh object URL, nothing to revoke, and the completion
                // toast's "changed" count stays honest.
                if (blob.size !== song.coverBlob?.size) {
                  replacements.cover = { coverArt: URL.createObjectURL(blob), coverBlob: blob };
                  if (song.coverArt) staleCovers.push(song.coverArt);
                }
              }

              patches.set(song.id, { meta, replacements });
              // Computed against the pre-sweep SNAPSHOT, purely for the
              // toast's "changed" count — deliberately not moved to apply
              // time (that would need re-running this for every song right
              // before the writes, for a count that's already an
              // approximation of "how much did the file change").
              if (hasMetaChanged(song, mergeRescan(song, meta, replacements))) changed += 1;
            } catch (err) {
              // One unreadable file must never abort the sweep.
              console.warn('re-scan: could not read', song.title, err);
              failed += 1;
            } finally {
              done += 1;
              // Every 10 keeps the toast alive (its 5s timer resets on each
              // set) without re-rendering App once per file.
              if (done % 10 === 0) setNotification(`Re-scanning tags… ${done}/${songs.length}`);
            }
          }),
        );

        // The ONE playing-song checkpoint, read once, right here, right
        // before the writes — NOT at fetch time above. A fetch-time check
        // would go stale on a long sweep: a song can start playing between
        // its OWN tag fetch and this point. `apply` below merges each patch
        // onto the LIVE song (not the pre-sweep snapshot), so mid-sweep
        // mutations survive, and it omits file/url for the playing song so
        // RescanReplacements' "omit to keep current" semantics leave the
        // <audio> element's src untouched — swapping it would restart the
        // track from 0.
        const playingId = currentSongIdRef.current;
        // Urls `apply` will DISCARD (never assigned to any song) — nobody
        // else revokes these, since `staleUrls` holds only OLD urls, so
        // they have to be captured here or they leak: one fresh blob URL
        // pinning a whole audio file, per re-scan-while-playing.
        const discardedUrls: string[] = [];
        if (playingId) {
          staleUrls.delete(playingId);
          const discarded = patches.get(playingId)?.replacements.url;
          if (discarded) discardedUrls.push(discarded);
        }

        const apply = (s: Song): Song => {
          const p = patches.get(s.id);
          if (!p) return s;
          const r: RescanReplacements =
            s.id === playingId ? { ...p.replacements, file: undefined, url: undefined } : p.replacements;
          return mergeRescan(s, p.meta, r);
        };

        if (patches.size > 0) {
          setPlaylists((prev) => prev.map((p) => ({ ...p, songs: p.songs.map(apply) })));
          setCurrentSong((prev) => (prev ? apply(prev) : prev));
          setQueue((q) => q.map(apply));
        }

        const stale = [...staleUrls.values(), ...staleCovers, ...discardedUrls];
        if (stale.length > 0) {
          // Deferred past React's commit, same reason as the revoke effect.
          setTimeout(() => {
            for (const url of stale) URL.revokeObjectURL(url);
          }, 0);
        }

        if (failed === songs.length) {
          // Every file unreadable almost always means they MOVED — an
          // external tagger re-organised paths, which is Refresh's job.
          setNotification(
            `Re-scan failed for all ${songs.length} ${songs.length === 1 ? 'track' : 'tracks'} — the files may have moved. Try Refresh.`,
          );
          return;
        }
        const failedNote = failed > 0 ? ` · ${failed} unreadable` : '';
        setNotification(
          `Re-scan complete: ${changed} of ${songs.length} ${songs.length === 1 ? 'track' : 'tracks'} updated${failedNote}`,
        );
      } finally {
        // Always runs, even on an unexpected throw mid-sweep — otherwise
        // re-scan would be permanently "running" (dead button, silent `⋯`
        // guard above) for the rest of the session with no way to recover.
        rescanningRef.current = false;
        setRescanning(false);
      }
    }
  }, [libraryStatus, libraryRoots, playlists, requestConfirm]);

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
        if (targetId === 'favorites') {
          const idSet = new Set(ids);
          setPlaylists((prev) =>
            prev.map((p) =>
              p.songs.some((s) => idSet.has(s.id))
                ? {
                    ...p,
                    songs: p.songs.map((s) => (idSet.has(s.id) ? { ...s, favorite: true } : s)),
                  }
                : p,
            ),
          );
          setCurrentSong((prev) =>
            prev && idSet.has(prev.id) ? { ...prev, favorite: true } : prev,
          );
          setNotification(
            `Added ${ids.length} ${ids.length === 1 ? 'song' : 'songs'} to Favorites`,
          );
          setSelectionMode(false);
          return;
        }
        const sourceSongs =
          activePlaylistId === 'favorites'
            ? favoriteSongs
            : playlists.find((p) => p.id === activePlaylistId)?.songs ?? [];
        const songsToCopy = sourceSongs.filter((s) => ids.includes(s.id));
        if (songsToCopy.length === 0) return;

        const isMove =
          ((activatorEvent as PointerEvent | KeyboardEvent | MouseEvent | null)?.ctrlKey ||
            (activatorEvent as PointerEvent | KeyboardEvent | MouseEvent | null)?.metaKey) ??
          false;
        // Never move out of Library or the virtual Favorites view (always copy)
        const effectiveMove =
          isMove && activePlaylistId !== 'library' && activePlaylistId !== 'favorites';

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
    [playlists, activePlaylistId, selectionMode, handleReorder, favoriteSongs],
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

  // Close the mobile now-playing view if the track goes away (mirrors PiP).
  useEffect(() => {
    if (mobilePlayerOpen && !currentSong) setMobilePlayerOpen(false);
  }, [mobilePlayerOpen, currentSong]);

  // Clear any stale "no lyrics found" message when the track changes.
  useEffect(() => {
    setFetchLyricsError(null);
  }, [currentSong?.id]);

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
      // Delegates to the collector so BOTH folder paths work: Chromium
      // directory handles (persistable roots) and the Firefox/Safari
      // webkitGetAsEntry recursion — App used to handle only the former, so
      // dropping a folder in Firefox silently yielded nothing.
      const { directoryHandles, files } = await ingestDataTransferItems(items);
      for (const handle of directoryHandles) await addFolderHandle(handle);
      if (files.length > 0) await handleFiles(files.map((f) => f.file));
      if (directoryHandles.length === 0 && files.length === 0) {
        setNotification('Nothing to add — drop audio files or a folder of music.');
      }
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
      ArrowRight: (e) => {
        if (e.shiftKey) return playNext();
        if (!currentSong) return;
        e.preventDefault();
        seek(Math.min(duration || currentTime + 10, currentTime + 10));
      },
      ArrowLeft: (e) => {
        if (e.shiftKey) return playPrev();
        if (!currentSong) return;
        e.preventDefault();
        seek(Math.max(0, currentTime - 10));
      },
      Slash: () => searchInputRef.current?.focus(),
      KeyL: () => togglePanel('lyrics'),
      KeyQ: () => togglePanel('queue'),
      KeyS: () => togglePanel('stats'),
      Escape: () => {
        if (mobilePlayerOpen) {
          setMobilePlayerOpen(false);
          return;
        }
        if (selectionMode) {
          setSelectionMode(false);
          return;
        }
        if (showUpload) {
          setShowUpload(false);
          return;
        }
        if (showQueue) {
          setShowQueue(false);
          return;
        }
        if (showStats) {
          setShowStats(false);
          return;
        }
        if (showLyrics) {
          setShowLyrics(false);
          return;
        }
        // Mobile only: the desktop sidebar is persistent — closing it on
        // Escape there would be hostile, not helpful.
        if (sidebarOpen && !window.matchMedia('(min-width: 1024px)').matches) {
          setSidebarOpen(false);
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
    {
      // Any App-level modal suppresses shortcuts (Escape still passes) —
      // the focus traps park focus on modal buttons, and q/l/slash firing
      // behind a dialog would act on hidden UI.
      isBlocked: showUpload || confirm !== null || promptState !== null || sharedTrack !== null,
    },
  );

  // Secondary header actions — shown inline on desktop, in the `⋯` menu on mobile.
  const headerActions: HeaderAction[] = [
    {
      key: 'select',
      label: 'Select',
      icon: ListChecks,
      onClick: () => setSelectionMode((v) => !v),
      active: selectionMode,
    },
    {
      key: 'lyrics',
      label: 'Lyrics',
      icon: Mic2,
      onClick: () => togglePanel('lyrics'),
      active: showLyrics,
    },
    ...(currentSong
      ? [{ key: 'share', label: 'Share', icon: Share2, onClick: handleShare }]
      : []),
    ...(activePlaylistId === 'library' && libraryRoots.length > 0
      ? [{ key: 'refresh', label: 'Refresh library', icon: RefreshCw, onClick: refreshLibrary }]
      : []),
    ...(activePlaylistId === 'library' && libraryRoots.length > 0 && libraryStatus === 'ready'
      ? [{ key: 'rescan', label: 'Re-scan tags', icon: ScanLine, onClick: rescanTags }]
      : []),
    ...(activePlaylist && activePlaylist.songs.length > 0
      ? [
          {
            key: 'export',
            label: 'Export playlist',
            icon: Download,
            onClick: () => exportPlaylist(activePlaylistId),
          },
        ]
      : []),
    ...(canInstall || isIOS
      ? [
          {
            key: 'install',
            label: 'Install Vibes',
            icon: ArrowDownToLine,
            onClick: canInstall
              ? promptInstall
              : () =>
                  setNotification('To install: tap the Share button, then "Add to Home Screen".'),
          },
        ]
      : []),
  ];

  // Lazy-mount gating for the usePresence surfaces: they must STAY mounted
  // after first open so their exit animation can play (a bare `{open && ...}`
  // would unmount abruptly), but mounting them eagerly would defeat the
  // code-split. Monotonic render-phase ref writes: once opened, always mounted.
  if (showLyrics) lyricsEverOpenedRef.current = true;
  if (showQueue) queueEverOpenedRef.current = true;
  if (mobilePlayerOpen) mobilePlayerEverOpenedRef.current = true;
  const mountLyricsPanel = showLyrics || lyricsEverOpenedRef.current;
  const mountQueuePanel = showQueue || queueEverOpenedRef.current;
  const mountMobileNowPlaying = mobilePlayerOpen || mobilePlayerEverOpenedRef.current;

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
          <div
            className={`fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-300 ${
              sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <Sidebar
            playlists={sidebarPlaylists}
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
              if (id === 'library' || id === 'favorites') return;
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
            onRename={(id) => {
              if (id === 'library' || id === 'favorites') return;
              const playlist = playlists.find((p) => p.id === id);
              if (!playlist) return;
              setPromptState({
                title: 'Rename playlist',
                placeholder: 'Playlist name',
                defaultValue: playlist.name,
                confirmLabel: 'Rename',
                onConfirm: (name) => {
                  setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
                },
              });
            }}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <header className="p-4 lg:px-6 lg:py-3 border-b border-white/10">
              {!sidebarOpen && (
                <div className="flex items-center justify-center space-x-3 mb-3">
                  <div className="w-12 h-12 bg-gradient-to-r from-amber to-coral rounded-xl flex items-center justify-center shadow-lg">
                    <Music className="h-7 w-7 text-deep" />
                  </div>
                  <h1 className="text-2xl lg:text-3xl font-bold font-display bg-gradient-to-r from-amber to-coral bg-clip-text text-transparent">
                    Vibes
                  </h1>
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                {!sidebarOpen && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="p-2 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 transition-all"
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
                  <div className="hidden lg:flex items-center gap-2">
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
                    onClick={() => togglePanel('lyrics')}
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
                  {activePlaylistId === 'library' &&
                    libraryRoots.length > 0 &&
                    libraryStatus === 'ready' && (
                      <button
                        onClick={rescanTags}
                        disabled={rescanning}
                        className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all disabled:opacity-40"
                        title="Re-read embedded tags from disk"
                        aria-label="Re-scan tags"
                      >
                        <ScanLine className="h-4 w-4" />
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
                  </div>
                  <HeaderMenu actions={headerActions} />
                  <button
                    onClick={() => setShowUpload(true)}
                    className="bg-gradient-to-r from-amber to-coral hover:brightness-110 text-deep px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium shadow-lg"
                  >
                    Add Music
                  </button>
                </div>
              </div>
            </header>

            <div className="px-4 lg:px-6 pt-2">
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
                onToggleFavorite={() => toggleFavorite(currentSong.id)}
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
                onPlayNext={playNextInQueue}
                onAddToQueue={addToQueue}
                onToggleFavorite={toggleFavorite}
                onBatchDelete={handleBatchDelete}
                onReorder={handleReorder}
                isFilterActive={
                  searchQuery.trim().length > 0 || sortBy !== 'manual' || activePlaylistId === 'favorites'
                }
                selectionMode={selectionMode}
                onSelectionModeChange={setSelectionMode}
                emptyHint={
                  searchQuery.trim()
                    ? {
                        primary: `No matches for "${searchQuery.trim()}"`,
                        secondary: 'Try a different search',
                      }
                    : activePlaylistId === 'favorites'
                      ? {
                          primary: 'No favorites yet',
                          secondary: 'Click the heart on a song to add it',
                        }
                      : undefined
                }
              />
              {mountLyricsPanel && (
                <Suspense fallback={null}>
                  <LyricsPanel
                    open={showLyrics}
                    lyrics={currentSong?.lyrics}
                    currentTime={currentTime}
                    onClose={() => setShowLyrics(false)}
                    onSeek={seek}
                    onFetch={currentSong ? handleFetchLyrics : undefined}
                    fetching={fetchingLyrics}
                    fetchError={fetchLyricsError}
                  />
                </Suspense>
              )}
              {mountQueuePanel && (
                <Suspense fallback={null}>
                  <QueuePanel
                    open={showQueue}
                    currentSong={currentSong}
                    queue={queue}
                    upNext={upNext}
                    shuffle={shuffle}
                    onClose={() => setShowQueue(false)}
                    onRemove={removeFromQueue}
                    onReorder={reorderQueue}
                    onClear={clearQueue}
                  />
                </Suspense>
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
        crossfade={crossfade}
        onCrossfadeChange={setCrossfade}
        sleepDeadline={sleepDeadline}
        onSetSleepTimer={handleSetSleepTimer}
        volume={volume}
        onVolumeChange={setVolume}
        onTogglePip={togglePip}
        supportsPip={'documentPictureInPicture' in window}
        isPipOpen={pipWindow !== null}
        onToggleQueue={() => togglePanel('queue')}
        isQueueOpen={showQueue}
        onExpand={() => setMobilePlayerOpen(true)}
        onToggleFavorite={currentSong ? () => toggleFavorite(currentSong.id) : undefined}
      />

      </DndContext>

      {mountMobileNowPlaying && (
        <Suspense fallback={null}>
          <MobileNowPlaying
            open={mobilePlayerOpen}
            onClose={() => setMobilePlayerOpen(false)}
            song={currentSong}
            playlistName={activePlaylist?.name}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            visualizerData={visualizerData}
            repeatMode={repeatMode}
            shuffle={shuffle}
            eqPreset={eqPreset}
            volume={volume}
            onPlayPause={togglePlayPause}
            onPrev={playPrev}
            onNext={playNext}
            onSeek={seek}
            onCycleRepeat={cycleRepeat}
            onToggleShuffle={() => setShuffle((s) => !s)}
            onEqPresetChange={setEqPreset}
            crossfade={crossfade}
            onCrossfadeChange={setCrossfade}
            sleepDeadline={sleepDeadline}
            onSetSleepTimer={handleSetSleepTimer}
            onVolumeChange={setVolume}
            onToggleLyrics={() => togglePanel('lyrics')}
            onToggleQueue={() => togglePanel('queue')}
            onShare={handleShare}
          />
        </Suspense>
      )}

      {pipWindow &&
        currentSong &&
        createPortal(
          <Suspense fallback={null}>
            <MiniPlayer
              song={currentSong}
              isPlaying={isPlaying}
              tintColor={tintColor}
              onPlayPause={togglePlayPause}
              onPrev={playPrev}
              onNext={playNext}
            />
          </Suspense>,
          pipWindow.document.body,
        )}

      {showUpload && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowUpload(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Add music"
        >
          <div
            ref={uploadPanelRef}
            className="bg-surface/90 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-white/10 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <label
              tabIndex={0}
              data-autofocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.click();
                }
              }}
              className="border-2 border-dashed border-white/20 hover:border-amber focus:border-amber focus:outline-none rounded-xl p-8 text-center transition-all cursor-pointer block">
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

      {confirm !== null && (
        <Suspense fallback={null}>
          <ConfirmModal
            open
            title={confirm.title}
            message={confirm.message}
            confirmLabel={confirm.confirmLabel}
            destructive={confirm.destructive ?? true}
            onConfirm={() => {
              confirm.onConfirm();
              setConfirm(null);
            }}
            onCancel={() => setConfirm(null)}
          />
        </Suspense>
      )}

      {promptState !== null && (
        <Suspense fallback={null}>
          <PromptModal
            open
            title={promptState.title}
            placeholder={promptState.placeholder}
            defaultValue={promptState.defaultValue}
            confirmLabel={promptState.confirmLabel}
            onConfirm={(value) => {
              promptState.onConfirm(value);
              setPromptState(null);
            }}
            onCancel={() => setPromptState(null)}
          />
        </Suspense>
      )}

      {sharedTrack !== null && (
        <Suspense fallback={null}>
          <SharedTrackModal track={sharedTrack} onClose={() => setSharedTrack(null)} />
        </Suspense>
      )}

      <audio ref={audioRefA} className="hidden" crossOrigin="anonymous" />
      <audio ref={audioRefB} className="hidden" crossOrigin="anonymous" />
    </div>
  );
}
