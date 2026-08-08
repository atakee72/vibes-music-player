import { useEffect, useRef, useState } from 'react';
import { ListEnd, ListStart, MoreHorizontal } from 'lucide-react';

interface RowMenuProps {
  songTitle: string;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  /** Notified on every open/close transition — lets the virtualized list
   *  raise this row's wrapper z-index while the menu is open (CLAUDE.md
   *  "RowMenu occluded by following virtualized rows"). */
  onOpenChange?: (open: boolean) => void;
}

/**
 * The song-row "⋯" dropdown. Local open state + outside-click close — same
 * convention-break precedent as PlayerBar's `eqOpen` (CLAUDE.md).
 */
export function RowMenu({ songTitle, onPlayNext, onAddToQueue, onOpenChange }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const setOpenNotify = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenNotify(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item = (label: string, Icon: typeof ListStart, action: () => void) => (
    <button
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        setOpenNotify(false);
        action();
      }}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
    >
      <Icon className="h-4 w-4 text-white/60" />
      {label}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpenNotify(!open);
        }}
        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        aria-label={`More actions for ${songTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4 text-white/60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-white/10 bg-surface/95 p-1 shadow-xl backdrop-blur-xl"
        >
          {item('Play next', ListStart, onPlayNext)}
          {item('Add to queue', ListEnd, onAddToQueue)}
        </div>
      )}
    </div>
  );
}
