import { ingestDirectoryHandle, ingestDataTransferItems } from './ingest';

function audioFile(name: string): File {
  return new File([], name, { type: 'audio/mpeg' });
}

function fakeFileHandle(name: string, file: File | (() => Promise<File>)): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: typeof file === 'function' ? file : async () => file,
  } as unknown as FileSystemFileHandle;
}

function fakeDirHandle(
  name: string,
  children: FileSystemHandle[],
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    values: () =>
      (async function* () {
        for (const c of children) yield c;
      })(),
  } as unknown as FileSystemDirectoryHandle;
}

describe('ingestDirectoryHandle', () => {
  it('returns only audio/* files from a flat directory', async () => {
    const root = fakeDirHandle('Music', [
      fakeFileHandle('a.mp3', audioFile('a.mp3')),
      fakeFileHandle('b.mp3', audioFile('b.mp3')),
      fakeFileHandle('notes.txt', new File([], 'notes.txt', { type: 'text/plain' })),
    ]);

    const result = await ingestDirectoryHandle(root);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.relativePath).sort()).toEqual(['a.mp3', 'b.mp3']);
    expect(result[0].fileHandle).toBeDefined();
  });

  it('recurses into subdirectories with prefixed relative paths', async () => {
    const sub = fakeDirHandle('Sub', [fakeFileHandle('deep.mp3', audioFile('deep.mp3'))]);
    const root = fakeDirHandle('Music', [
      fakeFileHandle('top.mp3', audioFile('top.mp3')),
      sub,
    ]);

    const result = await ingestDirectoryHandle(root);
    expect(result.map((r) => r.relativePath).sort()).toEqual(['Sub/deep.mp3', 'top.mp3']);
  });

  it('tolerates an entry whose getFile() throws and keeps walking', async () => {
    const root = fakeDirHandle('Music', [
      fakeFileHandle('good.mp3', audioFile('good.mp3')),
      fakeFileHandle('bad.mp3', async () => {
        throw new Error('locked');
      }),
      fakeFileHandle('alsogood.mp3', audioFile('alsogood.mp3')),
    ]);

    const result = await ingestDirectoryHandle(root);
    expect(result.map((r) => r.relativePath).sort()).toEqual(['alsogood.mp3', 'good.mp3']);
  });

  it('a custom accept predicate applies inside NESTED directories too', async () => {
    // Guards the recursion-passthrough trap: the recursive call must forward
    // `accept`, or playlists in Music/Playlists/ would be silently invisible.
    const playlists = fakeDirHandle('Playlists', [
      fakeFileHandle('80s.m3u', new File([], '80s.m3u', { type: 'audio/x-mpegurl' })),
    ]);
    const root = fakeDirHandle('Music', [
      fakeFileHandle('song.mp3', audioFile('song.mp3')),
      playlists,
    ]);

    const result = await ingestDirectoryHandle(root, '', (f) => f.name.endsWith('.m3u'));
    expect(result.map((r) => r.relativePath)).toEqual(['Playlists/80s.m3u']);
  });

  it('the default filter takes audio by MIME *or* extension, and excludes playlists', async () => {
    const root = fakeDirHandle('Music', [
      fakeFileHandle('a.mp3', audioFile('a.mp3')),
      // Windows often reports no MIME type for these — extension must win.
      fakeFileHandle('b.flac', new File([], 'b.flac')),
      // Chromium types .m3u as audio/x-mpegurl; it must NOT become a song.
      fakeFileHandle('80s.m3u', new File([], '80s.m3u', { type: 'audio/x-mpegurl' })),
      fakeFileHandle('notes.txt', new File([], 'notes.txt', { type: 'text/plain' })),
    ]);
    const result = await ingestDirectoryHandle(root);
    expect(result.map((r) => r.relativePath).sort()).toEqual(['a.mp3', 'b.flac']);
  });
});

// --- drag & drop -----------------------------------------------------------

function fileEntry(name: string, file: File): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (resolve: (f: File) => void) => resolve(file),
  } as unknown as FileSystemEntry;
}

function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  let served = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      // readEntries returns batches until empty
      readEntries: (resolve: (e: FileSystemEntry[]) => void) => {
        if (served) return resolve([]);
        served = true;
        resolve(children);
      },
    }),
  } as unknown as FileSystemEntry;
}

function itemList(items: Partial<DataTransferItem>[]): DataTransferItemList {
  return items as unknown as DataTransferItemList;
}

describe('ingestDataTransferItems', () => {
  it('Firefox/Safari: a dropped FOLDER is walked via webkitGetAsEntry', async () => {
    // The regression that made folder drops dead-end in an alert: without this
    // branch, getAsFile() on a folder yields a 0-byte non-audio File.
    const folder = dirEntry('Music', [
      fileEntry('a.mp3', audioFile('a.mp3')),
      fileEntry('b.flac', new File([], 'b.flac')), // no MIME — extension wins
      fileEntry('cover.jpg', new File([], 'cover.jpg', { type: 'image/jpeg' })),
      dirEntry('Playlists', [fileEntry('80s.m3u', new File([], '80s.m3u'))]),
    ]);
    const { directoryHandles, files } = await ingestDataTransferItems(
      itemList([
        {
          kind: 'file',
          webkitGetAsEntry: () => folder,
          getAsFile: () => new File([], 'Music'), // what a folder looks like here
        },
      ]),
    );
    expect(directoryHandles).toHaveLength(0);
    // Songs AND the playlist file come through; the image doesn't.
    expect(files.map((f) => f.relativePath).sort()).toEqual([
      'Music/Playlists/80s.m3u',
      'Music/a.mp3',
      'Music/b.flac',
    ]);
  });

  it('Chromium: a dropped folder comes back as a directory handle for the caller to register', async () => {
    const handle = { kind: 'directory', name: 'Music' };
    const { directoryHandles, files } = await ingestDataTransferItems(
      itemList([
        {
          kind: 'file',
          getAsFileSystemHandle: async () => handle as unknown as FileSystemHandle,
          getAsFile: () => new File([], 'Music'),
        },
      ]),
    );
    expect(directoryHandles).toEqual([handle]);
    expect(files).toHaveLength(0);
  });

  it('reads every item BEFORE awaiting (the list is invalidated after the first await)', async () => {
    let awaited = false;
    const items = itemList([
      {
        kind: 'file',
        // Flips only once the handler yields — that's when a real
        // DataTransferItemList becomes invalid, not at call time.
        getAsFileSystemHandle: () =>
          Promise.resolve().then(() => {
            awaited = true;
            return null as unknown as FileSystemHandle;
          }),
        getAsFile: () => new File([], 'first.mp3', { type: 'audio/mpeg' }),
      },
      {
        kind: 'file',
        // Simulates a neutered list: null once the handler has yielded.
        getAsFile: () => (awaited ? null : new File([], 'second.mp3', { type: 'audio/mpeg' })),
      },
    ]);
    const { files } = await ingestDataTransferItems(items);
    expect(files.map((f) => f.relativePath).sort()).toEqual(['first.mp3', 'second.mp3']);
  });
});
