import { fetchLyricsOnline } from './lyrics-online';

const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
const notFound = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) } as Response);

const query = { title: 'The Chain', artist: 'Fleetwood Mac', album: 'Rumours', duration: 271 };

afterEach(() => vi.restoreAllMocks());

describe('fetchLyricsOnline', () => {
  it('parses synced lyrics from an exact /api/get hit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      expect(String(url)).toContain('/api/get?');
      return ok({ syncedLyrics: '[00:01.00]one\n[00:02.00]two', plainLyrics: 'one\ntwo' });
    });
    const lines = await fetchLyricsOnline(query);
    expect(lines).toEqual([
      { time: 1, text: 'one' },
      { time: 2, text: 'two' },
    ]);
  });

  it('uses plain lyrics when there are no synced ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ plainLyrics: 'just words' }));
    expect(await fetchLyricsOnline(query)).toEqual([{ time: 0, text: 'just words' }]);
  });

  it('falls back to /api/search on a 404 from /api/get', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).includes('/api/get') ? notFound() : ok([{ syncedLyrics: '[00:00.50]hi' }]),
    );
    expect(await fetchLyricsOnline(query)).toEqual([{ time: 0.5, text: 'hi' }]);
  });

  it('returns null for an instrumental track', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).includes('/api/get') ? ok({ instrumental: true }) : ok([]),
    );
    expect(await fetchLyricsOnline(query)).toBeNull();
  });

  it('returns null (never throws) on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchLyricsOnline(query)).toBeNull();
  });
});
