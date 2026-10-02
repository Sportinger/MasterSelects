import type { RawPhotoMetadata } from './rawPhotoMetadata';

export function isRawImageFile(file: File | string): boolean {
  return /\.cr2$/i.test(typeof file === 'string' ? file : file.name);
}

interface DecodeState {
  pending: WeakMap<File, Promise<Blob>>;
  cache: Map<File, Blob>;
  bytes: number;
  queue: Promise<unknown>;
  metadata: WeakMap<File, RawPhotoMetadata>;
}
const state: DecodeState = import.meta.hot?.data?.rawImageDecodeState ?? {
  pending: new WeakMap(), cache: new Map(), bytes: 0, queue: Promise.resolve(), metadata: new WeakMap(),
};
state.metadata ??= new WeakMap();
if (import.meta.hot) import.meta.hot.dispose(data => { data.rawImageDecodeState = state; });
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

export async function getRawPhotoMetadata(file: File): Promise<RawPhotoMetadata | undefined> {
  if (!isRawImageFile(file)) return undefined;
  if (!state.metadata.has(file)) {
    // A display blob created before decoder HMR can lack EXIF metadata.
    const cached = state.cache.get(file);
    if (cached) { state.bytes -= cached.size; state.cache.delete(file); }
    await getRenderableImageBlob(file);
  }
  return state.metadata.get(file);
}

/** Original Files remain the source of truth; only runtime display blobs are decoded. */
export function getRenderableImageBlob(file: File): Promise<Blob> {
  if (!isRawImageFile(file)) return Promise.resolve(file);
  const cached = state.cache.get(file);
  if (cached) {
    state.cache.delete(file); state.cache.set(file, cached);
    return Promise.resolve(cached);
  }
  const pending = state.pending.get(file);
  if (pending) return pending;
  const job = state.queue.then(() => decode(file)).then(blob => {
    while (state.bytes + blob.size > MAX_CACHE_BYTES && state.cache.size) {
      const oldest = state.cache.keys().next().value!;
      state.bytes -= state.cache.get(oldest)!.size;
      state.cache.delete(oldest);
    }
    if (blob.size <= MAX_CACHE_BYTES) { state.cache.set(file, blob); state.bytes += blob.size; }
    return blob;
  }).finally(() => state.pending.delete(file));
  state.pending.set(file, job);
  state.queue = job.catch(() => undefined);
  return job;
}

async function decode(file: File): Promise<Blob> {
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('../../workers/rawImageWorker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`RAW decoding timed out: ${file.name}`)), 120_000);
      worker.onmessage = (event: MessageEvent<{ png?: ArrayBuffer; error?: string; metadata?: RawPhotoMetadata }>) => {
        clearTimeout(timer);
        if (event.data.png && event.data.metadata) state.metadata.set(file, event.data.metadata);
        if (event.data.png) resolve(new Blob([event.data.png], { type: 'image/png' }));
        else reject(new Error(`Cannot decode ${file.name}: ${event.data.error ?? 'missing pixels'}`));
      };
      worker.onerror = event => { clearTimeout(timer); reject(new Error(`RAW decoder failed: ${event.message}`)); };
      worker.postMessage(buffer, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
