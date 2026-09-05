import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { usePresence } from '../hooks/usePresence';
import { useSwipeGesture } from '../hooks/useSwipeGesture';
import { LyricsView } from './LyricsView';

interface LyricsSheetProps {
  open: boolean;
  onClose: () => void;
  lyrics: LyricLine[] | undefined;
  currentTime: number;
  onSeek?: (time: number) => void;
  onFetch?: () => void;
  fetching?: boolean;
  fetchError?: string | null;
}

/**
 * Lyrics as a bottom sheet INSIDE the now-playing view.
 *
 * Exists so the view no longer has to close itself to show lyrics: the
 * right-edge LyricsPanel is z-40 and the view is z-[60], so App used to
 * dismiss the view whenever lyrics opened. This is positioned `absolute`
 * against the view's CONTENT AREA — deliberately not the view root, which
 * would bury the progress bar and transport and leave no way to control
 * playback while reading lyrics. The negative inline inset cancels the
 * host's padding so it still bleeds edge to edge.
 *
 * Non-modal, like the other panels: labelled landmark, no focus trap.
 */
export function LyricsSheet({
  open,
  onClose,
  lyrics,
  currentTime,
  onSeek,
  onFetch,
  fetching,
  fetchError,
}: LyricsSheetProps) {
  const { mounted, visible } = usePresence(open);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Only the handle is draggable. The body scrolls, and a downward scroll
  // there must not read as a dismissal.
  const drag = useSwipeGesture({ onSwipeDown: onClose });

  // The sheet stays mounted and on screen through its ~300ms exit, and a
  // transform removes nothing from the tab order — so Tab could reach the
  // close button and the lyric lines of a sheet the user just dismissed.
  // `inert` is the only attribute that takes a whole subtree out of both the
  // tab order and the a11y tree without hiding it, and React 18's JSX types
  // have no `inert` prop (React 19 added it), so it goes on imperatively.
  //
  // Keyed on `open`, NOT `visible`: `visible` is also false for the two
  // frames of the ENTER, where the sheet must stay reachable. `mounted` is a
  // dep because the node does not exist on the render where `open` first
  // flips true. MUST stay above the early return below — a hook after a
  // conditional return breaks the Rules of Hooks.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    if (open) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <div
      ref={sheetRef}
      role="complementary"
      aria-label="Lyrics"
      className={`absolute inset-y-0 -inset-x-6 z-10 flex flex-col rounded-t-card border-t border-white/10 bg-surface/95 backdrop-blur-xl motion-safe:transition-transform motion-safe:duration-300 ${
        visible ? 'translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
    >
      <div
        data-testid="lyrics-sheet-handle"
        className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2"
        {...drag}
      >
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>

      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <span className="text-sm font-medium text-white/80">Lyrics</span>
        <button
          onClick={onClose}
          className="rounded-full p-1 transition-colors hover:bg-white/10"
          aria-label="Close lyrics"
        >
          <X className="h-4 w-4 text-white/60" />
        </button>
      </div>

      <LyricsView
        lyrics={lyrics}
        currentTime={currentTime}
        onSeek={onSeek}
        onFetch={onFetch}
        fetching={fetching}
        fetchError={fetchError}
      />
    </div>
  );
}
