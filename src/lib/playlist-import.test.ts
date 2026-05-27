import { parseM3U, parsePLS, matchImportEntries } from './playlist-import';
import { makeSong } from '../test-utils';

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
