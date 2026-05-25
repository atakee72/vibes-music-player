import type { Song } from '../types';

/**
 * Single-token, case-insensitive substring filter against title, artist, or album.
 * Empty/whitespace-only query returns the input list unchanged.
 */
export function filterSongs(songs: Song[], query: string): Song[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return songs;
  return songs.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.album.toLowerCase().includes(q),
  );
}
