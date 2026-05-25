export interface Song {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  genre?: string;
  year?: number;
  bitrate?: number;
  coverArt?: string;
  file: File;
  fileHandle?: FileSystemFileHandle;
  replayGainDb?: number;
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
