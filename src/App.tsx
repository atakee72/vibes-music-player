import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { Playlist, RepeatMode, Song } from './types';
import { useMetadataExtractor } from './hooks/useMetadataExtractor';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { PlayerBar } from './components/PlayerBar';

/**
 * Root component.
 *
 * State shape and effect lifecycle match the original bundle exactly
 * (see _recovered/app.pretty.js, component `D` ~line 648).
 *
 * Visual structure (root div) recovered classes:
 *   "h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900
 *    text-white flex flex-col overflow-hidden"
 *
 * Drag overlay (when isDragging) classes:
 *   "fixed inset-0 bg-purple-500/20 backdrop-blur-sm z-50 flex items-center
 *    justify-center border-4 border-dashed border-purple-400"
 */
export default function App() {
  const [playlists, setPlaylists] = useState<Playlist[]>([
    { id: 'library', name: 'Library', songs: [], createdAt: new Date() },
  ]);
  const [activePlaylistId, setActivePlaylistId] = useState<string>('library');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [visualizerData, setVisualizerData] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const { extractMetadata } = useMetadataExtractor();

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId);

  // Audio element + Web Audio API analyser wiring.
  // See _recovered/app.pretty.js around lines 706–740.
  useEffect(() => {
    if (!currentSong || !audioRef.current) return;
    const audio = audioRef.current;

    try {
      const ctx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      ctx.createMediaElementSource(audio).connect(analyser);
      analyser.connect(ctx.destination);
      analyser.fftSize = 256;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf: number;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setVisualizerData(Array.from(data));
        raf = requestAnimationFrame(tick);
      };

      const onPlay = () => {
        setIsPlaying(true);
        tick();
      };
      const onPause = () => {
        setIsPlaying(false);
        cancelAnimationFrame(raf);
      };
      const onEnded = () => {
        setIsPlaying(false);
        cancelAnimationFrame(raf);
        playNext();
      };
      const onTime = () => setCurrentTime(audio.currentTime);
      const onLoaded = () => setDuration(audio.duration);

      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('timeupdate', onTime);
      audio.addEventListener('loadedmetadata', onLoaded);
      audio.play().catch(console.error);

      return () => {
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('timeupdate', onTime);
        audio.removeEventListener('loadedmetadata', onLoaded);
        cancelAnimationFrame(raf);
      };
    } catch (err) {
      console.error('Audio context error:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong]);

  const handleFiles = async (files: FileList) => {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) {
      alert('Please select audio files (MP3, WAV, FLAC, etc.)');
      return;
    }
    for (const file of audioFiles) {
      try {
        const song = await extractMetadata(file);
        setPlaylists((prev) =>
          prev.map((p) =>
            p.id === activePlaylistId ? { ...p, songs: [...p.songs, song] } : p,
          ),
        );
      } catch (err) {
        console.error('Error processing file:', file.name, err);
      }
    }
    setShowUpload(false);
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
  };

  const playNext = () => {
    if (!activePlaylist || !currentSong) return;
    const idx = activePlaylist.songs.findIndex((s) => s.id === currentSong.id);
    if (repeatMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      return;
    }
    let next = idx + 1;
    if (next >= activePlaylist.songs.length) {
      if (repeatMode !== 'all') return;
      next = 0;
    }
    if (activePlaylist.songs[next]) setCurrentSong(activePlaylist.songs[next]);
  };

  const playPrev = () => {
    if (!activePlaylist || !currentSong) return;
    const idx = activePlaylist.songs.findIndex((s) => s.id === currentSong.id);
    const prev = idx - 1;
    if (prev >= 0) setCurrentSong(activePlaylist.songs[prev]);
  };

  const seek = (t: number) => {
    if (audioRef.current) audioRef.current.currentTime = t;
  };

  const cycleRepeat = () => {
    setRepeatMode((m) => (m === 'none' ? 'all' : m === 'all' ? 'one' : 'none'));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  return (
    <div
      className="h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex flex-col overflow-hidden"
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) await handleFiles(files);
      }}
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
              </h2>
              <button
                onClick={() => setShowUpload(true)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-4 py-2 rounded-lg transition-all duration-200 text-sm font-medium shadow-lg"
              >
                Add Music
              </button>
            </div>
          </header>

          <SongList
            songs={activePlaylist?.songs || []}
            currentSong={currentSong}
            isPlaying={isPlaying}
            onPlay={(song) => {
              audioRef.current?.pause();
              setCurrentSong(song);
            }}
            onPause={togglePlayPause}
            onDelete={(id) => {
              setPlaylists((prev) =>
                prev.map((p) => ({ ...p, songs: p.songs.filter((s) => s.id !== id) })),
              );
              if (currentSong?.id === id) {
                setCurrentSong(null);
                setIsPlaying(false);
              }
            }}
          />
        </div>
      </div>

      <PlayerBar
        song={currentSong}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        visualizerData={visualizerData}
        repeatMode={repeatMode}
        onPlayPause={togglePlayPause}
        onPrev={playPrev}
        onNext={playNext}
        onSeek={seek}
        onCycleRepeat={cycleRepeat}
      />

      {/* Upload modal — see _recovered/app.pretty.js for full markup */}
      {showUpload && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowUpload(false)}
        >
          <div
            className="bg-slate-800/90 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-white/10"
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
          </div>
        </div>
      )}

      {currentSong && (
        <audio
          ref={audioRef}
          src={currentSong.url}
          className="hidden"
          crossOrigin="anonymous"
        />
      )}
    </div>
  );
}
