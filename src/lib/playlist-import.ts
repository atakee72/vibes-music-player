import type { Playlist, Song } from '../types';

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

// Re-exported for convenience (tests + callers already inside this module's
// dynamic chunk). App imports it from './file-types' directly so the parser
// below stays out of the startup bundle.
export { isPlaylistFileName } from './file-types';

/**
 * The playlist a given import file should UPDATE, or undefined for "create
 * a new one". Matches only on `importSource` (case-insensitive) — the link
 * established when the file was first imported.
 *
 * Deliberately does NOT adopt a same-named unlinked playlist: importing
 * `Rock.m3u` must never silently overwrite a hand-made "Rock". The Library
 * and Favorites views can never be targets either (a file literally named
 * `library.m3u` just creates an ordinary playlist).
 */
export function findLinkedPlaylist(
  playlists: Playlist[],
  fileName: string,
): Playlist | undefined {
  const key = fileName.toLowerCase();
  return playlists.find(
    (p) =>
      p.id !== 'library' &&
      p.id !== 'favorites' &&
      p.importSource?.toLowerCase() === key,
  );
}

/** Song-id delta between two lists — drives the "(+3, −1)" re-sync toast. */
export function diffSongSets(
  prev: Song[],
  next: Song[],
): { added: number; removed: number } {
  const prevIds = new Set(prev.map((s) => s.id));
  const nextIds = new Set(next.map((s) => s.id));
  return {
    added: next.filter((s) => !prevIds.has(s.id)).length,
    removed: prev.filter((s) => !nextIds.has(s.id)).length,
  };
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
