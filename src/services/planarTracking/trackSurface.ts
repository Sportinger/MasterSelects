import type { PlanarTrack, SurfaceQuad, SurfaceSample } from '../../types/planarTracking';
import { sampleOcclusion, validQuad } from './surfaceGeometry';
import { openSurfaceFrames, surfaceFrameIndex } from './surfaceFrameReader';

interface TrackingStep { quad?: SurfaceQuad; confidence?: number; lost?: boolean; reason?: string }
export interface TrackSurfaceRequest {
  url: string;
  file?: Blob;
  track: PlanarTrack;
  from: number;
  to: number;
  quad: SurfaceQuad;
  signal: AbortSignal;
  onProgress: (progress: number, sample: SurfaceSample) => void;
}

export async function trackSurface(request: TrackSurfaceRequest): Promise<{ samples: SurfaceSample[]; stopped?: string }> {
  if (!validQuad(request.quad)) throw new Error('Select a convex, non-crossing surface first.');
  const reader = await openSurfaceFrames(request.url, request.signal, request.file);
  let worker: Worker | undefined;
  let rejectPending: ((reason: Error) => void) | undefined;
  const abort = () => { worker?.terminate(); rejectPending?.(new DOMException('Tracking cancelled', 'AbortError')); };
  request.signal.addEventListener('abort', abort);
  try {
    request.signal.throwIfAborted();
    worker = new Worker('/workers/planar-tracking.worker.js');
    let id = 0;
    const step = (pixels: ImageData, time: number, previousTime: number, reset: boolean) => new Promise<TrackingStep>((resolve, reject) => {
      request.signal.throwIfAborted();
      const timer = setTimeout(() => { rejectPending = undefined; reject(new Error('Surface tracker timed out.')); }, 30_000);
      rejectPending = reason => { clearTimeout(timer); rejectPending = undefined; reject(reason); };
      worker!.onerror = event => { clearTimeout(timer); rejectPending = undefined; reject(new Error(event.message)); };
      worker!.onmessage = ({ data }) => {
        clearTimeout(timer); rejectPending = undefined;
        if (data.error) reject(new Error(data.error)); else resolve(data.data);
      };
      worker!.postMessage({ id: ++id, pixels: pixels.data.buffer, width: pixels.width, height: pixels.height,
        reset, quad: request.quad, exclusion: sampleOcclusion(request.track, time),
        previousExclusion: sampleOcclusion(request.track, previousTime),
      }, [pixels.data.buffer]);
    });
    const first = Math.max(0, surfaceFrameIndex(reader.frames, request.from)), last = Math.max(0, surfaceFrameIndex(reader.frames, request.to));
    const requestedCount = Math.abs(last - first) + 1;
    const count = Math.min(requestedCount, 1800);
    const samples: SurfaceSample[] = [];
    let stopped: string | undefined;
    let i = 0, previousTime = request.from;
    for await (const frame of reader.readRange(request.from, request.to)) {
      request.signal.throwIfAborted();
      const { time, duration, pixels } = frame;
      const result = await step(pixels, time, previousTime, i === 0);
      if (result.lost || !result.quad || !validQuad(result.quad)) { stopped = `${time.toFixed(3)}s: ${result.reason ?? 'Invalid surface'}`; break; }
      const sample = { time, duration, quad: result.quad, confidence: result.confidence ?? 1, ...(i === 0 ? { manual: true } : {}) };
      samples.push(sample); request.onProgress((i + 1) / count, sample);
      previousTime = time; i++;
    }
    if (!stopped && requestedCount > count) stopped = `Pass complete at ${samples.at(-1)!.time.toFixed(3)}s. Continue from that frame.`;
    return { samples: samples.toSorted((a, b) => a.time - b.time), stopped };
  } finally {
    request.signal.removeEventListener('abort', abort); worker?.terminate(); reader.close();
  }
}
