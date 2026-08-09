import { useState } from 'react';
import type { Song } from '../types';
import { extractMeta } from '../lib/metadata-client';
import { downscaleCover } from '../lib/cover';

export function useMetadataExtractor() {
  const [isLoading, setIsLoading] = useState(false);

  const extractMetadata = async (file: File): Promise<Song> => {
    setIsLoading(true);
    try {
      // The CPU-heavy tag parsing runs in the metadata worker (pooled, with a
      // main-thread fallback) — see src/lib/metadata-client.ts. Only the
      // non-serializable pieces (Blob + object URLs) are built here.
      const meta = await extractMeta(file);
      if (!meta) throw new Error('unparseable');

      let coverArt: string | undefined;
      let coverBlob: Blob | undefined;
      if (meta.picData && meta.picFormat) {
        // The documented BlobPart cast (CLAUDE.md "TypeScript gotcha") lives on:
        // music-metadata's Uint8Array<ArrayBufferLike> doesn't satisfy BlobPart
        // under strict — don't "fix" it by re-typing.
        const raw = new Blob([meta.picData as BlobPart], { type: meta.picFormat });
        coverBlob = await downscaleCover(raw);
        coverArt = URL.createObjectURL(coverBlob);
      }

      return {
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        duration: meta.duration,
        genre: meta.genre,
        bpm: meta.bpm,
        year: meta.year,
        bitrate: meta.bitrate,
        coverArt,
        coverBlob,
        file,
        replayGainDb: meta.replayGainDb,
        lyrics: meta.lyrics,
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
