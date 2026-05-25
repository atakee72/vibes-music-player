import { useEffect } from 'react';
import type { Song } from '../types';

interface Args {
  song: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (t: number) => void;
}

/**
 * Wire the browser's Media Session API so OS-level media controls
 * (lock screen, Bluetooth headphones, macOS Now Playing, Windows SMTC,
 * Linux MPRIS via browser) reflect what Vibes is playing.
 *
 * Split into four effects so we don't thrash:
 *   - metadata    when `song` changes
 *   - playbackState when `isPlaying` changes
 *   - action handlers when callbacks change (rarely, due to useCallback)
 *   - positionState when `currentTime`/`duration` change
 */
export function useMediaSession({
  song,
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onSeek,
}: Args): void {
  // Metadata
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!song) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: song.coverArt
        ? [{ src: song.coverArt, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  }, [song]);

  // Playback state
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // Action handlers
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => onPlay());
    ms.setActionHandler('pause', () => onPause());
    ms.setActionHandler('nexttrack', () => onNext());
    ms.setActionHandler('previoustrack', () => onPrev());
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) onSeek(details.seekTime);
    });
    return () => {
      ms.setActionHandler('play', null);
      ms.setActionHandler('pause', null);
      ms.setActionHandler('nexttrack', null);
      ms.setActionHandler('previoustrack', null);
      ms.setActionHandler('seekto', null);
    };
  }, [onPlay, onPause, onNext, onPrev, onSeek]);

  // Position state (for lock-screen scrubbers)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {
      // Some browsers reject mid-load; ignore — it'll succeed on the next tick.
    }
  }, [currentTime, duration]);
}
