import { useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  Heart,
  ListMusic,
  Music,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
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
import { ScrollingText } from './ScrollingText';

interface PlayerBarProps {
  song: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  visualizerData: number[];
  repeatMode: RepeatMode;
  shuffle: boolean;
  eqPreset: EqPreset;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onEqPresetChange: (preset: EqPreset) => void;
  onTogglePip?: () => void;
  supportsPip?: boolean;
  isPipOpen?: boolean;
  onToggleQueue?: () => void;
  isQueueOpen?: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  /** Mobile only: open the full-screen now-playing view (tap the cover/title). */
  onExpand?: () => void;
  onToggleFavorite?: () => void;
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
  shuffle,
  eqPreset,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onCycleRepeat,
  onToggleShuffle,
  onEqPresetChange,
  onTogglePip,
  supportsPip,
  isPipOpen,
  onToggleQueue,
  isQueueOpen,
  volume,
  onVolumeChange,
  onExpand,
  onToggleFavorite,
}: PlayerBarProps) {
  const [eqOpen, setEqOpen] = useState(false);
  const eqWrapRef = useRef<HTMLDivElement>(null);
  const eqTriggerRef = useRef<HTMLButtonElement>(null);
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
      <div className="h-[104px] lg:h-24 bg-surface/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-center">
        <p className="text-white/50 text-sm">No song playing</p>
      </div>
    );
  }

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const repeatColor = repeatMode !== 'none' ? 'text-amber' : 'text-white/60';
  const shuffleColor = shuffle ? 'text-amber' : 'text-white/60';
  // Tapping the cover/title opens the full-screen now-playing view (any size).
  const expand = () => onExpand?.();
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    // Mobile is taller than desktop here: the full-width title line adds a row
    // and the control row carries bottom padding so it doesn't sit on the screen
    // edge. The empty state matches this height so the bar can't jump on play.
    <div className="relative h-[104px] lg:h-24 bg-surface/95 backdrop-blur-xl border-t border-white/10 flex flex-col">
      {/* Floating pull-up handle: opens the full-screen now-playing view.
          Visible on both mobile and desktop; amber on hover. */}
      {onExpand && (
        <button
          onClick={expand}
          aria-label="Open now playing"
          title="Open now playing"
          className="absolute left-1/2 -translate-x-1/2 bottom-full z-10 flex items-center justify-center h-5 w-9 lg:h-8 lg:w-12 rounded-t-xl bg-surface/95 backdrop-blur-xl border border-b-0 border-white/10 text-white/70 hover:text-deep hover:bg-amber motion-safe:transition-colors shadow-lg"
        >
          <ChevronUp className="h-3.5 w-3.5 lg:h-5 lg:w-5" />
        </button>
      )}
      {/* Mobile: the title gets its own full-width line. Squeezed beside the
          transport controls it had ~60px to work with — the marquee scrolled,
          but nothing was readable. Desktop keeps it inline next to the cover. */}
      <div className="lg:hidden px-4 pt-1.5">
        <ScrollingText
          text={song.artist ? `${song.title} · ${song.artist}` : song.title}
          // Centered while it fits; once it overflows the marquee fills the
          // width and alignment stops mattering.
          className="text-center text-xs font-medium font-display text-cream"
        />
      </div>
      <div className="px-4 pt-1 lg:pt-2">
        <div className="flex items-center space-x-3 text-xs text-white/60">
          <span className="w-10 text-right font-mono">{formatTime(currentTime)}</span>
          <div
            className="flex-1 h-1 bg-white/20 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              onSeek(ratio * duration);
            }}
          >
            <div
              className="h-full bg-gradient-to-r from-amber to-coral rounded-full relative transition-all duration-150"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
            </div>
          </div>
          <span className="w-10 font-mono">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center px-3 lg:px-4 flex-1 pb-2 lg:pb-0">
        <div
          role="button"
          tabIndex={0}
          aria-label="Open now playing"
          onClick={expand}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              expand();
            }
          }}
          className="flex items-center space-x-3 flex-1 min-w-0 text-left cursor-pointer"
        >
          {song.coverArt ? (
            <img
              key={song.coverArt}
              src={song.coverArt}
              alt={song.album}
              className="w-12 h-12 lg:w-14 lg:h-14 rounded-lg object-cover shadow-lg motion-safe:animate-fade-in"
            />
          ) : (
            <div className="w-12 h-12 lg:w-14 lg:h-14 bg-gradient-to-br from-surface to-surface-2 rounded-lg flex items-center justify-center border border-white/10">
              <Music className="h-6 w-6 lg:h-7 lg:w-7 text-white/40" />
            </div>
          )}
          {/* Desktop only — mobile shows this full-width above the progress bar */}
          <div className="hidden lg:block min-w-0 flex-1">
            <ScrollingText
              text={song.title}
              className="text-sm lg:text-base font-medium font-display text-white"
            />
            <p className="text-xs lg:text-sm text-white/60 truncate">{song.artist}</p>
          </div>
        </div>

        {onToggleFavorite && (
          <button
            onClick={onToggleFavorite}
            className="shrink-0 p-2 hover:bg-white/10 rounded-lg transition-all mr-1 lg:mr-2"
            aria-label={song.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            aria-pressed={!!song.favorite}
          >
            <Heart
              className={
                'h-4 w-4 lg:h-5 lg:w-5 ' +
                (song.favorite ? 'text-coral fill-current' : 'text-white/60')
              }
            />
          </button>
        )}

        <div className="flex items-center space-x-2 lg:space-x-4">
          <button
            onClick={onToggleShuffle}
            className={`hidden lg:block p-2 hover:bg-white/10 rounded-full transition-all duration-200 ${shuffleColor}`}
            title={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-label={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-pressed={shuffle}
          >
            <Shuffle className="h-4 w-4" />
          </button>
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
            className="p-3 lg:p-4 bg-gradient-to-r from-amber to-coral hover:brightness-110 motion-safe:active:scale-95 active:shadow-[0_0_24px_#FF9E5E99] rounded-full transition-all duration-200 shadow-lg"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 lg:h-6 lg:w-6 text-deep" fill="currentColor" />
            ) : (
              <Play className="h-5 w-5 lg:h-6 lg:w-6 text-deep" fill="currentColor" />
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
          <button
            onClick={onToggleShuffle}
            className={`lg:hidden p-2 hover:bg-white/10 rounded-full transition-all duration-200 ${shuffleColor}`}
            aria-label={`Shuffle: ${shuffle ? 'on' : 'off'}`}
            aria-pressed={shuffle}
          >
            <Shuffle className="h-4 w-4" />
          </button>
        </div>

        <div className="hidden lg:flex items-center space-x-2 lg:space-x-4 lg:ml-6">
          <div className="flex items-end space-x-1 h-6 lg:h-8">
            {visualizerData.slice(0, 15).map((value, i) => (
              <div
                key={i}
                className="bg-gradient-to-t from-coral to-gold rounded-sm transition-all duration-75"
                style={{
                  width: '2px',
                  height: `${Math.max(2, (value / 255) * (window.innerWidth < 1024 ? 24 : 32))}px`,
                  opacity: isPlaying ? 1 : 0.3,
                }}
              />
            ))}
          </div>
          {onToggleQueue && (
            <button
              onClick={onToggleQueue}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              aria-label="Toggle queue"
              title="Queue"
            >
              <ListMusic
                className={`h-4 w-4 lg:h-5 lg:w-5 ${isQueueOpen ? 'text-amber' : 'text-white/60'}`}
              />
            </button>
          )}
          {supportsPip && (
            <button
              onClick={onTogglePip}
              className={`p-2 hover:bg-white/10 rounded-full transition-colors ${
                isPipOpen ? 'text-amber' : 'text-white/60'
              }`}
              title="Picture-in-Picture"
              aria-label="Picture-in-Picture"
            >
              <PictureInPicture2 className="h-4 w-4 lg:h-5 lg:w-5" />
            </button>
          )}
          <div
            ref={eqWrapRef}
            className="relative"
            onKeyDown={(e) => {
              if (eqOpen && e.key === 'Escape') {
                e.stopPropagation(); // own the Escape before App's chain
                setEqOpen(false);
                eqTriggerRef.current?.focus();
              }
            }}
          >
            <button
              ref={eqTriggerRef}
              onClick={() => setEqOpen((v) => !v)}
              className={`p-2 hover:bg-white/10 rounded-full transition-colors ${
                eqPreset !== 'Off' ? 'text-amber' : 'text-white/60'
              }`}
              title={`Equalizer: ${eqPreset}`}
              aria-label="Equalizer"
            >
              <Sliders className="h-4 w-4 lg:h-5 lg:w-5" />
            </button>
            {eqOpen && (
              <div
                role="menu"
                aria-label="Equalizer presets"
                className="absolute bottom-full right-0 mb-2 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl py-1 min-w-[140px] z-50"
              >
                {EQ_PRESET_NAMES.map((name) => (
                  <button
                    key={name}
                    role="menuitem"
                    onClick={() => {
                      onEqPresetChange(name);
                      setEqOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      name === eqPreset
                        ? 'bg-gradient-to-r from-amber/30 to-coral/30 text-cream'
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
              className="w-16 lg:w-20 accent-amber"
              aria-label="Volume"
              title={`Volume: ${Math.round(volume * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
