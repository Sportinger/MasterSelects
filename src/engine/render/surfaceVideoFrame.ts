import type { Layer, LayerRenderData } from '../core/types';
import type { TextureManager } from '../texture/TextureManager';
import { renderHostPort } from '../../services/render/renderHostPort';

interface PresentedSurfaceFrame {
  video: WeakRef<HTMLVideoElement>;
  source: string;
  frame: VideoFrame | null;
  callback: number;
  lastUsed: number;
  expiry: ReturnType<typeof setTimeout>;
}

// Runtime-only ownership. Capture pixels and presentation time in the same
// callback; currentTime is a seek/playback clock, not the displayed frame PTS.
const frames: WeakMap<HTMLVideoElement, PresentedSurfaceFrame> = import.meta.hot?.data?.surfaceFramesV2 ?? new WeakMap();
const clocks: WeakMap<HTMLVideoElement, { source: string; currentTime: number; mediaTime: number }> = import.meta.hot?.data?.surfaceClocks ?? new WeakMap();
const cleanup: FinalizationRegistry<PresentedSurfaceFrame> = import.meta.hot?.data?.surfaceCleanup ?? new FinalizationRegistry(release);
if (import.meta.hot) import.meta.hot.dispose(data => { data.surfaceFramesV2 = frames; data.surfaceClocks = clocks; data.surfaceCleanup = cleanup; });

/** Only call from requestVideoFrameCallback, never from seeked/currentTime. */
export function recordSurfaceVideoFrameTime(video: HTMLVideoElement, mediaTime: number): void {
  if (Number.isFinite(mediaTime)) clocks.set(video, { source: video.currentSrc, currentTime: video.currentTime, mediaTime });
}

export function getSurfaceVideoFrameTime(video: HTMLVideoElement): number | undefined {
  const clock = clocks.get(video);
  return clock && !video.seeking && clock.source === video.currentSrc && clock.currentTime === video.currentTime
    ? clock.mediaTime : undefined;
}

function release(entry: PresentedSurfaceFrame): void {
  const video = entry.video.deref();
  video?.cancelVideoFrameCallback(entry.callback);
  clearTimeout(entry.expiry);
  entry.frame?.close();
  entry.frame = null;
  if (video) frames.delete(video);
  cleanup.unregister(entry);
}

function arm(entry: PresentedSurfaceFrame): void {
  const video = entry.video.deref();
  if (!video) { release(entry); return; }
  entry.callback = video.requestVideoFrameCallback(presented.bind(null, entry));
}

function presented(entry: PresentedSurfaceFrame, _now: number, metadata: VideoFrameCallbackMetadata): void {
  const video = entry.video.deref();
  if (!video || entry.source !== video.currentSrc) { release(entry); return; }
  if (Number.isFinite(metadata.mediaTime)) {
    recordSurfaceVideoFrameTime(video, metadata.mediaTime);
    try {
      const next = new VideoFrame(video, { timestamp: Math.round(metadata.mediaTime * 1_000_000) });
      entry.frame?.close(); entry.frame = next;
      renderHostPort.requestNewFrameRender();
    } catch { /* Preserve the previous identified frame during decoder recovery. */ }
  }
  arm(entry);
}

function idle(entry: PresentedSurfaceFrame): void {
  if (performance.now() - entry.lastUsed > 2000) {
    entry.video.deref()?.cancelVideoFrameCallback(entry.callback);
    entry.callback = 0;
    // Keep the paused picture. The weak owner allows the media runtime to
    // release the element; its finalizer closes the retained frame too.
  } else entry.expiry = setTimeout(idle, 2000, entry);
}

function watch(video: HTMLVideoElement): PresentedSurfaceFrame | null {
  if (typeof video.requestVideoFrameCallback !== 'function' || typeof VideoFrame === 'undefined') return null;
  let entry = frames.get(video);
  if (entry && entry.source !== video.currentSrc) { release(entry); entry = undefined; }
  if (!entry) {
    const owned: PresentedSurfaceFrame = {
      video: new WeakRef(video), source: video.currentSrc, frame: null, callback: 0,
      lastUsed: performance.now(), expiry: 0 as unknown as ReturnType<typeof setTimeout>,
    };
    const clock = clocks.get(video);
    if (clock && video.paused && !video.seeking && clock.source === video.currentSrc && clock.currentTime === video.currentTime) {
      try { owned.frame = new VideoFrame(video, { timestamp: Math.round(clock.mediaTime * 1_000_000) }); } catch { /* Await a fresh presentation. */ }
    }
    cleanup.register(video, owned, owned);
    frames.set(video, owned); entry = owned;
  }
  entry.lastUsed = performance.now();
  if (!entry.callback) { arm(entry); entry.expiry = setTimeout(idle, 2000, entry); }
  return entry;
}

/** undefined = ordinary clip; null = tracked clip awaiting its first identified frame. */
export function collectSurfaceVideoFrame(layer: Layer, video: HTMLVideoElement, textures: TextureManager): LayerRenderData | null | undefined {
  if (!layer.effects.some(effect => effect.surfaceTrack)) {
    const entry = frames.get(video); if (entry) release(entry);
    return undefined;
  }
  const frame = watch(video)?.frame;
  if (!frame) return null;
  const externalTexture = textures.importVideoTexture(frame);
  if (!externalTexture) return null;
  return {
    layer, isVideo: true, externalTexture, textureView: null,
    sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
    displayedMediaTime: frame.timestamp / 1_000_000,
    targetMediaTime: layer.source?.mediaTime,
    previewPath: 'surface-presented-frame',
  };
}
