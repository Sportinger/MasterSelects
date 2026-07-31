import type {
  ExportRenderFrameDecorator,
  ExportRenderSessionFrameCapture,
} from '../../../engine/export/ExportRenderSessionImpl';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { getStoryboardProjectSnapshot } from '../../../stores/storyboardStore';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { resolveStoryboardCandidateAwareAnimaticFramePayload } from '../animaticCandidates/frameAdapter';
import { renderStoryboardAnimaticExportFrame } from './exportAdapter';
import type { StoryboardAnimaticCameraMove } from './types';

interface RenderSurface {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createRenderSurface(width: number, height: number): RenderSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Animatic export could not create a 2D render surface.');
    return { canvas, context };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Animatic export could not create a 2D render surface.');
  return { canvas, context };
}

function loadImage(url: string, cache: Map<string, Promise<HTMLImageElement>>): Promise<HTMLImageElement> {
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Animatic still image could not be loaded: ${url}`));
    image.src = url;
  });
  cache.set(url, pending);
  return pending;
}

async function decorateCapture(
  capture: ExportRenderSessionFrameCapture,
  paint: (surface: RenderSurface) => Promise<void>,
): Promise<ExportRenderSessionFrameCapture> {
  const surface = createRenderSurface(capture.width, capture.height);
  if (capture.kind === 'video-frame') {
    surface.context.drawImage(capture.frame, 0, 0, capture.width, capture.height);
  } else {
    surface.context.putImageData(
      new ImageData(new Uint8ClampedArray(capture.pixels), capture.width, capture.height),
      0,
      0,
    );
  }
  await paint(surface);

  if (capture.kind === 'video-frame') {
    const nextFrame = new VideoFrame(surface.canvas, {
      timestamp: capture.timestampMicros ?? capture.frame.timestamp,
      duration: capture.durationMicros ?? capture.frame.duration ?? undefined,
    });
    capture.frame.close();
    return { ...capture, frame: nextFrame };
  }

  return {
    ...capture,
    pixels: surface.context.getImageData(0, 0, capture.width, capture.height).data,
  };
}

export function createStoryboardAnimaticExportFrameDecorator(input: {
  readonly clips: readonly TimelineClip[];
  readonly tracks: readonly TimelineTrack[];
  readonly mediaFiles: readonly MediaFile[];
  readonly width: number;
  readonly height: number;
  readonly cameraMove?: StoryboardAnimaticCameraMove;
  readonly watermark?: string;
}): ExportRenderFrameDecorator {
  const imageCache = new Map<string, Promise<HTMLImageElement>>();
  const storyboardState = getStoryboardProjectSnapshot();

  return async (capture, frameInput) => {
    try {
      const payload = resolveStoryboardCandidateAwareAnimaticFramePayload({
        clips: input.clips,
        tracks: input.tracks,
        mediaFiles: input.mediaFiles,
        time: frameInput.time,
        width: input.width,
        height: input.height,
        mode: 'animatic-export',
        cameraMove: input.cameraMove,
        watermark: input.watermark,
        state: storyboardState,
      });
      if (!payload || payload.kind === 'real-media') return capture;

      const image = payload.kind === 'still-image' && payload.still
        ? await loadImage(payload.still.imageUrl, imageCache)
        : undefined;
      return decorateCapture(capture, async ({ context }) => {
        renderStoryboardAnimaticExportFrame(context, payload, image);
        if (capture.height > payload.height) {
          context.save();
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.fillStyle = '#ffffff';
          context.fillRect(0, payload.height, capture.width, capture.height - payload.height);
          context.restore();
        }
      });
    } catch (error) {
      if (capture.kind === 'video-frame') capture.frame.close();
      throw error;
    }
  };
}
