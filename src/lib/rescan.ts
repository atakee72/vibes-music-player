import type { Song } from '../types';
import type { ExtractedMeta } from './metadata-core';

/**
 * Re-scan merge policy: how a freshly parsed file updates a song Vibes
 * already knows. Pure and DOM-free — Blob/object-URL creation happens in the
 * caller and arrives as `replacements`.
 *
 * The file is the source of truth for scalar tags (an external tagger like
 * beets rewrites them in place, and clearing a value must propagate), but
 * NOT for cover art and lyrics: those can also come from inside Vibes
 * (LRCLIB "Find lyrics", the cover self-heal effect) and blind replacement
 * would destroy them. Hence merge-not-replace for exactly those two.
 */

export interface RescanReplacements {
  /** Fresh File from fileHandle.getFile(). Omit to keep the song's current
   *  file (used for the currently-playing song, whose <audio> holds it). */
  file?: File;
  /** Object URL for that fresh File. Omit to keep the current url. */
  url?: string;
  /** Downscaled cover built from meta.picData. Omit when the file has no
   *  embedded picture — the song keeps whatever cover it already had. */
  cover?: { coverArt: string; coverBlob: Blob };
}

export function mergeRescan(
  song: Song,
  meta: ExtractedMeta,
  replacements: RescanReplacements = {},
): Song {
  const { file, url, cover } = replacements;
  return {
    ...song,
    // File wins for scalars — including clearing values it no longer carries.
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    genre: meta.genre,
    bpm: meta.bpm,
    year: meta.year,
    bitrate: meta.bitrate,
    replayGainDb: meta.replayGainDb,
    // A zero duration means the parse couldn't determine it — keeping the
    // known-good value beats breaking the progress bar and the gapless
    // preload threshold.
    duration: meta.duration > 0 ? meta.duration : song.duration,
    // Merge-not-replace: see the module comment.
    lyrics: meta.lyrics && meta.lyrics.length > 0 ? meta.lyrics : song.lyrics,
    coverArt: cover ? cover.coverArt : song.coverArt,
    coverBlob: cover ? cover.coverBlob : song.coverBlob,
    file: file ?? song.file,
    url: url ?? song.url,
  };
}

/**
 * Did a re-scan actually change anything the user can see? Drives the summary
 * toast's "N of M updated" count only — deliberately ignores `url`/`file`,
 * which the re-scan swaps for every song regardless of tag content.
 */
export function hasMetaChanged(before: Song, after: Song): boolean {
  if (
    before.title !== after.title ||
    before.artist !== after.artist ||
    before.album !== after.album ||
    before.duration !== after.duration ||
    before.genre !== after.genre ||
    before.bpm !== after.bpm ||
    before.year !== after.year ||
    before.bitrate !== after.bitrate ||
    before.replayGainDb !== after.replayGainDb
  ) {
    return true;
  }
  if (before.coverBlob !== after.coverBlob) return true;
  return (before.lyrics?.length ?? 0) !== (after.lyrics?.length ?? 0);
}
