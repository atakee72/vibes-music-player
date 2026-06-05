import type { Song } from '../types';

export type SortKey = 'manual' | 'recent' | 'title' | 'artist' | 'duration';

export const SORT_LABELS: Record<SortKey, string> = {
  manual: 'Manual',
  recent: 'Recent',
  title: 'Title',
  artist: 'Artist',
  duration: 'Duration',
};

/**
 * View-only ordering for the song list. Returns a **new** array; never mutates
 * the input (playback order is unaffected — the queue still walks the playlist's
 * own order).
 * - `manual`   → the list as-is (drag order)
 * - `recent`   → reversed (newest-appended-last proxy; Song carries no timestamp)
 * - `title`/`artist` → locale-aware A–Z
 * - `duration` → ascending
 */
export function sortSongs(songs: Song[], key: SortKey): Song[] {
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
  }
}
