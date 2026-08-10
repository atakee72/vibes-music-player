export interface LyricLine {
  time: number;
  text: string;
}

export interface Song {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  genre?: string;
  bpm?: number;
  year?: number;
  bitrate?: number;
  coverArt?: string;
  coverBlob?: Blob;
  file: File;
  fileHandle?: FileSystemFileHandle;
  replayGainDb?: number;
  lyrics?: LyricLine[];
  favorite?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: Date;
  /** Source file name (e.g. "80s.m3u") when this playlist came from an
   *  import. Its presence marks the playlist LINKED: re-importing that file
   *  — or hitting Refresh — replaces this playlist's songs from it.
   *  Persists for free via storage's `Omit<Playlist,'songs'>` spread. */
  importSource?: string;
}

export type RepeatMode = 'none' | 'all' | 'one';

export interface LibraryRoot {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: Date;
}
