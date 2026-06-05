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
}

export interface Playlist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: Date;
}

export type RepeatMode = 'none' | 'all' | 'one';

export interface LibraryRoot {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: Date;
}
