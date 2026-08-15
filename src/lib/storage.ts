import { get, set } from 'idb-keyval';
import type { LibraryRoot, Playlist, Song } from '../types';
import type { EqPreset } from './eq';
import { CROSSFADE_OPTIONS } from './crossfade';

const ROOTS_KEY = 'library-roots';
const PLAYLISTS_KEY = 'playlists';
const EQ_PRESET_KEY = 'eq-preset';
const VOLUME_KEY = 'volume';
const CROSSFADE_KEY = 'crossfade';

type SongMeta = Omit<Song, 'file' | 'url' | 'fileHandle' | 'coverArt'>;
type HandleStoredSong = SongMeta & { fileHandle: FileSystemFileHandle };
type BlobStoredSong = SongMeta & { blob: Blob; fileName: string };
type StoredSong = HandleStoredSong | BlobStoredSong;
type StoredPlaylist = Omit<Playlist, 'songs'> & { songs: StoredSong[] };

function toStored(song: Song): StoredSong | null {
  // Prefer handle when present — no byte duplication on Chromium
  if (song.fileHandle) {
    const { file: _f, url: _u, coverArt: _c, fileHandle, ...rest } = song;
    return { ...rest, fileHandle };
  }
  if (song.file) {
    const { file, url: _u, coverArt: _c, fileHandle: _h, ...rest } = song;
    return { ...rest, blob: file as Blob, fileName: file.name };
  }
  return null;
}

function rehydrateSong(stored: StoredSong, file: File): Song {
  const coverArt = stored.coverBlob ? URL.createObjectURL(stored.coverBlob) : undefined;
  return { ...stored, file, url: URL.createObjectURL(file), coverArt };
}

async function fromStored(stored: StoredSong): Promise<Song | null> {
  if ('fileHandle' in stored) {
    try {
      const file = await stored.fileHandle.getFile();
      return rehydrateSong(stored, file);
    } catch {
      return null;
    }
  }
  const file = new File([stored.blob], stored.fileName, { type: stored.blob.type });
  return rehydrateSong(stored, file);
}

/**
 * Request persistent storage so the browser won't evict our IDB under quota
 * pressure. Idempotent across sessions: `persisted()` short-circuits when
 * already granted, so steady-state users never see the Firefox prompt twice.
 */
export async function ensurePersisted(): Promise<void> {
  const s = navigator.storage;
  if (!s?.persist || !s?.persisted) return;
  if (await s.persisted()) return;
  await s.persist();
}

export class StorageQuotaError extends Error {
  constructor(message = 'Storage quota exceeded') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
  percent: number;
} | null> {
  const s = navigator.storage;
  if (!s?.estimate) return null;
  const est = await s.estimate();
  const usage = est.usage ?? 0;
  const quota = est.quota ?? 0;
  return { usage, quota, percent: quota > 0 ? (usage / quota) * 100 : 0 };
}

export const STORAGE_WARN_PERCENT = 90;

/**
 * Early quota warning: complements StorageQuotaError, which only fires AFTER
 * a save has failed — this warns while saves still succeed. Returns null when
 * under threshold or when the estimate is unavailable (unsupported browser).
 */
export function formatStorageWarning(
  est: { usage: number; quota: number; percent: number } | null,
): string | null {
  if (!est || est.percent < STORAGE_WARN_PERCENT) return null;
  return `Storage almost full (${Math.round(est.percent)}% used) — new songs may fail to save.`;
}

export async function getLibraryRoots(): Promise<LibraryRoot[]> {
  return (await get<LibraryRoot[]>(ROOTS_KEY)) ?? [];
}

export async function addLibraryRoot(
  name: string,
  handle: FileSystemDirectoryHandle,
): Promise<LibraryRoot | null> {
  const existing = await getLibraryRoots();
  for (const root of existing) {
    if (await root.handle.isSameEntry(handle)) return null;
  }
  const newRoot: LibraryRoot = {
    id: crypto.randomUUID(),
    name,
    handle,
    addedAt: new Date(),
  };
  await set(ROOTS_KEY, [...existing, newRoot]);
  return newRoot;
}

export async function getPlaylists(): Promise<Playlist[]> {
  const stored = await get<StoredPlaylist[]>(PLAYLISTS_KEY);
  if (!stored) return [];

  // Reconstruct every song in a playlist **in parallel**. Each `fromStored`
  // awaits `fileHandle.getFile()` (Chromium handle path); doing them
  // sequentially made load O(N) round-trips and dominated startup for large
  // libraries. `Promise.all` preserves order, so playlist order is unchanged.
  const playlists: Playlist[] = [];
  for (const sp of stored) {
    const songs = (await Promise.all(sp.songs.map(fromStored))).filter(
      (s): s is Song => s !== null,
    );
    playlists.push({ ...sp, songs });
  }
  return playlists;
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  const stored: StoredPlaylist[] = playlists.map((p) => ({
    ...p,
    songs: p.songs.map(toStored).filter((s): s is StoredSong => s !== null),
  }));
  try {
    await set(PLAYLISTS_KEY, stored);
  } catch (err) {
    // IDB quota exceeded surfaces as a DOMException with this name.
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new StorageQuotaError(err.message);
    }
    throw err;
  }
}

export async function getEqPreset(): Promise<EqPreset> {
  return (await get<EqPreset>(EQ_PRESET_KEY)) ?? 'Off';
}

export async function saveEqPreset(preset: EqPreset): Promise<void> {
  await set(EQ_PRESET_KEY, preset);
}

export async function getVolume(): Promise<number> {
  const v = await get<number>(VOLUME_KEY);
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
}

export async function saveVolume(volume: number): Promise<void> {
  await set(VOLUME_KEY, volume);
}

export async function getCrossfade(): Promise<number> {
  const v = await get<number>(CROSSFADE_KEY);
  // Validate against the offered options rather than any number: a stale or
  // hand-edited value must not become an unbounded fade duration.
  return typeof v === 'number' && (CROSSFADE_OPTIONS as readonly number[]).includes(v) ? v : 0;
}

export async function saveCrossfade(seconds: number): Promise<void> {
  await set(CROSSFADE_KEY, seconds);
}
