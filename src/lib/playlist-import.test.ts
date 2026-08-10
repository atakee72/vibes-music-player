import {
  parseM3U,
  parsePLS,
  matchImportEntries,
  isPlaylistFileName,
  findLinkedPlaylist,
  diffSongSets,
} from './playlist-import';
import { makeSong, makePlaylist } from '../test-utils';

describe('parseM3U', () => {
  it('parses simple paths', () => {
    const result = parseM3U('/music/song1.mp3\n/music/song2.mp3');
    expect(result).toEqual([
      { path: '/music/song1.mp3', filename: 'song1.mp3', title: undefined },
      { path: '/music/song2.mp3', filename: 'song2.mp3', title: undefined },
    ]);
  });

  it('skips comments and blank lines', () => {
    const result = parseM3U('#EXTM3U\n\n# A comment\nsong.mp3\n');
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('song.mp3');
  });

  it('extracts titles from #EXTINF lines', () => {
    const result = parseM3U('#EXTINF:180,My Song Title\n/path/song.mp3');
    expect(result[0].title).toBe('My Song Title');
  });

  it('handles Windows backslash paths', () => {
    const result = parseM3U('C:\\Users\\Music\\track.mp3');
    expect(result[0].filename).toBe('track.mp3');
  });

  it('handles relative paths (just filenames)', () => {
    const result = parseM3U('track.mp3');
    expect(result[0].filename).toBe('track.mp3');
  });

  it('strips UTF-8 BOM', () => {
    const result = parseM3U('﻿#EXTM3U\nsong.mp3');
    expect(result).toHaveLength(1);
  });
});

describe('parsePLS', () => {
  it('parses standard PLS format', () => {
    const pls = `[playlist]
File1=/music/song1.mp3
Title1=First Song
Length1=180
File2=/music/song2.mp3
Title2=Second Song
Length2=200
NumberOfEntries=2
Version=2`;
    const result = parsePLS(pls);
    expect(result).toEqual([
      { path: '/music/song1.mp3', filename: 'song1.mp3', title: 'First Song' },
      { path: '/music/song2.mp3', filename: 'song2.mp3', title: 'Second Song' },
    ]);
  });

  it('handles missing title fields', () => {
    const result = parsePLS('[playlist]\nFile1=/music/song.mp3');
    expect(result[0].title).toBeUndefined();
  });

  it('sorts by entry number', () => {
    const result = parsePLS('File3=c.mp3\nFile1=a.mp3\nFile2=b.mp3');
    expect(result.map((e) => e.filename)).toEqual(['a.mp3', 'b.mp3', 'c.mp3']);
  });
});

describe('matchImportEntries', () => {
  it('matches entries by filename case-insensitively', () => {
    const songs = [makeSong({ file: new File([], 'Song.MP3', { type: 'audio/mpeg' }) })];
    const entries = [{ path: '/music/song.mp3', filename: 'song.mp3' }];
    const { matched, unmatched } = matchImportEntries(entries, songs);
    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
  });

  it('reports unmatched entries', () => {
    const entries = [{ path: '/music/missing.mp3', filename: 'missing.mp3' }];
    const { matched, unmatched } = matchImportEntries(entries, []);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it('handles mixed matched and unmatched', () => {
    const songs = [makeSong({ file: new File([], 'found.mp3', { type: 'audio/mpeg' }) })];
    const entries = [
      { path: 'found.mp3', filename: 'found.mp3' },
      { path: 'lost.mp3', filename: 'lost.mp3' },
    ];
    const { matched, unmatched } = matchImportEntries(entries, songs);
    expect(matched).toHaveLength(1);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].filename).toBe('lost.mp3');
  });
});

describe('isPlaylistFileName', () => {
  it('accepts m3u/m3u8/pls case-insensitively and rejects everything else', () => {
    expect(isPlaylistFileName('80s.m3u')).toBe(true);
    expect(isPlaylistFileName('Rock.M3U8')).toBe(true);
    expect(isPlaylistFileName('mix.PLS')).toBe(true);
    expect(isPlaylistFileName('song.mp3')).toBe(false);
    expect(isPlaylistFileName('lyrics.lrc')).toBe(false);
    expect(isPlaylistFileName('m3u')).toBe(false);
  });
});

describe('findLinkedPlaylist', () => {
  const linked = makePlaylist({ name: 'Eighties', importSource: '80s.m3u' });
  const unlinked = makePlaylist({ name: '90s' });

  it('matches on importSource, case-insensitively', () => {
    expect(findLinkedPlaylist([unlinked, linked], '80s.m3u')).toBe(linked);
    expect(findLinkedPlaylist([unlinked, linked], '80S.M3U')).toBe(linked);
  });

  it('does NOT adopt a same-named but unlinked playlist', () => {
    // Importing 90s.m3u must not silently overwrite a hand-made "90s".
    expect(findLinkedPlaylist([unlinked], '90s.m3u')).toBeUndefined();
  });

  it('never returns the library or favorites views', () => {
    const library = makePlaylist({ id: 'library', name: 'Library', importSource: 'library.m3u' });
    const favorites = makePlaylist({ id: 'favorites', name: 'Favorites', importSource: 'favorites.m3u' });
    expect(findLinkedPlaylist([library, favorites], 'library.m3u')).toBeUndefined();
    expect(findLinkedPlaylist([library, favorites], 'favorites.m3u')).toBeUndefined();
  });

  it('returns undefined when nothing is linked to that file', () => {
    expect(findLinkedPlaylist([unlinked, linked], 'Jazz.m3u')).toBeUndefined();
  });
});

describe('diffSongSets', () => {
  const a = makeSong({ title: 'A' });
  const b = makeSong({ title: 'B' });
  const c = makeSong({ title: 'C' });

  it('counts added and removed by song id', () => {
    expect(diffSongSets([a, b], [b, c])).toEqual({ added: 1, removed: 1 });
    expect(diffSongSets([], [a, b])).toEqual({ added: 2, removed: 0 });
    expect(diffSongSets([a, b], [])).toEqual({ added: 0, removed: 2 });
    expect(diffSongSets([a, b], [a, b])).toEqual({ added: 0, removed: 0 });
  });
});
