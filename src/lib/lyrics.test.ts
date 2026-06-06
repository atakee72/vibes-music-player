import type { IAudioMetadata } from 'music-metadata';
import { extractLyrics } from './lyrics';

// Minimal metadata shape — only the fields extractLyrics reads.
const meta = (common: unknown, native: unknown = {}): IAudioMetadata =>
  ({ common, native } as unknown as IAudioMetadata);

describe('extractLyrics', () => {
  it('returns synced lines from common.lyrics syncText', () => {
    const result = extractLyrics(
      meta({
        lyrics: [
          {
            syncText: [
              { timestamp: 1000, text: 'one' },
              { timestamp: 2500, text: 'two' },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual([
      { time: 1, text: 'one' },
      { time: 2.5, text: 'two' },
    ]);
  });

  it('returns a plain one-block from common.lyrics text', () => {
    const result = extractLyrics(meta({ lyrics: [{ text: 'line a\nline b' }] }));
    expect(result).toEqual([{ time: 0, text: 'line a\nline b' }]);
  });

  it('parses LRC stored as plain common text', () => {
    const result = extractLyrics(meta({ lyrics: [{ text: '[00:01.00]hi\n[00:02.00]bye' }] }));
    expect(result).toEqual([
      { time: 1, text: 'hi' },
      { time: 2, text: 'bye' },
    ]);
  });

  it('falls back to a native frame whose id is lyric-shaped (UNSYNCEDLYRICS)', () => {
    const result = extractLyrics(
      meta({}, { vorbis: [{ id: 'UNSYNCEDLYRICS', value: 'native words' }] }),
    );
    expect(result).toEqual([{ time: 0, text: 'native words' }]);
  });

  it('falls back to a TXXX frame labelled by description', () => {
    const result = extractLyrics(
      meta({}, { 'ID3v2.3': [{ id: 'TXXX', value: { description: 'LYRICS', text: 'txxx words' } }] }),
    );
    expect(result).toEqual([{ time: 0, text: 'txxx words' }]);
  });

  it('ignores non-lyric native frames and object values without text', () => {
    expect(
      extractLyrics(meta({}, { 'ID3v2.3': [{ id: 'TIT2', value: { text: 'A Title' } }] })),
    ).toBeUndefined();
    expect(
      extractLyrics(meta({}, { x: [{ id: 'COMM', value: { foo: 'bar' } }] })),
    ).toBeUndefined();
  });

  it('returns undefined when there are no lyrics anywhere', () => {
    expect(extractLyrics(meta({}))).toBeUndefined();
  });
});
