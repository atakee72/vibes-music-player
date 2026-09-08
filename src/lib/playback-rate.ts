/**
 * Playback speed, as a pure module so the clamp lives in exactly one place.
 *
 * The clamp is not defensive padding — it is load-bearing. Verified in
 * Chromium 2026-09-06: `audio.playbackRate = 0` is silently ACCEPTED and
 * behaves as a pause (no event, no state change, nothing in the UI looks
 * wrong), and `audio.playbackRate = -1` throws `NotSupportedError` out of
 * whatever handler set it. Both are reachable from a corrupt persisted value.
 */

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const DEFAULT_RATE = 1;

/** The speeds offered in the UI. Quarter steps: fine enough to be useful,
 *  few enough to stay a tap list rather than a slider. */
export const RATE_OPTIONS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function clampRate(rate: number): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return DEFAULT_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

/** `1` -> "1x", `1.5` -> "1.5x". No trailing ".0". */
export function formatRate(rate: number): string {
  return `${parseFloat(rate.toFixed(2))}x`;
}
