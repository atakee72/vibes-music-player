import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mount/unmount presence with enter **and** exit transitions for surfaces that
 * are conditionally rendered (overlays, panels). Returns:
 * - `mounted` — keep the element in the tree (stays true through the exit so
 *   CSS can animate out before unmounting),
 * - `visible` — drive the enter/leave class (`false` = the "from" state).
 *
 * Honors `prefers-reduced-motion`: no hold, instant swap (so reduced-motion
 * users never see a 300ms empty gap). `duration` must match the CSS transition.
 */
export function usePresence(open: boolean, duration = 300): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    if (open) {
      setMounted(true);
      if (reduced) {
        setVisible(true);
      } else {
        // Two frames so the browser paints the "from" state before flipping to
        // the "to" state — otherwise the transition is skipped on first mount.
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => setVisible(true));
        });
      }
    } else {
      setVisible(false);
      timerRef.current = setTimeout(() => setMounted(false), reduced ? 0 : duration);
    }
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, [open, duration]);

  return { mounted, visible };
}
