import type { CSSProperties } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Song } from '../types';
import { VibeOrb } from './VibeOrb';

interface MiniPlayerProps {
  song: Song;
  isPlaying: boolean;
  tintColor: string | null;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function MiniPlayer({
  song,
  isPlaying,
  tintColor,
  onPlayPause,
  onPrev,
  onNext,
}: MiniPlayerProps) {
  const PlayPauseIcon = isPlaying ? Pause : Play;

  return (
    <div
      className="w-full h-full bg-deep flex flex-col items-center justify-center p-4 select-none relative overflow-hidden"
      style={{ ['--vibe']: tintColor ?? '#FF9E5E' } as CSSProperties}
    >
      {tintColor && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: tintColor, opacity: 0.15 }}
        />
      )}

      <div className="relative flex flex-col items-center gap-4">
        <VibeOrb coverArt={song.coverArt} isPlaying={isPlaying} className="w-40 h-40" />

        <div className="text-center w-full max-w-[340px]">
          <p className="text-sm font-medium font-display text-white truncate">{song.title}</p>
          <p className="text-xs text-white/60 truncate">{song.artist}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onPrev}
            className="p-2 text-white/60 hover:text-white transition-colors"
            aria-label="Previous"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={onPlayPause}
            className="p-2 bg-gradient-to-r from-amber to-coral rounded-full text-deep shadow-lg hover:brightness-110 motion-safe:active:scale-95 active:shadow-[0_0_24px_#FF9E5E99] transition-all"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <PlayPauseIcon className="h-5 w-5" />
          </button>
          <button
            onClick={onNext}
            className="p-2 text-white/60 hover:text-white transition-colors"
            aria-label="Next"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
