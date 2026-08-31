import type { Song } from '../types';

/**
 * The format/quality badge shown in the now-playing views:
 * `AAC · 44.1 kHz · 133 kbps`.
 *
 * Pure and DOM-free. Everything it needs is already on the Song — the format
 * fields captured at ingest, plus `file.size` and `duration` for the derived
 * bitrate — so it needs no parser and no async work at render time.
 */

/** music-metadata's `format.codec` strings are verbose; these are display names. */
const CODEC_LABELS: Record<string, string> = {
  'MPEG-4/AAC': 'AAC',
  'MPEG 1 Layer 3': 'MP3',
  'MPEG 2 Layer 3': 'MP3',
  'MPEG 2.5 Layer 3': 'MP3',
  'MPEG 1 Layer 2': 'MP2',
};

/**
 * Container names for the pre-re-scan fallback, keyed by extension.
 *
 * These are deliberately CONTAINERS, not codecs: a `.m4a` may hold AAC or
 * ALAC, and `.ogg` may hold Vorbis or Opus. Naming the container is honest
 * about what we actually know; a re-scan supplies the real codec.
 */
const CONTAINER_LABELS: Record<string, string> = {
  m4a: 'M4A',
  mp4: 'MP4',
  m4b: 'M4A',
  mp3: 'MP3',
  flac: 'FLAC',
  ogg: 'OGG',
  oga: 'OGG',
  opus: 'Opus',
  wav: 'WAV',
  aiff: 'AIFF',
  aif: 'AIFF',
  wma: 'WMA',
  aac: 'AAC',
};

/**
 * How far a parsed bitrate may stray from the size-derived one before we stop
 * believing it.
 *
 * This replaces the obvious "reject implausibly small values" floor, which
 * does not work: music-metadata reports 8-17 kbps for some AAC files that
 * actually run at ~135 kbps, so any floor low enough to admit a real 8 kbps
 * stream also admits that garbage. Cross-checking against the file size
 * separates them cleanly — in a 463-file library the bad values land at
 * 0.06-0.12 of derived while every good one lands above 0.67.
 */
const TRUST_MIN = 0.5;
const TRUST_MAX = 1.5;

function codecLabel(song: Song): string | null {
  if (song.codec) return CODEC_LABELS[song.codec] ?? song.codec;

  const ext = song.file.name.split('.').pop()?.toLowerCase();
  return (ext && CONTAINER_LABELS[ext]) || null;
}

function sampleRateLabel(hz: number | undefined): string | null {
  if (!hz || hz <= 0) return null;
  const khz = hz / 1000;
  // 44100 -> "44.1 kHz", 48000 -> "48 kHz" (no trailing ".0").
  return `${parseFloat(khz.toFixed(1))} kHz`;
}

function bitrateLabel(song: Song): string | null {
  const bytes = song.file.size;
  if (!(song.duration > 0) || bytes <= 0) return null;

  const derivedKbps = (bytes * 8) / song.duration / 1000;
  const parsedKbps = (song.bitrate ?? 0) / 1000;

  const ratio = parsedKbps / derivedKbps;
  if (parsedKbps > 0 && ratio >= TRUST_MIN && ratio <= TRUST_MAX) {
    return `${Math.round(parsedKbps)} kbps`;
  }
  // "~" marks a value inferred from the file size: it includes container and
  // embedded-art overhead, so it runs a few percent high.
  return `~${Math.round(derivedKbps)} kbps`;
}

export function describeFormat(song: Song): string | null {
  const parts = [
    codecLabel(song),
    sampleRateLabel(song.sampleRate),
    // Bit depth is a PCM property. music-metadata reports bitsPerSample: 16
    // for AAC, but a lossy stream has no sample depth — printing one would
    // claim a precision it does not have.
    song.lossless && song.bitsPerSample ? `${song.bitsPerSample}-bit` : null,
    bitrateLabel(song),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
}
