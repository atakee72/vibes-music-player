import { get, set } from 'idb-keyval';
import type { LibraryRoot, Playlist, Song } from '../types';

const ROOTS_KEY = 'library-roots';
const PLAYLISTS_KEY = 'playlists';

type StoredSong = Omit<Song, 'file' | 'url'> & { fileHandle: FileSystemFileHandle };
type StoredPlaylist = Omit<Playlist, 'songs'> & { songs: StoredSong[] };

function toStored(song: Song): StoredSong | null {
  if (!song.fileHandle) return null;
  const { file: _file, url: _url, ...rest } = song;
  return { ...rest, fileHandle: song.fileHandle };
}

async function fromStored(stored: StoredSong): Promise<Song | null> {
  try {
    const file = await stored.fileHandle.getFile();
    return { ...stored, file, url: URL.createObjectURL(file) };
  } catch {
    return null;
  }
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
