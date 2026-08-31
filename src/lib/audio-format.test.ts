import { describe, it, expect } from 'vitest';
import { describeFormat } from './audio-format';
import { makeSong } from '../test-utils';

/** A File whose `size` is real, so the derived-bitrate path has bytes to work with. */
function sized(bytes: number, name: string): File {
  return new File([new Uint8Array(bytes)], name);
}

describe('describeFormat', () => {
  it('shows codec, sample rate and bitrate for a lossy track', () => {
    const song = makeSong({
      codec: 'MPEG-4/AAC',
      sampleRate: 44100,
      lossless: false,
      bitrate: 320000,
      duration: 10,
      file: sized(409_000, 'track.m4a'),
    });

    expect(describeFormat(song)).toBe('AAC · 44.1 kHz · 320 kbps');
  });

  it('shows bit depth only for lossless formats', () => {
    const flac = makeSong({
      codec: 'FLAC',
      sampleRate: 44100,
      bitsPerSample: 16,
      lossless: true,
      bitrate: 1066000,
      duration: 2,
      file: sized(270_000, 'track.flac'),
    });

    expect(describeFormat(flac)).toBe('FLAC · 44.1 kHz · 16-bit · 1066 kbps');
  });

  it('omits bit depth for lossy audio even when the parser reports one', () => {
    // music-metadata reports bitsPerSample: 16 for AAC, but bit depth is a
    // PCM concept — printing it would claim a precision AAC does not have.
    const song = makeSong({
      codec: 'MPEG-4/AAC',
      sampleRate: 44100,
      bitsPerSample: 16,
      lossless: false,
      bitrate: 320000,
      duration: 10,
      file: sized(409_000, 'track.m4a'),
    });

    expect(describeFormat(song)).not.toContain('16-bit');
  });

  describe('bitrate', () => {
    it('derives the bitrate when the parsed value disagrees with the file size', () => {
      // Real case from the library: music-metadata reports ~2.5 kbps for AAC
      // files that actually run at ~140 kbps.
      const song = makeSong({
        codec: 'MPEG-4/AAC',
        sampleRate: 44100,
        lossless: false,
        bitrate: 2537,
        duration: 10,
        file: sized(177_000, 'track.m4a'),
      });

      expect(describeFormat(song)).toBe('AAC · 44.1 kHz · ~142 kbps');
    });

    it('keeps the parsed bitrate when it agrees with the file size', () => {
      // 320 kbps stated vs 327 kbps derived: container and tag overhead, not
      // a bad parse. The encoder's stated rate is the more accurate one.
      const song = makeSong({
        codec: 'MPEG 1 Layer 3',
        sampleRate: 44100,
        lossless: false,
        bitrate: 320000,
        duration: 10,
        file: sized(409_000, 'track.mp3'),
      });

      expect(describeFormat(song)).toBe('MP3 · 44.1 kHz · 320 kbps');
    });

    it('omits the bitrate when it cannot be cross-checked against a duration', () => {
      // No duration means no derived value to validate against, and an
      // unvalidated parsed value is exactly the 2.5 kbps trap.
      const song = makeSong({
        codec: 'MPEG-4/AAC',
        sampleRate: 44100,
        bitrate: 2537,
        duration: 0,
        file: sized(177_000, 'track.m4a'),
      });

      expect(describeFormat(song)).toBe('AAC · 44.1 kHz');
    });

    it('omits the bitrate for a zero-byte file with no parsed value', () => {
      const song = makeSong({
        codec: 'MPEG-4/AAC',
        sampleRate: 44100,
        bitrate: undefined,
        duration: 180,
        file: new File([], 'track.m4a'),
      });

      expect(describeFormat(song)).toBe('AAC · 44.1 kHz');
    });
  });

  describe('codec labels', () => {
    it.each([
      ['MPEG-4/AAC', 'AAC'],
      ['MPEG 1 Layer 3', 'MP3'],
      ['MPEG 2 Layer 3', 'MP3'],
      ['FLAC', 'FLAC'],
      ['Opus', 'Opus'],
      ['ALAC', 'ALAC'],
    ])('maps %s to %s', (codec, label) => {
      const song = makeSong({ codec, duration: 0, file: new File([], 'track.bin') });
      expect(describeFormat(song)).toBe(label);
    });

    it('passes an unrecognised codec through unchanged', () => {
      // An ugly label beats a missing badge.
      const song = makeSong({
        codec: 'Musepack SV8',
        duration: 0,
        file: new File([], 'track.mpc'),
      });

      expect(describeFormat(song)).toBe('Musepack SV8');
    });
  });

  describe('before a re-scan, with no parsed format fields', () => {
    it('names the container from the extension rather than guessing a codec', () => {
      // A .m4a may hold AAC or ALAC. Naming the container is honest; a
      // re-scan replaces it with the real codec.
      const song = makeSong({
        codec: undefined,
        sampleRate: undefined,
        bitrate: undefined,
        duration: 10,
        file: sized(166_000, 'track.m4a'),
      });

      expect(describeFormat(song)).toBe('M4A · ~133 kbps');
    });

    it('returns null when there is nothing at all to report', () => {
      const song = makeSong({
        codec: undefined,
        sampleRate: undefined,
        bitrate: undefined,
        duration: 0,
        file: new File([], 'track'),
      });

      expect(describeFormat(song)).toBeNull();
    });
  });

  describe('sample rate', () => {
    it.each([
      [44100, '44.1 kHz'],
      [48000, '48 kHz'],
      [24000, '24 kHz'],
    ])('renders %i Hz as %s', (sampleRate, label) => {
      const song = makeSong({
        codec: 'FLAC',
        sampleRate,
        duration: 0,
        file: new File([], 'track.flac'),
      });

      expect(describeFormat(song)).toBe(`FLAC · ${label}`);
    });
  });
});
