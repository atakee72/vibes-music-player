import { useRef } from 'react';

// [data-no-swipe] opts a subtree out of the gesture for controls that are
// not one of the natively-focusable elements above and so can't otherwise be
// matched — e.g. a click-to-seek `<div>` with no ARIA role.
const INTERACTIVE =
  'button, input, select, textarea, a, [role="button"], [role="slider"], [data-no-swipe]';

interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * Vertical swipe detection for overlay surfaces. Returns handlers to spread
 * onto the element that should respond to the drag.
 *
 * Deliberately does NOT call setPointerCapture: the surfaces using this are
 * covered in buttons and scrollable regions that still need their own events.
 * Drags starting on an interactive element are ignored outright — otherwise
 * scrubbing the progress bar upward would read as a swipe.
 */
export function useSwipeGesture({
  onSwipeUp,
  onSwipeDown,
  threshold = 50,
}: {
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
}): SwipeHandlers {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const reset = () => {
    start.current = null;
  };

  return {
    onPointerDown: (e) => {
      if (start.current) return; // Ignore if a gesture is already in flight
      if ((e.target as Element | null)?.closest?.(INTERACTIVE)) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    // Tracked for symmetry and future travel-based feedback; the decision is
    // taken on pointerup so a drag can still be abandoned mid-flight.
    onPointerMove: () => {},
    onPointerUp: (e) => {
      const from = start.current;
      if (!from || from.id !== e.pointerId) return;
      reset();

      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dy) <= Math.abs(dx)) return;
      if (Math.abs(dy) < threshold) return;

      if (dy < 0) onSwipeUp?.();
      else onSwipeDown?.();
    },
    onPointerCancel: reset,
  };
}
