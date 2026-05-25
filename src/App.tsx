import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { LibraryRoot, Playlist, RepeatMode, Song } from './types';
import { useMetadataExtractor } from './hooks/useMetadataExtractor';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMediaSession } from './hooks/useMediaSession';
import { useAudioEngine } from './hooks/useAudioEngine';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { PlayerBar } from './components/PlayerBar';
import * as storage from './lib/storage';
import { ingestDirectoryHandle } from './lib/ingest';
import { filterSongs } from './lib/filter';
import { nextInPlaylist } from './lib/queue';
import type { EqPreset } from './lib/eq';

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [eqPreset, setEqPreset] = useState<EqPreset>('Off');

  const loadedRef = useRef(false);
  const persistRequestedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { extractMetadata } = useMetadataExtractor();

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId);
  const filteredSongs = filterSongs(activePlaylist?.songs ?? [], searchQuery);
  const nextSong = nextInPlaylist(currentSong, activePlaylist?.songs ?? [], repeatMode);

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
        setLibraryRoots(roots);
        setPlaylists(ensureLibrary(loaded));
        setEqPreset(storedEq);
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

  // Persist playlists on every change — guarded so we don't write before load
  useEffect(() => {
    if (!loadedRef.current) return;
    storage.savePlaylists(playlists).catch((err) => console.error('Save failed:', err));
  }, [playlists]);

  // Persist EQ preset on change — same guard
  useEffect(() => {
    if (!loadedRef.current) return;
    storage.saveEqPreset(eqPreset).catch((err) => console.error('EQ save failed:', err));
  }, [eqPreset]);

  const requestPersistOnce = useCallback(() => {
    if (persistRequestedRef.current) return;
    persistRequestedRef.current = true;
    storage.ensurePersisted().catch(() => {
      // Persist denied or unsupported — IDB still works, just evictable
    });
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith('audio/'));
      if (arr.length === 0) {
        alert('Please select audio files (MP3, WAV, FLAC, etc.)');
        return;
      }
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
      setShowUpload(false);
    },
    [activePlaylistId, extractMetadata, requestPersistOnce],
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
    const next = nextInPlaylist(currentSong, activePlaylist.songs, repeatMode);
    if (next) setCurrentSong(next);
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
      Escape: () => {
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
      className="h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex flex-col overflow-hidden"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
    >
      {isDragging && (
        <div className="fixed inset-0 bg-purple-500/20 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-purple-400">
          <div className="text-center">
            <Upload className="h-16 w-16 mx-auto mb-4 text-purple-400" />
            <p className="text-2xl font-bold text-purple-300">Drop your music files here!</p>
            <p className="text-purple-200 mt-2">Supports MP3, WAV, FLAC, and more</p>
          </div>
        </div>
      )}

      {libraryStatus === 'needs-prompt' && (
        <div className="bg-purple-500/20 border-b border-purple-400/30 px-4 py-2 flex items-center justify-between text-sm">
          <span className="text-purple-100">Welcome back. Click to restore your library.</span>
          <button
            onClick={restoreLibrary}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-3 py-1 rounded-md text-xs font-medium shadow"
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
              const name = prompt('Enter playlist name:');
              if (name) {
                setPlaylists((prev) => [
                  ...prev,
                  { id: crypto.randomUUID(), name, songs: [], createdAt: new Date() },
                ]);
              }
            }}
            onDelete={(id) => {
              if (id === 'library') return;
              setPlaylists((prev) => prev.filter((p) => p.id !== id));
              if (activePlaylistId === id) setActivePlaylistId('library');
            }}
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <header className="p-4 lg:p-6 border-b border-white/10">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
                  aria-label="Open menu"
                >
                  <div className="w-6 h-6 flex flex-col justify-center space-y-1">
                    <div className="w-full h-0.5 bg-white rounded" />
                    <div className="w-full h-0.5 bg-white rounded" />
                    <div className="w-full h-0.5 bg-white rounded" />
                  </div>
                </button>
                <h2 className="text-xl lg:text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  {activePlaylist?.name}
                  {searchQuery.trim() && activePlaylist && (
                    <span className="ml-2 text-sm font-normal text-white/50 bg-clip-border bg-none [-webkit-text-fill-color:initial]">
                      {filteredSongs.length} of {activePlaylist.songs.length}
                    </span>
                  )}
                </h2>
                <button
                  onClick={() => setShowUpload(true)}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium shadow-lg"
                >
                  Add Music
                </button>
              </div>
            </header>

            <div className="px-4 lg:px-6 pt-3">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search this playlist… (press / to focus)"
                className="w-full bg-white/5 text-sm text-white placeholder-white/40 rounded-lg border border-white/10 focus:border-purple-400 focus:outline-none px-3 py-2 transition-colors"
              />
            </div>

            <SongList
              songs={filteredSongs}
              currentSong={currentSong}
              isPlaying={isPlaying}
              onPlay={(song) => setCurrentSong(song)}
              onPause={togglePlayPause}
              onDelete={(id) => {
                setPlaylists((prev) =>
                  prev.map((p) => ({ ...p, songs: p.songs.filter((s) => s.id !== id) })),
                );
                if (currentSong?.id === id) setCurrentSong(null);
              }}
              emptyHint={
                searchQuery.trim()
                  ? {
                      primary: `No matches for "${searchQuery.trim()}"`,
                      secondary: 'Try a different search',
                    }
                  : undefined
              }
            />
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
        eqPreset={eqPreset}
        onPlayPause={togglePlayPause}
        onPrev={playPrev}
        onNext={playNext}
        onSeek={seek}
        onCycleRepeat={cycleRepeat}
        onEqPresetChange={setEqPreset}
      />

      {showUpload && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowUpload(false)}
        >
          <div
            className="bg-slate-800/90 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-white/10 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="border-2 border-dashed border-white/20 hover:border-purple-400 rounded-xl p-8 text-center transition-all cursor-pointer block">
              <input
                type="file"
                multiple
                accept="audio/*"
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
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-4 py-2 rounded-lg text-sm font-medium shadow"
              >
                Choose Folder
              </button>
            )}
          </div>
        </div>
      )}

      <audio ref={audioRefA} className="hidden" crossOrigin="anonymous" />
      <audio ref={audioRefB} className="hidden" crossOrigin="anonymous" />
    </div>
  );
}
