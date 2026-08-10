import { ingestDirectoryHandle } from './ingest';

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

  it('defaults to audio-only when no accept predicate is given', async () => {
    const root = fakeDirHandle('Music', [
      fakeFileHandle('a.mp3', audioFile('a.mp3')),
      fakeFileHandle('80s.m3u', new File([], '80s.m3u', { type: 'audio/x-mpegurl' })),
    ]);
    // .m3u reports as audio/x-mpegurl in Chromium, so the default filter
    // DOES include it — the caller (App) excludes playlist files explicitly.
    const result = await ingestDirectoryHandle(root);
    expect(result.map((r) => r.relativePath).sort()).toEqual(['80s.m3u', 'a.mp3']);
  });
});
