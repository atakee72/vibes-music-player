import { mergeRescan, hasMetaChanged } from './rescan';
import { makeSong } from '../test-utils';
import type { ExtractedMeta } from './metadata-core';

const meta = (o: Partial<ExtractedMeta> = {}): ExtractedMeta => ({
  title: 'New Title',
  artist: 'New Artist',
  album: 'New Album',
  duration: 200,
  ...o,
});

describe('mergeRescan', () => {
  it('takes scalar tag fields from the file', () => {
    const song = makeSong({ genre: 'Old', bpm: 100, year: 1999, bitrate: 128 });
    const out = mergeRescan(song, meta({ genre: 'Rock', bpm: 128, year: 1984, bitrate: 320, replayGainDb: -6.5 }));
    expect(out).toMatchObject({
      title: 'New Title',
      artist: 'New Artist',
      album: 'New Album',
      duration: 200,
      genre: 'Rock',
      bpm: 128,
      year: 1984,
      bitrate: 320,
      replayGainDb: -6.5,
    });
  });

  it('clears a scalar the file no longer carries', () => {
    const song = makeSong({ genre: 'Old', bpm: 100 });
    const out = mergeRescan(song, meta());
    expect(out.genre).toBeUndefined();
    expect(out.bpm).toBeUndefined();
  });

  it('preserves id, favorite and fileHandle', () => {
    const handle = {} as FileSystemFileHandle;
    const song = makeSong({ id: 'root/a.mp3', favorite: true, fileHandle: handle });
    const out = mergeRescan(song, meta());
    expect(out.id).toBe('root/a.mp3');
    expect(out.favorite).toBe(true);
    expect(out.fileHandle).toBe(handle);
  });

  it('keeps the old duration when the parse reports zero', () => {
    const song = makeSong({ duration: 180 });
    const out = mergeRescan(song, meta({ duration: 0 }));
    expect(out.duration).toBe(180);
  });

  it('keeps existing lyrics when the file has none', () => {
    const song = makeSong({ lyrics: [{ time: 0, text: 'fetched online' }] });
    const out = mergeRescan(song, meta());
    expect(out.lyrics).toEqual([{ time: 0, text: 'fetched online' }]);
  });

  it('replaces lyrics when the file has them', () => {
    const song = makeSong({ lyrics: [{ time: 0, text: 'old' }] });
    const out = mergeRescan(song, meta({ lyrics: [{ time: 1, text: 'embedded' }] }));
    expect(out.lyrics).toEqual([{ time: 1, text: 'embedded' }]);
  });

  it('keeps the existing cover when no replacement cover is given', () => {
    const blob = new Blob(['old']);
    const song = makeSong({ coverArt: 'blob:old-cover', coverBlob: blob });
    const out = mergeRescan(song, meta());
    expect(out.coverArt).toBe('blob:old-cover');
    expect(out.coverBlob).toBe(blob);
  });

  it('replaces the cover when one is given', () => {
    const song = makeSong({ coverArt: 'blob:old-cover', coverBlob: new Blob(['old']) });
    const fresh = new Blob(['new']);
    const out = mergeRescan(song, meta(), { cover: { coverArt: 'blob:new-cover', coverBlob: fresh } });
    expect(out.coverArt).toBe('blob:new-cover');
    expect(out.coverBlob).toBe(fresh);
  });

  it('swaps file and url when given, and keeps them when not', () => {
    const song = makeSong({ url: 'blob:old-audio' });
    const fresh = new File([], 'fresh.mp3', { type: 'audio/mpeg' });

    const swapped = mergeRescan(song, meta(), { file: fresh, url: 'blob:new-audio' });
    expect(swapped.file).toBe(fresh);
    expect(swapped.url).toBe('blob:new-audio');

    const kept = mergeRescan(song, meta());
    expect(kept.file).toBe(song.file);
    expect(kept.url).toBe('blob:old-audio');
  });

  it('never leaks raw picture bytes onto the song', () => {
    const out = mergeRescan(makeSong(), meta({ picData: new Uint8Array([1, 2]), picFormat: 'image/jpeg' }));
    expect('picData' in out).toBe(false);
    expect('picFormat' in out).toBe(false);
  });
});

describe('hasMetaChanged', () => {
  it('is false when nothing meaningful changed', () => {
    const song = makeSong({ genre: 'Rock', bpm: 120 });
    expect(hasMetaChanged(song, { ...song })).toBe(false);
  });

  it('ignores a url/file swap on its own', () => {
    const song = makeSong();
    const after = { ...song, url: 'blob:different', file: new File([], 'x.mp3') };
    expect(hasMetaChanged(song, after)).toBe(false);
  });

  it('detects a changed tag', () => {
    const song = makeSong({ bpm: undefined });
    expect(hasMetaChanged(song, { ...song, bpm: 128 })).toBe(true);
    expect(hasMetaChanged(song, { ...song, title: 'Renamed' })).toBe(true);
  });

  it('detects a new cover and new lyrics', () => {
    const song = makeSong();
    expect(hasMetaChanged(song, { ...song, coverBlob: new Blob(['art']) })).toBe(true);
    expect(hasMetaChanged(song, { ...song, lyrics: [{ time: 0, text: 'hi' }] })).toBe(true);
  });

  it('ignores a cover swap to a different Blob of the SAME size', () => {
    // The caller builds a fresh Blob for every song with embedded art, so
    // reference identity always differs — this is the re-embedded-same-art
    // case (beets `embedart`) that must NOT count as "changed".
    const song = makeSong({ coverBlob: new Blob(['aaa']) });
    expect(hasMetaChanged(song, { ...song, coverBlob: new Blob(['bbb']) })).toBe(false);
  });

  it('detects a cover swap to a Blob of a DIFFERENT size', () => {
    const song = makeSong({ coverBlob: new Blob(['aaa']) });
    expect(hasMetaChanged(song, { ...song, coverBlob: new Blob(['bigger-art']) })).toBe(true);
  });
});
