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

export interface ResolveNextArgs {
  current: Song | null;
  queue: Song[];
  songs: Song[];
  repeatMode: RepeatMode;
  shuffle?: boolean;
  /** Last song that played FROM the playlist — the drain-back base when the
   *  queue empties after a song that isn't in `songs`. */
  anchor?: Song | null;
}

/**
 * Queue-aware next-song resolution (spec:
 * docs/superpowers/specs/2026-08-07-queue-panel-design.md).
 * Order: repeat-one → current (the queue WAITS); explicit queue head; else
 * the playlist walk from `current` if it is in `songs`, otherwise from
 * `anchor` — so a drained queue never strands playback in silence.
 */
export function resolveNextSong({
  current,
  queue,
  songs,
  repeatMode,
  shuffle = false,
  anchor = null,
}: ResolveNextArgs): Song | null {
  if (repeatMode === 'one') return current;
  // Skip queue entries matching the CURRENT song: the engine treats
  // next.url === active.src as repeat-one and replays in place WITHOUT
  // calling onEnded, so such a head could never dequeue (infinite loop).
  // Skipped entries stay queued; they become playable once current changes.
  const head = queue.find((s) => s.id !== current?.id);
  if (head) return head;
  const base = current && songs.some((s) => s.id === current.id) ? current : anchor;
  return nextInPlaylist(base, songs, repeatMode, shuffle);
}

/**
 * Read-only preview of the non-shuffle playlist walk after `current`:
 * up to `count` songs, wrapping under 'all', stopping at the end under
 * 'none'. Returns [] for repeat-one (the honest preview is "this song
 * forever") and for an unknown/missing current. Shuffle previews are NOT
 * computed here — a random walk has no knowable order beyond the already
 * memoized next pick (the caller shows that pick directly).
 */
export function upNextPreview(
  current: Song | null,
  songs: Song[],
  repeatMode: RepeatMode,
  count = 10,
): Song[] {
  if (!current || songs.length === 0 || repeatMode === 'one') return [];
  const idx = songs.findIndex((s) => s.id === current.id);
  if (idx === -1) return [];
  const out: Song[] = [];
  for (let i = 1; i <= count; i++) {
    const j = idx + i;
    if (j < songs.length) out.push(songs[j]);
    else if (repeatMode === 'all') out.push(songs[j % songs.length]);
    else break;
  }
  return out;
}
