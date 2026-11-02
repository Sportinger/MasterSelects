import { FFmpegFrameRenderer } from '../../components/export/exportHelpers';
import { ExportRenderSessionImpl } from '../../engine/export/ExportRenderSessionImpl';
import { createExportRunId } from '../timeline/exportRuntimeReporting';
import type { TimelineClip } from '../../types/timeline';
import {
  encodeDatamoshPlaybackArtifact,
  type CodecDatamoshEncodeResult,
} from './codecDatamoshEncoder';
import { createMpeg4DatamoshFrames } from './mpeg4Datamosh';

// The bake keeps the composition's resolution. Only a raw frame buffer this tab could not hold scales down, and the
// result says so (`reducedFrom`).
const MAX_RAW_SOURCE_BYTES = 3 * 1024 * 1024 * 1024;
// The playback artifact only has to carry the moshed pixels. Data Rate shapes the MPEG-4 mosh and must not compress
// its result a second time.
const PLAYBACK_BITS_PER_PIXEL = 0.35;

export type DatamoshBakePhase = 'preparing' | 'rendering' | 'corrupting' | 'muxing';

export interface DatamoshTransitionBakeInput {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  compositionId: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bitrate: number;
  onProgress?: (phase: DatamoshBakePhase, completed: number, total: number) => void;
}

export interface DatamoshTransitionBakeResult extends CodecDatamoshEncodeResult {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** The composition's size, when this length did not fit in memory at full resolution. */
  reducedFrom?: { width: number; height: number };
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function resolveDatamoshBakeDimensions(
  width: number,
  height: number,
  inputFrameCount = 61,
): { width: number; height: number } {
  const safeWidth = Math.max(2, width);
  const safeHeight = Math.max(2, height);
  const pixelBudget = Math.max(4, Math.floor(MAX_RAW_SOURCE_BYTES / Math.max(1, inputFrameCount) / 4));
  const scale = Math.min(1, Math.sqrt(pixelBudget / (safeWidth * safeHeight)));
  return {
    width: evenDimension(safeWidth * scale),
    height: evenDimension(safeHeight * scale),
  };
}

/** The bitrate of the playback artifact: from its pixels, whatever the Data Rate of the mosh is. */
export function resolveDatamoshPlaybackBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * PLAYBACK_BITS_PER_PIXEL);
}

async function captureToRgba(
  capture: Awaited<ReturnType<ExportRenderSessionImpl['renderFrame']>>,
  targetWidth: number,
  targetHeight: number,
): Promise<Uint8Array> {
  const sourcePixels = new Uint8Array(capture.width * capture.height * 4);
  if (capture.kind === 'rgba-pixels') {
    sourcePixels.set(capture.pixels);
  } else {
    try {
      await capture.frame.copyTo(sourcePixels, { format: 'RGBA' });
    } finally {
      capture.frame.close();
    }
  }

  if (capture.width === targetWidth && capture.height === targetHeight) return sourcePixels;

  const resized = new Uint8Array(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(capture.height - 1, Math.floor(targetY * capture.height / targetHeight));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(capture.width - 1, Math.floor(targetX * capture.width / targetWidth));
      const sourceOffset = (sourceY * capture.width + sourceX) * 4;
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      resized[targetOffset] = sourcePixels[sourceOffset];
      resized[targetOffset + 1] = sourcePixels[sourceOffset + 1];
      resized[targetOffset + 2] = sourcePixels[sourceOffset + 2];
      resized[targetOffset + 3] = sourcePixels[sourceOffset + 3];
    }
  }
  return resized;
}

export async function bakeDatamoshTransition(
  input: DatamoshTransitionBakeInput,
): Promise<DatamoshTransitionBakeResult> {
  const fps = Math.max(1, Math.min(60, Math.round(input.fps)));
  const duration = Math.max(2 / fps, input.duration);
  const outputFrameCount = Math.max(2, Math.ceil(duration * fps));
  const inputFrameCount = outputFrameCount + 1;
  const dimensions = resolveDatamoshBakeDimensions(input.width, input.height, inputFrameCount);
  const frameDurationSeconds = 1 / fps;
  const junctionTime = input.outgoingClip.startTime + input.outgoingClip.duration;
  const anchorTime = Math.max(
    input.outgoingClip.startTime,
    junctionTime - frameDurationSeconds * 0.5,
  );
  const donorLastTime = Math.max(
    input.incomingClip.startTime,
    input.incomingClip.startTime + input.incomingClip.duration - frameDurationSeconds * 0.5,
  );
  const renderer = new FFmpegFrameRenderer({
    width: input.width,
    height: input.height,
    fps,
    startTime: anchorTime,
    endTime: Math.max(anchorTime + frameDurationSeconds, junctionTime + duration),
    exportMode: 'precise',
  });
  const renderSession = new ExportRenderSessionImpl({
    runId: createExportRunId(),
    compositionId: input.compositionId,
    width: input.width,
    height: input.height,
    stackedAlpha: false,
    preferZeroCopy: false,
  });

  input.onProgress?.('preparing', 0, 1);
  let rawFrames: Uint8Array;
  try {
    await renderer.initialize();
    await renderSession.begin();
    input.onProgress?.('preparing', 1, 1);

    const frameSize = dimensions.width * dimensions.height * 4;
    const frameDurationMicros = Math.round(1_000_000 / fps);
    rawFrames = new Uint8Array(frameSize * inputFrameCount);
    for (let index = 0; index < inputFrameCount; index += 1) {
      const isAnchor = index === 0;
      const donorIndex = Math.max(0, index - 1);
      const time = isAnchor
        ? anchorTime
        : Math.min(donorLastTime, input.incomingClip.startTime + donorIndex * frameDurationSeconds);
      const clip = isAnchor ? input.outgoingClip : input.incomingClip;
      const layers = await renderer.buildClipLayersAtTime(clip.id, time);
      if (layers.length === 0) {
        throw new Error(`Datamosh could not render ${isAnchor ? 'the outgoing anchor' : 'an incoming donor'} frame.`);
      }
      const capture = await renderSession.renderFrame({
        time,
        layers,
        timestampMicros: index * frameDurationMicros,
        durationMicros: frameDurationMicros,
      });
      rawFrames.set(await captureToRgba(capture, dimensions.width, dimensions.height), index * frameSize);
      input.onProgress?.('rendering', index + 1, inputFrameCount);
    }
  } finally {
    renderSession.dispose();
    renderer.cleanup();
  }

  const frameSize = dimensions.width * dimensions.height * 4;
  const moshedFrames = await createMpeg4DatamoshFrames({
    rgbaFrames: rawFrames,
    ...dimensions,
    fps,
    bitrate: input.bitrate,
    inputFrameCount,
    outputFrameCount,
    onProgress: (completed, total) => input.onProgress?.('corrupting', completed, total),
  });
  const frameDurationMicros = Math.round(1_000_000 / fps);
  const encoded = await encodeDatamoshPlaybackArtifact({
    ...dimensions,
    fps,
    bitrate: resolveDatamoshPlaybackBitrate(dimensions.width, dimensions.height, fps),
    frameCount: outputFrameCount,
    getFrame: async (index, timestampMicros, durationMicros) => new VideoFrame(
      moshedFrames.subarray(index * frameSize, (index + 1) * frameSize),
      {
        format: 'RGBA',
        codedWidth: dimensions.width,
        codedHeight: dimensions.height,
        timestamp: timestampMicros,
        duration: durationMicros,
      },
    ),
    onProgress: (completed, total) => input.onProgress?.('muxing', completed, total),
  });
  return {
    ...encoded,
    inputFrameCount,
    droppedKeyPacketCount: 1,
    ...dimensions,
    fps,
    duration: outputFrameCount * frameDurationMicros / 1_000_000,
    ...(dimensions.width < input.width || dimensions.height < input.height
      ? { reducedFrom: { width: input.width, height: input.height } }
      : {}),
  };
}
