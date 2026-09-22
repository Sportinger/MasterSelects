import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, UrlSource, VideoSampleSink } from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { surfaceFrameIndex, type SurfaceFrameStamp } from '../../planarTracking/surfaceFrameReader';

export interface SourceFrameAsset { id: string; url: string; file?: File }
/** Borrowed only for the synchronous frame callback. */
export interface SourceFrameSurface extends SurfaceFrameStamp {
  frame: VideoFrame; rotation: number; width: number; height: number;
}

/** Independent background session. Keeps its decoder cursor across nearby forward
 * requests; seeking it never moves the editor's playback decoder. No canvas/pixels. */
export async function openSourceFrameReader(asset: SourceFrameAsset, signal: AbortSignal) {
  const input = new Input({ formats: ALL_FORMATS, source: asset.file?.size
    ? new BlobSource(asset.file, { maxCacheSize: 16 * 1024 * 1024 }) : new UrlSource(asset.url) });
  let cursor: AsyncIterableIterator<VideoSample> | undefined;
  let lastTime = -Infinity;
  let closed = false;
  const stop = async () => {
    const previous = cursor; cursor = undefined; lastTime = -Infinity;
    await previous?.return?.();
  };
  const close = () => {
    if (closed) return;
    closed = true; void stop().catch(() => undefined); input.dispose();
    signal.removeEventListener('abort', close);
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error('Source video cannot be decoded.');
    const packets = new EncodedPacketSink(track);
    const stamps: SurfaceFrameStamp[] = [];
    for await (const packet of packets.packets(undefined, undefined, { metadataOnly: true })) {
      signal.throwIfAborted();
      if (Number.isFinite(packet.timestamp) && packet.duration > 0 && packet.timestamp + packet.duration > 0) {
        stamps.push({ time: packet.timestamp, duration: packet.duration });
      }
      if (stamps.length > 300_000) throw new Error('Source has too many frames for indexed temporal access.');
    }
    const frames = stamps.toSorted((a, b) => a.time - b.time).filter((s, i, all) => i === 0 || s.time > all[i - 1].time);
    if (!frames.length) throw new Error('Source has no timestamped video frames.');
    const sink = new VideoSampleSink(track);
    return {
      frames, rotation: track.rotation, width: track.displayWidth, height: track.displayHeight, close, idle: stop,
      async *read(times: readonly number[]): AsyncGenerator<SourceFrameSurface> {
        for (const time of times) {
          signal.throwIfAborted();
          const target = frames[Math.max(0, surfaceFrameIndex(frames, time))].time;
          // A distant seek must not decode everything between the two windows.
          if (!cursor || target <= lastTime + 0.6e-6 || target - lastTime > 1) {
            await stop(); cursor = sink.samples(target - 0.6e-6);
          }
          while (cursor) {
            const next = await cursor.next();
            if (next.done) throw new Error(`No decoded source frame at ${target}.`);
            const sample = next.value;
            let frame: VideoFrame | undefined;
            try {
              signal.throwIfAborted();
              lastTime = sample.timestamp;
              if (sample.timestamp < target - 0.6e-6) continue;
              if (Math.abs(sample.timestamp - target) > 1e-6) throw new Error('Decoder skipped the requested source PTS.');
              frame = sample.toVideoFrame();
              yield { frame, time: target, duration: sample.duration,
                rotation: sample.rotation, width: sample.displayWidth, height: sample.displayHeight };
              break;
            } finally { frame?.close(); sample.close(); }
          }
        }
      },
    };
  } catch (error) { close(); throw error; }
}
export type SourceFrameReader = Awaited<ReturnType<typeof openSourceFrameReader>>;
