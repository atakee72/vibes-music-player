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
