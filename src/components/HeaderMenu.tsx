import { useEffect, useRef, useState } from 'react';
import { MoreVertical, type LucideIcon } from 'lucide-react';

export interface HeaderAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
}

/**
 * Mobile-only (`lg:hidden`) overflow menu for the header's secondary actions
 * (Select / Lyrics / Share / Refresh / Export / Install). Keeps the mobile
 * header to one tidy row — the desktop header shows these inline instead.
 * Click-outside-to-close uses the same `mousedown` pattern as PlayerBar's EQ
 * popover.
 */
export function HeaderMenu({ actions }: { actions: HeaderAction[] }) {
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

  if (actions.length === 0) return null;

  return (
    <div
      ref={ref}
      className="relative lg:hidden"
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
        className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-lg border border-white/10 bg-surface/95 backdrop-blur-xl py-1 shadow-xl"
          role="menu"
        >
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                role="menuitem"
                onClick={() => {
                  a.onClick();
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-white/5 ${
                  a.active ? 'text-amber' : 'text-white/80'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
