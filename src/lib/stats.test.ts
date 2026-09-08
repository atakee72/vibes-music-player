import {
  formatListenTime,
  recentlyPlayed,
  recordFinish,
  topArtists,
  topTracks,
  totals,
  type StatsMap,
} from './stats';
import { makeSong } from '../test-utils';

describe('recordFinish', () => {
  it('creates an entry on the first finish', () => {
    const song = makeSong({ id: 's1', title: 'Cemalım', artist: 'Altın Gün', duration: 200 });
    const stats = recordFinish({}, song, 1000);

    expect(stats.s1).toEqual({
      plays: 1,
      lastPlayedAt: 1000,
      msPlayed: 200_000,
      title: 'Cemalım',
      artist: 'Altın Gün',
    });
  });

  it('accumulates plays and listening time', () => {
    const song = makeSong({ id: 's1', duration: 200 });
    let stats = recordFinish({}, song, 1000);
    stats = recordFinish(stats, song, 2000);

    expect(stats.s1.plays).toBe(2);
    expect(stats.s1.msPlayed).toBe(400_000);
    expect(stats.s1.lastPlayedAt).toBe(2000);
  });

  it('does not mutate the input map', () => {
    const before: StatsMap = {};
    recordFinish(before, makeSong({ id: 's1' }), 1000);
    expect(before).toEqual({});
  });

  // beets rewrites tags in place; a re-scan changes the Song, and the next
  // finish should carry the new name rather than showing a stale one forever.
  it('refreshes the denormalised title/artist on every finish', () => {
    const song = makeSong({ id: 's1', title: 'old', artist: 'old' });
    let stats = recordFinish({}, song, 1000);
    stats = recordFinish(stats, { ...song, title: 'new', artist: 'New' }, 2000);

    expect(stats.s1.title).toBe('new');
    expect(stats.s1.artist).toBe('New');
    expect(stats.s1.plays).toBe(2);
  });

  it('never contributes negative time for a bogus duration', () => {
    const stats = recordFinish({}, makeSong({ id: 's1', duration: -5 }), 1000);
    expect(stats.s1.msPlayed).toBe(0);
  });
});

const fixture = (): StatsMap => ({
  a: { plays: 5, lastPlayedAt: 300, msPlayed: 500_000, title: 'Alpha', artist: 'Ada' },
  b: { plays: 9, lastPlayedAt: 100, msPlayed: 900_000, title: 'Beta', artist: 'Bo' },
  c: { plays: 5, lastPlayedAt: 200, msPlayed: 250_000, title: 'Gamma', artist: 'Ada' },
});

describe('totals', () => {
  it('sums plays and time across tracks', () => {
    expect(totals(fixture())).toEqual({ plays: 19, msPlayed: 1_650_000, tracks: 3 });
  });

  it('is zeroed for an empty map', () => {
    expect(totals({})).toEqual({ plays: 0, msPlayed: 0, tracks: 0 });
  });
});

describe('topTracks', () => {
  it('ranks by plays, breaking ties by title for a stable order', () => {
    expect(topTracks(fixture()).map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('honours the limit', () => {
    expect(topTracks(fixture(), 1).map((t) => t.id)).toEqual(['b']);
  });
});

describe('topArtists', () => {
  it('aggregates plays across an artist’s tracks', () => {
    const ranked = topArtists(fixture());
    expect(ranked[0]).toEqual({ artist: 'Ada', plays: 10, msPlayed: 750_000 });
    expect(ranked[1]).toEqual({ artist: 'Bo', plays: 9, msPlayed: 900_000 });
  });
});

describe('recentlyPlayed', () => {
  it('orders by most recent finish', () => {
    expect(recentlyPlayed(fixture()).map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('formatListenTime', () => {
  it('formats hours and minutes', () => {
    expect(formatListenTime(83 * 3_600_000 + 12 * 60_000)).toBe('83h 12m');
  });

  it('drops the hour part under an hour', () => {
    expect(formatListenTime(9 * 60_000)).toBe('9m');
  });

  it('distinguishes "nothing yet" from "a little"', () => {
    expect(formatListenTime(0)).toBe('0m');
    expect(formatListenTime(30_000)).toBe('< 1m');
  });

  it('handles an exact hour', () => {
    expect(formatListenTime(3_600_000)).toBe('1h 0m');
  });
});

describe('recordFinish at a non-default playback rate', () => {
  it('counts wall-clock time actually spent, not the track duration', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const stats = recordFinish({}, song, 1000, 2);

    // A 4-minute track played at 2x took 2 minutes of the listener's evening.
    expect(stats.s1.msPlayed).toBe(120_000);
  });

  it('counts more time than the duration at a slow rate', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const stats = recordFinish({}, song, 1000, 0.5);

    expect(stats.s1.msPlayed).toBe(480_000);
  });

  it('still counts one play regardless of rate', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const stats = recordFinish({}, song, 1000, 2);

    expect(stats.s1.plays).toBe(1);
  });

  it('defaults to 1x when no rate is given, so existing callers are unchanged', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const noRateStats = recordFinish({}, song, 1000);
    const withRate1Stats = recordFinish({}, song, 1000, 1);
    const withRate2Stats = recordFinish({}, song, 1000, 2);

    // Omitting the rate should match passing 1 explicitly, not passing 2.
    expect(noRateStats[song.id].msPlayed).toBe(240_000);
    expect(noRateStats[song.id].msPlayed).toBe(withRate1Stats[song.id].msPlayed);
    expect(noRateStats[song.id].msPlayed).not.toBe(withRate2Stats[song.id].msPlayed);
  });

  it('falls back to 1x for a nonsensical rate rather than dividing by zero', () => {
    const song = makeSong({ id: 's1', duration: 240 });
    const zeroRateStats = recordFinish({}, song, 1000, 0);
    const rate1Stats = recordFinish({}, song, 1000, 1);
    const rate2Stats = recordFinish({}, song, 1000, 2);

    // Rate 0 should fall back to 1, not divide by zero.
    expect(zeroRateStats[song.id].msPlayed).toBe(240_000);
    expect(zeroRateStats[song.id].msPlayed).toBe(rate1Stats[song.id].msPlayed);
    expect(zeroRateStats[song.id].msPlayed).not.toBe(rate2Stats[song.id].msPlayed);
  });
});
