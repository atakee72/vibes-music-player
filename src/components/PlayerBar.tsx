import { useEffect, useRef, useState } from 'react';
import {
  Music,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Sliders,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { RepeatMode, Song } from '../types';
import { EQ_PRESET_NAMES, type EqPreset } from '../lib/eq';

interface PlayerBarProps {
  song: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  visualizerData: number[];
  repeatMode: RepeatMode;
  eqPreset: EqPreset;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
  onCycleRepeat: () => void;
  onEqPresetChange: (preset: EqPreset) => void;
  onTogglePip?: () => void;
  supportsPip?: boolean;
  isPipOpen?: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
}

const formatTime = (s: number) => {
  if (isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
};

export function PlayerBar({
  song,
  isPlaying,
  currentTime,
  duration,
  visualizerData,
  repeatMode,
  eqPreset,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onCycleRepeat,
  onEqPresetChange,
  onTogglePip,
  supportsPip,
  isPipOpen,
  volume,
  onVolumeChange,
}: PlayerBarProps) {
  const [eqOpen, setEqOpen] = useState(false);
  const eqWrapRef = useRef<HTMLDivElement>(null);
  const lastVolumeRef = useRef(volume > 0 ? volume : 1);

  useEffect(() => {
    if (volume > 0) lastVolumeRef.current = volume;
  }, [volume]);

  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2;

  const toggleMute = () => {
    if (volume === 0) onVolumeChange(lastVolumeRef.current);
    else onVolumeChange(0);
  };

  useEffect(() => {
    if (!eqOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!eqWrapRef.current?.contains(e.target as Node)) setEqOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [eqOpen]);
  if (!song) {
    return (
      <div className="h-20 lg:h-24 bg-slate-800/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-center">
        <p className="text-white/50 text-sm">No song playing</p>
      </div>
    );
  }

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const repeatColor = repeatMode !== 'none' ? 'text-purple-400' : 'text-white/60';
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-20 lg:h-24 bg-slate-800/95 backdrop-blur-xl border-t border-white/10 flex flex-col">
      <div className="px-4 pt-2">
        <div className="flex items-center space-x-3 text-xs text-white/60">
          <span className="w-10 text-right">{formatTime(currentTime)}</span>
          <div
            className="flex-1 h-1 bg-white/20 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              onSeek(ratio * duration);
            }}
          >
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full relative transition-all duration-150"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
            </div>
          </div>
          <span className="w-10">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center px-3 lg:px-4 flex-1">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          {song.coverArt ? (
            <img
              src={song.coverArt}
              alt={song.album}
              className="w-12 h-12 lg:w-14 lg:h-14 rounded-lg object-cover shadow-lg"
            />
          ) : (
            <div className="w-12 h-12 lg:w-14 lg:h-14 bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg flex items-center justify-center border border-white/10">
              <Music className="h-6 w-6 lg:h-7 lg:w-7 text-white/40" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm lg:text-base font-medium text-white truncate">{song.title}</p>
            <p className="text-xs lg:text-sm text-white/60 truncate">{song.artist}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 lg:space-x-4">
          <button
            onClick={onCycleRepeat}
            className={`hidden lg:block p-2 hover:bg-white/10 rounded-full transition-all duration-200 ${repeatColor}`}
            title={`Repeat: ${repeatMode}`}
            aria-label={`Repeat: ${repeatMode}`}
          >
            <RepeatIcon className="h-4 w-4" />
          </button>
          <button
            onClick={onPrev}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            aria-label="Previous"
          >
            <SkipBack className="h-4 w-4 lg:h-5 lg:w-5 text-white/80" fill="currentColor" />
          </button>
          <button
            onClick={onPlayPause}
            className="p-3 lg:p-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full transition-all duration-200 shadow-lg"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 lg:h-6 lg:w-6 text-white" fill="currentColor" />
            ) : (
              <Play className="h-5 w-5 lg:h-6 lg:w-6 text-white" fill="currentColor" />
            )}
          </button>
          <button
            onClick={onNext}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            aria-label="Next"
          >
            <SkipForward className="h-4 w-4 lg:h-5 lg:w-5 text-white/80" fill="currentColor" />
          </button>
          <button
            onClick={onCycleRepeat}
            className={`lg:hidden p-2 hover:bg-white/10 rounded-full transition-all duration-200 ${repeatColor}`}
            aria-label={`Repeat: ${repeatMode}`}
          >
            <RepeatIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center space-x-2 lg:space-x-4 flex-1 justify-end">
          <div className="flex items-end space-x-1 h-6 lg:h-8">
            {visualizerData.slice(0, 15).map((value, i) => (
              <div
                key={i}
                className="bg-gradient-to-t from-purple-500 to-pink-500 rounded-sm transition-all duration-75"
                style={{
                  width: '2px',
                  height: `${Math.max(2, (value / 255) * (window.innerWidth < 1024 ? 24 : 32))}px`,
                  opacity: isPlaying ? 1 : 0.3,
                }}
              />
            ))}
          </div>
          {supportsPip && (
            <button
              onClick={onTogglePip}
              className={`p-2 hover:bg-white/10 rounded-full transition-colors ${
                isPipOpen ? 'text-purple-400' : 'text-white/60'
              }`}
              title="Picture-in-Picture"
              aria-label="Picture-in-Picture"
            >
              <PictureInPicture2 className="h-4 w-4 lg:h-5 lg:w-5" />
            </button>
          )}
          <div ref={eqWrapRef} className="relative">
            <button
              onClick={() => setEqOpen((v) => !v)}
              className={`p-2 hover:bg-white/10 rounded-full transition-colors ${
                eqPreset !== 'Off' ? 'text-purple-400' : 'text-white/60'
              }`}
              title={`Equalizer: ${eqPreset}`}
              aria-label="Equalizer"
            >
              <Sliders className="h-4 w-4 lg:h-5 lg:w-5" />
            </button>
            {eqOpen && (
              <div className="absolute bottom-full right-0 mb-2 bg-slate-800/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl py-1 min-w-[140px] z-50">
                {EQ_PRESET_NAMES.map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      onEqPresetChange(name);
                      setEqOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      name === eqPreset
                        ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/30 text-purple-200'
                        : 'text-white/80 hover:bg-white/5'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={toggleMute}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60"
              title={volume === 0 ? 'Unmute' : 'Mute'}
              aria-label={volume === 0 ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon className="h-4 w-4 lg:h-5 lg:w-5" />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
              className="w-16 lg:w-20 accent-purple-500"
              aria-label="Volume"
              title={`Volume: ${Math.round(volume * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
