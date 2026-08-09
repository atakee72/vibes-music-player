/// <reference lib="webworker" />
import { extractSongMeta, type ExtractedMeta } from '../lib/metadata-core';

/**
 * Metadata-extraction worker: parseBlob's CPU-heavy tag parsing runs here
 * instead of blocking the main thread during bulk ingest. Requires
 * `worker: { format: 'es' }` in vite.config.ts — the default iife format
 * would inline every music-metadata parser chunk into one monolith.
 */

export interface MetadataRequest {
  id: number;
  file: File;
}

export type MetadataResponse =
  | { id: number; ok: true; meta: ExtractedMeta }
  | { id: number; ok: false };

self.onmessage = async (e: MessageEvent<MetadataRequest>) => {
  const { id, file } = e.data;
  try {
    const { parseBlob } = await import('music-metadata');
    const meta = await parseBlob(file);
    const response: MetadataResponse = { id, ok: true, meta: extractSongMeta(meta, file.name) };
    self.postMessage(response);
  } catch {
    const response: MetadataResponse = { id, ok: false };
    self.postMessage(response);
  }
};
