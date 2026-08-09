import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface PromptModalProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  open,
  title,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Create',
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Trap + restore only — the existing rAF input focus/select below owns
  // initial focus, so the hook must not fight it.
  useDialogFocus(open, panelRef, { initialFocus: false });

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select(); // no-op when defaultValue is empty (New Playlist)
      });
    }
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-title"
    >
      <div
        ref={panelRef}
        className="bg-surface/95 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-white/10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="prompt-title" className="text-lg font-semibold font-display text-white">
          {title}
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="w-full bg-white/5 text-white placeholder-white/40 rounded-lg border border-white/10 focus:border-amber focus:outline-none px-3 py-2 transition-colors"
        />
        <div className="flex justify-end space-x-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber to-coral hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-deep text-sm font-medium transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
