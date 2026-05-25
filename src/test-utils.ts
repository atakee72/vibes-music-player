import type { Playlist, Song } from './types';

let songCounter = 0;
let playlistCounter = 0;

export function makeSong(overrides: Partial<Song> = {}): Song {
  songCounter += 1;
  const filename = `song-${songCounter}.mp3`;
  return {
    id: `song-id-${songCounter}`,
    url: `blob:song-${songCounter}`,
    title: `Track ${songCounter}`,
    artist: `Artist ${songCounter}`,
    album: `Album ${songCounter}`,
    duration: 180,
    file: new File([], filename, { type: 'audio/mpeg' }),
    ...overrides,
  };
}

export function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
  playlistCounter += 1;
  return {
    id: `playlist-id-${playlistCounter}`,
    name: `Playlist ${playlistCounter}`,
    songs: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
