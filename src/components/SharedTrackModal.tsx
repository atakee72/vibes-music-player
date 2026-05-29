import { useEffect } from 'react';
import { Music } from 'lucide-react';
import type { SharedTrack } from '../lib/share';

interface SharedTrackModalProps {
  track: SharedTrack | null;
  onClose: () => void;
}

const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
};

/**
 * Shown when the app is opened via a share link (`#s=...`). Displays the
 * shared track's metadata only — Vibes never carries the audio file, so the
 * recipient plays it from their own library or not at all.
 *
 * Owns its own Escape via a capture-phase listener (like ConfirmModal) so it
 * doesn't collide with App's Escape chain.
 */
export function SharedTrackModal({ track, onClose }: SharedTrackModalProps) {
  useEffect(() => {
    if (!track) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [track, onClose]);

  if (!track) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-track-title"
    >
      <div
        className="bg-slate-800/95 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-white/10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs uppercase tracking-wide text-purple-300/80 font-medium">
          Shared with you
        </p>
        <div className="flex items-center space-x-4">
          <div className="h-14 w-14 shrink-0 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Music className="h-7 w-7 text-white" />
          </div>
          <div className="min-w-0">
            <h3
              id="shared-track-title"
              className="text-lg font-semibold text-white truncate"
            >
              {track.title || 'Unknown title'}
            </h3>
            <p className="text-sm text-white/70 truncate">
              {track.artist || 'Unknown artist'}
            </p>
            {track.album && (
              <p className="text-xs text-white/50 truncate">{track.album}</p>
            )}
          </div>
        </div>
        <p className="text-xs text-white/50">
          {formatTime(track.duration)} · Open this track from your own library to
          play it — Vibes never shares audio files.
        </p>
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
