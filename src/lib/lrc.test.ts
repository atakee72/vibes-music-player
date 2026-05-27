import { parseLRC, activeLyricIndex } from './lrc';

describe('parseLRC', () => {
  it('parses simple timestamps', () => {
    const result = parseLRC('[00:05.00]Hello\n[00:10.00]World');
    expect(result).toEqual([
      { time: 5, text: 'Hello' },
      { time: 10, text: 'World' },
    ]);
  });

  it('handles timestamps without milliseconds', () => {
    const result = parseLRC('[01:30]Line');
    expect(result).toEqual([{ time: 90, text: 'Line' }]);
  });

  it('handles multiple timestamps per line', () => {
    const result = parseLRC('[00:01.00][00:15.00]Repeated');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ time: 1, text: 'Repeated' });
    expect(result[1]).toEqual({ time: 15, text: 'Repeated' });
  });

  it('strips metadata tags', () => {
    const result = parseLRC('[ti:Song Title]\n[ar:Artist]\n[00:05.00]Lyric');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Lyric');
  });

  it('applies offset tag', () => {
    const result = parseLRC('[offset:500]\n[00:10.000]Line');
    expect(result[0].time).toBeCloseTo(10.5);
  });

  it('sorts output by time', () => {
    const result = parseLRC('[00:20.00]Second\n[00:05.00]First');
    expect(result[0].text).toBe('First');
    expect(result[1].text).toBe('Second');
  });

  it('skips lines without timestamps', () => {
    const result = parseLRC('Just text\n[00:01.00]Valid');
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseLRC('')).toEqual([]);
  });

  it('handles negative offset clamped to 0', () => {
    const result = parseLRC('[offset:-10000]\n[00:05.000]Line');
    expect(result[0].time).toBe(0);
  });
});

describe('activeLyricIndex', () => {
  const lyrics = [
    { time: 0, text: 'A' },
    { time: 5, text: 'B' },
    { time: 10, text: 'C' },
  ];

  it('returns -1 for empty lyrics', () => {
    expect(activeLyricIndex([], 5)).toBe(-1);
  });

  it('returns 0 at or after first line', () => {
    expect(activeLyricIndex(lyrics, 0)).toBe(0);
    expect(activeLyricIndex(lyrics, 3)).toBe(0);
  });

  it('returns correct index mid-song', () => {
    expect(activeLyricIndex(lyrics, 5)).toBe(1);
    expect(activeLyricIndex(lyrics, 7)).toBe(1);
  });

  it('returns last index after last line', () => {
    expect(activeLyricIndex(lyrics, 100)).toBe(2);
  });
});
