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
