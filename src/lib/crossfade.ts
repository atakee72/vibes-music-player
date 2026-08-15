/**
 * Equal-power crossfade curves.
 *
 * A *linear* crossfade (one gain ramping 1→0 while the other ramps 0→1) sums
 * to 0.5 at the midpoint, which is roughly -6 dB of perceived level — an
 * audible hole in the middle of every transition. Two uncorrelated signals
 * sum in POWER, not amplitude, so the pair has to satisfy
 * `gainOut² + gainIn² === 1`. The sine/cosine quarter-wave pair does exactly
 * that, which is why it's the standard choice.
 */

/** Selectable crossfade durations, in seconds. 0 = off (plain gapless). */
export const CROSSFADE_OPTIONS = [0, 2, 4, 6, 8, 12] as const;

/** Points per curve. 64 is inaudibly smooth and cheap to build. */
export const CURVE_SAMPLES = 64;

export type CrossfadeDirection = 'in' | 'out';

/**
 * Build an equal-power gain curve for `setValueCurveAtTime`.
 *
 * 'in'  → rises 0 → 1 as sin(t·π/2)
 * 'out' → falls 1 → 0 as cos(t·π/2)
 */
export function fadeCurve(
  direction: CrossfadeDirection,
  samples: number = CURVE_SAMPLES,
): Float32Array {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1); // 0..1 inclusive, so endpoints are exact
    curve[i] = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
  }
  return curve;
}

/** Human label for a duration option ("Off", "6s"). */
export function formatCrossfade(seconds: number): string {
  return seconds === 0 ? 'Off' : `${seconds}s`;
}
