import type { RepeatMode, Song } from '../types';

/**
 * What plays next given the current song, the playlist, and the repeat mode.
 * - `'one'` → the same song again
 * - `'all'` → wraps from last to first
 * - `'none'` → null after the last song
 * Returns null if `current` is not in `songs` or `songs` is empty.
 */
export function nextInPlaylist(
  current: Song | null,
  songs: Song[],
  repeatMode: RepeatMode,
): Song | null {
  if (!current || songs.length === 0) return null;
  if (repeatMode === 'one') return current;
  const idx = songs.findIndex((s) => s.id === current.id);
  if (idx === -1) return null;
  const next = idx + 1;
  if (next >= songs.length) {
    return repeatMode === 'all' ? songs[0] : null;
  }
  return songs[next];
}
