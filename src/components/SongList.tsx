import { Clock, MoreHorizontal, Music, Pause, Play, Trash2 } from 'lucide-react';
import type { Song } from '../types';

interface SongListProps {
  songs: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onDelete: (id: string) => void;
}

const formatTime = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export function SongList({
  songs,
  currentSong,
  isPlaying,
  onPlay,
  onPause,
  onDelete,
}: SongListProps) {
  if (songs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center text-white/60">
          <div className="w-20 h-20 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Music className="h-10 w-10 text-purple-400" />
          </div>
          <p className="text-lg mb-2 font-medium">No songs in this playlist</p>
          <p className="text-sm text-white/40">Add some music files to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-1 p-2 lg:p-4">
        {songs.map((song) => {
          const active = currentSong?.id === song.id;
          const activePlaying = active && isPlaying;
          return (
            <div
              key={song.id}
              className={
                'group flex items-center space-x-3 p-3 lg:p-4 rounded-xl hover:bg-white/5 transition-all duration-200 ' +
                (active
                  ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20'
                  : '')
              }
            >
              <div className="relative flex-shrink-0 w-12 h-12">
                {song.coverArt ? (
                  <img
                    src={song.coverArt}
                    alt={song.album}
                    className="w-12 h-12 rounded-lg object-cover shadow-lg"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg flex items-center justify-center border border-white/10">
                    <Music className="h-6 w-6 text-white/40" />
                  </div>
                )}
                <button
                  onClick={() => (activePlaying ? onPause() : onPlay(song))}
                  className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200 backdrop-blur-sm"
                  aria-label={activePlaying ? 'Pause' : 'Play'}
                >
                  {activePlaying ? (
                    <Pause className="h-5 w-5 text-white" fill="white" />
                  ) : (
                    <Play className="h-5 w-5 text-white" fill="white" />
                  )}
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        'text-sm lg:text-base font-medium truncate ' +
                        (active ? 'text-purple-300' : 'text-white')
                      }
                    >
                      {song.title}
                    </p>
                    <p className="text-xs lg:text-sm text-white/60 truncate">
                      {song.artist}
                      {song.album && song.album !== 'Unknown Album' && ` • ${song.album}`}
                    </p>
                    <div className="flex items-center space-x-3 mt-1 lg:hidden">
                      {song.duration ? (
                        <div className="flex items-center space-x-1 text-xs text-white/40">
                          <Clock className="h-3 w-3" />
                          <span>{formatTime(song.duration)}</span>
                        </div>
                      ) : null}
                      {song.file && (
                        <span className="text-xs text-white/40">
                          {(song.file.size / 1048576).toFixed(1)} MB
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="hidden lg:flex items-center space-x-4">
                    {song.duration ? (
                      <span className="text-sm text-white/60">{formatTime(song.duration)}</span>
                    ) : null}
                    <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onDelete(song.id)}
                        className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                        aria-label="Delete song"
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </button>
                      <button
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        aria-label="More"
                      >
                        <MoreHorizontal className="h-4 w-4 text-white/60" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex lg:hidden items-center space-x-2">
                <button
                  onClick={() => onDelete(song.id)}
                  className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                  aria-label="Delete song"
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
