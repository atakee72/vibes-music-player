import type { IAudioMetadata } from 'music-metadata';
import { extractSongMeta } from './metadata-core';

const meta = (over: { common?: object; format?: object } = {}): IAudioMetadata =>
  ({
    common: { ...over.common },
    format: { ...over.format },
    native: {},
    quality: { warnings: [] },
  }) as unknown as IAudioMetadata;

describe('extractSongMeta', () => {
  it('maps the full field set', () => {
    const out = extractSongMeta(
      meta({
        common: {
          title: 'Şarkı',
          artist: 'Artist',
          album: 'Album',
          genre: ['Dreampop', 'Shoegaze'],
          bpm: 124,
          year: 2020,
          replaygain_track_gain: { dB: -6.5, ratio: 0.22 },
        },
        format: { duration: 200.5, bitrate: 320000 },
      }),
      'file.mp3',
    );
    expect(out).toMatchObject({
      title: 'Şarkı',
      artist: 'Artist',
      album: 'Album',
      duration: 200.5,
      genre: 'Dreampop',
      bpm: 124,
      year: 2020,
      bitrate: 320000,
      replayGainDb: -6.5,
    });
  });

  it('falls back to the extension-stripped filename and Unknowns', () => {
    const out = extractSongMeta(meta(), 'My Track.final.flac');
    expect(out.title).toBe('My Track.final');
    expect(out.artist).toBe('Unknown Artist');
    expect(out.album).toBe('Unknown Album');
    expect(out.duration).toBe(0);
  });

  it('surfaces raw picture bytes without creating a Blob (worker-serializable)', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = extractSongMeta(
      meta({ common: { picture: [{ data: bytes, format: 'image/jpeg' }] } }),
      'x.mp3',
    );
    expect(out.picData).toBe(bytes);
    expect(out.picFormat).toBe('image/jpeg');
    // Nothing in the result is a Blob/URL — it must survive postMessage.
    expect(Object.values(out).some((v) => v instanceof Blob)).toBe(false);
  });

  it('omits picture fields when no art is embedded', () => {
    const out = extractSongMeta(meta(), 'x.mp3');
    expect(out.picData).toBeUndefined();
    expect(out.picFormat).toBeUndefined();
  });
});
