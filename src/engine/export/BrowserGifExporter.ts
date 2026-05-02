import { GIFEncoder, applyPalette, quantize, type GifPalette } from 'gifenc';
import {
  clampGifAlphaThreshold,
  clampGifColors,
  type GifExportOptions,
  type GifPaletteMode,
} from '../gif/gifOptions';

export interface BrowserGifExportSettings extends Required<GifExportOptions> {
  width: number;
  height: number;
  fps: number;
}

export interface BrowserGifEncodeProgress {
  phase: 'palette' | 'frames';
  frame: number;
  totalFrames: number;
  percent: number;
}

export function createDefaultBrowserGifSettings(
  settings: Partial<BrowserGifExportSettings> & Pick<BrowserGifExportSettings, 'width' | 'height' | 'fps'>,
): BrowserGifExportSettings {
  return {
    width: Math.max(1, Math.round(settings.width)),
    height: Math.max(1, Math.round(settings.height)),
    fps: Math.max(1, settings.fps),
    gifColors: clampGifColors(settings.gifColors),
    gifDither: settings.gifDither ?? 'sierra2_4a',
    gifLoop: settings.gifLoop ?? 'forever',
    gifPaletteMode: settings.gifPaletteMode ?? 'global',
    gifOptimize: settings.gifOptimize ?? true,
    gifAlphaThreshold: clampGifAlphaThreshold(settings.gifAlphaThreshold),
  };
}

export function encodeBrowserGif(
  frames: Uint8Array[],
  settingsInput: BrowserGifExportSettings,
  onProgress?: (progress: BrowserGifEncodeProgress) => void,
): Blob {
  if (frames.length === 0) {
    throw new Error('No frames rendered');
  }

  const settings = createDefaultBrowserGifSettings(settingsInput);
  const gif = GIFEncoder({
    initialCapacity: estimateInitialCapacity(frames.length, settings.width, settings.height),
  });
  const delay = Math.max(2, Math.round(1000 / settings.fps));
  const repeat = settings.gifLoop === 'once' ? -1 : 0;
  const format = 'rgba4444';
  const alphaThreshold = settings.gifAlphaThreshold;
  const globalPalette = settings.gifPaletteMode === 'global'
    ? createGlobalPalette(frames, settings, (percent) => {
        onProgress?.({
          phase: 'palette',
          frame: 0,
          totalFrames: frames.length,
          percent,
        });
      })
    : null;

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const palette = globalPalette ?? createFramePalette(frame, settings.gifColors, alphaThreshold);
    const indexedFrame = applyPalette(frame, palette, format);
    const transparentIndex = findTransparentIndex(palette);
    gif.writeFrame(indexedFrame, settings.width, settings.height, {
      palette: index === 0 || settings.gifPaletteMode === 'per-frame' ? palette : undefined,
      delay,
      repeat: index === 0 ? repeat : undefined,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : undefined,
    });

    onProgress?.({
      phase: 'frames',
      frame: index + 1,
      totalFrames: frames.length,
      percent: ((index + 1) / frames.length) * 100,
    });
  }

  gif.finish();
  const bytes = gif.bytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'image/gif' });
}

function createFramePalette(frame: Uint8Array, colors: number, alphaThreshold: number): GifPalette {
  return quantize(frame, colors, {
    format: 'rgba4444',
    oneBitAlpha: alphaThreshold,
    clearAlpha: true,
    clearAlphaThreshold: alphaThreshold,
    clearAlphaColor: 0x00,
  });
}

function createGlobalPalette(
  frames: Uint8Array[],
  settings: BrowserGifExportSettings,
  onProgress?: (percent: number) => void,
): GifPalette {
  const sample = sampleFrames(frames, settings.width, settings.height);
  onProgress?.(50);
  const palette = createFramePalette(sample, settings.gifColors, settings.gifAlphaThreshold);
  onProgress?.(100);
  return palette;
}

function sampleFrames(frames: Uint8Array[], width: number, height: number): Uint8Array {
  const maxSamplePixels = 240_000;
  const framePixelCount = width * height;
  const frameStride = Math.max(1, Math.floor(frames.length / 12));
  const sampledFrameCount = Math.ceil(frames.length / frameStride);
  const pixelStride = Math.max(1, Math.ceil((framePixelCount * sampledFrameCount) / maxSamplePixels));
  const samplesPerFrame = Math.ceil(framePixelCount / pixelStride);
  const output = new Uint8Array(samplesPerFrame * sampledFrameCount * 4);
  let outputOffset = 0;

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += frameStride) {
    const frame = frames[frameIndex];
    for (let pixelIndex = 0; pixelIndex < framePixelCount; pixelIndex += pixelStride) {
      const sourceOffset = pixelIndex * 4;
      output[outputOffset++] = frame[sourceOffset];
      output[outputOffset++] = frame[sourceOffset + 1];
      output[outputOffset++] = frame[sourceOffset + 2];
      output[outputOffset++] = frame[sourceOffset + 3];
    }
  }

  return outputOffset === output.length ? output : output.slice(0, outputOffset);
}

function findTransparentIndex(palette: GifPalette): number {
  return palette.findIndex((color) => color.length >= 4 && (color[3] ?? 255) < 128);
}

function estimateInitialCapacity(frameCount: number, width: number, height: number): number {
  const estimated = width * height * Math.max(1, frameCount) * 0.45;
  return Math.max(4096, Math.min(512 * 1024 * 1024, Math.round(estimated)));
}

export function isBrowserGifPaletteMode(value: string): value is GifPaletteMode {
  return value === 'global' || value === 'per-frame';
}
