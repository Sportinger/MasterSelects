import { openSurfaceFrames } from '../../services/planarTracking/surfaceFrameReader';
import { PreparedFrameCache } from './PreparedFrameCache';

export interface PreparedSourceOptions {
  url: string;
  file?: Blob;
  maxEdge: number;
  /** CPU pixel reservation only; GPU atlas and decoder working memory are separate. */
  budgetBytes: number;
  signal: AbortSignal;
}

/** Independent decoder lifetime. Source/revision changes must close this owner and reopen. */
export async function openPreparedFrameCache(options: PreparedSourceOptions): Promise<PreparedFrameCache> {
  const { signal, maxEdge, budgetBytes } = options;
  signal.throwIfAborted();
  const maxFrameBytes = maxEdge * maxEdge * 4;
  if (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > 4096
    || !Number.isSafeInteger(budgetBytes) || budgetBytes < maxFrameBytes) {
    throw new Error('Prepared source resolution exceeds its pixel memory budget.');
  }
  const reader = await openSurfaceFrames(options.url, signal, options.file, maxEdge);
  let cache: PreparedFrameCache | undefined;
  const onAbort = () => cache?.close();
  try {
    signal.throwIfAborted();
    cache = new PreparedFrameCache({ frames: reader.frames, read: time => reader.read(time),
      close: () => { signal.removeEventListener('abort', onAbort); reader.close(); },
    }, budgetBytes, maxFrameBytes);
    signal.addEventListener('abort', onAbort, { once: true });
    return cache;
  } catch (error) { reader.close(); throw error; }
}
