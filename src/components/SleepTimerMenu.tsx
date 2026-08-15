import { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { SLEEP_OPTIONS_MINUTES, formatRemaining } from '../lib/sleep';

interface SleepTimerMenuProps {
  /** Epoch ms the timer fires at, or null when disarmed. */
  deadline: number | null;
  /** `null` disarms. */
  onSet: (minutes: number | null) => void;
  /** Popover side — the player bar opens upward, the mobile view downward. */
  placement?: 'up' | 'down';
  className?: string;
}

/**
 * Sleep-timer popover. Follows the RowMenu/HeaderMenu pattern deliberately:
 * a popover is NOT a modal, so it owns Escape locally (stopPropagation, then
 * refocus its trigger) rather than trapping focus with `useDialogFocus`.
 *
 * The countdown re-renders from App's 1s tick — this component reads
 * `deadline` and formats it, it does not own a timer of its own.
 */
export function SleepTimerMenu({
  deadline,
  onSet,
  placement = 'up',
  className = '',
}: SleepTimerMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const armed = deadline !== null;
  const remaining = armed ? formatRemaining(deadline - Date.now()) : null;

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          e.stopPropagation(); // own the Escape before App's chain sees it
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-full p-2 transition-colors hover:bg-white/10 ${
          armed ? 'text-amber' : 'text-white/60'
        }`}
        title={armed ? `Sleep timer: ${remaining} remaining` : 'Sleep timer'}
        aria-label={armed ? `Sleep timer, ${remaining} remaining` : 'Sleep timer'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Moon className="h-4 w-4 lg:h-5 lg:w-5" />
        {armed && <span className="font-mono text-xs tabular-nums">{remaining}</span>}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Sleep timer"
          className={`absolute right-0 z-50 min-w-[150px] rounded-lg border border-white/10 bg-surface/95 py-1 shadow-xl backdrop-blur-xl ${
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <button
            role="menuitem"
            onClick={() => {
              onSet(null);
              setOpen(false);
            }}
            className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
              armed
                ? 'text-white/80 hover:bg-white/5'
                : 'bg-gradient-to-r from-amber/30 to-coral/30 text-cream'
            }`}
          >
            Off
          </button>
          {SLEEP_OPTIONS_MINUTES.map((minutes) => (
            <button
              key={minutes}
              role="menuitem"
              onClick={() => {
                onSet(minutes);
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/5"
            >
              {minutes} minutes
            </button>
          ))}
          {armed && (
            <p className="border-t border-white/10 px-3 pb-1 pt-1.5 text-xs text-faint">
              Fades out at {remaining}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
