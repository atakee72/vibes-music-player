import { isAudioFile, isIngestableFile } from './file-types';
export interface IngestedFile {
  file: File;
  fileHandle?: FileSystemFileHandle;
  relativePath: string;
}


/**
 * Walk a FileSystemDirectoryHandle recursively, yielding matching files with
 * their relative paths and the matching FileSystemFileHandle (so callers can
 * persist them later). Tolerates errors per entry — a single broken file does
 * not abort the rest of the walk.
 *
 * `accept` defaults to audio-only. Refresh passes a wider predicate so one
 * walk collects songs AND playlist files (`getFile()` runs before the filter
 * either way, so a wider predicate costs no extra round-trips).
 * **The recursive call MUST forward `accept`** — otherwise subdirectories
 * silently fall back to audio-only, and files that only live in a subfolder
 * (e.g. `Music/Playlists/*.m3u`) become invisible with no error.
 */
export async function ingestDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  prefix = '',
  accept: (file: File) => boolean = isAudioFile,
): Promise<IngestedFile[]> {
  const out: IngestedFile[] = [];
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    try {
      if (entry.kind === 'directory') {
        out.push(
          ...(await ingestDirectoryHandle(entry as FileSystemDirectoryHandle, path, accept)),
        );
      } else {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        if (accept(file)) out.push({ file, fileHandle, relativePath: path });
      }
    } catch (err) {
      console.warn('ingest: skipping entry', path, err);
    }
  }
  return out;
}

/** What a drop yielded: Chromium directory handles (persistable as library
 *  roots) plus loose files — including everything recursively collected from
 *  a folder dropped in Firefox/Safari, where no handles exist. */
export interface DroppedItems {
  directoryHandles: FileSystemDirectoryHandle[];
  files: IngestedFile[];
}

/**
 * Walk drag-and-drop DataTransferItems.
 *
 * Chromium: `getAsFileSystemHandle()` yields persistable handles — a dropped
 * folder comes back as a directory handle the caller registers as a library
 * root. Firefox/Safari have no such API, so a dropped folder is walked via
 * `webkitGetAsEntry()` + `readEntries()` into session-only files. Without that
 * branch, `getAsFile()` on a folder returns a 0-byte non-audio File and the
 * drop silently yields nothing.
 *
 * **Everything is snapshotted synchronously first**: a DataTransferItemList is
 * invalidated as soon as the drop handler awaits, so calling `getAsFile()` /
 * `getAsFileSystemHandle()` after the first `await` returns null.
 *
 * Files are filtered with `isIngestableFile` (audio + playlists + lyrics) —
 * routing is the caller's job, so a dropped music folder also delivers its
 * `Playlists/*.m3u`.
 */
export async function ingestDataTransferItems(
  items: DataTransferItemList,
): Promise<DroppedItems> {
  const snapshot = Array.from(items)
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      handlePromise:
        typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle() : null,
      entry: item.webkitGetAsEntry?.() ?? null,
      file: item.getAsFile(),
    }));

  const directoryHandles: FileSystemDirectoryHandle[] = [];
  const files: IngestedFile[] = [];

  for (const snap of snapshot) {
    if (snap.handlePromise) {
      try {
        const handle = await snap.handlePromise;
        if (handle?.kind === 'directory') {
          directoryHandles.push(handle as FileSystemDirectoryHandle);
          continue;
        }
        if (handle?.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          if (isIngestableFile(file)) files.push({ file, fileHandle, relativePath: file.name });
          continue;
        }
      } catch (err) {
        console.warn('ingest: getAsFileSystemHandle failed, falling back', err);
      }
    }

    // Firefox/Safari — recurse the dropped entry (session-only, no handles)
    if (snap.entry) {
      files.push(...(await collectFromEntry(snap.entry)));
      continue;
    }

    if (snap.file && isIngestableFile(snap.file)) {
      files.push({ file: snap.file, relativePath: snap.file.name });
    }
  }

  return { directoryHandles, files };
}

async function collectFromEntry(entry: FileSystemEntry, prefix = ''): Promise<IngestedFile[]> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    try {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      return isIngestableFile(file) ? [{ file, relativePath: path }] : [];
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
