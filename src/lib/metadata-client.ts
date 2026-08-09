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
 * MODE, and any runtime worker failure — construction error, script error,
 * clone failure, environment failure inside the worker, or a request that
 * never answers (worker process killed, e.g. parseBlob OOM on a hostile
 * file) — fails over to the main thread. Extraction must never break, and
 * never HANG, because the worker did.
 */

const POOL_SIZE = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 3) - 1));
const REQUEST_TIMEOUT_MS = 30_000;

interface PendingEntry {
  resolve: (meta: ExtractedMeta | null) => void;
  file: File;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let workerBroken = import.meta.env.MODE === 'test';
let nextId = 0;
let consecutiveTimeouts = 0;
const pending = new Map<number, PendingEntry>();

/** Give up on the worker for this session; re-run everything in flight on
 *  the main thread. Pool slots stay held by their original extractMeta
 *  awaits, so this cannot double-release or starve the pool. */
function failOverAll(): void {
  workerBroken = true;
  const entries = [...pending.values()];
  pending.clear();
  worker?.terminate();
  worker = null;
  for (const entry of entries) {
    clearTimeout(entry.timer);
    void mainThreadExtract(entry.file).then(entry.resolve);
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/metadata.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<MetadataResponse>) => {
      if (!e.data.ok && e.data.workerEnv) {
        // The worker itself is broken (its music-metadata import failed) —
        // not the file. The request is still in `pending`, so failOverAll
        // re-runs it (and everything else in flight) on the main thread.
        failOverAll();
        return;
      }
      const entry = pending.get(e.data.id);
      if (!entry) return; // late message after timeout/failover — ignore
      consecutiveTimeouts = 0; // the worker is alive after all
      pending.delete(e.data.id);
      clearTimeout(entry.timer);
      entry.resolve(e.data.ok ? e.data.meta : null);
    };
    worker.onerror = failOverAll;
    worker.onmessageerror = failOverAll;
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
    // Per-request timeout: a killed worker process fires NEITHER onmessage
    // nor onerror — without this, the pending promise never settles, the
    // pool slot leaks, and after POOL_SIZE leaks ingest hangs forever.
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      void mainThreadExtract(file).then(resolve);
      // A worker that times out repeatedly with no error event is dead —
      // don't make every remaining file eat the full timeout serially.
      if (++consecutiveTimeouts >= 2) failOverAll();
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, file, timer });
    const request: MetadataRequest = { id, file };
    w.postMessage(request);
  });
}

// ---------------------------------------------------------------------------
// Concurrency pool: bulk ingest maps ALL files through extractMeta at once;
// the pool keeps at most POOL_SIZE requests in flight. (With the single
// worker this pipelines rather than parallelizes the parses — the win is
// getting them OFF the main thread; N workers is future headroom.)
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
