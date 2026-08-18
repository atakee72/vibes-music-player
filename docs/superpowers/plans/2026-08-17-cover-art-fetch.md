# Cover Art Fetch (iTunes Search API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user fill in missing cover art — one track at a time, or as a
library-wide sweep — from the free iTunes Search API, persisted into Vibes'
own `coverBlob` and never written back to the music files.

**Architecture:** A new `src/lib/cover-online.ts` owns the network + matching
and is the only file that knows iTunes exists. Its matching predicates are
pure and unit-tested without a network. `App.tsx` gets two consumers of that
one primitive: a per-song action (row `⋯` menu + mobile action sheet) and a
library sweep (header button, Re-scan shape: confirm modal → progress toast →
one batch state write). Everything the module returns goes through the
existing `downscaleCover` before it is persisted.

**Tech Stack:** TypeScript (strict), React 18, Vite 5, Vitest 3 + happy-dom +
React Testing Library, `idb-keyval` via `src/lib/storage.ts`, lucide-react icons,
Tailwind with the AFTERGLOW tokens.

## Global Constraints

- Package manager is **pnpm**. Never npm/yarn.
- `pnpm test:run && pnpm build` must both pass before any push. `tsc` runs only
  in `pnpm build` — **`Array.prototype.at()` is not in this project's TS lib
  target**; it type-checks under Vitest and fails the build. Use index access.
- **Vibes is strictly read-only on the music files.** Fetched art goes into
  `Song.coverBlob` only — never back into the file's tags. beets owns tags.
- **Outbound requests carry metadata only** (title / artist / album / duration).
  No audio, no file bytes, no cover bytes ever leave the device. This is the
  same invariant as `lyrics-online.ts` and the share links.
- **Cover art is always downscaled via `downscaleCover` before it is persisted**
  (512px cap, JPEG q0.85, PNG stays PNG). Contract: never worse than the input.
- **Never use native `window.alert` / `confirm` / `prompt`** — they block the
  main thread and the audio engine pauses. Use `setNotification`, `requestConfirm`
  and `PromptModal`.
- Colour tokens come from `tailwind.config.js`, not raw hex. Glyphs on the
  `from-amber to-coral` accent fill are `text-deep`, never white.
- Every new `src/lib/*.ts` module gets a co-located `*.test.ts`.
- Commit messages: simple and concise. **No** "Generated with Claude Code"
  signature, **no** "Co-Authored-By" footer.
- Baseline: `main` @ `34ebe97`, **427 tests green**, tree clean.

---

## Verified facts (probed 2026-08-17 — do not re-litigate these)

These were checked with live requests before this plan was written. They are
the load-bearing assumptions; the feature is impossible if any is false.

| Fact | Evidence |
|---|---|
| The search JSON is CORS-open | `GET https://itunes.apple.com/search?…` → `access-control-allow-origin: *` |
| The **artwork host** is CORS-open (so `res.blob()` works) | `GET https://is1-ssl.mzstatic.com/…/600x600bb.jpg` → `access-control-allow-origin: *`, `content-type: image/jpeg`, 151672 bytes |
| The `100x100bb.jpg` → `600x600bb.jpg` path substitution works | 600×600 JPEG returned, 151 kB (1000×1000 also works, 345 kB — we do **not** use it; we downscale to 512 anyway) |
| No key, no secret, no server | Plain `GET`, no auth header |
| A no-match returns a well-formed empty body | `{"resultCount":0,"results":[]}` |
| **Naive "take result[0]" pastes wrong art** | `entity=album&term=altin gun on` returned Altın Gün — *and Elton John*. This is why matching must be scored, not positional. |

The response `content-type` is `text/javascript; charset=utf-8`, not
`application/json`. `Response.json()` does not check content-type, so it parses
fine — do not add a content-type guard, it would reject every valid response.

## Measured recall: the matcher was run against the live API before shipping

The predicates below were implemented and run against real iTunes responses for
8 realistic library shapes (diacritics, a remaster suffix, a missing duration, a
Turkish title, mainstream Anglo tracks). **7 of 8 matched** — 6 on the track
search, 1 via the album fallback.

The single miss is the informative one. For "Childish Gambino – Redbone" the
API's top 10 contained a DJ mix (85 s), three karaoke versions, a smooth-jazz
cover and a lofi cover — **six candidates that would each have pasted the wrong
art onto the track** — and the real album cut was not in the results at all.
Strict matching rejected all six and correctly reported no match.

Two things were tested and **rejected as fixes**, so don't reach for them:

- **Raising `limit` to 25 does not help.** The real Redbone is still absent —
  it is a term-indexing gap at Apple's end, not a truncation. Keep `limit=10`.
- **Cleaning the album term's punctuation does not help either.** `entity=album`
  searches for `Childish Gambino Awaken My Love` return 0 results with or
  without the `,` and `!`; an artist-only album search returns his *features*,
  not his albums. iTunes' album index is simply weak on artist+album terms.

So the album fallback has **modest** recall — it rescued 1 of 8 here — but it
costs one request and its artist-equality guard is what rejects the other
artists' albums that search reliably returns. Keep it; don't expect much of it.

## Decisions already made (do not re-open)

- **Single-song action first, batch sweep built on the same primitive.**
- **Strict auto-accept, no candidate picker.** A result is accepted only when
  normalized artist AND normalized title both match exactly, and durations agree
  within ±7s when both are known. Anything else reports "no confident match".
  A picker was considered and rejected: it is a new modal and a batch sweep
  cannot use it.
- **Only songs that have no art are candidates.** Replacing existing art is out
  of scope. This is what keeps object-URL revocation out of this feature
  entirely (there is no previous `coverArt` URL to revoke).
- **No cancel button on the sweep**, matching the Re-scan precedent.

## What a successful write sets in motion (traced, so it isn't re-discovered)

Both surfaces end in `setPlaylists` + `setCurrentSong` + `setQueue`. Everything
downstream of that was traced against the source; none of it needs new code,
but a reviewer will hit all four:

- **The `useEffect([playlists])` revoke diff is unaffected.** It revokes URLs
  only for ids that *disappeared* (`App.tsx:371-387`); adding art removes
  nothing. Combined with the "only art-less songs are candidates" rule, this
  feature creates no revocation obligation at all.
- **The debounced save fires once** — which is precisely why the sweep does one
  batch write at the end instead of writing per song. `StorageQuotaError` is
  already caught and toasted by the existing save handler; a sweep that fills
  a nearly-full quota degrades the way any other large write does.
- **`useMediaSession` picks the artwork up for free.** Its metadata effect is
  keyed `[song]`, and `setCurrentSong(apply)` produces a new object, so the OS
  Now Playing widget gains the art without extra wiring (`useMediaSession.ts:49`).
- **A shuffle re-roll at that instant is possible, pre-existing, and bounded.**
  `activePlaylist?.songs` is a reference dep of the `nextSong` memo, so any
  song mutation can recompute the random pick — the source already documents
  this and its severity: "worst case is a rare non-gapless track boundary,
  never a wrong song or a stall" (`App.tsx:247-253`). Hearting a song and
  Re-scan already do exactly this. **Do not** try to engineer around it; the
  single batch write already limits a whole sweep to one occurrence.

**Do not add a "re-read the file first" step** by analogy with
`handleFetchLyrics`. That step exists for lyrics because nothing else recovers
embedded lyrics an old ingest missed. For covers, App's `healedCoversRef`
self-heal effect (`App.tsx:447-481`) already re-extracts embedded art for every
song lacking `coverBlob`, once per session — so by the time a row looks blank,
the local path has been tried and failed. A re-parse here would be dead code
that also drags `music-metadata` into the interaction.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/cover-online.ts` | **new** — the only file that knows about iTunes. Normalization, the two match predicates, artwork URL upgrade, and `fetchCoverOnline` returning a discriminated result. Downscales before returning. |
| `src/lib/cover-online.test.ts` | **new** — pure predicates without a network; `fetchCoverOnline` against a stubbed `fetch`. |
| `src/components/RowMenu.tsx` | optional `onFindCover` menu item. |
| `src/components/RowActionSheet.tsx` | the same action for mobile. |
| `src/components/SongList.tsx` | threads an **optional** `onFindCover?: (id: string) => void` prop to both, gated on the row having no art. |
| `src/App.tsx` | `handleFetchCover` (single) and `findMissingCovers` (sweep) + the two header openers. |
| `CLAUDE.md`, `README.md`, `ROADMAP.md` | docs. |

Nothing else changes. `types.ts` needs no change: `coverArt` and `coverBlob`
already exist and already persist through `storage.ts`.

---

### Task 1: Matching primitives in `cover-online.ts`

Pure functions only — no network in this task. These are what stop the Elton
John failure mode, so they get the most test attention.

**Files:**
- Create: `src/lib/cover-online.ts`
- Test: `src/lib/cover-online.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, for Tasks 2–4:
  - `interface CoverQuery { title: string; artist: string; album?: string; duration?: number }` (duration in **seconds**)
  - `interface ItunesResult { artistName?: string; trackName?: string; collectionName?: string; trackTimeMillis?: number; artworkUrl100?: string }`
  - `normalizeForMatch(s: string): string`
  - `isConfidentTrackMatch(q: CoverQuery, r: ItunesResult): boolean`
  - `isConfidentAlbumMatch(q: CoverQuery, r: ItunesResult): boolean`
  - `artworkUrl(url100: string, size?: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cover-online.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/lib/cover-online.test.ts`
Expected: FAIL — `Failed to resolve import "./cover-online"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cover-online.ts`:

```ts
/**
 * Cover art lookup against the **iTunes Search API** — free, no key, no
 * secret, CORS-open on both the JSON and the artwork host (verified
 * 2026-08-17). Spotify was rejected for this: its client-credentials flow
 * needs a secret, and a secret needs a server, which Vibes does not have.
 *
 * Sends **metadata only** (artist / title / album). No audio, no file bytes.
 * The art it returns is stored in Vibes' own `coverBlob` and is NEVER written
 * back into the music file — beets owns tags (CLAUDE.md interop contract).
 */

const BASE = 'https://itunes.apple.com/search';
/** Requested artwork edge. We downscale to 512, so 600 is the smallest source
 *  that cannot upscale. 1000 exists but is ~2× the bytes for no visible gain. */
const ARTWORK_SIZE = 600;
const SEARCH_LIMIT = 10;
/** Same spirit as LRCLIB's ±2s, widened: embedded durations drift on VBR
 *  files, and store versions differ by a fade-out. */
const DURATION_TOLERANCE_S = 7;

export interface CoverQuery {
  title: string;
  artist: string;
  album?: string;
  /** Seconds. iTunes reports milliseconds; the comparison converts. */
  duration?: number;
}

/** The subset of an iTunes result we read. Everything is optional — the API
 *  omits fields freely across entity types. */
export interface ItunesResult {
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
}

/**
 * Reduce a title/artist/album to a comparison key. Not a display name — the
 * only property that matters is that both sides of a comparison run through
 * this same function.
 */
export function normalizeForMatch(s: string): string {
  const key = s
    .normalize('NFD')
    // Escapes, NOT literal combining marks — those are invisible in source
    // and corrupt on copy/paste.
    .replace(/[\u0300-\u036f]/g, '') // café → cafe, Gün → Gun
    // Turkish dotless ı (U+0131) has NO NFD decomposition, so it survives to
    // the ASCII filter below and gets deleted MID-WORD: "Cemalım" → "cemal m",
    // "Şıkıdım" → "s k d m". Both sides still agree, but such a low-entropy
    // key invites collisions. Folding it to `i` keeps the word intact.
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/\([^()]*\)|\[[^\]]*\]/g, ' ') // (Remastered 2011), [Live]
    // Deliberately NOT `with`: it appears mid-title often enough that
    // truncating there would fold "Sitting With Me" and "Sitting With You"
    // to the same key — a false-positive that attaches the wrong art.
    .replace(/\b(?:feat|ft|featuring)\b.*$/, ' ') // featured-artist tail
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // Non-Latin scripts (CJK, Cyrillic, Hangul) contain no [a-z0-9] at all, so
  // the pipeline above empties them — and both predicates treat an empty key
  // as "unusable" and bail, which would make this feature silently find
  // NOTHING for such a library. Fall back to the raw string, case-folded and
  // whitespace-collapsed. Both sides still run through this same function, so
  // the keys stay comparable, and the fallback can only ever add an exact
  // string-equality match.
  return key || s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function durationAgrees(q: CoverQuery, r: ItunesResult): boolean {
  // Only a constraint when BOTH sides know it — an unknown duration must not
  // veto an otherwise exact artist+title hit.
  if (!q.duration || q.duration <= 0) return true;
  if (!r.trackTimeMillis || r.trackTimeMillis <= 0) return true;
  return Math.abs(r.trackTimeMillis / 1000 - q.duration) <= DURATION_TOLERANCE_S;
}

/**
 * Strict, deliberately. A live probe showed an album search for
 * "altin gun on" returning Altın Gün AND Elton John, so a positional
 * "take the first result" would silently paste wrong art across a library.
 * Equality (not containment) on both fields: containment would match
 * "Love" against "Love Story".
 */
export function isConfidentTrackMatch(q: CoverQuery, r: ItunesResult): boolean {
  if (!r.artworkUrl100) return false;
  const title = normalizeForMatch(q.title);
  const artist = normalizeForMatch(q.artist);
  // An untagged file yields an empty key, which would match every result
  // whose corresponding field is also empty.
  if (!title || !artist) return false;
  if (normalizeForMatch(r.trackName ?? '') !== title) return false;
  if (normalizeForMatch(r.artistName ?? '') !== artist) return false;
  return durationAgrees(q, r);
}

/** Fallback for tracks the store has only as part of an album. No duration
 *  check — an album has none. */
export function isConfidentAlbumMatch(q: CoverQuery, r: ItunesResult): boolean {
  if (!r.artworkUrl100 || !q.album) return false;
  const album = normalizeForMatch(q.album);
  const artist = normalizeForMatch(q.artist);
  if (!album || !artist) return false;
  if (normalizeForMatch(r.collectionName ?? '') !== album) return false;
  return normalizeForMatch(r.artistName ?? '') === artist;
}

/** Swap iTunes' 100px thumbnail path segment for a larger one. Unrecognised
 *  shapes pass through unchanged — a 100px cover beats an exception. */
export function artworkUrl(url100: string, size = ARTWORK_SIZE): string {
  return url100.replace(/\/\d+x\d+bb\.jpg$/, `/${size}x${size}bb.jpg`);
}
```

Do **not** import `downscaleCover` yet — Task 2 adds it along with the code
that uses it. (`tsconfig.json` sets `noUnusedLocals: false`, so an early import
would not actually fail the build, but leaving it out keeps this commit
self-contained.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:run src/lib/cover-online.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cover-online.ts src/lib/cover-online.test.ts
git commit -m "feat: iTunes cover-art match predicates"
```

---

### Task 2: `fetchCoverOnline` — the network path

**Files:**
- Modify: `src/lib/cover-online.ts` (append)
- Test: `src/lib/cover-online.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `CoverQuery`, `ItunesResult`, `isConfidentTrackMatch`,
  `isConfidentAlbumMatch`, `artworkUrl`; `downscaleCover(blob: Blob) => Promise<Blob>`
  from `src/lib/cover.ts`.
- Produces, for Tasks 3–4:
  - `type CoverResult = { status: 'found'; blob: Blob } | { status: 'none' } | { status: 'throttled' } | { status: 'error' }`
  - `fetchCoverOnline(q: CoverQuery): Promise<CoverResult>` — **never throws**.

Why a discriminated union instead of `Blob | null` (which is what
`fetchLyricsOnline` returns): the sweep in Task 4 must stop early when Apple
throttles us, and "no match for this track" is a completely different outcome
from "the API cut us off". Collapsing both to `null` would make a throttled
sweep look like a library with no matchable art.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/cover-online.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/lib/cover-online.test.ts`
Expected: FAIL — `fetchCoverOnline is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Add the `downscaleCover` import at the top of `src/lib/cover-online.ts`:

```ts
import { downscaleCover } from './cover';
```

Then append:

```ts
export type CoverResult =
  | { status: 'found'; blob: Blob }
  | { status: 'none' }
  | { status: 'throttled' }
  | { status: 'error' };

/** `'throttled'` is distinct from `null` on purpose — the library sweep must
 *  stop on it rather than issue hundreds of doomed requests. */
type SearchOutcome = ItunesResult[] | null | 'throttled';

async function search(term: string, entity: 'song' | 'album'): Promise<SearchOutcome> {
  const qs = new URLSearchParams({
    term,
    entity,
    media: 'music',
    limit: String(SEARCH_LIMIT),
  });
  const res = await fetch(`${BASE}?${qs.toString()}`);
  // 403 is iTunes' rate-limit response; 429 is the conventional one.
  if (res.status === 403 || res.status === 429) return 'throttled';
  if (!res.ok) return null;
  // The endpoint answers with `content-type: text/javascript`. Response.json()
  // does not check content-type, so this is correct — do NOT add a
  // content-type guard, it would reject every valid response.
  const data = (await res.json()) as { results?: ItunesResult[] };
  return data.results ?? [];
}

async function download(r: ItunesResult): Promise<CoverResult> {
  const res = await fetch(artworkUrl(r.artworkUrl100 as string));
  if (!res.ok) return { status: 'error' };
  const raw = await res.blob();
  // A CDN error page comes back 200 with HTML; persisting it would put a
  // permanently broken image into the library.
  if (raw.size === 0 || !raw.type.startsWith('image/')) return { status: 'error' };
  // The project-wide rule: never persist art that has not been downscaled.
  return { status: 'found', blob: await downscaleCover(raw) };
}

/**
 * Find cover art for one song. Tries an exact track match first, then falls
 * back to the album (for tracks the store carries only as album cuts).
 *
 * **Never throws** — same contract as `fetchLyricsOnline`. Callers switch on
 * `status`.
 */
export async function fetchCoverOnline(q: CoverQuery): Promise<CoverResult> {
  try {
    const tracks = await search(`${q.artist} ${q.title}`, 'song');
    if (tracks === 'throttled') return { status: 'throttled' };
    const track = tracks?.find((r) => isConfidentTrackMatch(q, r));
    if (track) return await download(track);

    if (q.album) {
      const albums = await search(`${q.artist} ${q.album}`, 'album');
      if (albums === 'throttled') return { status: 'throttled' };
      const album = albums?.find((r) => isConfidentAlbumMatch(q, r));
      if (album) return await download(album);
    }

    return { status: 'none' };
  } catch {
    return { status: 'error' };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:run src/lib/cover-online.test.ts`
Expected: PASS, 28 tests total in this file.

- [ ] **Step 5: Verify the whole suite and the build**

Run: `pnpm test:run && pnpm build`
Expected: all tests pass (**455** = 427 baseline + 18 from Task 1 + 10 from Task 2), `tsc` clean, `vite build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cover-online.ts src/lib/cover-online.test.ts
git commit -m "feat: fetch cover art from the iTunes Search API"
```

---

### Task 3: Per-song "Find cover art" action

**Files:**
- Modify: `src/components/RowMenu.tsx`
- Modify: `src/components/RowActionSheet.tsx`
- Modify: `src/components/SongList.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `fetchCoverOnline`, `CoverResult` from Task 2.
- Produces, for Task 4: nothing — Task 4 calls `fetchCoverOnline` directly.
  The two consumers are siblings, not a chain.

**Why it lives in the row menu and not on the now-playing hero:** the hero is
display-only by design (its one button is the heart), and the action is most
useful when you are looking at a list and can see which rows are blank.

- [ ] **Step 1: Add the menu item to `RowMenu.tsx`**

Add `ImagePlus` to the existing lucide import, extend the props interface, and
render the item conditionally. Insert after the `onAddToQueue` menu item, so
queue actions stay adjacent:

```tsx
// in the import from 'lucide-react', add ImagePlus:
import { ImagePlus, ListEnd, ListStart, MoreHorizontal } from 'lucide-react';

// in RowMenuProps:
  /** Present only when the song has no cover art — absent hides the item. */
  onFindCover?: () => void;

// in the destructured params:
export function RowMenu({ songTitle, onPlayNext, onAddToQueue, onFindCover, onOpenChange }: RowMenuProps) {
```

Render it inside the menu, immediately after the "Add to queue" item, matching
that item's existing markup exactly (same `role="menuitem"`, same classes, same
`setOpenNotify(false)` on click). Use this label and icon:

```tsx
{onFindCover && (
  <button
    role="menuitem"
    onClick={() => {
      setOpenNotify(false);
      onFindCover();
    }}
    className="<copy the className from the Add to queue button above>"
  >
    <ImagePlus className="h-4 w-4" />
    Find cover art
  </button>
)}
```

- [ ] **Step 2: Add the same action to `RowActionSheet.tsx`**

Add `ImagePlus` to its lucide import, add **optional** `onFindCover?: (id: string) => void`
to `RowActionSheetProps`, destructure it, and render a button between "Add to
queue" and the favourite toggle — copying the existing buttons' markup — shown
only when the song has no art:

```tsx
{onFindCover && !shown.coverArt && (
  <button
    onClick={() => {
      onFindCover(shown.id);
      onClose();
    }}
    className="<copy the className from the Add to queue button above>"
  >
    <ImagePlus className="h-5 w-5" />
    Find cover art
  </button>
)}
```

- [ ] **Step 3: Thread the prop through `SongList.tsx`**

`SongList.tsx` declares `onPlayNext`/`onAddToQueue` in **two** interfaces (the
row props at ~line 39 and the list props at ~line 71). Add
`onFindCover?: (id: string) => void;` to both, destructure it in both
components, and:

**The `?` is load-bearing, not laziness.** `tsc` typechecks test files
(`tsconfig.json` has `include: ["src"]`), so a *required* prop breaks the build
at every existing render site that omits it — two in `SongList.test.tsx`, one in
`RowActionSheet.test.tsx`. This is the same reason the `stats?` prop added by
the listening-stats work is optional (`SongList.tsx:27`).

- pass it to `<RowActionSheet …>` at the list root: `onFindCover={onFindCover}`
- pass it to `<SortableRow …>`: `onFindCover={onFindCover}`
- in the row, gate it on the song having no art:

```tsx
<RowMenu
  songTitle={song.title}
  onPlayNext={() => onPlayNext(song.id)}
  onAddToQueue={() => onAddToQueue(song.id)}
  onFindCover={onFindCover && !song.coverArt ? () => onFindCover(song.id) : undefined}
  onOpenChange={…}
/>
```

`onFindCover` must be a **stable** `useCallback` in App (like `onPlayNext`),
because `SortableRow` is `React.memo`-wrapped — see CLAUDE.md "Memoization
gotchas". The inline arrow above is created *inside* the row's own render, which
is the same thing the existing `onPlayNext` line does, so it does not defeat memo.

- [ ] **Step 4: Write the failing App test**

Append to `src/App.test.tsx`. `renderApp` and `makeSong` already exist in that
file — reuse them exactly as the surrounding tests do.

```ts
// Near the other vi.mock calls at the top of the file:
vi.mock('./lib/cover-online', () => ({
  fetchCoverOnline: vi.fn(async () => ({ status: 'none' })),
}));
```

**Every test below must set its own `mockResolvedValue`.** The file's global
`afterEach` (line ~131) calls `vi.clearAllMocks()`, which resets recorded calls
but **not** implementations — a `mockResolvedValue` from an earlier test
survives into later ones. Call counts are safe to assert; a default return is not.

`App.test.tsx` already has `openRowMenuAnd(songTitle, itemRegExp)` (line ~121),
which clicks the `More actions for ${songTitle}` trigger and then the named
`menuitem`. The tests below use it. The file's idiom is synchronous
`fireEvent.click` + `waitFor`, **not** `userEvent` — follow it.

```tsx
import { fetchCoverOnline } from './lib/cover-online';

describe('cover art fetch', () => {
  it('persists art fetched for a single song', async () => {
    const png = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' });
    vi.mocked(fetchCoverOnline).mockResolvedValue({ status: 'found', blob: png });

    store.playlists = [
      makePlaylist({
        id: 'library',
        name: 'Library',
        songs: [makeSong({ id: 's1', title: 'Bare', artist: 'Nobody' })],
      }),
    ];
    await renderApp();

    openRowMenuAnd('Bare', /find cover art/i);

    await waitFor(() =>
      expect(vi.mocked(fetchCoverOnline)).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bare', artist: 'Nobody' }),
      ),
    );
    await waitFor(() => {
      const saved = vi.mocked(storage.savePlaylists).mock.lastCall?.[0] as Playlist[];
      expect(saved[0].songs[0].coverBlob).toBe(png);
    });
  });

  it('tells the user when nothing confident was found', async () => {
    vi.mocked(fetchCoverOnline).mockResolvedValue({ status: 'none' });
    store.playlists = [
      makePlaylist({
        id: 'library',
        name: 'Library',
        songs: [makeSong({ id: 's1', title: 'Bare', artist: 'Nobody' })],
      }),
    ];
    await renderApp();

    openRowMenuAnd('Bare', /find cover art/i);

    expect(await screen.findByText(/no cover art found/i)).toBeInTheDocument();
  });

  // The action exists to FILL gaps; offering it on a song that already has
  // art would invite silent replacement, which this feature deliberately
  // does not do (and would need object-URL revocation to do safely).
  it('does not offer the action for a song that already has art', async () => {
    store.playlists = [
      makePlaylist({
        id: 'library',
        name: 'Library',
        songs: [makeSong({ id: 's1', title: 'Arted', coverArt: 'blob:existing' })],
      }),
    ];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Arted' }));
    expect(screen.getByRole('menuitem', { name: /play next/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /find cover art/i })).not.toBeInTheDocument();
  });
});
```

If `More actions for Bare` is not the row menu trigger's actual accessible
name, read the `aria-label` on `RowMenu`'s trigger button and use that string
instead — do not change the component to fit the test.

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm test:run src/App.test.tsx -t "cover art fetch"`
Expected: FAIL — no `Find cover art` menu item.

- [ ] **Step 6: Implement `handleFetchCover` in `App.tsx`**

Add beside `handleFetchLyrics` (~line 780):

```tsx
// Guarded by a ref, not state: the guard must be readable synchronously
// inside the callback, and a busy flag rendered into memoized rows would
// re-render the whole list for a one-song network call.
const fetchingCoverRef = useRef(false);
// Declared here, set by Task 4's sweep. Both refs live together so the
// cross-guard below compiles before the sweep exists.
const sweepingCoversRef = useRef(false);

const handleFetchCover = useCallback(async (id: string) => {
  // Cross-guarded against the sweep, not just against itself: the two paths
  // hit the SAME rate-limited API, and a single lookup fired mid-sweep both
  // doubles the request rate and can be the request that gets the sweep
  // throttled.
  if (fetchingCoverRef.current || sweepingCoversRef.current) {
    setNotification('Already looking for cover art…');
    return;
  }
  const song = filteredSongsRef.current.find((s) => s.id === id);
  if (!song) return;

  fetchingCoverRef.current = true;
  setNotification(`Looking for cover art for "${song.title}"…`);
  try {
    // Dynamic import keeps the iTunes client out of the startup bundle,
    // exactly like lyrics-online.
    const { fetchCoverOnline } = await import('./lib/cover-online');
    const result = await fetchCoverOnline({
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
    });

    if (result.status === 'found') {
      const patch = { coverArt: URL.createObjectURL(result.blob), coverBlob: result.blob };
      // Merged onto the LIVE song in each updater — never onto the `song`
      // snapshot captured above, which may be stale by the time the network
      // call returns (CLAUDE.md, "Re-scan tags": same lesson).
      const apply = (s: Song): Song => (s.id === id ? { ...s, ...patch } : s);
      setPlaylists((prev) => prev.map((p) => ({ ...p, songs: p.songs.map(apply) })));
      setCurrentSong((cur) => (cur ? apply(cur) : cur));
      setQueue((q) => q.map(apply));
      setNotification(`Cover art added for "${song.title}".`);
    } else if (result.status === 'throttled') {
      setNotification('Apple rate-limited the lookup. Try again in a minute.');
    } else if (result.status === 'error') {
      setNotification('Cover art lookup failed — check your connection.');
    } else {
      setNotification(`No cover art found for "${song.title}".`);
    }
  } catch (err) {
    // `fetchCoverOnline` never throws, but `import()` can — a tab left open
    // across a deploy 404s on the lazy chunk. Without this the rejection
    // escapes an onClick as an unhandled rejection with no user feedback,
    // which is the exact bug the Re-scan `.catch` exists for.
    console.warn('cover fetch: unexpected failure', err);
    setNotification('Cover art lookup failed unexpectedly.');
  } finally {
    fetchingCoverRef.current = false;
  }
}, []);
```

No object-URL revocation is needed here: the action is only offered for songs
with no `coverArt`, so there is no previous URL to free. If the song is deleted
while its lookup is in flight, `apply` matches nothing and the one created URL
outlives its blob — a leak of one cover per rare race, not worth a reaper.

Then pass it to `SongList`, beside the existing queue props (~line 2125):

```tsx
onFindCover={handleFetchCover}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test:run src/App.test.tsx`
Expected: PASS, including the three new tests.

- [ ] **Step 8: Verify the whole suite and the build**

Run: `pnpm test:run && pnpm build`
Expected: all pass (**458** = 455 + this task's 3 App tests), `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/RowMenu.tsx src/components/RowActionSheet.tsx src/components/SongList.tsx
git commit -m "feat: per-song Find cover art action"
```

---

### Task 4: Library-wide "Find missing covers" sweep

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `fetchCoverOnline`, `CoverResult` from Task 2; the existing
  `requestConfirm(title, message, onConfirm, confirmLabel?, destructive?)` and
  `setNotification(msg)` helpers in `App.tsx`.
- Produces: nothing further.

**Three constraints this task must respect, none of which apply to Re-scan:**

1. **Sequential, not `Promise.all`.** Re-scan reads local disk and fans out
   freely. This hits a public API with a per-IP rate limit; a `Promise.all`
   over 60 songs would be throttled almost immediately. One request at a time,
   with a fixed gap between songs.
2. **Stop on `throttled`.** Once Apple cuts us off, every further request is
   wasted and the toast would lie about coverage. Break the loop, keep the
   art already found, and say the sweep stopped early.
3. **Merge onto live songs at apply time.** The sweep runs for minutes with a
   toast inviting the user to sit and watch. If the batch write applied
   pre-merged snapshots, a heart toggled or lyrics fetched mid-sweep would be
   silently reverted *and then persisted* by the debounced save. This is the
   exact bug the Re-scan work already hit once; see CLAUDE.md "Refresh library
   + M3U export".

- [ ] **Step 1: Write the failing test**

Append to `src/App.test.tsx`:

```tsx
describe('find missing covers sweep', () => {
  it('fills art for every candidate and reports the count', async () => {
    const png = new Blob([new Uint8Array([7])], { type: 'image/png' });
    vi.mocked(fetchCoverOnline).mockResolvedValue({ status: 'found', blob: png });

    store.playlists = [
      makePlaylist({
        id: 'library',
        name: 'Library',
        songs: [
          makeSong({ id: 's1', title: 'Bare One' }),
          makeSong({ id: 's2', title: 'Bare Two' }),
          makeSong({ id: 's3', title: 'Has Art', coverArt: 'blob:existing' }),
        ],
      }),
    ];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Find missing covers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Find covers' }));

    // Only the two art-less songs are candidates.
    // 3s: the sweep's SWEEP_GAP_MS pause sits between the two lookups, so
    // waitFor's 1s default is uncomfortably close to the real timing.
    await waitFor(() => expect(vi.mocked(fetchCoverOnline)).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    expect(await screen.findByText(/added 2 of 2/i)).toBeInTheDocument();
  });

  it('stops early when Apple rate-limits, keeping what it already found', async () => {
    const png = new Blob([new Uint8Array([7])], { type: 'image/png' });
    vi.mocked(fetchCoverOnline)
      .mockResolvedValueOnce({ status: 'found', blob: png })
      .mockResolvedValue({ status: 'throttled' });

    store.playlists = [
      makePlaylist({
        id: 'library',
        name: 'Library',
        songs: [
          makeSong({ id: 's1', title: 'Bare One' }),
          makeSong({ id: 's2', title: 'Bare Two' }),
          makeSong({ id: 's3', title: 'Bare Three' }),
        ],
      }),
    ];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Find missing covers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Find covers' }));

    // Song 1 succeeded, song 2 was throttled, song 3 was never attempted.
    await waitFor(() => expect(screen.getByText(/rate-limited/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(vi.mocked(fetchCoverOnline)).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const saved = vi.mocked(storage.savePlaylists).mock.lastCall?.[0] as Playlist[];
      expect(saved[0].songs[0].coverBlob).toBe(png);
    });
  });

  it('says so when every track already has art', async () => {
    store.playlists = [
      makePlaylist({
        id: 'library',
        name: 'Library',
        songs: [makeSong({ id: 's1', title: 'Has Art', coverArt: 'blob:existing' })],
      }),
    ];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Find missing covers' }));

    expect(await screen.findByText(/already has cover art/i)).toBeInTheDocument();
    expect(vi.mocked(fetchCoverOnline)).not.toHaveBeenCalled();
  });
});
```

The sweep's inter-request delay must be short enough that these tests do not
time out with real timers (see Step 2's `SWEEP_GAP_MS`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/App.test.tsx -t "find missing covers"`
Expected: FAIL — no element labelled `Find missing covers`.

- [ ] **Step 3: Implement the sweep in `App.tsx`**

First, at **module scope** in `App.tsx` (top of the file, beside the other
module constants — not inside the component, where it would be re-created every
render):

```ts
/** Politeness gap between iTunes lookups. The Search API rate-limits per IP,
 *  so the sweep is deliberately sequential — a Promise.all over a library's
 *  worth of gaps would be throttled within seconds. */
const SWEEP_GAP_MS = 400;
```

Then, inside the component near `rescanTags` (~line 1290), after the Re-scan block:

```tsx
// `sweepingCoversRef` was already declared in Task 3, beside fetchingCoverRef.
const [sweepingCovers, setSweepingCovers] = useState(false);

const findMissingCovers = useCallback(() => {
  // Cross-guarded, same reason as handleFetchCover: one rate-limited API.
  if (sweepingCoversRef.current || fetchingCoverRef.current) {
    setNotification('Already looking for cover art…');
    return;
  }

  // Deduped across playlists by id: ingest adds songs only to the active
  // playlist, so Library is NOT a strict superset (same as Re-scan).
  const candidates: Song[] = [];
  const seen = new Set<string>();
  for (const p of playlistsRef.current) {
    for (const s of p.songs) {
      if (!s.coverArt && !s.coverBlob && !seen.has(s.id)) {
        seen.add(s.id);
        candidates.push(s);
      }
    }
  }

  if (candidates.length === 0) {
    setNotification('Every track already has cover art.');
    return;
  }

  const total = candidates.length;
  requestConfirm(
    'Find missing covers',
    `Look up artwork for ${total} ${total === 1 ? 'track' : 'tracks'} on Apple's iTunes Search API? Only the artist, title and album are sent — never your files. Art is saved in Vibes and never written back to the files.`,
    () => {
      void runSweep(candidates).catch((err) => {
        console.warn('cover sweep: unexpected failure', err);
        setNotification('Cover art lookup failed unexpectedly.');
      });
    },
    'Find covers',
    false, // not destructive — keep the confirm button off the `danger` token
  );

  async function runSweep(songs: Song[]) {
    sweepingCoversRef.current = true;
    setSweepingCovers(true);
    try {
      const { fetchCoverOnline } = await import('./lib/cover-online');
      // id → the fields to merge. Raw patches, applied to the LIVE song at
      // commit time — never a pre-merged snapshot (CLAUDE.md, Re-scan).
      const patches = new Map<string, { coverArt: string; coverBlob: Blob }>();
      let throttled = false;
      let done = 0;

      setNotification(`Finding cover art… 0/${songs.length}`);

      for (const song of songs) {
        const result = await fetchCoverOnline({
          title: song.title,
          artist: song.artist,
          album: song.album,
          duration: song.duration,
        });

        if (result.status === 'throttled') {
          // Every further request would be refused too, and the toast would
          // over-report how much of the library was actually checked.
          throttled = true;
          break;
        }
        if (result.status === 'found') {
          patches.set(song.id, {
            coverArt: URL.createObjectURL(result.blob),
            coverBlob: result.blob,
          });
        }

        done += 1;
        // Every 5 keeps the toast alive (its timer resets on each set)
        // without re-rendering App once per lookup.
        if (done % 5 === 0) setNotification(`Finding cover art… ${done}/${songs.length}`);
        if (done < songs.length) await new Promise((r) => setTimeout(r, SWEEP_GAP_MS));
      }

      if (patches.size > 0) {
        const apply = (s: Song): Song => {
          const patch = patches.get(s.id);
          return patch ? { ...s, ...patch } : s;
        };
        setPlaylists((prev) => prev.map((p) => ({ ...p, songs: p.songs.map(apply) })));
        setCurrentSong((cur) => (cur ? apply(cur) : cur));
        setQueue((q) => q.map(apply));
      }

      if (throttled) {
        setNotification(
          `Apple rate-limited the lookup — stopped after ${done} of ${songs.length}. Added ${patches.size}. Try again in a minute.`,
        );
      } else {
        setNotification(
          `Cover art: added ${patches.size} of ${songs.length} ${songs.length === 1 ? 'track' : 'tracks'}.`,
        );
      }
    } finally {
      sweepingCoversRef.current = false;
      setSweepingCovers(false);
    }
  }
}, [requestConfirm]);
```

No revocation list: every candidate had no `coverArt`, so no URL is replaced.
Patches whose song was deleted mid-sweep simply never match in `apply` — a
harmless one-URL leak in a rare race, not worth a reaper.

- [ ] **Step 4: Add BOTH header openers**

`headerActions` feeds **only** the mobile `⋯` HeaderMenu; the desktop header's
inline buttons are hand-written duplicates. One edit ships a button that is
invisible on desktop, which is the primary surface. Do both.

Add `ImagePlus` to `App.tsx`'s lucide-react import. Then, in `headerActions`,
directly after the `rescan` entry (~line 1784):

```tsx
...(activePlaylistId === 'library'
  ? [{ key: 'find-covers', label: 'Find missing covers', icon: ImagePlus, onClick: findMissingCovers }]
  : []),
```

And in the desktop header, directly after the Re-scan button (~line 2053):

```tsx
{activePlaylistId === 'library' && (
  <button
    onClick={findMissingCovers}
    disabled={sweepingCovers}
    className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-all disabled:opacity-40"
    title="Look up artwork for tracks with no cover"
    aria-label="Find missing covers"
  >
    <ImagePlus className="h-4 w-4" />
  </button>
)}
```

Gated on Library only — matching where Refresh and Re-scan live, and avoiding
the "what does this do inside a user playlist" ambiguity. Unlike Re-scan it does
**not** need `libraryRoots`/`libraryStatus`: the lookup uses tags Vibes already
holds in memory, so it works for Firefox/Safari blob-persisted libraries too.

Two placement consequences, both deliberate:

- The button is shown in Library but its candidate set is **deduped across all
  playlists**, so it also fixes a song that lives only in a user playlist
  (ingest adds songs to the active playlist, so Library is not a strict
  superset). Re-scan's candidate collection has exactly this property already
  — the confirm modal's count is what tells the user the real scope.
- **The single-song action is reachable only from the song list** (row `⋯` on
  desktop, the action sheet on mobile). The now-playing hero and
  `MobileNowPlaying` deliberately get no button: the hero is display-only by
  design — its one and only button is the heart — and a track playing without
  art is fixed by finding its row, or by the sweep.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:run src/App.test.tsx`
Expected: PASS, including the three sweep tests.

- [ ] **Step 6: Verify the whole suite and the build**

Run: `pnpm test:run && pnpm build`
Expected: all pass (**461** = 458 + this task's 3 sweep tests), `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: library-wide find missing covers sweep"
```

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add a CLAUDE.md section**

Insert a new section directly after "Cover art persistence" (it is the closest
neighbour and shares the `coverBlob` invariants):

```markdown
## Online cover art (iTunes Search API)

- `src/lib/cover-online.ts` is the only file that knows iTunes exists.
  **Metadata only** (artist/title/album/duration) — no audio, no file bytes,
  same invariant as `lyrics-online.ts` and share links. Free, no key, no
  secret, and **CORS-open on both the JSON and the `mzstatic` artwork host**,
  which is what makes `res.blob()` possible in the browser and is why iTunes
  was chosen over Spotify (whose client-credentials flow needs a server).
- **Matching is strict and scored, never positional.** A live probe had an
  album search for "altin gun on" return Altın Gün *and Elton John*, so
  `result[0]` would paste wrong art across a library. `isConfidentTrackMatch`
  requires normalized artist AND title equality (equality, not containment —
  containment matches "Love" against "Love Story") plus duration within ±7s
  when both sides know it. `isConfidentAlbumMatch` is the fallback for album
  cuts. `normalizeForMatch` is a comparison key, not a display name: its only
  contract is that both sides run through it.
- `fetchCoverOnline` returns a **discriminated `CoverResult`**, not
  `Blob | null`. `'throttled'` (HTTP 403/429) has to be distinguishable from
  `'none'` or the library sweep cannot stop early — and a throttled sweep
  would otherwise read as "your library has no matchable art".
- The search endpoint answers `content-type: text/javascript`. `Response.json()`
  ignores content-type, so it parses — **don't add a content-type guard**, it
  would reject every valid response.
- **Only songs with no art are candidates**, on both surfaces. That is what
  keeps object-URL revocation out of this feature entirely: there is no
  previous `coverArt` URL to free. Replacing existing art is deliberately out
  of scope.
- **The sweep is sequential with a `SWEEP_GAP_MS` gap** — the API rate-limits
  per IP, so Re-scan's `Promise.all` fan-out is exactly wrong here. Its batch
  write merges patches onto the **live** song inside the state updater, never
  a pre-sweep snapshot (same lesson as Re-scan: a heart toggled mid-sweep
  would otherwise be reverted and then persisted).
- Fetched art is downscaled through `downscaleCover` *inside* the module, so
  no caller can forget. It goes into `coverBlob` and **never back into the
  file** — Vibes stays read-only on music files; beets owns tags.
- The header opener needs **two** edits (`headerActions` for the mobile `⋯`
  menu + the hand-written desktop button), per "The right-edge panel slot".
```

- [ ] **Step 2: Update README.md**

In the feature list, after the lyrics entry, add:

```markdown
- **Cover art lookup** — fill in missing artwork from the free iTunes Search
  API, one track at a time (row `⋯` menu) or across the whole library
  (**Find missing covers**). Only the artist, title and album are sent; the
  art is stored in Vibes and never written back to your files.
```

And in the file tree, beside `lyrics-online.ts`:

```
│   ├── cover-online.ts       # iTunes Search API cover lookup + strict matching
```

- [ ] **Step 3: Update ROADMAP.md**

Strike item 4 in the backlog the way item 3 was struck, change the "Items 1-3
shipped" line to "Items 1-4 shipped", and add a shipped section after
"Local listening stats (shipped, 2026-08-17)":

```markdown
## Cover art fetch (shipped, 2026-08-17)

Backlog item 4, on branch `cover-art-fetch`.

- Fills missing artwork from the **iTunes Search API** — free, no key, no
  secret, and CORS-open on both the JSON *and* the `mzstatic` artwork host,
  which is the fact the whole feature rests on (verified with live requests
  before the plan was written). Spotify was ruled out for the opposite
  reason: a client secret implies a server.
- **Two surfaces on one primitive**: a per-song action in the row `⋯` menu /
  mobile sheet, and a library-wide sweep behind a confirm modal with a
  progress toast.
- **Matching is strict and scored.** The probe that shaped it: an album search
  for "altin gun on" returned Altın Gün *and Elton John*, so a positional
  `result[0]` would have pasted wrong art across the library. Acceptance needs
  normalized artist AND title equality plus a ±7s duration agreement.
- **The sweep is sequential and stops on HTTP 403/429.** The API rate-limits
  per IP, so Re-scan's parallel fan-out is exactly wrong here, and a throttled
  sweep that kept going would over-report its own coverage.
- Read-only on files throughout: art lands in `coverBlob`, downscaled inside
  the module so no caller can skip it, and never written back to tags.
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm test:run && pnpm build`
Expected: all pass, `tsc` clean.

```bash
git add CLAUDE.md README.md ROADMAP.md
git commit -m "docs: cover art fetch"
```

---

## Verification

**Automated:** `pnpm test:run && pnpm build` — expected 461 tests green,
`tsc` clean. No test may perform a real network request; every one stubs
`fetch` or mocks `./lib/cover-online`.

**Manual** (`pnpm build && pnpm preview`, the only way to exercise the real API):

1. Find a track with no artwork; open its row `⋯` → **Find cover art**. The
   toast should go "Looking for…" → "Cover art added", and the art should
   appear in the row, the hero orb and the player bar.
2. **Reload the page.** The art must still be there — that proves it went
   through `coverBlob` into IDB, not just into session state.
3. Try it on a track with a deliberately wrong artist tag. It must report
   "No cover art found" rather than attaching something plausible-looking.
   This is the failure mode the strict matching exists for.
4. Run **Find missing covers** on the library. Watch the progress toast
   advance, and confirm the final count matches the number of rows that
   actually gained art.
5. While the sweep runs, **heart a track that is not part of the sweep's
   results**. When the sweep finishes, that heart must still be set — this is
   the live-merge invariant.
6. Confirm in DevTools → Network that every outbound request is to
   `itunes.apple.com` or `is1-ssl.mzstatic.com`, and that no request body
   carries file bytes.
