import type { RepeatMode, Song } from '../types';

/**
 * What plays next given the current song, the playlist, the repeat mode, and
 * whether shuffle is on.
 * - `'one'` → the same song again (shuffle is ignored — repeat-one wins)
 * - shuffle → a uniformly random *other* song (simple, with replacement: no
 *   shuffled-history, so tracks may recur; shuffle keeps advancing even under
 *   `'none'` since shuffle implies continuous play)
 * - `'all'` → wraps from last to first
 * - `'none'` → null after the last song
 * Returns null if `current` is not in `songs` or `songs` is empty.
 */
export function nextInPlaylist(
  current: Song | null,
  songs: Song[],
  repeatMode: RepeatMode,
  shuffle = false,
): Song | null {
  if (!current || songs.length === 0) return null;
  if (repeatMode === 'one') return current;
  if (shuffle && songs.length > 1) {
    const others = songs.filter((s) => s.id !== current.id);
    return others[Math.floor(Math.random() * others.length)];
  }
  const idx = songs.findIndex((s) => s.id === current.id);
  if (idx === -1) return null;
  const next = idx + 1;
  if (next >= songs.length) {
    return repeatMode === 'all' ? songs[0] : null;
  }
  return songs[next];
}
