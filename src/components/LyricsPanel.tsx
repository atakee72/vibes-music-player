import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { LyricLine } from '../types';
import { activeLyricIndex } from '../lib/lrc';

interface LyricsPanelProps {
  lyrics: LyricLine[] | undefined;
  currentTime: number;
  onClose: () => void;
}

export function LyricsPanel({ lyrics, currentTime, onClose }: LyricsPanelProps) {
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

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-40 lg:relative lg:z-auto lg:w-80 flex flex-col bg-slate-800/95 backdrop-blur-xl border-l border-white/10">
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
            <p className="text-sm text-white/40 text-center mt-8">
              No lyrics available for this track.
            </p>
          ) : isSynced ? (
            <div className="space-y-3">
              {lyrics.map((line, i) => (
                <p
                  key={i}
                  ref={(el) => {
                    if (el) lineRefs.current.set(i, el);
                    else lineRefs.current.delete(i);
                  }}
                  className={`transition-all duration-300 ${
                    i === activeIdx
                      ? 'text-purple-300 text-lg font-medium'
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
