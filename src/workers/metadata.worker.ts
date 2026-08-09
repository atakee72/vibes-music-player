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
  | { id: number; ok: false; workerEnv?: boolean };

self.onmessage = async (e: MessageEvent<MetadataRequest>) => {
  const { id, file } = e.data;

  // Environment failure (chunk fetch failed mid-deploy, CSP, …) is NOT the
  // file's fault — flag it so the client fails over to the main thread
  // instead of emitting metadata-less fallback songs for the whole batch.
  let parseBlob: typeof import('music-metadata').parseBlob;
  try {
    ({ parseBlob } = await import('music-metadata'));
  } catch {
    const response: MetadataResponse = { id, ok: false, workerEnv: true };
    self.postMessage(response);
    return;
  }

  try {
    const meta = await parseBlob(file);
    const response: MetadataResponse = { id, ok: true, meta: extractSongMeta(meta, file.name) };
    self.postMessage(response);
  } catch {
    const response: MetadataResponse = { id, ok: false };
    self.postMessage(response);
  }
};
