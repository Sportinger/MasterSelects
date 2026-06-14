import { GIFEncoder, applyPalette, quantize, type GifPalette } from 'gifenc';
import {
  clampGifAlphaThreshold,
  clampGifBayerScale,
  clampGifColors,
  estimateGifSize,
  formatByteSize,
  clampGifLoopCount,
  getGifRepeatCount,
  type GifExportOptions,
  type GifPaletteMode,
} from '../gif/gifOptions';

const BROWSER_GIF_MAX_RAW_FRAME_BYTES = 384 * 1024 * 1024;
const BROWSER_GIF_MAX_ESTIMATED_OUTPUT_BYTES = 512 * 1024 * 1024;

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

export interface BrowserGifPreflightInput extends BrowserGifExportSettings {
  durationSeconds: number;
}

export interface BrowserGifPreflightResult {
  ok: boolean;
  frameCount: number;
  rawFrameBytes: number;
  estimatedOutputBytes: number;
  estimatedOutputMaxBytes: number;
  message?: string;
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
    gifLoopCount: clampGifLoopCount(settings.gifLoopCount),
    gifPaletteMode: settings.gifPaletteMode ?? 'global',
    gifOptimize: settings.gifOptimize ?? true,
    gifTransparency: settings.gifTransparency ?? true,
    gifAlphaThreshold: clampGifAlphaThreshold(settings.gifAlphaThreshold),
    gifBayerScale: clampGifBayerScale(settings.gifBayerScale),
  };
}

export function checkBrowserGifExportSize(settingsInput: BrowserGifPreflightInput): BrowserGifPreflightResult {
  const settings = createDefaultBrowserGifSettings(settingsInput);
  const durationSeconds = Math.max(0, settingsInput.durationSeconds);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * settings.fps));
  const rawFrameBytes = settings.width * settings.height * 4 * frameCount;
  const estimate = estimateGifSize({
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    durationSeconds,
    gifColors: settings.gifColors,
    gifDither: settings.gifDither,
    gifLoop: settings.gifLoop,
    gifLoopCount: settings.gifLoopCount,
    gifPaletteMode: settings.gifPaletteMode,
    gifOptimize: settings.gifOptimize,
    gifTransparency: settings.gifTransparency,
    gifAlphaThreshold: settings.gifAlphaThreshold,
    gifBayerScale: settings.gifBayerScale,
  });
  const overRawLimit = rawFrameBytes > BROWSER_GIF_MAX_RAW_FRAME_BYTES;
  const overOutputLimit = estimate.maxBytes > BROWSER_GIF_MAX_ESTIMATED_OUTPUT_BYTES;
  if (!overRawLimit && !overOutputLimit) {
    return {
      ok: true,
      frameCount,
      rawFrameBytes,
      estimatedOutputBytes: estimate.bytes,
      estimatedOutputMaxBytes: estimate.maxBytes,
    };
  }

  const rawLabel = formatByteSize(rawFrameBytes);
  const outputRangeLabel = `${formatByteSize(estimate.minBytes)}-${formatByteSize(estimate.maxBytes)}`;
  const maxRawLabel = formatByteSize(BROWSER_GIF_MAX_RAW_FRAME_BYTES);
  const maxOutputLabel = formatByteSize(BROWSER_GIF_MAX_ESTIMATED_OUTPUT_BYTES);

  return {
    ok: false,
    frameCount,
    rawFrameBytes,
    estimatedOutputBytes: estimate.bytes,
    estimatedOutputMaxBytes: estimate.maxBytes,
    message: [
      `Browser GIF is too large for in-browser encoding (${frameCount} frames, ${rawLabel} raw frames, estimated ${outputRangeLabel}).`,
      `Use FFmpeg GIF for this range, or lower duration, FPS, or resolution. Browser GIF is capped at about ${maxRawLabel} raw frames and ${maxOutputLabel} estimated output.`,
    ].join(' '),
  };
}

export function encodeBrowserGif(
  frames: Uint8Array[],
  settingsInput: BrowserGifExportSettings,
  onProgress?: (progress: BrowserGifEncodeProgress) => void,
): Blob {
  const output = encodeBrowserGifBytes(frames, settingsInput, onProgress);
  const buffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(buffer).set(output);
  return new Blob([buffer], { type: 'image/gif' });
}

export function encodeBrowserGifBytes(
  frames: Uint8Array[],
  settingsInput: BrowserGifExportSettings,
  onProgress?: (progress: BrowserGifEncodeProgress) => void,
): Uint8Array {
  if (frames.length === 0) {
    throw new Error('No frames rendered');
  }

  const settings = createDefaultBrowserGifSettings(settingsInput);
  const gif = GIFEncoder({
    initialCapacity: estimateInitialCapacity(frames.length, settings.width, settings.height),
  });
  const delay = Math.max(2, Math.round(1000 / settings.fps));
  const repeat = getGifRepeatCount(settings.gifLoop, settings.gifLoopCount);
  const format = settings.gifTransparency ? 'rgba4444' : 'rgb565';
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
    const palette = globalPalette ?? createFramePalette(
      frame,
      settings.gifColors,
      alphaThreshold,
      settings.gifTransparency,
    );
    const indexedFrame = applyPalette(frame, palette, format);
    const transparentIndex = settings.gifTransparency ? findTransparentIndex(palette) : -1;
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
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output;
}

function createFramePalette(
  frame: Uint8Array,
  colors: number,
  alphaThreshold: number,
  transparency: boolean,
): GifPalette {
  return quantize(frame, colors, {
    format: transparency ? 'rgba4444' : 'rgb565',
    oneBitAlpha: transparency ? alphaThreshold : false,
    clearAlpha: transparency,
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
  const palette = createFramePalette(
    sample,
    settings.gifColors,
    settings.gifAlphaThreshold,
    settings.gifTransparency,
  );
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
