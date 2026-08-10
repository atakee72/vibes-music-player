import { isAudioFile, isPlaylistFileName, isLrcFileName } from './file-types';

const file = (name: string, type = '') => new File([], name, { type });

describe('isAudioFile', () => {
  it('accepts files with an audio/* MIME type', () => {
    expect(isAudioFile(file('song.mp3', 'audio/mpeg'))).toBe(true);
    expect(isAudioFile(file('song.wav', 'audio/wav'))).toBe(true);
  });

  it('accepts known audio extensions when the browser reports NO MIME type', () => {
    // Windows registry gaps routinely produce type: '' for these — the exact
    // case that made ingest silently drop every file and show the dead-end alert.
    for (const name of ['track.flac', 'track.m4a', 'track.opus', 'track.aiff', 'track.wma']) {
      expect(isAudioFile(file(name))).toBe(true);
    }
  });

  it('is case-insensitive about extensions', () => {
    expect(isAudioFile(file('TRACK.FLAC'))).toBe(true);
  });

  it('rejects playlist files even though Chromium types them audio/x-mpegurl', () => {
    expect(isAudioFile(file('80s.m3u', 'audio/x-mpegurl'))).toBe(false);
    expect(isAudioFile(file('80s.m3u8', 'audio/x-mpegurl'))).toBe(false);
    expect(isAudioFile(file('mix.pls'))).toBe(false);
  });

  it('rejects lyric files and unrelated files', () => {
    expect(isAudioFile(file('song.lrc'))).toBe(false);
    expect(isAudioFile(file('notes.txt', 'text/plain'))).toBe(false);
    expect(isAudioFile(file('cover.jpg', 'image/jpeg'))).toBe(false);
    expect(isAudioFile(file('README'))).toBe(false);
  });
});

describe('isPlaylistFileName / isLrcFileName', () => {
  it('match their extensions case-insensitively', () => {
    expect(isPlaylistFileName('80s.M3U')).toBe(true);
    expect(isPlaylistFileName('song.mp3')).toBe(false);
    expect(isLrcFileName('Song.LRC')).toBe(true);
    expect(isLrcFileName('song.mp3')).toBe(false);
  });
});
