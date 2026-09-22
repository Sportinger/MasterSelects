import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, UrlSource, VideoSampleSink } from 'mediabunny';
import type { VideoSample } from 'mediabunny';

export interface SurfaceFrameStamp { time: number; duration: number }
export interface SurfaceDecodedFrame extends SurfaceFrameStamp { pixels: ImageData }
/** Borrowed until the next iterator step; never save in a store or close the source. */
export interface SurfaceGpuFrame extends SurfaceFrameStamp { source: VideoFrame | HTMLCanvasElement; width: number; height: number }

/** Last presented frame, never the next frame or an interpolated pose. */
export function surfaceFrameIndex(frames: readonly SurfaceFrameStamp[], time: number): number {
  let lo = 0, hi = frames.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (frames[mid].time <= time + 0.6e-6) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

/** Independent WebCodecs decoder; source PTS and pixels are acquired together. */
export async function openSurfaceFrames(url: string, signal: AbortSignal, file?: Blob, maxEdge = 1280) {
  if (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > 16384) throw new Error('Invalid source frame resolution.');
  signal.throwIfAborted();
  const input = new Input({ formats: ALL_FORMATS, source: file?.size
    ? new BlobSource(file, { maxCacheSize: 16 * 1024 * 1024 }) : new UrlSource(url) });
  let closed = false;
  const close = () => { if (!closed) { closed = true; input.dispose(); } signal.removeEventListener('abort', close); };
  signal.addEventListener('abort', close, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    signal.throwIfAborted();
    if (!track || !await track.canDecode()) throw new Error('This source cannot be decoded for frame-synchronized tracking.');
    const packets = new EncodedPacketSink(track);
    const stamps: SurfaceFrameStamp[] = [];
    for await (const packet of packets.packets(undefined, undefined, { metadataOnly: true })) {
      signal.throwIfAborted();
      if (Number.isFinite(packet.timestamp) && packet.timestamp + packet.duration > 0) stamps.push({ time: packet.timestamp, duration: packet.duration });
      if (stamps.length > 300_000) throw new Error('This source has too many frames for surface tracking. Use a shorter source.');
    }
    const frames = stamps.toSorted((a, b) => a.time - b.time).filter((stamp, i, all) => i === 0 || stamp.time > all[i - 1].time);
    if (!frames.length) throw new Error('The source has no timestamped video frames.');
    const sink = new VideoSampleSink(track);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create tracking canvas.');
    let gpuCanvas: HTMLCanvasElement | undefined;
    const capture = (sample: VideoSample): SurfaceDecodedFrame => {
      try {
        signal.throwIfAborted();
        const scale = Math.min(1, maxEdge / Math.max(sample.displayWidth, sample.displayHeight));
        const width = Math.max(1, Math.round(sample.displayWidth * scale)), height = Math.max(1, Math.round(sample.displayHeight * scale));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        sample.draw(context, 0, 0, width, height);
        return { time: sample.timestamp, duration: sample.duration, pixels: context.getImageData(0, 0, width, height) };
      } finally { sample.close(); }
    };
    return {
      frames,
      rotation: track.rotation,
      close,
      /** Keep decoded surfaces on the GPU. Resize/rotation also stays on a GPU canvas. */
      async *readGpuTimes(times: readonly number[]): AsyncGenerator<SurfaceGpuFrame> {
        const timestamps = times.map(time => frames[Math.max(0, surfaceFrameIndex(frames, time))].time + 0.6e-6);
        for await (const sample of sink.samplesAtTimestamps(timestamps)) {
          if (!sample) throw new Error('A requested source frame could not be decoded.');
          let frame: VideoFrame | undefined;
          try {
            signal.throwIfAborted();
            const scale = Math.min(1, maxEdge / Math.max(sample.displayWidth, sample.displayHeight));
            const width = Math.max(1, Math.round(sample.displayWidth * scale));
            const height = Math.max(1, Math.round(sample.displayHeight * scale));
            if (scale === 1 && sample.rotation === 0) {
              frame = sample.toVideoFrame();
              yield { time: sample.timestamp, duration: sample.duration, source: frame, width, height };
            } else {
              gpuCanvas ??= document.createElement('canvas');
              if (gpuCanvas.width !== width || gpuCanvas.height !== height) { gpuCanvas.width = width; gpuCanvas.height = height; }
              const gpuContext = gpuCanvas.getContext('2d');
              if (!gpuContext) throw new Error('Could not create GPU transfer canvas.');
              sample.draw(gpuContext, 0, 0, width, height);
              yield { time: sample.timestamp, duration: sample.duration, source: gpuCanvas, width, height };
            }
          } finally { frame?.close(); sample.close(); }
        }
      },
      async read(time: number): Promise<SurfaceDecodedFrame> {
        const stamp = frames[Math.max(0, surfaceFrameIndex(frames, time))];
        const sample = await sink.getSample(stamp.time + 0.6e-6);
        if (!sample) throw new Error('The selected video frame could not be decoded.');
        return capture(sample);
      },
      /** One decoder run for an ordered batch, rather than one GOP seek per sample. */
      async *readTimes(times: readonly number[]): AsyncGenerator<SurfaceDecodedFrame> {
        const timestamps = times.map(time => frames[Math.max(0, surfaceFrameIndex(frames, time))].time + 0.6e-6);
        for await (const sample of sink.samplesAtTimestamps(timestamps)) {
          signal.throwIfAborted();
          if (!sample) throw new Error('A requested source frame could not be decoded.');
          yield capture(sample);
        }
      },
      async *readRange(from: number, to: number, limit = 1800): AsyncGenerator<SurfaceDecodedFrame> {
        const first = Math.max(0, surfaceFrameIndex(frames, from));
        const last = Math.max(0, surfaceFrameIndex(frames, to));
        const direction = last >= first ? 1 : -1;
        const count = Math.min(limit, Math.abs(last - first) + 1);
        const timestamps = Array.from({ length: count }, (_, i) => frames[first + direction * i].time + 0.6e-6);
        for await (const sample of sink.samplesAtTimestamps(timestamps)) {
          if (!sample) throw new Error('A source frame could not be decoded; the previous track is kept.');
          yield capture(sample);
        }
      },
    };
  } catch (error) { close(); throw error; }
}

export type SurfaceFrameReader = Awaited<ReturnType<typeof openSurfaceFrames>>;
