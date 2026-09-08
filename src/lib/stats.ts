import type { Song } from '../types';

/**
 * Local listening stats. Never leaves the device, never syncs — the source
 * app needs a backend for this only because its stats follow a user across
 * devices; ours are one browser's history.
 *
 * A play is counted when a track FINISHES (see `useAudioEngine`'s
 * `onTrackFinished`), and `msPlayed` is the wall-clock time that took at the
 * playback rate in effect — partial listens are deliberately invisible.
 */
export interface SongStat {
  plays: number;
  /** Epoch ms of the most recent finish. */
  lastPlayedAt: number;
  /** Wall-clock ms actually spent listening (duration ÷ playback rate). */
  msPlayed: number;
  /**
   * Denormalised from the Song on every finish. Keeps this map self-contained:
   * the panel needs no join against the library, and deleting a song doesn't
   * make historical totals or top-artists lurch.
   */
  title: string;
  artist: string;
}

/** Keyed by `Song.id`. */
export type StatsMap = Record<string, SongStat>;

/**
 * Record one completed play. Pure — returns a new map.
 *
 * `now` is injected rather than read from `Date.now()` so the caller (and the
 * tests) stay in control of time.
 *
 * `rate` is the playback speed in effect at the finish. `msPlayed` divides by
 * it so the panel's "listening time" means time the listener actually spent:
 * a 4-minute track at 2x cost them two minutes, not four. Defaults to 1, so
 * every pre-speed call site is unaffected.
 */
export function recordFinish(
  stats: StatsMap,
  song: Song,
  now: number,
  rate = 1,
): StatsMap {
  const prev = stats[song.id];
  // Guard the divisor here as well as at the source: this is a pure function
  // with a public signature, and a 0 would produce Infinity in a persisted map.
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return {
    ...stats,
    [song.id]: {
      plays: (prev?.plays ?? 0) + 1,
      lastPlayedAt: now,
      msPlayed: (prev?.msPlayed ?? 0) + (Math.max(0, song.duration) / safeRate) * 1000,
      // Refreshed every time, so a re-tag (beets) updates the display name.
      title: song.title,
      artist: song.artist,
    },
  };
}

export interface Totals {
  plays: number;
  msPlayed: number;
  /** Distinct tracks with at least one completed play. */
  tracks: number;
}

export function totals(stats: StatsMap): Totals {
  const entries = Object.values(stats);
  return {
    plays: entries.reduce((n, s) => n + s.plays, 0),
    msPlayed: entries.reduce((n, s) => n + s.msPlayed, 0),
    tracks: entries.length,
  };
}

export interface RankedTrack extends SongStat {
  id: string;
}

/** Most-played first. Ties break by title so the order is stable across renders. */
export function topTracks(stats: StatsMap, limit = 5): RankedTrack[] {
  return Object.entries(stats)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export interface RankedArtist {
  artist: string;
  plays: number;
  msPlayed: number;
}

/** Aggregates plays per artist. Ties break by name, for the same reason. */
export function topArtists(stats: StatsMap, limit = 5): RankedArtist[] {
  const byArtist = new Map<string, RankedArtist>();
  for (const s of Object.values(stats)) {
    const existing = byArtist.get(s.artist);
    if (existing) {
      existing.plays += s.plays;
      existing.msPlayed += s.msPlayed;
    } else {
      byArtist.set(s.artist, { artist: s.artist, plays: s.plays, msPlayed: s.msPlayed });
    }
  }
  return [...byArtist.values()]
    .sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist))
    .slice(0, limit);
}

/** Most recently finished first. */
export function recentlyPlayed(stats: StatsMap, limit = 5): RankedTrack[] {
  return Object.entries(stats)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** `"83h 12m"` / `"9m"` / `"< 1m"`. */
export function formatListenTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return ms > 0 ? '< 1m' : '0m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
