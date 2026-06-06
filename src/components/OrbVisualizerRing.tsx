interface OrbVisualizerRingProps {
  /** Analyser frequency bins (0–255), e.g. `visualizerData` from the engine. */
  data: number[];
  isPlaying: boolean;
  className?: string;
}

const BAR_COUNT = 48;
const BASE_RADIUS = 118; // px from centre where each bar starts (just outside the orb)
const MAX_BAR = 26; // px — peak bar length
const REST = 3; // px — idle nub length

/**
 * The frame-D circular visualizer: `BAR_COUNT` thin bars arranged radially
 * around the now-playing orb, each driven by one analyser bin. Meant to fill an
 * `inset-0` square overlay around a centred `VibeOrb` (~`w-72` container).
 *
 * Always renders the full ring — `data` is `[]` until audio flows, and bars fall
 * back to the rest length. Length changes are `motion-safe` so reduced-motion
 * users get a static ring.
 */
export function OrbVisualizerRing({ data, isPlaying, className }: OrbVisualizerRingProps) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className ?? ''}`} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const level = (data[i] ?? 0) / 255; // 0–1
        const len = REST + (isPlaying ? level * MAX_BAR : 0);
        const angle = (i / BAR_COUNT) * 360;
        return (
          <div
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `rotate(${angle}deg)` }}
          >
            <div
              className="absolute rounded-full bg-gradient-to-t from-coral to-gold motion-safe:transition-[height] duration-75"
              style={{ width: '3px', left: '-1.5px', top: `${BASE_RADIUS}px`, height: `${len}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}
