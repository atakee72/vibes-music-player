import type { CSSProperties } from 'react';
import type { Song } from '../types';
import { VibeOrb } from './VibeOrb';

interface NowPlayingHeroProps {
  song: Song;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  onGenreClick: (genre: string) => void;
}

const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
};

/**
 * Desktop-only (`lg+`) now-playing banner above the song list — the AFTERGLOW
 * identity moment. **Display-only**: it shows the VibeOrb + track info + an
 * ambient, scrubbable progress bar, but carries **no transport buttons** — the
 * persistent bottom PlayerBar owns transport (the hero scrolls off with the
 * list). The orb glow + progress fill read the per-track `--vibe` variable.
 */
export function NowPlayingHero({
  song,
  isPlaying,
  currentTime,
  duration,
  onSeek,
  onGenreClick,
}: NowPlayingHeroProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasChips = Boolean(song.genre || song.bpm);

  return (
    <div className="hidden lg:flex shrink-0 mx-4 lg:mx-6 mt-3 h-[300px] items-center gap-8 rounded-card border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6">
      <VibeOrb coverArt={song.coverArt} isPlaying={isPlaying} className="h-[232px] w-[232px]" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber" />
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-amber">
            Now Playing
          </span>
        </div>

        <h2 className="mt-2 truncate font-display text-4xl font-semibold text-cream">
          {song.title}
        </h2>
        <p className="mt-1 truncate text-base text-muted">
          {song.artist}
          {song.album && song.album !== 'Unknown Album' && ` · ${song.album}`}
        </p>

        {hasChips && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {song.genre && (
              <button
                onClick={() => onGenreClick(song.genre!)}
                className="rounded-full bg-white/[0.08] px-3 py-1 text-xs font-medium text-lilac transition-colors hover:bg-white/[0.14]"
                title={`Filter by ${song.genre}`}
              >
                {song.genre}
              </button>
            )}
            {song.bpm ? (
              <span className="rounded-full bg-white/[0.08] px-3 py-1 font-mono text-xs text-lilac">
                {Math.round(song.bpm)} BPM
              </span>
            ) : null}
          </div>
        )}

        <div className="mt-auto flex items-center gap-3 pt-6">
          <span className="w-12 text-right font-mono text-xs text-muted">
            {formatTime(currentTime)}
          </span>
          <div
            className="group h-1.5 flex-1 cursor-pointer rounded-full bg-white/15"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              onSeek(ratio * duration);
            }}
          >
            <div
              className="relative h-full rounded-full transition-all duration-150"
              style={
                {
                  width: `${progress}%`,
                  background:
                    'linear-gradient(90deg, color-mix(in srgb, var(--vibe, #FF9E5E) 85%, white), var(--vibe, #FF9E5E))',
                } as CSSProperties
              }
            >
              <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-cream opacity-0 shadow-lg transition-opacity group-hover:opacity-100" />
            </div>
          </div>
          <span className="w-12 font-mono text-xs text-muted">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
