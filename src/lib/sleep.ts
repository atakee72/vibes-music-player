/** Sleep-timer helpers. Session-only feature — nothing here is persisted. */

/** Selectable durations, in minutes. "Off" is represented by a null deadline. */
export const SLEEP_OPTIONS_MINUTES = [15, 30, 45, 60] as const;

/** How long the fade-to-silence takes when the timer fires. */
export const SLEEP_FADE_SECONDS = 10;

/**
 * `m:ss` countdown for the remaining milliseconds. Clamps at 0 so an overdue
 * deadline reads "0:00" rather than a negative time.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
