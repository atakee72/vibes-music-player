import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { activeLyricIndex } from '../lib/lrc';
import { usePresence } from '../hooks/usePresence';

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
  const activeIdx = lyrics ? activeLyricIndex(lyrics, currentTime) : -1;
  const prevIdxRef = useRef(-1);
  const lineRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());

  const isSynced = lyrics && lyrics.length > 1 && lyrics.some((l) => l.time > 0);

  useEffect(() => {
    if (activeIdx !== prevIdxRef.current && activeIdx >= 0) {
      const el = lineRefs.current.get(activeIdx);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    prevIdxRef.current = activeIdx;
  }, [activeIdx]);

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

        <div className="flex-1 overflow-y-auto p-4">
          {!lyrics || lyrics.length === 0 ? (
            <div className="text-center mt-8 space-y-3">
              <p className="text-sm text-white/40">No lyrics available for this track.</p>
              {onFetch && (
                <>
                  <button
                    onClick={onFetch}
                    disabled={fetching}
                    className="px-4 py-2 rounded-full bg-gradient-to-r from-amber to-coral text-deep text-sm font-medium hover:brightness-110 disabled:opacity-60 transition-all"
                  >
                    {fetching ? 'Searching…' : 'Find lyrics'}
                  </button>
                  {fetchError && <p className="text-xs text-danger">{fetchError}</p>}
                  <p className="text-[11px] text-white/30 px-4 leading-relaxed">
                    Checks the file, then LRCLIB (only the track name, artist &amp; duration
                    are sent).
                  </p>
                </>
              )}
            </div>
          ) : isSynced ? (
            <div className="space-y-3">
              {lyrics.map((line, i) => (
                <p
                  key={i}
                  ref={(el) => {
                    if (el) lineRefs.current.set(i, el);
                    else lineRefs.current.delete(i);
                  }}
                  {...(onSeek
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        onClick: () => onSeek(line.time),
                        onKeyDown: (e: ReactKeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSeek(line.time);
                          }
                        },
                        title: 'Jump to this line',
                      }
                    : {})}
                  className={`transition-all duration-300 ${
                    onSeek ? 'cursor-pointer hover:text-white/80' : ''
                  } ${
                    i === activeIdx
                      ? 'text-amber text-lg font-medium font-display motion-safe:scale-105 origin-left'
                      : 'text-white/40 text-sm'
                  }`}
                >
                  {line.text || ' '}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed">
              {lyrics[0].text}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
