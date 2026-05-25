export interface IngestedFile {
  file: File;
  fileHandle?: FileSystemFileHandle;
  relativePath: string;
}

const isAudio = (file: File) => file.type.startsWith('audio/');

/**
 * Walk a FileSystemDirectoryHandle recursively, yielding audio files with their
 * relative paths and the matching FileSystemFileHandle (so callers can persist
 * them later). Tolerates errors per entry — a single broken file does not
 * abort the rest of the walk.
 */
export async function ingestDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  prefix = '',
): Promise<IngestedFile[]> {
  const out: IngestedFile[] = [];
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    try {
      if (entry.kind === 'directory') {
        out.push(...(await ingestDirectoryHandle(entry as FileSystemDirectoryHandle, path)));
      } else {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        if (isAudio(file)) out.push({ file, fileHandle, relativePath: path });
      }
    } catch (err) {
      console.warn('ingest: skipping entry', path, err);
    }
  }
  return out;
}

/**
 * Walk drag-and-drop DataTransferItems. Tries the modern FS Access API path
 * first (returns handles, suitable for persistence on Chromium). Falls back
 * to webkitGetAsEntry for Firefox/Safari (no handles — session-only files).
 */
export async function ingestDataTransferItems(
  items: DataTransferItemList,
): Promise<IngestedFile[]> {
  const out: IngestedFile[] = [];

  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;

    // Chromium path — FS Access API
    if (typeof item.getAsFileSystemHandle === 'function') {
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle?.kind === 'directory') {
          out.push(...(await ingestDirectoryHandle(handle as FileSystemDirectoryHandle)));
          continue;
        }
        if (handle?.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          if (isAudio(file)) out.push({ file, fileHandle, relativePath: file.name });
          continue;
        }
      } catch (err) {
        console.warn('ingest: getAsFileSystemHandle failed, falling back', err);
      }
    }

    // Firefox/Safari path — webkitGetAsEntry (no handle, session-only)
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      out.push(...(await collectFromEntry(entry)));
      continue;
    }

    // Final fallback — single plain file
    const file = item.getAsFile();
    if (file && isAudio(file)) out.push({ file, relativePath: file.name });
  }

  return out;
}

async function collectFromEntry(entry: FileSystemEntry, prefix = ''): Promise<IngestedFile[]> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    try {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      return isAudio(file) ? [{ file, relativePath: path }] : [];
    } catch (err) {
      console.warn('ingest: webkit entry file() failed', path, err);
      return [];
    }
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const out: IngestedFile[] = [];
    // readEntries can return in batches; loop until empty
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) {
        out.push(...(await collectFromEntry(child, path)));
      }
    }
    return out;
  }

  return [];
}
