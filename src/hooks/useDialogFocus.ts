import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogFocusOptions {
  /** Focus the first focusable (or `[data-autofocus]`) on open. Set false when
   *  the surface manages its own initial focus (e.g. PromptModal's input). */
  initialFocus?: boolean;
}

/**
 * Modal focus management: initial focus, Tab trapping, and focus restore.
 *
 * Key on the OPEN signal, not mount — `usePresence` surfaces stay mounted
 * ~300ms after close for their exit slide, and restore must fire at close
 * time (while the trigger still expects focus back), not at unmount.
 *
 * The Tab listener is DOCUMENT-level on purpose: a container-scoped listener
 * never fires once focus has left the container (e.g. a backdrop click sends
 * focus to body), which would let Tab walk the page behind the modal. On any
 * Tab while active, focus outside the container is pulled back inside.
 *
 * Panels (Queue/Lyrics) and the desktop sidebar are non-modal — do NOT trap
 * them; this hook is for `aria-modal` dialog surfaces only.
 */
export function useDialogFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement>,
  { initialFocus = true }: DialogFocusOptions = {},
): void {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (initialFocus) {
      const container = containerRef.current;
      const target =
        container?.querySelector<HTMLElement>('[data-autofocus]') ??
        container?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;

      const activeEl = document.activeElement;
      if (!(activeEl instanceof HTMLElement) || !container.contains(activeEl)) {
        // Focus escaped (backdrop click → body): pull it back inside.
        e.preventDefault();
        focusables[0].focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const restore = restoreRef.current;
      restoreRef.current = null;
      if (restore?.isConnected) restore.focus();
    };
  }, [active, containerRef, initialFocus]);
}
