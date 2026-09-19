// HAP export runner: renders timeline frames through the export render
// session, BC-compresses them on a private WebGPU device (CPU worker fallback),
// Snappy-packages frames in a worker pool, and muxes a QuickTime movie with
// optional PCM audio. No FFmpeg involvement — the pipeline is fully local.

import { AudioExportPipeline } from '../../../engine/audio';
import { HapGpuBlockEncoder } from '../../../engine/hap/HapGpuBlockEncoder';
import { Logger } from '../../../services/logger';
import {
  hapContainerFourCC,
  hapVariantHasAlpha,
  type HapEncodeVariant,
} from '../../../services/hap/hapCodecIdentity';
import type { HapTextureEncodeFormat } from '../../../services/hap/dxtEncodeCpu';
import { HapEncodeWorkerPool } from '../../../services/hap/hapEncodeWorkerPool';
import {
  HAP_FORMAT_RGBA_DXT5,
  HAP_FORMAT_RGB_DXT1,
  HAP_FORMAT_YCOCG_DXT5,
  type HapTextureFormatNibble,
} from '../../../services/hap/hapFrame';
import { HapMovWriter } from '../../../services/hap/hapMovMuxer';
import { useTimelineStore } from '../../../stores/timeline';
import { FFmpegFrameRenderer } from '../exportHelpers';
import {
  attachRenderSession,
  disposeRenderSession,
  forceOpaqueAlpha,
  type ExportRenderSessionFactory,
  type ExportRenderSessionRef,
} from './runnerUtils';

const log = Logger.create('HapExportRunner');

// Bound the number of frames simultaneously in worker packaging.
const MAX_PIPELINE_DEPTH = 8;

export interface HapExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  exportMode: 'fast' | 'precise';
  filename: string;
  hapFormat: HapEncodeVariant;
  includeAudio: boolean;
  audioSampleRate: number;
  audioBitrate: number;
  normalizeAudio: boolean;
  includeAlpha: boolean;
  frameRendererRef: { current: FFmpegFrameRenderer | null };
  audioPipelineRef: { current: AudioExportPipeline | null };
  renderSessionRef: ExportRenderSessionRef;
  createRenderSession: ExportRenderSessionFactory;
  onProgress: (progress: {
    phase: 'video' | 'muxing';
    currentFrame: number;
    totalFrames: number;
    percent: number;
    estimatedTimeRemaining: number;
    currentTime: number;
  }) => void;
  onTimelineProgress: (percent: number, time: number) => void;
}

export interface HapExportRunnerResult {
  blob: Blob;
  filename: string;
}

function variantEncodeFormat(variant: HapEncodeVariant): HapTextureEncodeFormat {
  switch (variant) {
    case 'hap': return 'bc1';
    case 'hap_alpha': return 'bc3';
    case 'hap_q': return 'ycocg-bc3';
  }
}

function variantFormatNibble(variant: HapEncodeVariant): HapTextureFormatNibble {
  switch (variant) {
    case 'hap': return HAP_FORMAT_RGB_DXT1;
    case 'hap_alpha': return HAP_FORMAT_RGBA_DXT5;
    case 'hap_q': return HAP_FORMAT_YCOCG_DXT5;
  }
}

/** Chunked frames let players decode one frame on several threads. */
function autoChunkCount(textureBytes: number): number {
  return Math.max(1, Math.min(16, Math.ceil(textureBytes / (1 << 20))));
}

function interleaveToInt16(buffer: AudioBuffer): Int16Array {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const out = new Int16Array(buffer.length * channels);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
    for (let i = 0; i < buffer.length; i++) {
      const clamped = Math.max(-1, Math.min(1, data[i]));
      out[i * channels + ch] = Math.round(clamped * 32767);
    }
  }
  return out;
}

export async function runHapExport(
  input: HapExportRunnerInput,
): Promise<HapExportRunnerResult | null> {
  const totalFrames = Math.max(1, Math.ceil((input.endTime - input.startTime) * input.fps));
  const frameDuration = 1 / Math.max(input.fps, 1);
  const encodeFormat = variantEncodeFormat(input.hapFormat);
  const formatNibble = variantFormatNibble(input.hapFormat);

  const timelineState = useTimelineStore.getState();
  const shouldIncludeAudio = input.includeAudio && AudioExportPipeline.hasAudioInRange(
    Array.isArray(timelineState.clips) ? timelineState.clips : [],
    Array.isArray(timelineState.tracks) ? timelineState.tracks : [],
    input.startTime,
    input.endTime,
    timelineState.masterAudioState,
  );

  const frameRenderer = new FFmpegFrameRenderer({
    width: input.width,
    height: input.height,
    fps: input.fps,
    startTime: input.startTime,
    endTime: Math.max(input.endTime, input.startTime + frameDuration),
    exportMode: input.exportMode,
    runtimeReporting: true,
    runtimeExportKind: 'hap-video',
    includeAudio: shouldIncludeAudio,
  });
  input.frameRendererRef.current = frameRenderer;

  const writer = new HapMovWriter({
    videoFourCC: hapContainerFourCC(input.hapFormat),
    width: input.width,
    height: input.height,
    fps: input.fps,
    depth: hapVariantHasAlpha(input.hapFormat) ? 32 : 24,
  });

  let renderSession: ReturnType<ExportRenderSessionFactory> | null = null;
  let gpuEncoder: HapGpuBlockEncoder | null = null;
  const workerPool = new HapEncodeWorkerPool();
  const pendingSamples: Promise<Uint8Array>[] = [];
  let drainedSamples = 0;

  const drainOneSample = async (): Promise<void> => {
    const sample = await pendingSamples[drainedSamples];
    writer.addVideoSample(sample);
    drainedSamples++;
  };

  try {
    await frameRenderer.initialize();
    gpuEncoder = await HapGpuBlockEncoder.create(encodeFormat, input.width, input.height);
    log.info(
      `HAP export started: ${input.hapFormat}, ${input.width}x${input.height}@${input.fps}, `
      + `${totalFrames} frames, backend=${gpuEncoder ? 'webgpu' : 'cpu-worker'}, `
      + `workers=${workerPool.workerCount}`,
    );

    renderSession = input.createRenderSession({
      runId: frameRenderer.getRuntimeRunId() ?? `hap-${Date.now()}`,
      width: input.width,
      height: input.height,
      stackedAlpha: false,
      // rgba-pixels captures like every other runner; the GPU encoder uploads
      // them via writeTexture. Zero-copy VideoFrames can come later with
      // dedicated evidence.
      preferZeroCopy: false,
    });
    attachRenderSession(input.renderSessionRef, renderSession);
    await renderSession.begin();

    const startedAt = performance.now();
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (frameRenderer.isCancelled()) return null;

      const frameTime = input.startTime + frameIndex * frameDuration;
      const layers = await frameRenderer.buildLayersAtTime(frameTime);
      const capture = await renderSession.renderFrame({ time: frameTime, layers });

      let opaquePixels: Uint8Array | null = null;
      if (!input.includeAlpha) {
        if (capture.kind === 'video-frame') {
          opaquePixels = new Uint8Array(input.width * input.height * 4);
          try {
            await capture.frame.copyTo(opaquePixels, { format: 'RGBA' });
          } finally {
            capture.frame.close();
          }
        } else {
          opaquePixels = new Uint8Array(
            capture.pixels.buffer.slice(
              capture.pixels.byteOffset,
              capture.pixels.byteOffset + capture.pixels.byteLength,
            ),
          );
        }
        forceOpaqueAlpha(opaquePixels);
      }

      if (gpuEncoder) {
        let blocks: Uint8Array;
        if (opaquePixels) {
          blocks = await gpuEncoder.encode({ pixels: opaquePixels });
        } else if (capture.kind === 'video-frame') {
          try {
            blocks = await gpuEncoder.encode(capture.frame);
          } finally {
            capture.frame.close();
          }
        } else {
          blocks = await gpuEncoder.encode({ pixels: capture.pixels });
        }
        pendingSamples.push(
          workerPool.packFrame(blocks, formatNibble, autoChunkCount(blocks.length)),
        );
      } else {
        let pixels: Uint8Array;
        if (opaquePixels) {
          pixels = opaquePixels;
        } else if (capture.kind === 'video-frame') {
          const frame = capture.frame;
          try {
            const size = input.width * input.height * 4;
            const copy = new Uint8Array(size);
            await frame.copyTo(copy, { format: 'RGBA' });
            pixels = copy;
          } finally {
            frame.close();
          }
        } else {
          pixels = new Uint8Array(
            capture.pixels.buffer.slice(
              capture.pixels.byteOffset,
              capture.pixels.byteOffset + capture.pixels.byteLength,
            ),
          );
        }
        const textureBytes = input.width * input.height * (encodeFormat === 'bc1' ? 0.5 : 1);
        pendingSamples.push(workerPool.encodeAndPackFrame(
          pixels,
          input.width,
          input.height,
          encodeFormat,
          formatNibble,
          autoChunkCount(textureBytes),
        ));
      }

      while (pendingSamples.length - drainedSamples >= MAX_PIPELINE_DEPTH) {
        await drainOneSample();
      }

      const completedFrames = frameIndex + 1;
      const renderPercent = (completedFrames / totalFrames) * 88;
      const elapsedMs = performance.now() - startedAt;
      const avgFrameMs = elapsedMs / completedFrames;
      input.onProgress({
        phase: 'video',
        currentFrame: completedFrames,
        totalFrames,
        percent: renderPercent,
        estimatedTimeRemaining: ((totalFrames - completedFrames) * avgFrameMs) / 1000,
        currentTime: frameTime,
      });
      input.onTimelineProgress(renderPercent, frameTime);
    }

    while (drainedSamples < pendingSamples.length) {
      if (frameRenderer.isCancelled()) return null;
      await drainOneSample();
    }

    if (shouldIncludeAudio) {
      try {
        const audioPipeline = new AudioExportPipeline({
          sampleRate: input.audioSampleRate,
          bitrate: input.audioBitrate,
          normalize: input.normalizeAudio,
        }, {
          exportRunId: frameRenderer.getRuntimeRunId() ?? undefined,
        });
        input.audioPipelineRef.current = audioPipeline;
        const audioBuffer = await audioPipeline.exportRawAudio(
          input.startTime,
          input.endTime,
          (audioProgress) => {
            const percent = 88 + audioProgress.percent * 0.06;
            input.onTimelineProgress(percent, input.endTime);
          },
        );
        input.audioPipelineRef.current = null;
        if (audioBuffer && audioBuffer.length > 0) {
          writer.setAudio({
            samples: interleaveToInt16(audioBuffer),
            sampleRate: audioBuffer.sampleRate,
            channelCount: Math.min(2, Math.max(1, audioBuffer.numberOfChannels)),
          });
        }
      } catch (audioError) {
        log.warn('HAP audio extraction failed, continuing video-only', audioError);
      }
    }

    if (frameRenderer.isCancelled()) return null;

    input.onProgress({
      phase: 'muxing',
      currentFrame: totalFrames,
      totalFrames,
      percent: 96,
      estimatedTimeRemaining: 0,
      currentTime: input.endTime,
    });
    input.onTimelineProgress(96, input.endTime);

    const blob = writer.finalize();
    input.onTimelineProgress(100, input.endTime);
    log.info(`HAP export finished: ${writer.sampleCount} samples, ${(blob.size / 1e6).toFixed(1)} MB`);
    return { blob, filename: `${input.filename}.mov` };
  } catch (error) {
    if (frameRenderer.isCancelled()) {
      log.info('HAP export cancelled');
      return null;
    }
    log.error('HAP export failed', error);
    throw error;
  } finally {
    disposeRenderSession(input.renderSessionRef, renderSession);
    gpuEncoder?.destroy();
    workerPool.dispose();
    frameRenderer.cleanup();
    input.frameRendererRef.current = null;
    input.audioPipelineRef.current = null;
  }
}
