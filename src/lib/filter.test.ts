import { filterSongs } from './filter';
import { makeSong } from '../test-utils';

const a = makeSong({ title: 'Yesterday', artist: 'The Beatles', album: 'Help!' });
const b = makeSong({ title: 'Paint It Black', artist: 'The Rolling Stones', album: 'Aftermath' });
const c = makeSong({ title: 'Imagine', artist: 'John Lennon', album: 'Imagine' });
const all = [a, b, c];

describe('filterSongs', () => {
  it('returns the full list for an empty query', () => {
    expect(filterSongs(all, '')).toEqual(all);
  });

  it('treats whitespace-only as empty', () => {
    expect(filterSongs(all, '   ')).toEqual(all);
  });

  it('matches title case-insensitively', () => {
    expect(filterSongs(all, 'YESTERDAY')).toEqual([a]);
  });

  it('matches artist', () => {
    expect(filterSongs(all, 'beatles')).toEqual([a]);
  });

  it('matches album', () => {
    expect(filterSongs(all, 'aftermath')).toEqual([b]);
  });

  it('returns multiple matches when the query hits more than one song', () => {
    expect(filterSongs(all, 'imagine')).toEqual([c]);
    expect(filterSongs(all, 'the')).toEqual([a, b]);
  });

  it('returns empty when nothing matches', () => {
    expect(filterSongs(all, 'zzz-no-such-thing')).toEqual([]);
  });
});
