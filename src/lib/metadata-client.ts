import { extractSongMeta, type ExtractedMeta } from './metadata-core';
import type {
  MetadataRequest,
  MetadataResponse,
} from '../workers/metadata.worker';

/**
 * Client for the metadata worker: request/response by id with a small
 * concurrency pool, and a main-thread fallback (same parseBlob +
 * extractSongMeta path) when the worker can't run.
 *
 * Worker detection is deliberately NOT `typeof Worker !== 'undefined'` alone:
 * happy-dom defines a Worker stub, so Vitest forces the main-thread path via
 * MODE, and any runtime worker failure (construction or first message)
 * permanently falls back too — extraction must never break because the
 * worker did.
 */

const POOL_SIZE = Math.min(4, (navigator.hardwareConcurrency || 3) - 1 || 2);

let worker: Worker | null = null;
let workerBroken = import.meta.env.MODE === 'test';
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (meta: ExtractedMeta | null) => void; file: File }
>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/metadata.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<MetadataResponse>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      entry.resolve(e.data.ok ? e.data.meta : null);
    };
    worker.onerror = () => {
      // Worker died (bad chunk, CSP, …): fail everything in flight over to
      // the main-thread path and stop using the worker for this session.
      workerBroken = true;
      const entries = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const entry of entries) {
        void mainThreadExtract(entry.file).then(entry.resolve);
      }
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function mainThreadExtract(file: File): Promise<ExtractedMeta | null> {
  try {
    const { parseBlob } = await import('music-metadata');
    const meta = await parseBlob(file);
    return extractSongMeta(meta, file.name);
  } catch {
    return null;
  }
}

function workerExtract(file: File): Promise<ExtractedMeta | null> {
  const w = getWorker();
  if (!w) return mainThreadExtract(file);
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve, file });
    const request: MetadataRequest = { id, file };
    w.postMessage(request);
  });
}

// ---------------------------------------------------------------------------
// Concurrency pool: bulk ingest maps ALL files through extractMeta at once;
// the pool keeps at most POOL_SIZE parses in flight (worker or fallback).
// Modeled on storage.getPlaylists' Promise.all precedent, bounded.
// ---------------------------------------------------------------------------

let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < POOL_SIZE) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => resolve()));
}

function release(): void {
  const next = queue.shift();
  if (next) next();
  else active--;
}

/**
 * Extract metadata for one file (pooled). Returns null when the file can't
 * be parsed — callers keep their own per-file fallback Song shape.
 */
export async function extractMeta(file: File): Promise<ExtractedMeta | null> {
  await acquire();
  try {
    return await workerExtract(file);
  } finally {
    release();
  }
}
