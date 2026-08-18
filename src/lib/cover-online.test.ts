import {
  artworkUrl,
  isConfidentAlbumMatch,
  isConfidentTrackMatch,
  normalizeForMatch,
  type CoverQuery,
} from './cover-online';

describe('normalizeForMatch', () => {
  it('folds case, diacritics and punctuation into a comparison key', () => {
    expect(normalizeForMatch('Café del Mar!')).toBe('cafe del mar');
  });

  it('drops bracketed suffixes so remasters match their originals', () => {
    expect(normalizeForMatch('The Chain (Remastered 2011)')).toBe('the chain');
    expect(normalizeForMatch('Cemalım [Live]')).toBe(normalizeForMatch('Cemalım'));
  });

  it('drops featured-artist tails', () => {
    expect(normalizeForMatch('Numb feat. Jay-Z')).toBe('numb');
    expect(normalizeForMatch('Numb ft Jay-Z')).toBe('numb');
  });

  // Turkish dotless ı (U+0131) has no NFD decomposition. Left alone it would
  // be deleted mid-word, turning "Cemalım" into the low-entropy key
  // "cemal m"; folding it to `i` keeps the word whole. This library is
  // Turkish-heavy, so it is worth the one extra replace.
  it('folds Turkish dotless i instead of fragmenting the word', () => {
    expect(normalizeForMatch('Cemalım')).toBe('cemalim');
    expect(normalizeForMatch('Altın Gün')).toBe('altin gun');
    expect(normalizeForMatch('Şıkıdım')).toBe('sikidim');
  });

  // Without the raw fallback these collapse to '' and both predicates bail on
  // an empty key — the feature would silently match NOTHING for a CJK,
  // Cyrillic or Hangul library.
  it('falls back to the raw string when a script has no ASCII at all', () => {
    expect(normalizeForMatch('夜に駆ける')).toBe('夜に駆ける');
    expect(normalizeForMatch('Кино')).toBe('кино');
  });

  it('still compares equal for the same non-Latin string', () => {
    expect(normalizeForMatch('夜に駆ける')).toBe(normalizeForMatch(' 夜に駆ける '));
  });
});

const query: CoverQuery = {
  title: 'Cemalım',
  artist: 'Altın Gün',
  album: 'On',
  duration: 242,
};
const art = 'https://is1-ssl.mzstatic.com/image/thumb/a/b/c/cover.jpg/100x100bb.jpg';

describe('isConfidentTrackMatch', () => {
  it('accepts an exact artist + title hit whose duration agrees', () => {
    expect(
      isConfidentTrackMatch(query, {
        artistName: 'Altın Gün',
        trackName: 'Cemalım',
        trackTimeMillis: 242720,
        artworkUrl100: art,
      }),
    ).toBe(true);
  });

  // The exact failure the live probe produced: an album search for
  // "altin gun on" also returned Elton John.
  it('rejects a different artist even when everything else looks plausible', () => {
    expect(
      isConfidentTrackMatch(query, {
        artistName: 'Elton John',
        trackName: 'Cemalım',
        trackTimeMillis: 242000,
        artworkUrl100: art,
      }),
    ).toBe(false);
  });

  it('rejects a title that merely contains the query title', () => {
    expect(
      isConfidentTrackMatch(
        { title: 'Love', artist: 'Adele' },
        { artistName: 'Adele', trackName: 'Love Story', artworkUrl100: art },
      ),
    ).toBe(false);
  });

  it('rejects a match whose duration is more than 7s off', () => {
    expect(
      isConfidentTrackMatch(query, {
        artistName: 'Altın Gün',
        trackName: 'Cemalım',
        trackTimeMillis: 260000,
        artworkUrl100: art,
      }),
    ).toBe(false);
  });

  it('accepts when the duration is unknown on either side', () => {
    expect(
      isConfidentTrackMatch(
        { title: 'Cemalım', artist: 'Altın Gün' },
        { artistName: 'Altın Gün', trackName: 'Cemalım', artworkUrl100: art },
      ),
    ).toBe(true);
  });

  it('rejects a result with no artwork — there is nothing to download', () => {
    expect(
      isConfidentTrackMatch(query, { artistName: 'Altın Gün', trackName: 'Cemalım' }),
    ).toBe(false);
  });

  // Untagged files fall back to a filename title and an empty artist; an
  // empty key would otherwise match every result with an empty field.
  it('rejects when the query itself has no usable artist or title', () => {
    expect(
      isConfidentTrackMatch(
        { title: 'Cemalım', artist: '' },
        { artistName: '', trackName: 'Cemalım', artworkUrl100: art },
      ),
    ).toBe(false);
  });
});

describe('isConfidentAlbumMatch', () => {
  it('accepts an exact artist + album hit', () => {
    expect(
      isConfidentAlbumMatch(query, {
        artistName: 'Altın Gün',
        collectionName: 'On',
        artworkUrl100: art,
      }),
    ).toBe(true);
  });

  it('rejects a different artist on the same album name', () => {
    expect(
      isConfidentAlbumMatch(query, {
        artistName: 'Elton John',
        collectionName: 'On',
        artworkUrl100: art,
      }),
    ).toBe(false);
  });

  it('rejects when the song carries no album to match on', () => {
    expect(
      isConfidentAlbumMatch(
        { title: 'x', artist: 'Altın Gün' },
        { artistName: 'Altın Gün', collectionName: 'On', artworkUrl100: art },
      ),
    ).toBe(false);
  });
});

describe('artworkUrl', () => {
  it('upgrades the 100px thumbnail to 600px', () => {
    expect(artworkUrl(art)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/a/b/c/cover.jpg/600x600bb.jpg',
    );
  });

  // Degrade, never throw: an unrecognised shape still yields a usable image.
  it('returns the url unchanged when the size suffix is not recognised', () => {
    expect(artworkUrl('https://example.com/cover.png')).toBe('https://example.com/cover.png');
  });
});

import { fetchCoverOnline } from './cover-online';

// The real downscaleCover decodes through an <img>, which never fires
// load/error under happy-dom — every call would sit out its 3s decode
// timeout. Identity keeps these tests fast and keeps the asserted blob
// identical to the stubbed response body.
vi.mock('./cover', () => ({ downscaleCover: vi.fn(async (b: Blob) => b) }));

const jpeg = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
const searchOk = (results: unknown[]) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results }) } as Response);
const imageOk = (blob: Blob) =>
  Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(blob) } as unknown as Response);

const q = { title: 'Cemalım', artist: 'Altın Gün', album: 'On', duration: 242 };
const hit = {
  artistName: 'Altın Gün',
  trackName: 'Cemalım',
  trackTimeMillis: 242720,
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/b/c/cover.jpg/100x100bb.jpg',
};

afterEach(() => vi.restoreAllMocks());

describe('fetchCoverOnline', () => {
  it('downloads the 600px artwork for a confident track match', async () => {
    const art = jpeg();
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.startsWith('https://itunes.apple.com/search')) {
        expect(u).toContain('entity=song');
        return searchOk([hit]);
      }
      expect(u).toContain('/600x600bb.jpg');
      return imageOk(art);
    });

    expect(await fetchCoverOnline(q)).toEqual({ status: 'found', blob: art });
  });

  it('sends metadata only — no file bytes, no audio', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      seen.push(String(url));
      return searchOk([]);
    });
    await fetchCoverOnline({ title: 'Cemalım', artist: 'Altın Gün' });
    expect(seen[0]).toContain('term=Alt');
    expect(seen[0]).not.toContain('blob:');
  });

  it('falls back to an album search when no track matches confidently', async () => {
    const art = jpeg();
    let songSearches = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = String(url);
      if (u.includes('entity=song')) {
        songSearches += 1;
        return searchOk([{ ...hit, artistName: 'Elton John' }]); // wrong artist
      }
      if (u.includes('entity=album')) {
        return searchOk([
          { artistName: 'Altın Gün', collectionName: 'On', artworkUrl100: hit.artworkUrl100 },
        ]);
      }
      return imageOk(art);
    });

    expect(await fetchCoverOnline(q)).toEqual({ status: 'found', blob: art });
    expect(songSearches).toBe(1);
  });

  it('reports none when nothing matches confidently', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => searchOk([{ ...hit, artistName: 'Nope' }]));
    expect(await fetchCoverOnline(q)).toEqual({ status: 'none' });
  });

  it('skips the album search entirely when the song has no album', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      calls.push(String(url));
      return searchOk([]);
    });
    await fetchCoverOnline({ title: 'Cemalım', artist: 'Altın Gün' });
    expect(calls).toHaveLength(1);
  });

  // 403 is what iTunes returns when it rate-limits a caller. The sweep in
  // App.tsx stops on this rather than firing another 200 doomed requests.
  it('reports throttled on a 403 so a sweep can stop early', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) } as Response),
    );
    expect(await fetchCoverOnline(q)).toEqual({ status: 'throttled' });
  });

  it('reports throttled on a 429 as well', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) } as Response),
    );
    expect(await fetchCoverOnline(q)).toEqual({ status: 'throttled' });
  });

  it('never throws when the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchCoverOnline(q)).toEqual({ status: 'error' });
  });

  it('rejects a download that is not actually an image', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).includes('itunes')
        ? searchOk([hit])
        : imageOk(new Blob(['<html>404</html>'], { type: 'text/html' })),
    );
    expect(await fetchCoverOnline(q)).toEqual({ status: 'error' });
  });

  it('rejects a zero-byte download', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).includes('itunes')
        ? searchOk([hit])
        : imageOk(new Blob([], { type: 'image/jpeg' })),
    );
    expect(await fetchCoverOnline(q)).toEqual({ status: 'error' });
  });
});
