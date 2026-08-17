import type { Song } from '../types';
import type { StatsMap } from './stats';

export type SortKey = 'manual' | 'recent' | 'title' | 'artist' | 'duration' | 'plays' | 'played';

export const SORT_LABELS: Record<SortKey, string> = {
  manual: 'Manual',
  recent: 'Recent',
  title: 'Title',
  artist: 'Artist',
  duration: 'Duration',
  plays: 'Most played',
  played: 'Last played',
};

/**
 * View-only ordering for the song list. Returns a **new** array; never mutates
 * the input (playback order is unaffected — the queue still walks the playlist's
 * own order).
 * - `manual`   → the list as-is (drag order)
 * - `recent`   → reversed (newest-appended-last proxy; Song carries no timestamp).
 *                Note this means "recently ADDED" — `played` is the listening one.
 * - `title`/`artist` → locale-aware A–Z
 * - `duration` → ascending
 * - `plays`    → most-played first; never-played tracks sort LAST
 * - `played`   → most-recently-finished first; never-played tracks sort LAST
 *
 * `stats` is optional so callers that don't sort by listening data (and the
 * existing component tests) need not supply it; without it the two listening
 * keys degrade to the input order rather than throwing.
 */
export function sortSongs(songs: Song[], key: SortKey, stats: StatsMap = {}): Song[] {
  switch (key) {
    case 'manual':
      return songs;
    case 'recent':
      return [...songs].reverse();
    case 'title':
      return [...songs].sort((a, b) => a.title.localeCompare(b.title));
    case 'artist':
      return [...songs].sort((a, b) => a.artist.localeCompare(b.artist));
    case 'duration':
      return [...songs].sort((a, b) => a.duration - b.duration);
    // Both listening sorts push unheard tracks to the bottom: surfacing a wall
    // of zeroes above your most-played would defeat the point of the sort.
    case 'plays':
      return [...songs].sort(
        (a, b) => (stats[b.id]?.plays ?? 0) - (stats[a.id]?.plays ?? 0),
      );
    case 'played':
      return [...songs].sort(
        (a, b) => (stats[b.id]?.lastPlayedAt ?? 0) - (stats[a.id]?.lastPlayedAt ?? 0),
      );
  }
}
