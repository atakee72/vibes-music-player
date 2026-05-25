import { nextInPlaylist } from './queue';
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
});
