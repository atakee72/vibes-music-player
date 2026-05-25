import {
  addLibraryRoot,
  getEqPreset,
  getLibraryRoots,
  getPlaylists,
  saveEqPreset,
  savePlaylists,
} from './storage';
import { makePlaylist, makeSong } from '../test-utils';

// In-memory mock of idb-keyval — bypasses structured clone, which fake-indexeddb
// (correctly) rejects for the objects-with-methods we use as handle stand-ins.
// Real FileSystemHandle survives the round-trip via a custom browser serializer
// that fake-indexeddb doesn't implement. We test the storage module's contract,
// not idb-keyval itself (which is third-party).
const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
}));

beforeEach(() => {
  store.clear();
});

function fakeDirHandle(
  name: string,
  sameAs: FileSystemDirectoryHandle[] = [],
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    isSameEntry: async (other: FileSystemDirectoryHandle) => sameAs.includes(other),
  } as unknown as FileSystemDirectoryHandle;
}

function fakeFileHandle(name: string, file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => file,
  } as unknown as FileSystemFileHandle;
}

describe('storage — library roots', () => {
  it('getLibraryRoots returns [] when key absent', async () => {
    expect(await getLibraryRoots()).toEqual([]);
  });

  it('addLibraryRoot persists and returns the new root', async () => {
    const handle = fakeDirHandle('Music');
    const root = await addLibraryRoot('Music', handle);
    expect(root).not.toBeNull();
    expect(root!.name).toBe('Music');
    const all = await getLibraryRoots();
    expect(all).toHaveLength(1);
    expect(all[0].handle).toBe(handle);
  });

  it('addLibraryRoot dedupes when isSameEntry returns true', async () => {
    const handleA = fakeDirHandle('Music');
    const handleB = fakeDirHandle('Music');
    // Stored handleA reports handleB as the same entry (symmetric real behavior)
    (handleA as unknown as { isSameEntry: (h: unknown) => Promise<boolean> }).isSameEntry =
      async (other) => other === handleB;

    await addLibraryRoot('Music', handleA);
    const result = await addLibraryRoot('Music', handleB);
    expect(result).toBeNull();

    const all = await getLibraryRoots();
    expect(all).toHaveLength(1);
  });
});

describe('storage — playlists', () => {
  it('getPlaylists returns [] when key absent', async () => {
    expect(await getPlaylists()).toEqual([]);
  });

  it('round-trips a playlist with persistent songs (those with a fileHandle)', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:re-derived');
    const file = new File([], 'reborn.mp3', { type: 'audio/mpeg' });
    const handle = fakeFileHandle('reborn.mp3', file);

    const song = makeSong({ title: 'Reborn', fileHandle: handle });
    const playlist = makePlaylist({ name: 'Mix', songs: [song] });
    await savePlaylists([playlist]);

    const loaded = await getPlaylists();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].songs).toHaveLength(1);
    expect(loaded[0].songs[0].title).toBe('Reborn');
    expect(loaded[0].songs[0].file).toBe(file);
    expect(loaded[0].songs[0].url).toBe('blob:re-derived');
  });

  it('round-trips a blob-backed song (Firefox/Safari fallback path)', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:from-blob');
    const file = new File([new Uint8Array([1, 2, 3])], 'firefox-song.mp3', {
      type: 'audio/mpeg',
    });
    // makeSong's default doesn't set fileHandle, so this is the blob-only case
    const song = makeSong({ title: 'Firefox Song', file });
    await savePlaylists([makePlaylist({ name: 'Mix', songs: [song] })]);

    const loaded = await getPlaylists();
    expect(loaded[0].songs).toHaveLength(1);
    expect(loaded[0].songs[0].title).toBe('Firefox Song');
    expect(loaded[0].songs[0].file.name).toBe('firefox-song.mp3');
    expect(loaded[0].songs[0].file.type).toBe('audio/mpeg');
    expect(loaded[0].songs[0].url).toBe('blob:from-blob');
  });

  it('mixed playlist: one handle-backed and one blob-backed both round-trip', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:any');
    const handleFile = new File([], 'on-disk.mp3', { type: 'audio/mpeg' });
    const handleSong = makeSong({
      title: 'On Disk',
      fileHandle: fakeFileHandle('on-disk.mp3', handleFile),
    });
    const blobSong = makeSong({ title: 'In Browser' });

    await savePlaylists([
      makePlaylist({ name: 'Mix', songs: [handleSong, blobSong] }),
    ]);
    const loaded = await getPlaylists();
    expect(loaded[0].songs).toHaveLength(2);
    expect(loaded[0].songs.map((s) => s.title).sort()).toEqual(['In Browser', 'On Disk']);
  });

  it('prefers the fileHandle path when a song has BOTH handle and file', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:from-handle');
    const handleFile = new File([], 'real.mp3', { type: 'audio/mpeg' });
    const song = makeSong({
      title: 'Both',
      file: new File([new Uint8Array([9, 9, 9])], 'unused-blob-bytes.mp3'),
      fileHandle: fakeFileHandle('real.mp3', handleFile),
    });
    await savePlaylists([makePlaylist({ name: 'Mix', songs: [song] })]);
    const loaded = await getPlaylists();
    // File should come from the handle.getFile(), not the blob duplicate
    expect(loaded[0].songs[0].file).toBe(handleFile);
    expect(loaded[0].songs[0].file.name).toBe('real.mp3');
  });

  it('getEqPreset returns "Off" when key absent', async () => {
    expect(await getEqPreset()).toBe('Off');
  });

  it('round-trips an EQ preset', async () => {
    await saveEqPreset('Bass Boost');
    expect(await getEqPreset()).toBe('Bass Boost');
  });

  it('drops songs whose handle getFile() throws (file moved/deleted)', async () => {
    const handle = {
      kind: 'file',
      name: 'gone.mp3',
      getFile: async () => {
        throw new Error('NotFoundError');
      },
    } as unknown as FileSystemFileHandle;

    const song = makeSong({ title: 'Gone', fileHandle: handle });
    await savePlaylists([makePlaylist({ name: 'Mix', songs: [song] })]);

    const loaded = await getPlaylists();
    expect(loaded[0].songs).toHaveLength(0);
  });
});
