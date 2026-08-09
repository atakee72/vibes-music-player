import type { IAudioMetadata } from 'music-metadata';
import type { LyricLine } from '../types';
import { extractLyrics } from './lyrics';

/**
 * The pure, structured-clone-serializable half of metadata extraction —
 * shared by the metadata worker and the main-thread fallback. Deliberately
 * NO Blob/object-URL creation here (those happen on the main thread after
 * the worker round-trip): only plain values plus the raw picture bytes.
 */
export interface ExtractedMeta {
  title: string;
  artist: string;
  album: string;
  duration: number;
  genre?: string;
  bpm?: number;
  year?: number;
  bitrate?: number;
  replayGainDb?: number;
  lyrics?: LyricLine[];
  /** Raw embedded art bytes (first picture) — Blob-ified by the caller. */
  picData?: Uint8Array;
  picFormat?: string;
}

export function extractSongMeta(meta: IAudioMetadata, fileName: string): ExtractedMeta {
  const pic = meta.common.picture?.[0];
  return {
    title: meta.common.title || fileName.replace(/\.[^/.]+$/, ''),
    artist: meta.common.artist || 'Unknown Artist',
    album: meta.common.album || 'Unknown Album',
    duration: meta.format.duration || 0,
    genre: meta.common.genre?.[0],
    bpm: meta.common.bpm,
    year: meta.common.year,
    bitrate: meta.format.bitrate,
    // Note: replaygain_track_gain is an IRatio object — `.dB` is the number.
    replayGainDb: meta.common.replaygain_track_gain?.dB,
    lyrics: extractLyrics(meta),
    picData: pic?.data,
    picFormat: pic?.format,
  };
}
