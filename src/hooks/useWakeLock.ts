import { useEffect, useRef } from 'react';

/**
 * Holds a Screen Wake Lock (keeps the display from sleeping) while `active`,
 * and releases it the moment it isn't.
 *
 * Audio keeps playing with the screen off, so this is NOT about playback —
 * it exists for the full-screen now-playing view used as an ambient display
 * (orb, visualizer ring, scrolling synced lyrics).
 *
 * Three browser facts shape this hook:
 * - The lock can only be held by a VISIBLE document, and the browser
 *   auto-releases it whenever the document becomes hidden. Re-acquiring on
 *   `visibilitychange` is mandatory, not a nicety.
 * - `request()` rejects for reasons outside our control (power saving, low
 *   battery, a document that stopped being visible mid-request). A refusal
 *   is not an error worth surfacing — the screen just behaves normally.
 * - `lib.dom` types `navigator.wakeLock` as always present, which is untrue
 *   off a secure context and in older Firefox/iOS Safari, so it is
 *   feature-detected anyway.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return;

    let cancelled = false;
    let acquiring = false;

    const acquire = async () => {
      if (cancelled || acquiring) return;
      if (document.visibilityState !== 'visible') return;
      const held = sentinelRef.current;
      if (held && !held.released) return;
      acquiring = true;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          // Torn down while the request was in flight — React 18 StrictMode
          // does exactly this on every mount in dev. Nothing else holds a
          // reference to this sentinel, so dropping it leaks the lock and
          // the screen never sleeps again.
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Refused. Leave the screen alone.
      } finally {
        acquiring = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
