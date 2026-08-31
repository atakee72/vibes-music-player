import { renderHook } from '@testing-library/react';
import { useSwipeGesture } from './useSwipeGesture';

/** Minimal React.PointerEvent stand-in — the hook only reads these fields. */
const evt = (over: { x?: number; y?: number; id?: number; target?: unknown } = {}) =>
  ({
    pointerId: over.id ?? 1,
    clientX: over.x ?? 0,
    clientY: over.y ?? 0,
    target: over.target ?? { closest: () => null },
  }) as unknown as React.PointerEvent;

describe('useSwipeGesture', () => {
  it('fires onSwipeUp when the drag clears the threshold upward', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerMove(evt({ x: 100, y: 200 }));
    result.current.onPointerUp(evt({ x: 100, y: 200 }));

    expect(onSwipeUp).toHaveBeenCalledTimes(1);
  });

  it('fires onSwipeDown for a downward drag', () => {
    const onSwipeDown = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeDown }));

    result.current.onPointerDown(evt({ x: 100, y: 200 }));
    result.current.onPointerUp(evt({ x: 100, y: 300 }));

    expect(onSwipeDown).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag shorter than the threshold', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerUp(evt({ x: 100, y: 270 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('ignores a mostly-horizontal drag', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerUp(evt({ x: 400, y: 240 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('ignores a drag that starts on an interactive element', () => {
    // The now-playing view is full of buttons and a scrubbable progress bar;
    // dragging one of those must never open the lyrics sheet.
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));
    const onButton = { closest: (sel: string) => (sel.includes('button') ? {} : null) };

    result.current.onPointerDown(evt({ x: 100, y: 300, target: onButton }));
    result.current.onPointerUp(evt({ x: 100, y: 200 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('ignores a second pointer while one gesture is in flight', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300, id: 1 }));
    result.current.onPointerUp(evt({ x: 100, y: 200, id: 2 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('abandons the gesture on pointer cancel', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300 }));
    result.current.onPointerCancel(evt({ x: 100, y: 200 }));
    result.current.onPointerUp(evt({ x: 100, y: 200 }));

    expect(onSwipeUp).not.toHaveBeenCalled();
  });

  it('second pointer does not hijack the first gesture', () => {
    // If a second pointer touches down while a gesture is in flight (pinch, etc),
    // it must not overwrite the first pointer's start coordinates.
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    result.current.onPointerDown(evt({ x: 100, y: 300, id: 1 }));
    result.current.onPointerDown(evt({ x: 200, y: 250, id: 2 }));
    result.current.onPointerUp(evt({ x: 100, y: 200, id: 1 }));

    // Pointer 1's gesture should fire (100px vertical from start)
    expect(onSwipeUp).toHaveBeenCalledTimes(1);
  });

  it('does not call setPointerCapture', () => {
    const onSwipeUp = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeUp }));

    const mockElement = {
      closest: () => null,
      setPointerCapture: vi.fn(),
    };

    const evtWithCapture = (over: { x?: number; y?: number; id?: number } = {}) =>
      ({
        pointerId: over.id ?? 1,
        clientX: over.x ?? 0,
        clientY: over.y ?? 0,
        target: mockElement,
      }) as unknown as React.PointerEvent;

    result.current.onPointerDown(evtWithCapture({ x: 100, y: 300 }));
    result.current.onPointerUp(evtWithCapture({ x: 100, y: 200 }));

    expect(mockElement.setPointerCapture).not.toHaveBeenCalled();
  });
});
