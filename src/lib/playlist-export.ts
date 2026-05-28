import type { Playlist } from '../types';

export function serializeM3U(playlist: Playlist): string {
  const lines: string[] = ['#EXTM3U'];
  for (const song of playlist.songs) {
    const duration = Math.round(song.duration || 0);
    const title = `${song.artist} - ${song.title}`.replace(/\r?\n/g, ' ');
    lines.push(`#EXTINF:${duration},${title}`);
    lines.push(song.file.name);
  }
  return lines.join('\n') + '\n';
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'playlist';
}
