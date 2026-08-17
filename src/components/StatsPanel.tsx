import { X } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';
import {
  formatListenTime,
  recentlyPlayed,
  topArtists,
  topTracks,
  totals,
  type StatsMap,
} from '../lib/stats';

interface StatsPanelProps {
  /** Drives the slide-in/out. Defaults to `true` (always-open) when omitted. */
  open?: boolean;
  stats: StatsMap;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-t border-white/10">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Rank({ n, label, sub }: { n: number; label: string; sub: string }) {
  return (
    <li className="flex items-baseline gap-3 py-1">
      <span className="w-4 shrink-0 font-mono text-xs text-faint">{n}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-white/80">{label}</span>
      <span className="shrink-0 font-mono text-xs text-white/40">{sub}</span>
    </li>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Listening stats, in the right-edge panel slot shared with Lyrics and Queue
 * (App's `togglePanel` keeps exactly one of the three open).
 *
 * Everything shown is derived from the `StatsMap` — no join against the
 * library — so tracks you've since deleted still count toward your history.
 */
export function StatsPanel({ open = true, stats, onClose }: StatsPanelProps) {
  const { mounted, visible } = usePresence(open);
  if (!mounted) return null;

  const summary = totals(stats);
  const artists = topArtists(stats);
  const tracks = topTracks(stats);
  const recent = recentlyPlayed(stats);
  const empty = summary.plays === 0;

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
        aria-label="Listening stats"
        className={`fixed inset-0 z-40 lg:relative lg:z-auto lg:w-80 flex flex-col bg-surface/95 backdrop-blur-xl border-l border-white/10 motion-safe:transition-transform motion-safe:duration-300 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h2 className="font-display text-lg text-cream">Stats</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-white/60 transition-colors hover:bg-white/10"
            aria-label="Close stats"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          {empty ? (
            <p className="px-4 py-6 text-sm text-white/40">
              Nothing yet. Play a track through to the end and it'll show up here.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 px-4 py-4 text-center">
                <div>
                  <p className="font-mono text-xl text-cream">{summary.plays}</p>
                  <p className="text-[10px] uppercase tracking-wider text-faint">Plays</p>
                </div>
                <div>
                  <p className="font-mono text-xl text-cream">
                    {formatListenTime(summary.msPlayed)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-faint">Listened</p>
                </div>
                <div>
                  <p className="font-mono text-xl text-cream">{summary.tracks}</p>
                  <p className="text-[10px] uppercase tracking-wider text-faint">Tracks</p>
                </div>
              </div>

              <Section title="Top artists">
                <ol>
                  {artists.map((a, i) => (
                    <Rank
                      key={a.artist}
                      n={i + 1}
                      label={a.artist}
                      sub={plural(a.plays, 'play')}
                    />
                  ))}
                </ol>
              </Section>

              <Section title="Top tracks">
                <ol>
                  {tracks.map((t, i) => (
                    <Rank
                      key={t.id}
                      n={i + 1}
                      label={t.title}
                      sub={plural(t.plays, 'play')}
                    />
                  ))}
                </ol>
              </Section>

              <Section title="Recently played">
                <ul>
                  {recent.map((t) => (
                    <li key={t.id} className="py-1">
                      <p className="truncate text-sm text-white/80">{t.title}</p>
                      <p className="truncate text-xs text-white/40">{t.artist}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
