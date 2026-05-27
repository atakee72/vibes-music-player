import type { Song } from '../types';

export interface ImportEntry {
  path: string;
  filename: string;
  title?: string;
}

function basename(path: string): string {
  return path.replace(/^.*[/\\]/, '');
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseM3U(text: string): ImportEntry[] {
  const lines = stripBom(text).split(/\r?\n/);
  const entries: ImportEntry[] = [];
  let pendingTitle: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      if (comma !== -1) pendingTitle = line.slice(comma + 1).trim() || undefined;
      continue;
    }

    if (line.startsWith('#')) continue;

    entries.push({ path: line, filename: basename(line), title: pendingTitle });
    pendingTitle = undefined;
  }

  return entries;
}

export function parsePLS(text: string): ImportEntry[] {
  const lines = stripBom(text).split(/\r?\n/);
  const files = new Map<number, string>();
  const titles = new Map<number, string>();

  for (const raw of lines) {
    const line = raw.trim();
    const fileMatch = line.match(/^File(\d+)=(.+)$/i);
    if (fileMatch) {
      files.set(parseInt(fileMatch[1]), fileMatch[2]);
      continue;
    }
    const titleMatch = line.match(/^Title(\d+)=(.+)$/i);
    if (titleMatch) {
      titles.set(parseInt(titleMatch[1]), titleMatch[2]);
    }
  }

  const entries: ImportEntry[] = [];
  for (const [num, path] of [...files.entries()].sort((a, b) => a[0] - b[0])) {
    entries.push({ path, filename: basename(path), title: titles.get(num) });
  }
  return entries;
}

export function matchImportEntries(
  entries: ImportEntry[],
  librarySongs: Song[],
): { matched: Song[]; unmatched: ImportEntry[] } {
  const matched: Song[] = [];
  const unmatched: ImportEntry[] = [];
  const songsByName = new Map<string, Song>();
  for (const s of librarySongs) {
    const key = s.file.name.toLowerCase();
    if (!songsByName.has(key)) songsByName.set(key, s);
  }

  for (const entry of entries) {
    const song = songsByName.get(entry.filename.toLowerCase());
    if (song) matched.push(song);
    else unmatched.push(entry);
  }

  return { matched, unmatched };
}
