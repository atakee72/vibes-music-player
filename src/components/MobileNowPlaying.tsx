import type { CSSProperties } from 'react';
import {
  ChevronDown,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
} from 'lucide-react';
import type { RepeatMode, Song } from '../types';
import { EQ_PRESET_NAMES, type EqPreset } from '../lib/eq';
import { VibeOrb } from './VibeOrb';
import { OrbVisualizerRing } from './OrbVisualizerRing';
import { ScrollingText } from './ScrollingText';

interface MobileNowPlayingProps {
  open: boolean;
  onClose: () => void;
  song: Song | null;
  playlistName?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  visualizerData: number[];
  repeatMode: RepeatMode;
  shuffle: boolean;
  eqPreset: EqPreset;
  volume: number;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onEqPresetChange: (preset: EqPreset) => void;
  onVolumeChange: (v: number) => void;
  onToggleLyrics: () => void;
  onShare: () => void;
}

const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
};

/**
 * Full-screen mobile now-playing view (frame D), reached by tapping the slim
 * mobile player bar. Desktop (`lg+`) never shows it — the inline now-playing
 * hero serves there. Houses the controls trimmed from the mobile bar (EQ,
 * volume, lyrics, share) plus the orb + its circular visualizer.
 */
export function MobileNowPlaying({
  open,
  onClose,
  song,
  playlistName,
  isPlaying,
  currentTime,
  duration,
  visualizerData,
  repeatMode,
  shuffle,
  eqPreset,
  volume,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onCycleRepeat,
  onToggleShuffle,
  onEqPresetChange,
  onVolumeChange,
  onToggleLyrics,
  onShare,
}: MobileNowPlayingProps) {
  if (!open || !song) return null;

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-deep/95 backdrop-blur-2xl p-6">
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80"
          aria-label="Close now playing"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
        <span className="min-w-0 truncate px-3 text-xs font-medium uppercase tracking-[0.2em] text-muted">
          {playlistName}
        </span>
        <span className="w-10 shrink-0" />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="relative flex h-72 w-72 items-center justify-center">
          <OrbVisualizerRing data={visualizerData} isPlaying={isPlaying} />
          <VibeOrb coverArt={song.coverArt} isPlaying={isPlaying} className="h-56 w-56" />
        </div>
        <div className="w-full text-center">
          <ScrollingText
            text={song.title}
            className="font-display text-2xl font-semibold text-cream"
          />
          <p className="truncate text-muted">
            {song.artist}
            {song.album && song.album !== 'Unknown Album' && ` · ${song.album}`}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <span className="w-10 text-right font-mono text-xs text-muted">
            {formatTime(currentTime)}
          </span>
          <div
            className="group h-1.5 flex-1 cursor-pointer rounded-full bg-white/15"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div
              className="h-full rounded-full"
              style={
                {
                  width: `${progress}%`,
                  background:
                    'linear-gradient(90deg, color-mix(in srgb, var(--vibe, #FF9E5E) 85%, white), var(--vibe, #FF9E5E))',
                } as CSSProperties
              }
            />
          </div>
          <span className="w-10 font-mono text-xs text-muted">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-6">
          <button
            onClick={onCycleRepeat}
            className={`p-2 transition-colors ${repeatMode !== 'none' ? 'text-amber' : 'text-white/60'}`}
            aria-label={`Repeat: ${repeatMode}`}
          >
            <RepeatIcon className="h-5 w-5" />
          </button>
          <button onClick={onPrev} className="p-2 text-white/80" aria-label="Previous">
            <SkipBack className="h-6 w-6" fill="currentColor" />
          </button>
          <button
            onClick={onPlayPause}
            className="rounded-full bg-gradient-to-r from-amber to-coral p-4 text-deep shadow-lg hover:brightness-110 motion-safe:active:scale-95 active:shadow-[0_0_24px_#FF9E5E99] transition-all"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-7 w-7" fill="currentColor" />
            ) : (
              <Play className="h-7 w-7" fill="currentColor" />
            )}
          </button>
          <button onClick={onNext} className="p-2 text-white/80" aria-label="Next">
            <SkipForward className="h-6 w-6" fill="currentColor" />
          </button>
          <button
            onClick={onToggleShuffle}
            className={`p-2 transition-colors ${shuffle ? 'text-amber' : 'text-white/60'}`}
            aria-label={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-pressed={shuffle}
          >
            <Shuffle className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggleLyrics}
            className="p-2 rounded-full bg-white/5 text-white/70 hover:bg-white/10 transition-colors"
            aria-label="Toggle lyrics"
          >
            <Mic2 className="h-5 w-5" />
          </button>

          <div className="relative flex items-center">
            <Sliders className="pointer-events-none absolute left-2 h-4 w-4 text-white/60" />
            <select
              value={eqPreset}
              onChange={(e) => onEqPresetChange(e.target.value as EqPreset)}
              className="appearance-none rounded-full border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm text-white/80 focus:border-amber focus:outline-none"
              aria-label="Equalizer preset"
            >
              {EQ_PRESET_NAMES.map((name) => (
                <option key={name} value={name} className="bg-surface text-white">
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-1 items-center gap-2">
            <Volume2 className="h-4 w-4 shrink-0 text-white/60" />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
              className="w-full accent-amber"
              aria-label="Volume"
            />
          </div>

          <button
            onClick={onShare}
            className="p-2 rounded-full bg-white/5 text-white/70 hover:bg-white/10 transition-colors"
            aria-label="Share current track"
          >
            <Share2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
