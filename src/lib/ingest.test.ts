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
});
