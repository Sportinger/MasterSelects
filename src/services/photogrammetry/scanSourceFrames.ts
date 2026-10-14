import { sourceFrameService } from '../mediaRuntime/sourceFrames/SourceFrameService';
import { planVideoSampleTimes, type SampledScanVideoFrame, type ScanVideoSampleOptions } from './videoFrameSampler';

// Identity belongs to the live File, not durable media/project state. Concurrent
// consumers of this file can share the source index and background decoder.
const sourceIds = new WeakMap<File, string>();

async function waitForSource<T>(ready: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return ready;
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([ready, new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Bounded CPU adapter: copy a borrowed frame synchronously, then encode one
 * JPEG before requesting the next frame. Never retain decoder-owned surfaces. */
export async function sampleScanSourceFrames(
  file: File,
  options: ScanVideoSampleOptions,
): Promise<SampledScanVideoFrame[]> {
  options.signal?.throwIfAborted();
  let id = sourceIds.get(file);
  if (!id) { id = `scan-video:${crypto.randomUUID()}`; sourceIds.set(file, id); }
  const lease = sourceFrameService.acquire({ id, file, url: '' });
  try {
    const reader = await waitForSource(lease.ready, options.signal);
    const last = reader.frames.at(-1);
    const duration = last ? last.time + last.duration : 0;
    const times = planVideoSampleTimes(duration, options.frameCount, options.startTime, options.endTime, options.frameRate);
    if (!times.length) throw new Error('This video does not report a usable duration.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas frame extraction is unavailable.');
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'video';
    const frames: SampledScanVideoFrame[] = [];
    for (const time of times) {
      options.signal?.throwIfAborted();
      let sourceTime: number | undefined;
      await lease.request({ times: [time], priority: 'required', signal: options.signal, onFrame(surface) {
        if (!('frame' in surface)) throw new Error('Scan extraction requires an original video frame.');
        const { width, height } = surface;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error('The source decoder did not provide a usable frame size.');
        }
        const rotation = ((surface.rotation % 360) + 360) % 360;
        if (![0, 90, 180, 270].includes(rotation)) throw new Error('Unsupported scan video rotation.');
        const scale = options.maxResolution === null ? 1 : Math.min(1, options.maxResolution / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const sideways = rotation === 90 || rotation === 270;
        const drawWidth = sideways ? canvas.height : canvas.width;
        const drawHeight = sideways ? canvas.width : canvas.height;
        context.save();
        try {
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate(rotation * Math.PI / 180);
          context.drawImage(surface.frame, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        } finally { context.restore(); }
        sourceTime = surface.time;
      } });
      options.signal?.throwIfAborted();
      if (sourceTime === undefined) throw new Error('The source decoder did not return the requested scan frame.');
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('The browser could not encode a sampled video frame.')),
        'image/jpeg', options.jpegQuality ?? 0.9,
      ));
      options.signal?.throwIfAborted();
      const index = frames.length;
      frames.push({ file: new File([blob], `${baseName}-frame-${String(index + 1).padStart(3, '0')}.jpg`,
        { type: 'image/jpeg', lastModified: file.lastModified + index + 1 }), sourceTime });
      await options.onFrame?.(frames[frames.length - 1]);
      options.signal?.throwIfAborted();
      options.onProgress?.(frames.length, times.length);
    }
    return frames;
  } finally { lease.release(); }
}
