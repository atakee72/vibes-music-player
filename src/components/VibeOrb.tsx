interface VibeOrbProps {
  coverArt?: string;
  isPlaying: boolean;
  /** Sizes the orb; defaults to a responsive square. */
  className?: string;
}

/**
 * The signature AFTERGLOW now-playing artwork: the album art (or a generative
 * fallback) as a glowing disc wrapped in a conic "mood ring". It also reads the
 * per-track `--vibe` CSS variable (published on the App root / the PiP window)
 * for its glow, so it tints to the current song.
 *
 * Looping motion (mood-ring spin, disc breathe) is gated on `isPlaying` AND the
 * `motion-safe:` variant, so it stays still when paused or when the user prefers
 * reduced motion. The other AFTERGLOW motions land in Phase C.
 */
export function VibeOrb({ coverArt, isPlaying, className }: VibeOrbProps) {
  return (
    <div className={`relative aspect-square ${className ?? 'w-full max-w-[280px]'}`}>
      {/* glow halo — colour from --vibe */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: '0 0 70px color-mix(in srgb, var(--vibe, #FF9E5E) 45%, transparent)',
        }}
      />
      {/* mood ring — rotates while playing */}
      <div
        className={`absolute inset-0 rounded-full p-[2px] ${
          isPlaying ? 'motion-safe:animate-spin-slow' : ''
        }`}
        style={{ background: 'conic-gradient(#FFC857,#FF6B6B,#C9A8FF,#FFC857)' }}
      />
      {/* disc — cover art, or generative fallback */}
      <div
        className={`absolute inset-[6px] rounded-full overflow-hidden ${
          isPlaying ? 'motion-safe:animate-breathe' : ''
        }`}
      >
        {coverArt ? (
          <img src={coverArt} alt="Album art" className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background:
                'radial-gradient(circle at 35% 30%, #FFE9C7, #FFC857 32%, #FF8C5A 66%, #C9A8FF)',
            }}
          />
        )}
      </div>
    </div>
  );
}
