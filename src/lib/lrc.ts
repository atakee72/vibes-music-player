import type { LyricLine } from '../types';

const TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
const META_TAG_RE = /^\[(ti|ar|al|by|offset|re|ve|id|length):/i;

export function parseLRC(text: string): LyricLine[] {
  const lines = text.split(/\r?\n/);
  const result: LyricLine[] = [];
  let offsetMs = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (META_TAG_RE.test(line)) {
      const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\]/i);
      if (offsetMatch) offsetMs = parseInt(offsetMatch[1]);
      continue;
    }

    const timestamps: number[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    TIMESTAMP_RE.lastIndex = 0;
    while ((match = TIMESTAMP_RE.exec(line)) !== null) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
      timestamps.push((min * 60 + sec) * 1000 + ms + offsetMs);
      lastIndex = TIMESTAMP_RE.lastIndex;
    }

    if (timestamps.length === 0) continue;
    const lyricText = line.slice(lastIndex).trim();

    for (const ts of timestamps) {
      result.push({ time: Math.max(0, ts / 1000), text: lyricText });
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

export function activeLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (lyrics.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= currentTime) idx = i;
    else break;
  }
  return idx;
}
