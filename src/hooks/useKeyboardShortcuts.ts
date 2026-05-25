import { useEffect, useLayoutEffect, useRef } from 'react';

export type KeyCode =
  | 'Space'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Slash'
  | 'Escape'
  | 'Enter'
  | string;

type Handler = (event: KeyboardEvent) => void;
type Handlers = Partial<Record<KeyCode, Handler>>;

interface Options {
  /** When true, suppress all handlers except Escape (e.g. while a modal is open). */
  isBlocked?: boolean;
}

const PREVENT_DEFAULT_CODES = new Set<string>(['Space', 'Slash']);

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Register keyboard shortcuts on document. Handlers are keyed by KeyboardEvent.code
 * (layout-independent). The listener is registered once; handlers see fresh
 * closures via an internally-tracked ref.
 *
 * - Input-focus guard: when an <input>, <textarea>, [contenteditable] etc. is
 *   focused, only Escape fires (so text editing works normally).
 * - Modal suppression: pass `{ isBlocked: true }` to limit firing to Escape only.
 * - preventDefault is called for Space (page scroll) and Slash (Firefox Quick Find).
 */
export function useKeyboardShortcuts(handlers: Handlers, options: Options = {}): void {
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);

  useLayoutEffect(() => {
    handlersRef.current = handlers;
    optionsRef.current = options;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.code;
      const handler = handlersRef.current[code as KeyCode];
      if (!handler) return;

      const inputBlocking = isInputFocused() || optionsRef.current.isBlocked === true;
      if (inputBlocking && code !== 'Escape') return;

      if (PREVENT_DEFAULT_CODES.has(code)) event.preventDefault();
      handler(event);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
