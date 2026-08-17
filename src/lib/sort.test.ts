import { sortSongs } from './sort';
import { makeSong } from '../test-utils';

const a = makeSong({ title: 'Banana', artist: 'Zed', duration: 200 });
const b = makeSong({ title: 'Apple', artist: 'Yara', duration: 100 });
const c = makeSong({ title: 'Cherry', artist: 'Xavier', duration: 300 });
const songs = [a, b, c];

describe('sortSongs', () => {
  it('manual returns the list unchanged (same reference)', () => {
    expect(sortSongs(songs, 'manual')).toBe(songs);
  });

  it('recent reverses the list', () => {
    expect(sortSongs(songs, 'recent')).toEqual([c, b, a]);
  });

  it('title sorts A–Z', () => {
    expect(sortSongs(songs, 'title')).toEqual([b, a, c]);
  });

  it('artist sorts A–Z', () => {
    expect(sortSongs(songs, 'artist')).toEqual([c, b, a]);
  });

  it('duration sorts ascending', () => {
    expect(sortSongs(songs, 'duration')).toEqual([b, a, c]);
  });

  it('does not mutate the input array', () => {
    const copy = [...songs];
    sortSongs(songs, 'title');
    expect(songs).toEqual(copy);
  });

  describe('listening sorts', () => {
    const stat = (plays: number, lastPlayedAt: number) => ({
      plays,
      lastPlayedAt,
      msPlayed: plays * 1000,
      title: '',
      artist: '',
    });
    // `b` is the most played; `a` the most recently finished; `c` unheard.
    const stats = { [a.id]: stat(2, 300), [b.id]: stat(7, 100) };

    it('plays ranks most-played first', () => {
      expect(sortSongs(songs, 'plays', stats)).toEqual([b, a, c]);
    });

    it('played ranks most-recently-finished first', () => {
      expect(sortSongs(songs, 'played', stats)).toEqual([a, b, c]);
    });

    // A wall of never-played tracks above your most-played would defeat the sort.
    it('sorts never-played tracks LAST, not first', () => {
      const byPlays = sortSongs(songs, 'plays', stats);
      const byPlayed = sortSongs(songs, 'played', stats);
      expect(byPlays[byPlays.length - 1]).toBe(c);
      expect(byPlayed[byPlayed.length - 1]).toBe(c);
    });

    it('degrades to input order when no stats are supplied', () => {
      expect(sortSongs(songs, 'plays')).toEqual(songs);
      expect(sortSongs(songs, 'played')).toEqual(songs);
    });

    it('does not mutate the input array', () => {
      const copy = [...songs];
      sortSongs(songs, 'plays', stats);
      expect(songs).toEqual(copy);
    });
  });
});
