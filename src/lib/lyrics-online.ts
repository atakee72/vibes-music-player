import type { LyricLine } from '../types';
import { parseLRC } from './lrc';

const BASE = 'https://lrclib.net/api';

interface LrclibTrack {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

export interface OnlineLyricsQuery {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

function toLines(track: LrclibTrack | null | undefined): LyricLine[] | null {
  if (!track || track.instrumental) return null;
  if (track.syncedLyrics) {
    const parsed = parseLRC(track.syncedLyrics);
    if (parsed.length) return parsed;
  }
  if (track.plainLyrics?.trim()) return [{ time: 0, text: track.plainLyrics.trim() }];
  return null;
}

/**
 * Fetch lyrics from LRCLIB (free, no key, CORS-open). Sends **metadata only**
 * (title/artist/album/duration) — no audio. Tries the exact `/api/get` match
 * first (LRCLIB matches duration ±2s), then falls back to fuzzy `/api/search`.
 * Returns parsed `LyricLine[]` (synced if available, else a plain block), or
 * `null` for no match / instrumental / any network error (never throws).
 */
export async function fetchLyricsOnline(query: OnlineLyricsQuery): Promise<LyricLine[] | null> {
  try {
    const get = new URLSearchParams({ track_name: query.title, artist_name: query.artist });
    if (query.album) get.set('album_name', query.album);
    if (query.duration && query.duration > 0) get.set('duration', String(Math.round(query.duration)));

    const getRes = await fetch(`${BASE}/get?${get.toString()}`);
    if (getRes.ok) {
      const lines = toLines((await getRes.json()) as LrclibTrack);
      if (lines) return lines;
    }

    const search = new URLSearchParams({ track_name: query.title, artist_name: query.artist });
    const searchRes = await fetch(`${BASE}/search?${search.toString()}`);
    if (searchRes.ok) {
      const results = (await searchRes.json()) as LrclibTrack[];
      for (const r of results ?? []) {
        const lines = toLines(r);
        if (lines) return lines;
      }
    }
    return null;
  } catch {
    return null;
  }
}
