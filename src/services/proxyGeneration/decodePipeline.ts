import type { Sample } from '../../engine/webCodecsTypes';
import {
  DECODE_BATCH_SIZE,
  FLUSH_TIMEOUT_PER_SAMPLE_MS,
  MAX_FLUSH_TIMEOUT_MS,
  MIN_FLUSH_TIMEOUT_MS,
} from './constants';
import type { ProxyGenerationMetrics } from './metrics';
import {
  getFirstPresentationCts,
  getNormalizedSampleTimestampUs,
} from './sampleTiming';

const SCENE_CUT_FEED_STRIDE = 4;

interface ProxyGenerationLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface ProxySampleProcessingController {
  decoder: VideoDecoder;
  samples: Sample[];
  metrics: ProxyGenerationMetrics;
  totalFrames: number;
  getProcessedFrames(): number;
  isCancelled(): boolean;
  checkCancelled(): boolean;
  markCancelled(): void;
  resetEncodePipeline(): void;
  startEncodeWorkers(): void;
  queueDecodedFrames(): void;
  waitForEncodeBackpressure(): Promise<void>;
  waitForSceneCutBackpressure(): Promise<void>;
  isSceneCutAnalysisActive(): boolean;
  getDecodedFrameCount(): number;
  closeDecodedFrames(): void;
  isEncodeStopRequested(): boolean;
  requestEncodeStop(): void;
  setDecodeDone(): void;
  wakeEncodeWorkers(): void;
  waitForEncodeWorkers(): Promise<PromiseSettledResult<void>[]>;
  logPerformance(totalMs: number): void;
  log: ProxyGenerationLogger;
}

export interface ProxySampleProcessingResult {
  decodeErrors: number;
  expectedFrameCount: number;
  skippedSamplesBeforeFirstKeyframe: number;
}

export async function processProxySamples(
  controller: ProxySampleProcessingController,
): Promise<ProxySampleProcessingResult> {
  const {
    decoder,
    samples,
    metrics,
    log,
  } = controller;

  const sortedSamples = [...samples].sort((a, b) => a.dts - b.dts);
  const firstPresentationCts = getFirstPresentationCts(sortedSamples);

  const keyframeCount = sortedSamples.filter(s => s.is_sync).length;
  log.info(`Decoding ${sortedSamples.length} samples (${keyframeCount} keyframes)...`);
  if (firstPresentationCts > 0) {
    log.debug('Normalizing proxy sample timestamps', {
      firstPresentationCts,
      firstPresentationSeconds: firstPresentationCts / sortedSamples[0].timescale,
    });
  }

  const firstKeyframeIdx = sortedSamples.findIndex(s => s.is_sync);
  if (firstKeyframeIdx === -1) throw new Error('No keyframes found');

  const startTime = performance.now();
  let decodeErrors = 0;
  let primaryError: unknown = null;
  let workerFailureReason: unknown = null;
  controller.resetEncodePipeline();
  controller.startEncodeWorkers();

  try {
    const decodeWallStart = performance.now();

    for (let batchStart = firstKeyframeIdx; batchStart < sortedSamples.length; batchStart += DECODE_BATCH_SIZE) {
      if (controller.checkCancelled()) {
        controller.markCancelled();
        break;
      }

      if (decoder.state === 'closed') {
        log.error('Decoder closed unexpectedly');
        break;
      }

      const batchEnd = Math.min(batchStart + DECODE_BATCH_SIZE, sortedSamples.length);

      for (let i = batchStart; i < batchEnd; i++) {
        const sample = sortedSamples[i];

        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: getNormalizedSampleTimestampUs(sample, firstPresentationCts),
          duration: (sample.duration / sample.timescale) * 1_000_000,
          data: sample.data,
        });

        try {
          const feedStart = performance.now();
          decoder.decode(chunk);
          metrics.decodeFeedMs += performance.now() - feedStart;
        } catch (error) {
          decodeErrors++;
          if (decodeErrors <= 5) {
            log.error('Decode chunk failed', error);
          }
          if (decodeErrors > 50) {
            throw new Error('Proxy decode stopped after more than 50 chunk errors.');
          }
        }

        if (
          controller.isSceneCutAnalysisActive() &&
          (i - batchStart + 1) % SCENE_CUT_FEED_STRIDE === 0
        ) {
          await new Promise(resolve => setTimeout(resolve, 0));
          controller.queueDecodedFrames();
          await controller.waitForEncodeBackpressure();
          await controller.waitForSceneCutBackpressure();
        }
      }

      await new Promise(resolve => setTimeout(resolve, 0));
      controller.queueDecodedFrames();
      await controller.waitForEncodeBackpressure();
      await controller.waitForSceneCutBackpressure();
    }

    const flushTimeoutMs = Math.max(
      MIN_FLUSH_TIMEOUT_MS,
      Math.min(MAX_FLUSH_TIMEOUT_MS, sortedSamples.length * FLUSH_TIMEOUT_PER_SAMPLE_MS)
    );
    const flushStart = performance.now();
    const flushed = await flushProxyDecoder(controller, flushTimeoutMs);
    metrics.decoderFlushMs += performance.now() - flushStart;
    if (!flushed && !controller.isCancelled()) {
      throw new Error(`Decoder flush timed out after ${flushTimeoutMs}ms`);
    }

    metrics.decodeWallMs += performance.now() - decodeWallStart;

    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch { /* ignore */ }

    await new Promise(resolve => setTimeout(resolve, 10));
    controller.queueDecodedFrames();
    await controller.waitForSceneCutBackpressure();
  } catch (error) {
    primaryError = error;
    controller.requestEncodeStop();
    throw error;
  } finally {
    if (controller.isEncodeStopRequested()) {
      controller.closeDecodedFrames();
    } else {
      controller.queueDecodedFrames();
    }

    controller.setDecodeDone();
    controller.wakeEncodeWorkers();

    const workerResults = await controller.waitForEncodeWorkers();
    const workerFailure = workerResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (!primaryError && workerFailure) {
      workerFailureReason = workerFailure.reason;
    }
  }

  if (workerFailureReason) {
    throw workerFailureReason;
  }

  const totalTime = performance.now() - startTime;
  const processedFrames = controller.getProcessedFrames();
  const fps = processedFrames / (totalTime / 1000);
  log.info(`Complete: ${processedFrames}/${controller.totalFrames} frames in ${(totalTime / 1000).toFixed(1)}s (${fps.toFixed(1)} fps encode)`);
  controller.logPerformance(totalTime);
  return {
    decodeErrors,
    expectedFrameCount: sortedSamples.length,
    skippedSamplesBeforeFirstKeyframe: firstKeyframeIdx,
  };
}

async function flushProxyDecoder(
  controller: ProxySampleProcessingController,
  timeoutMs: number
): Promise<boolean> {
  const { decoder, log } = controller;
  if (decoder.state === 'closed') return true;

  let settled = false;
  let succeeded = false;
  const startedAt = performance.now();

  const flushPromise = decoder.flush()
    .then(() => {
      succeeded = true;
    })
    .catch((error) => {
      log.warn('Decoder flush failed', error);
    })
    .finally(() => {
      settled = true;
    });

  while (!settled) {
    if (controller.checkCancelled()) {
      controller.markCancelled();
      break;
    }

    controller.queueDecodedFrames();
    await controller.waitForEncodeBackpressure();
    await controller.waitForSceneCutBackpressure();
    if (controller.getDecodedFrameCount() === 0) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    if (performance.now() - startedAt > timeoutMs) {
      log.warn('Decoder flush timed out', {
        decodeQueueSize: decoder.decodeQueueSize,
        decodedFrames: controller.getDecodedFrameCount(),
        processedFrames: controller.getProcessedFrames(),
        totalFrames: controller.totalFrames,
        timeoutMs,
      });
      break;
    }
  }

  if (settled) {
    await flushPromise;
  }
  return succeeded;
}
