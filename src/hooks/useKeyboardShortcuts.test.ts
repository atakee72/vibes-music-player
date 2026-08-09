import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function press(code: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    // Drop any input we appended for tests
    document.querySelectorAll('input[data-test-cleanup]').forEach((el) => el.remove());
  });

  it('fires a Space handler on keydown with code "Space"', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ Space: handler }));
    press('Space');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire non-Escape handlers when an <input> is focused', () => {
    const space = vi.fn();
    const escape = vi.fn();
    renderHook(() => useKeyboardShortcuts({ Space: space, Escape: escape }));

    const input = document.createElement('input');
    input.setAttribute('data-test-cleanup', '');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    press('Space');
    expect(space).not.toHaveBeenCalled();

    press('Escape');
    expect(escape).toHaveBeenCalledTimes(1);
  });

  it('calls preventDefault for Slash so Firefox Quick Find would not trigger', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ Slash: handler }));
    const event = press('Slash');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('reads the freshest handler after re-render (ref pattern)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ h }: { h: () => void }) =>
      useKeyboardShortcuts({ Space: h }), { initialProps: { h: first } });

    press('Space');
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ h: second });
    press('Space');
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1); // unchanged from before
  });

  it('with isBlocked, only Escape fires', () => {
    const space = vi.fn();
    const escape = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ Space: space, Escape: escape }, { isBlocked: true }),
    );
    press('Space');
    press('Escape');
    expect(space).not.toHaveBeenCalled();
    expect(escape).toHaveBeenCalledTimes(1);
  });

  it('Space on a focused <button> is left to the browser (button activation, no shortcut)', () => {
    const space = vi.fn();
    renderHook(() => useKeyboardShortcuts({ Space: space }));

    const button = document.createElement('button');
    button.setAttribute('data-test-cleanup', '');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    const event = press('Space');
    expect(space).not.toHaveBeenCalled();
    // The hook must not preventDefault either — that would kill activation.
    expect(event.defaultPrevented).toBe(false);
    button.remove();
  });

  it('other shortcuts still fire with a button focused (only Space is special-cased)', () => {
    const q = vi.fn();
    renderHook(() => useKeyboardShortcuts({ KeyQ: q }));
    const button = document.createElement('button');
    button.setAttribute('data-test-cleanup', '');
    document.body.appendChild(button);
    button.focus();
    press('KeyQ');
    expect(q).toHaveBeenCalledTimes(1);
    button.remove();
  });
});
