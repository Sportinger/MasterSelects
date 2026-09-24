import { BufferTarget, CanvasSource, Mp4OutputFormat, WebMOutputFormat, Output, canEncodeVideo } from 'mediabunny';
import type { RotoMask } from './rotoTypes';
import { DEFAULT_ROTO_EDGES, refineRotoEdges, type RotoEdges } from './rotoEdges';

export function orderedRotoMasks(masks: RotoMask[]) {
  const frames = masks.toSorted((a, b) => a.time - b.time);
  if (!frames.length) throw new Error('Track a range before exporting a mask video.');
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!Number.isFinite(f.time + f.duration) || f.duration <= 0 || f.data.length !== f.width * f.height) throw new Error('Invalid mask frame.');
    if (i && Math.abs(f.time - frames[i - 1].time - frames[i - 1].duration) > .002) throw new Error('Tracked frames contain a gap. Track the missing interval before export.');
  }
  return frames;
}
/** Preserve each source presentation timestamp and duration, including variable frame rates. */
export async function encodeRotoMaskVideo(masks: RotoMask[], signal: AbortSignal, progress: (value: number, message: string) => void,
  readSource?: (time: number) => Promise<{ pixels: ImageData }>, edges: RotoEdges = DEFAULT_ROTO_EDGES) {
  const frames = orderedRotoMasks(masks);
  const codec = readSource ? 'vp9' : 'avc';
  if (!await canEncodeVideo(codec)) throw new Error(`${codec} export is unavailable in this browser.`);
  const canvas = document.createElement('canvas'), map = document.createElement('canvas');
  canvas.width = Math.ceil(frames[0].width / 2) * 2; canvas.height = Math.ceil(frames[0].height / 2) * 2;
  const ctx = canvas.getContext('2d')!, mapCtx = map.getContext('2d')!;
  const target = new BufferTarget(), output = new Output({ target, format: readSource ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }) });
  const video = new CanvasSource(canvas, { codec, alpha: readSource ? 'keep' : 'discard', bitrate: 8_000_000, keyFrameInterval: 1 });
  output.addVideoTrack(video); let finished = false;
  try {
    await output.start();
    for (let i = 0; i < frames.length; i++) {
      signal.throwIfAborted();
      const f = frames[i]; map.width = f.width; map.height = f.height;
      const alpha = refineRotoEdges(f, edges);
      const pixels = readSource ? (await readSource(f.time)).pixels : mapCtx.createImageData(f.width, f.height);
      if (pixels.width !== f.width || pixels.height !== f.height) throw new Error('Source dimensions changed after tracking.');
      for (let j = 0; j < f.data.length; j++) {
        if (readSource) pixels.data[4 * j + 3] = alpha[j];
        else { pixels.data[4 * j] = pixels.data[4 * j + 1] = pixels.data[4 * j + 2] = alpha[j]; pixels.data[4 * j + 3] = 255; }
      }
      mapCtx.putImageData(pixels, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(map, 0, 0, canvas.width, canvas.height);
      await video.add(f.time - frames[0].time, f.duration);
      progress((i + 1) / frames.length, `Encoding mask ${i + 1} / ${frames.length}`);
    }
    signal.throwIfAborted(); await output.finalize(); finished = true;
    if (!target.buffer?.byteLength) throw new Error('Mask encoder returned an empty video.');
    return new Blob([target.buffer], { type: readSource ? 'video/webm' : 'video/mp4' });
  } finally { if (!finished) await output.cancel().catch(() => {}); }
}
