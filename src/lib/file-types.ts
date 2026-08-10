/**
 * File-type predicates shared by App's drop/pick routing and the directory
 * walk. Deliberately its own tiny module: these are needed SYNCHRONOUSLY,
 * while the playlist parser stays `await import()`ed (CLAUDE.md
 * "Code splitting").
 */

const PLAYLIST_EXTS = ['.m3u', '.m3u8', '.pls'];

/**
 * Audio extensions used as a FALLBACK when the browser reports no usable MIME
 * type. Chromium/Firefox derive `File.type` from an OS registry lookup, which
 * on Windows frequently yields `""` for `.flac`, `.m4a`, `.opus`, `.aiff`,
 * `.wma`… Trusting MIME alone silently drops those files from ingest — the
 * "Please select audio files" dead end. Extension-matching is what every
 * serious web player falls back to.
 */
const AUDIO_EXTS = [
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.flac',
  '.wav',
  '.wave',
  '.ogg',
  '.oga',
  '.opus',
  '.webm',
  '.aiff',
  '.aif',
  '.aifc',
  '.wma',
  '.mp4',
  '.mka',
  '.ape',
  '.wv',
  '.mpc',
  '.dsf',
  '.dff',
];

const hasExt = (name: string, exts: string[]) => {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
};

/** True for playlist file names (`.m3u`, `.m3u8`, `.pls`), case-insensitive. */
export function isPlaylistFileName(name: string): boolean {
  return hasExt(name, PLAYLIST_EXTS);
}

/** True for `.lrc` lyric files. */
export function isLrcFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.lrc');
}

/**
 * True for playable audio: an `audio/*` MIME type OR a known audio extension
 * (see AUDIO_EXTS for why the fallback is required). Playlist files are
 * excluded explicitly — Chromium reports `.m3u` as `audio/x-mpegurl`, which
 * would otherwise pass the MIME test and be ingested as an unplayable "song".
 */
export function isAudioFile(file: File): boolean {
  if (isPlaylistFileName(file.name) || isLrcFileName(file.name)) return false;
  return file.type.startsWith('audio/') || hasExt(file.name, AUDIO_EXTS);
}

/**
 * Anything the app knows how to consume from a drop: audio, playlists, lyrics.
 * Collectors use this and let `handleFiles` do the routing — a dropped folder
 * should yield its `Playlists/*.m3u` too, not just its songs.
 */
export function isIngestableFile(file: File): boolean {
  return isAudioFile(file) || isPlaylistFileName(file.name) || isLrcFileName(file.name);
}
