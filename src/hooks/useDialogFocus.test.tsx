import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDialogFocus } from './useDialogFocus';

/** Minimal dialog harness: an outside trigger + a togglable trapped container. */
function Harness({ initialFocus = true }: { initialFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, ref, { initialFocus });
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <button>Outside button</button>
      {open && (
        <div ref={ref} role="dialog" aria-label="Test dialog">
          <button onClick={() => setOpen(false)}>First</button>
          <button>Middle</button>
          <button data-autofocus onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

const tab = (shift = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });

describe('useDialogFocus', () => {
  it('focuses the [data-autofocus] element on open and restores the trigger on close', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(trigger).toHaveFocus();
  });

  it('falls back to the first focusable when no data-autofocus exists', () => {
    function NoAutofocus() {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useDialogFocus(open, ref);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          {open && (
            <div ref={ref} role="dialog" aria-label="Plain">
              <button>Alpha</button>
              <button>Beta</button>
            </div>
          )}
        </div>
      );
    }
    render(<NoAutofocus />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
  });

  it('does not steal focus when initialFocus is false', () => {
    render(<Harness initialFocus={false} />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveFocus();
  });

  it('Tab wraps from the last focusable to the first', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    // autofocus put us on "Close" (the last focusable)
    tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('Shift+Tab wraps from the first focusable to the last', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    screen.getByRole('button', { name: 'First' }).focus();
    tab(true);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('pulls focus back into the container when Tab fires with focus outside it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    // Simulate a backdrop click sending focus to body
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();
    tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('hidden elements are never wrap targets (upload dialog hidden file input)', () => {
    function WithHiddenInput() {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useDialogFocus(open, ref);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          {open && (
            <div ref={ref} role="dialog" aria-label="Upload-like">
              <button>Browse</button>
              <input style={{ display: 'none' }} aria-label="hidden file input" />
            </div>
          )}
        </div>
      );
    }
    render(<WithHiddenInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const browse = screen.getByRole('button', { name: 'Browse' });
    expect(browse).toHaveFocus();
    // Browse is both first AND last visible focusable — Tab must wrap to it,
    // never to the display:none input.
    tab();
    expect(browse).toHaveFocus();
    tab(true);
    expect(browse).toHaveFocus();
  });

  it('is inert while inactive (no listener, no restore bookkeeping)', () => {
    render(<Harness />);
    const outside = screen.getByRole('button', { name: 'Outside button' });
    outside.focus();
    tab();
    // No trap active: our synthetic keyDown doesn't move focus at all
    expect(outside).toHaveFocus();
  });
});
