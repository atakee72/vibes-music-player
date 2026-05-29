import type { Song } from '../types';

/**
 * The track metadata carried by a share link. Deliberately metadata-only —
 * never the audio file. The recipient sees "what I'm listening to"; they
 * play it from their own library or not at all.
 */
export interface SharedTrack {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

const PREFIX = '#s=';

// Compact wire shape keeps the URL short.
interface Wire {
  t: string;
  a: string;
  al: string;
  d: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode a song's shareable metadata into a URL hash fragment (e.g.
 * `#s=<base64url>`). Unicode-safe: JSON → UTF-8 bytes → base64url, so
 * non-ASCII titles survive (plain `btoa` is Latin1-only and would corrupt them).
 */
export function encodeSharePayload(song: Song): string {
  const wire: Wire = {
    t: song.title,
    a: song.artist,
    al: song.album,
    d: song.duration,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  return PREFIX + bytesToBase64Url(bytes);
}

/**
 * Decode a hash fragment produced by `encodeSharePayload` back into a
 * `SharedTrack`. Returns `null` for anything malformed — a recipient could
 * paste an arbitrary string, so this never throws.
 */
export function decodeSharePayload(hash: string): SharedTrack | null {
  if (!hash || !hash.startsWith(PREFIX)) return null;
  const payload = hash.slice(PREFIX.length);
  if (!payload) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const wire = JSON.parse(json) as unknown;
    if (typeof wire !== 'object' || wire === null) return null;
    const { t, a, al, d } = wire as Record<string, unknown>;
    if (typeof t !== 'string' || typeof a !== 'string') return null;
    if (typeof al !== 'string') return null;
    if (typeof d !== 'number' || !Number.isFinite(d)) return null;
    return { title: t, artist: a, album: al, duration: d };
  } catch {
    return null;
  }
}
