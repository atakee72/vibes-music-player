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
});
