const PLAYLIST_EXTS = ['.m3u', '.m3u8', '.pls'];

/**
 * True for playlist file names (`.m3u`, `.m3u8`, `.pls`), case-insensitive.
 *
 * Deliberately its own module: App needs this predicate SYNCHRONOUSLY (file
 * routing, the Refresh directory walk), while the parsing/matching half of
 * `playlist-import.ts` stays `await import()`ed. Importing it from there
 * would drag the whole parser into the startup chunk (CLAUDE.md
 * "Code splitting").
 */
export function isPlaylistFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return PLAYLIST_EXTS.some((ext) => lower.endsWith(ext));
}
