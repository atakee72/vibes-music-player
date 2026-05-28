import { serializeM3U, sanitizeFilename } from './playlist-export';
import { parseM3U } from './playlist-import';
import { makePlaylist, makeSong } from '../test-utils';

describe('serializeM3U', () => {
  it('writes the #EXTM3U header and one #EXTINF + filename per song', () => {
    const playlist = makePlaylist({
      name: 'Mix',
      songs: [
        makeSong({
          title: 'Song A',
          artist: 'Artist X',
          duration: 200,
          file: new File([], 'a.mp3'),
        }),
        makeSong({
          title: 'Song B',
          artist: 'Artist Y',
          duration: 180,
          file: new File([], 'b.mp3'),
        }),
      ],
    });
    const out = serializeM3U(playlist);
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXTINF:200,Artist X - Song A');
    expect(lines[2]).toBe('a.mp3');
    expect(lines[3]).toBe('#EXTINF:180,Artist Y - Song B');
    expect(lines[4]).toBe('b.mp3');
  });

  it('round-trips through parseM3U', () => {
    const songs = [
      makeSong({ title: 'X', artist: 'A1', file: new File([], 'one.mp3') }),
      makeSong({ title: 'Y', artist: 'A2', file: new File([], 'two.mp3') }),
    ];
    const playlist = makePlaylist({ name: 'Round', songs });
    const text = serializeM3U(playlist);
    const entries = parseM3U(text);
    expect(entries.map((e) => e.filename)).toEqual(['one.mp3', 'two.mp3']);
    expect(entries[0].title).toBe('A1 - X');
  });

  it('handles songs with zero duration', () => {
    const playlist = makePlaylist({
      songs: [
        makeSong({ duration: 0, file: new File([], 's.mp3') }),
      ],
    });
    expect(serializeM3U(playlist)).toContain('#EXTINF:0,');
  });

  it('produces #EXTM3U-only output for empty playlists', () => {
    const playlist = makePlaylist({ songs: [] });
    expect(serializeM3U(playlist).trim()).toBe('#EXTM3U');
  });
});

describe('sanitizeFilename', () => {
  it('replaces forbidden characters with underscores', () => {
    expect(sanitizeFilename('My/Mix\\:?')).toBe('My_Mix___');
  });

  it('falls back to "playlist" for empty/whitespace input', () => {
    expect(sanitizeFilename('   ')).toBe('playlist');
    expect(sanitizeFilename('')).toBe('playlist');
  });
});
