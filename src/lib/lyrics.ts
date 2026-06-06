import type { IAudioMetadata } from 'music-metadata';
import type { LyricLine } from '../types';
import { parseLRC } from './lrc';

/** A line containing an LRC timestamp like `[01:23` → treat the blob as synced. */
const LRC_RE = /\[\d{1,2}:\d{2}/;

function fromText(raw: string): LyricLine[] | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (LRC_RE.test(text)) {
    const parsed = parseLRC(text);
    if (parsed.length) return parsed;
  }
  return [{ time: 0, text }];
}

const looksLyric = (s: unknown): boolean => typeof s === 'string' && /lyric/i.test(s);

/**
 * Pull lyrics out of parsed metadata. `music-metadata` only maps *some* embedded
 * lyrics frames to `common.lyrics` (ID3 USLT/SYLT, some Vorbis LYRICS), so we
 * also scan the raw `native` tags for anything lyric-shaped (TXXX:LYRICS,
 * UNSYNCEDLYRICS, ©lyr, …) — which is how many taggers store them.
 */
export function extractLyrics(meta: IAudioMetadata): LyricLine[] | undefined {
  // 1) Mapped common.lyrics.
  const common = meta.common.lyrics?.[0];
  if (common) {
    if (common.syncText?.length) {
      const synced = common.syncText
        .filter((s) => s.timestamp != null)
        .map((s) => ({ time: s.timestamp! / 1000, text: s.text }));
      if (synced.length) return synced;
    }
    if (common.text?.trim()) return fromText(common.text);
  }

  // 2) Native-tag fallback.
  for (const tag of Object.values(meta.native ?? {}).flat()) {
    const v = tag.value as { text?: unknown; description?: unknown; descriptor?: unknown } | string;
    const isLyricFrame =
      looksLyric(tag.id) ||
      (typeof v === 'object' && (looksLyric(v?.description) || looksLyric(v?.descriptor)));
    if (!isLyricFrame) continue;

    const text =
      typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : null;
    if (!text) continue;
    const result = fromText(text);
    if (result) return result;
  }

  return undefined;
}
