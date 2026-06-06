import { useState } from 'react';
import { parseBlob } from 'music-metadata';
import type { Song } from '../types';
import { extractLyrics } from '../lib/lyrics';

export function useMetadataExtractor() {
  const [isLoading, setIsLoading] = useState(false);

  const extractMetadata = async (file: File): Promise<Song> => {
    setIsLoading(true);
    try {
      const meta = await parseBlob(file);

      let coverArt: string | undefined;
      let coverBlob: Blob | undefined;
      if (meta.common.picture && meta.common.picture.length > 0) {
        const pic = meta.common.picture[0];
        coverBlob = new Blob([pic.data as BlobPart], { type: pic.format });
        coverArt = URL.createObjectURL(coverBlob);
      }

      const lyrics = extractLyrics(meta);

      return {
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        title: meta.common.title || file.name.replace(/\.[^/.]+$/, ''),
        artist: meta.common.artist || 'Unknown Artist',
        album: meta.common.album || 'Unknown Album',
        duration: meta.format.duration || 0,
        genre: meta.common.genre?.[0],
        bpm: meta.common.bpm,
        year: meta.common.year,
        bitrate: meta.format.bitrate,
        coverArt,
        coverBlob,
        file,
        replayGainDb: meta.common.replaygain_track_gain?.dB,
        lyrics,
      };
    } catch (err) {
      console.error('Error extracting metadata:', err);
      return {
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        title: file.name.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: 0,
        file,
      };
    } finally {
      setIsLoading(false);
    }
  };

  return { extractMetadata, isLoading };
}
