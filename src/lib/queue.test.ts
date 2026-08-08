import { nextInPlaylist, resolveNextSong, safeQueueMove, upNextPreview } from './queue';
import { makeSong } from '../test-utils';

const a = makeSong({ title: 'A' });
const b = makeSong({ title: 'B' });
const c = makeSong({ title: 'C' });
const songs = [a, b, c];

describe('nextInPlaylist', () => {
  it('returns null when current is null or list is empty', () => {
    expect(nextInPlaylist(null, songs, 'none')).toBeNull();
    expect(nextInPlaylist(a, [], 'none')).toBeNull();
  });

  it('returns null when current is not in the list', () => {
    const orphan = makeSong({ title: 'Orphan' });
    expect(nextInPlaylist(orphan, songs, 'none')).toBeNull();
  });

  it('returns the next song under repeat=none', () => {
    expect(nextInPlaylist(a, songs, 'none')).toBe(b);
    expect(nextInPlaylist(b, songs, 'none')).toBe(c);
    expect(nextInPlaylist(c, songs, 'none')).toBeNull();
  });

  it('wraps to first song under repeat=all', () => {
    expect(nextInPlaylist(c, songs, 'all')).toBe(a);
    expect(nextInPlaylist(a, songs, 'all')).toBe(b);
  });

  it('returns the same song under repeat=one', () => {
    expect(nextInPlaylist(a, songs, 'one')).toBe(a);
    expect(nextInPlaylist(c, songs, 'one')).toBe(c);
  });

  describe('shuffle', () => {
    it('returns a different song from the list when shuffle is on', () => {
      // Stub Math.random so the pick is deterministic (first "other" song).
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(nextInPlaylist(a, songs, 'none', true)).toBe(b); // others=[b,c], idx 0
      expect(nextInPlaylist(b, songs, 'none', true)).toBe(a); // others=[a,c], idx 0
      spy.mockRestore();
    });

    it('never returns the current song under shuffle', () => {
      const spy = vi.spyOn(Math, 'random');
      for (let r = 0; r < 1; r += 0.34) {
        spy.mockReturnValue(r);
        expect(nextInPlaylist(b, songs, 'none', true)).not.toBe(b);
      }
      spy.mockRestore();
    });

    it('repeat=one still wins over shuffle', () => {
      expect(nextInPlaylist(a, songs, 'one', true)).toBe(a);
    });

    it('is unchanged from sequential when shuffle is off (default)', () => {
      expect(nextInPlaylist(a, songs, 'none')).toBe(b);
      expect(nextInPlaylist(a, songs, 'none', false)).toBe(b);
    });
  });
});

describe('resolveNextSong', () => {
  it('repeat-one wins over the queue', () => {
    expect(resolveNextSong({ current: a, queue: [b], songs, repeatMode: 'one' })).toBe(a);
  });

  it('queue head wins over the playlist walk', () => {
    expect(resolveNextSong({ current: a, queue: [c], songs, repeatMode: 'none' })).toBe(c);
  });

  it('queue head wins even under shuffle', () => {
    expect(resolveNextSong({ current: a, queue: [b], songs, repeatMode: 'none', shuffle: true })).toBe(b);
  });

  it('empty queue falls back to the plain playlist walk', () => {
    expect(resolveNextSong({ current: a, queue: [], songs, repeatMode: 'none' })).toBe(b);
    expect(resolveNextSong({ current: c, queue: [], songs, repeatMode: 'all' })).toBe(a);
    expect(resolveNextSong({ current: c, queue: [], songs, repeatMode: 'none' })).toBeNull();
  });

  it('drains back via the anchor when current is not in songs', () => {
    const foreign = makeSong({ title: 'Foreign' });
    expect(
      resolveNextSong({ current: foreign, queue: [], songs, repeatMode: 'none', anchor: a }),
    ).toBe(b);
  });

  it('Spotify-style: a valid anchor wins even when current IS in songs', () => {
    // Listening to `a`, queued `c` played (anchor stayed `a`): the walk
    // resumes after `a` (→ b), not after `c` (→ null under repeat=none).
    expect(
      resolveNextSong({ current: c, queue: [], songs, repeatMode: 'none', anchor: a }),
    ).toBe(b);
  });

  it('falls back to current when the anchor is stale (not in songs)', () => {
    const staleAnchor = makeSong({ title: 'Old Playlist Song' });
    expect(
      resolveNextSong({ current: a, queue: [], songs, repeatMode: 'none', anchor: staleAnchor }),
    ).toBe(b);
  });

  it('returns null when a foreign current has no anchor', () => {
    expect(resolveNextSong({ current: makeSong(), queue: [], songs, repeatMode: 'none' })).toBeNull();
  });

  it('skips queue entries equal to the current song (engine replay-in-place guard)', () => {
    // Head equals current → would never dequeue (engine replays in place
    // without onEnded); resolution must skip to the first different entry.
    expect(resolveNextSong({ current: a, queue: [a, c], songs, repeatMode: 'none' })).toBe(c);
  });

  it('falls back to the playlist walk when the queue is only current-duplicates', () => {
    expect(resolveNextSong({ current: a, queue: [a, a], songs, repeatMode: 'none' })).toBe(b);
  });
});

describe('upNextPreview', () => {
  it('lists the following songs, stopping at the end under repeat=none', () => {
    expect(upNextPreview(a, songs, 'none')).toEqual([b, c]);
    expect(upNextPreview(c, songs, 'none')).toEqual([]);
  });

  it('wraps under repeat=all up to the count', () => {
    expect(upNextPreview(b, songs, 'all', 4)).toEqual([c, a, b, c]);
  });

  it('caps at count', () => {
    expect(upNextPreview(a, songs, 'all', 2)).toEqual([b, c]);
  });

  it('returns [] for repeat-one, a missing current, or an unknown current', () => {
    expect(upNextPreview(a, songs, 'one')).toEqual([]);
    expect(upNextPreview(null, songs, 'none')).toEqual([]);
    expect(upNextPreview(makeSong(), songs, 'none')).toEqual([]);
  });
});

describe('safeQueueMove', () => {
  it('moves an element forward and backward', () => {
    expect(safeQueueMove([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(safeQueueMove([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it('returns the array unchanged for stale/out-of-range indices', () => {
    const arr = [1, 2];
    expect(safeQueueMove(arr, 2, 0)).toBe(arr);
    expect(safeQueueMove(arr, 0, 5)).toBe(arr);
    expect(safeQueueMove(arr, -1, 0)).toBe(arr);
  });
});
