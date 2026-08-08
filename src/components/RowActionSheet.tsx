import { useEffect, useRef } from 'react';
import { Heart, ListEnd, ListStart, Trash2 } from 'lucide-react';
import type { Song } from '../types';
import { usePresence } from '../hooks/usePresence';

interface RowActionSheetProps {
  /** The song the sheet acts on; null = closed. The parent renders this
   *  component ALWAYS (never `{cond && <sheet/>}`) so the exit slide plays. */
  song: Song | null;
  onPlayNext: (id: string) => void;
  onAddToQueue: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * Mobile bottom action sheet for song rows (spec:
 * docs/superpowers/specs/2026-08-09-mobile-touch-affordances-design.md).
 * MUST be rendered at SongList's root — never inside the virtualized row
 * wrappers, whose `transform` would hijack `position: fixed` (the wrapper
 * becomes the containing block) and pin the sheet inside the row.
 */
export function RowActionSheet({
  song,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onDelete,
  onClose,
}: RowActionSheetProps) {
  const open = song !== null;
  const { mounted, visible } = usePresence(open);
  // Keep the previous song's content rendered through the exit slide.
  const lastSongRef = useRef<Song | null>(null);
  if (song) lastSongRef.current = song;
  const shown = song ?? lastSongRef.current;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // own the Escape before App's chain sees it
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted || !shown) return null;

  const act = (fn: (id: string) => void) => () => {
    onClose();
    fn(shown.id);
  };

  const itemClass =
    'flex w-full items-center gap-3 rounded-lg px-3 py-3 min-h-12 text-sm transition-colors hover:bg-white/10';

  return (
    <>
      <div
        data-sheet-backdrop
        className={`fixed inset-0 z-50 bg-black/50 motion-safe:transition-opacity motion-safe:duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${shown.title}`}
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-white/10 bg-surface/95 p-2 pb-4 backdrop-blur-xl motion-safe:transition-transform motion-safe:duration-300 ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="mb-1 border-b border-white/10 px-3 py-2">
          <p className="truncate text-sm font-medium font-display text-cream">{shown.title}</p>
          <p className="truncate text-xs text-white/50">{shown.artist}</p>
        </div>
        <button onClick={act(onPlayNext)} className={`${itemClass} text-white/80`}>
          <ListStart className="h-5 w-5 text-white/60" />
          Play next
        </button>
        <button onClick={act(onAddToQueue)} className={`${itemClass} text-white/80`}>
          <ListEnd className="h-5 w-5 text-white/60" />
          Add to queue
        </button>
        <button
          onClick={act(onToggleFavorite)}
          aria-pressed={!!shown.favorite}
          className={`${itemClass} text-white/80`}
        >
          <Heart
            className={`h-5 w-5 ${shown.favorite ? 'text-coral fill-current' : 'text-white/60'}`}
          />
          {shown.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
        </button>
        <button onClick={act(onDelete)} className={`${itemClass} text-danger`}>
          <Trash2 className="h-5 w-5 text-danger" />
          Delete
        </button>
      </div>
    </>
  );
}
