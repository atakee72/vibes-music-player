import { encodeSharePayload, decodeSharePayload } from './share';
import { makeSong } from '../test-utils';

describe('share — encode/decode', () => {
  it('round-trips a song through encode → decode', () => {
    const song = makeSong({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: 354,
    });
    const hash = encodeSharePayload(song);
    expect(hash.startsWith('#s=')).toBe(true);

    const decoded = decodeSharePayload(hash);
    expect(decoded).toEqual({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: 354,
    });
  });

  it('carries only metadata — never the file', () => {
    const song = makeSong({ title: 'X' });
    const hash = encodeSharePayload(song);
    const decoded = decodeSharePayload(hash);
    expect(decoded).not.toHaveProperty('file');
    expect(decoded).not.toHaveProperty('url');
    expect(decoded).not.toHaveProperty('id');
  });

  it('survives unicode titles (proves UTF-8 base64, not Latin1 btoa)', () => {
    const song = makeSong({
      title: '夜に駆ける',
      artist: 'YOASOBI',
      album: 'THE BOOK 𝄞',
    });
    const decoded = decodeSharePayload(encodeSharePayload(song));
    expect(decoded?.title).toBe('夜に駆ける');
    expect(decoded?.artist).toBe('YOASOBI');
    expect(decoded?.album).toBe('THE BOOK 𝄞');
  });

  it('produces a URL-safe payload (no +, /, or = padding)', () => {
    // A title likely to yield + or / in plain base64.
    const song = makeSong({ title: '???>>>~~~øøø' });
    const payload = encodeSharePayload(song).slice('#s='.length);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('round-trips empty string fields', () => {
    const song = makeSong({ title: '', artist: '', album: '', duration: 0 });
    const decoded = decodeSharePayload(encodeSharePayload(song));
    expect(decoded).toEqual({ title: '', artist: '', album: '', duration: 0 });
  });

  describe('decode rejects malformed input with null', () => {
    it('empty string', () => {
      expect(decodeSharePayload('')).toBeNull();
    });

    it('missing prefix', () => {
      expect(decodeSharePayload('s=abc')).toBeNull();
      expect(decodeSharePayload('#other=abc')).toBeNull();
    });

    it('prefix with empty payload', () => {
      expect(decodeSharePayload('#s=')).toBeNull();
    });

    it('non-base64 garbage', () => {
      expect(decodeSharePayload('#s=!!!not base64!!!')).toBeNull();
    });

    it('valid base64 but not JSON', () => {
      const notJson = btoa('hello world').replace(/=+$/, '');
      expect(decodeSharePayload('#s=' + notJson)).toBeNull();
    });

    it('valid JSON but wrong shape (missing fields)', () => {
      const wrong = btoa(JSON.stringify({ t: 'only title' })).replace(/=+$/, '');
      expect(decodeSharePayload('#s=' + wrong)).toBeNull();
    });

    it('valid JSON but duration is a string', () => {
      const wrong = btoa(
        JSON.stringify({ t: 'a', a: 'b', al: 'c', d: 'not a number' }),
      ).replace(/=+$/, '');
      expect(decodeSharePayload('#s=' + wrong)).toBeNull();
    });

    it('valid JSON array, not an object', () => {
      const wrong = btoa(JSON.stringify([1, 2, 3])).replace(/=+$/, '');
      expect(decodeSharePayload('#s=' + wrong)).toBeNull();
    });
  });
});
