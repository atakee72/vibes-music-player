import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { usePresence } from '../hooks/usePresence';
import { LyricsView } from './LyricsView';

interface LyricsPanelProps {
  lyrics: LyricLine[] | undefined;
  currentTime: number;
  /** Drives the slide-in/out. Defaults to `true` (always-open) when omitted. */
  open?: boolean;
  onClose: () => void;
  onSeek?: (time: number) => void;
  onFetch?: () => void;
  fetching?: boolean;
  fetchError?: string | null;
}

export function LyricsPanel({
  lyrics,
  currentTime,
  open = true,
  onClose,
  onSeek,
  onFetch,
  fetching,
  fetchError,
}: LyricsPanelProps) {
  const { mounted, visible } = usePresence(open);

  if (!mounted) return null;

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 lg:hidden motion-safe:transition-opacity motion-safe:duration-300 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        role="complementary"
        aria-label="Lyrics"
        className={`fixed inset-0 z-40 lg:relative lg:z-auto lg:w-80 flex flex-col bg-surface/95 backdrop-blur-xl border-l border-white/10 motion-safe:transition-transform motion-safe:duration-300 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <span className="text-sm font-medium text-white/80">Lyrics</span>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
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
    </>
  );
}
