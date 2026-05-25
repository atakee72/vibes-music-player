import { get, set } from 'idb-keyval';
import type { LibraryRoot, Playlist, Song } from '../types';
import type { EqPreset } from './eq';

const ROOTS_KEY = 'library-roots';
const PLAYLISTS_KEY = 'playlists';
const EQ_PRESET_KEY = 'eq-preset';

type SongMeta = Omit<Song, 'file' | 'url' | 'fileHandle'>;
type HandleStoredSong = SongMeta & { fileHandle: FileSystemFileHandle };
type BlobStoredSong = SongMeta & { blob: Blob; fileName: string };
type StoredSong = HandleStoredSong | BlobStoredSong;
type StoredPlaylist = Omit<Playlist, 'songs'> & { songs: StoredSong[] };

function toStored(song: Song): StoredSong | null {
  // Prefer handle when present — no byte duplication on Chromium
  if (song.fileHandle) {
    const { file: _f, url: _u, fileHandle, ...rest } = song;
    return { ...rest, fileHandle };
  }
  if (song.file) {
    const { file, url: _u, fileHandle: _h, ...rest } = song;
    return { ...rest, blob: file as Blob, fileName: file.name };
  }
  return null;
}

async function fromStored(stored: StoredSong): Promise<Song | null> {
  if ('fileHandle' in stored) {
    try {
      const file = await stored.fileHandle.getFile();
      return { ...stored, file, url: URL.createObjectURL(file) };
    } catch {
      return null;
    }
  }
  const file = new File([stored.blob], stored.fileName, { type: stored.blob.type });
  return { ...stored, file, url: URL.createObjectURL(file) };
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

  const playlists: Playlist[] = [];
  for (const sp of stored) {
    const songs: Song[] = [];
    for (const ss of sp.songs) {
      const song = await fromStored(ss);
      if (song) songs.push(song);
    }
    playlists.push({ ...sp, songs });
  }
  return playlists;
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  const stored: StoredPlaylist[] = playlists.map((p) => ({
    ...p,
    songs: p.songs.map(toStored).filter((s): s is StoredSong => s !== null),
  }));
  await set(PLAYLISTS_KEY, stored);
}

export async function getEqPreset(): Promise<EqPreset> {
  return (await get<EqPreset>(EQ_PRESET_KEY)) ?? 'Off';
}

export async function saveEqPreset(preset: EqPreset): Promise<void> {
  await set(EQ_PRESET_KEY, preset);
}
