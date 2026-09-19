import type { RuntimeFrameProvider } from './types';
import {
  createBrowserWorkerRenderHostRuntimeBridge,
  type WorkerRenderHostRuntimeBridge,
} from '../render/workerRenderHostRuntimeBridge';
import type {
  WorkerRenderHostRuntimeJobOutput,
} from '../render/workerRenderHostRuntimeHandlers';
import type {
  WorkerRenderHostWebCodecsResult,
  WorkerRenderHostWebCodecsSeekMode,
  WorkerRenderHostWebCodecsStatus,
} from '../render/workerRenderHostRuntimeCommands';

interface WorkerWebCodecsFrameProviderOptions {
  readonly sourceId: string;
  readonly file: File;
  readonly bridge?: WorkerRenderHostRuntimeBridge;
  readonly onFrame?: () => void;
  readonly onError?: (error: Error) => void;
}

interface PendingFrameRequest {
  readonly sequence: number;
  readonly epoch: number;
  readonly mode: WorkerRenderHostWebCodecsSeekMode;
  readonly timeSeconds: number;
  readonly timeoutMs: number;
}

let workerWebCodecsProviderSequence = 0;
const PLAYBACK_INTERMEDIATE_FRAME_TOLERANCE_SECONDS = 1.25;

function nextRequestId(sourceId: string, label: string): string {
  workerWebCodecsProviderSequence += 1;
  return `worker-webcodecs:${label}:${sourceId}:${workerWebCodecsProviderSequence}`;
}

function closeBitmap(bitmap: ImageBitmap | null): void {
  try {
    bitmap?.close();
  } catch {
    // Ignore already-detached ImageBitmap handles.
  }
}

export class WorkerWebCodecsFrameProvider implements RuntimeFrameProvider {
  readonly backend = 'worker-webcodecs' as const;
  currentTime = 0;
  isPlaying = false;

  private readonly sourceId: string;
  private readonly file: File;
  private readonly bridge: WorkerRenderHostRuntimeBridge;
  private readonly ownsBridge: boolean;
  private readonly onFrame?: () => void;
  private readonly onError?: (error: Error) => void;
  private currentBitmap: ImageBitmap | null = null;
  private currentBitmapTimeSeconds: number | null = null;
  private currentBitmapMode: WorkerRenderHostWebCodecsSeekMode | null = null;
  private ready = false;
  private width = 0;
  private height = 0;
  private frameRate = 0;
  private pendingTime: number | null = null;
  private decodePending = false;
  private lastStatus: WorkerRenderHostWebCodecsStatus | null = null;
  private destroyed = false;
  private requestSequence = 0;
  private requestEpoch = 0;
  private activeRequest: PendingFrameRequest | null = null;
  private pendingRequest: PendingFrameRequest | null = null;
  private drainPromise: Promise<void> | null = null;

  constructor(options: WorkerWebCodecsFrameProviderOptions) {
    this.sourceId = options.sourceId;
    this.file = options.file;
    this.bridge = options.bridge ?? createBrowserWorkerRenderHostRuntimeBridge();
    this.ownsBridge = !options.bridge;
    this.onFrame = options.onFrame;
    this.onError = options.onError;
  }

  async load(): Promise<void> {
    const buffer = await this.file.arrayBuffer();
    const output = await this.bridge.loadWebCodecsSource(
      nextRequestId(this.sourceId, 'load'),
      this.sourceId,
      buffer,
    );
    this.applyOutput(output);
    this.ready = output.webCodecs?.status.ready ?? this.ready;
  }

  isFullMode(): boolean {
    return this.ready;
  }

  isSimpleMode(): boolean {
    return false;
  }

  getCurrentFrame(): VideoFrame | null {
    return this.currentBitmapIsUsableForCurrentTarget()
      ? this.currentBitmap as unknown as VideoFrame
      : null;
  }

  getFrameRate(): number {
    return this.frameRate;
  }

  getPendingSeekTime(): number | null {
    return this.pendingTime;
  }

  isSeeking(): boolean {
    return this.pendingTime !== null;
  }

  isDecodePending(): boolean {
    return this.decodePending || this.pendingRequest !== null || this.drainPromise !== null;
  }

  hasFrame(): boolean {
    return this.currentBitmapIsUsableForCurrentTarget();
  }

  hasBufferedFutureFrame(): boolean {
    return false;
  }

  getDebugInfo() {
    const status = this.lastStatus;
    const currentFrameTimestampSeconds = this.currentBitmapIsUsableForCurrentTarget()
      ? this.currentBitmapTimeSeconds
      : null;
    return {
      codec: 'worker-webcodecs',
      hwAccel: 'worker',
      decodeQueueSize: status?.decodeQueueSize ?? (this.isDecodePending() ? 1 : 0),
      samplesLoaded: status?.samplesLoaded ?? (this.ready ? 1 : 0),
      sampleIndex: status?.sampleIndex ?? Math.round(this.currentTime * Math.max(this.frameRate, 1)),
      feedIndex: status?.feedIndex,
      frameBufferSize: status?.frameBufferSize,
      decoderState: status?.decoderState,
      currentFrameTimestampSeconds,
      pendingSeekKind: status?.pendingSeekKind,
      pendingSeekTargetSeconds: status?.pendingSeekTargetSeconds,
      pendingSeekFeedEndIndex: status?.pendingSeekFeedEndIndex,
      decodeErrorCount: status?.decodeErrorCount,
      lastDecodeError: status?.lastDecodeError,
      decodedFrameCount: status?.decodedFrameCount,
      lastDecodedFrameTimestampSeconds: status?.lastDecodedFrameTimestampSeconds,
      reverseFrameCacheSize: status?.reverseFrameCacheSize,
      lastSeekPlan: status?.lastSeekPlan,
      lastError: status?.lastError,
    };
  }

  advanceToTime(timeSeconds: number): void {
    this.isPlaying = true;
    this.queueFrameRequest('advance', timeSeconds, 80);
  }

  advanceReverseToTime(timeSeconds: number): void {
    this.isPlaying = true;
    this.queueFrameRequest('reverse', timeSeconds, 1000);
  }

  seek(timeSeconds: number): void {
    this.isPlaying = false;
    this.queueFrameRequest('seek', timeSeconds, 220);
  }

  scrubSeek(timeSeconds: number): void {
    this.isPlaying = false;
    this.queueFrameRequest('scrub', timeSeconds, 140);
  }

  fastSeek(timeSeconds: number): void {
    this.isPlaying = false;
    this.queueFrameRequest('fast', timeSeconds, 90);
  }

  pause(): void {
    this.isPlaying = false;
    if (!this.hasPlaybackRequestInFlight()) {
      return;
    }

    this.requestEpoch += 1;
    const pendingPlaybackRequest = isPlaybackFrameRequest(this.pendingRequest)
      ? this.pendingRequest
      : null;
    const hasNonPlaybackPending = this.pendingRequest !== null && !pendingPlaybackRequest;
    if (pendingPlaybackRequest) {
      this.pendingRequest = null;
    }
    if (!hasNonPlaybackPending) {
      this.pendingTime = null;
      if (this.currentBitmapTimeSeconds !== null) {
        this.currentTime = this.currentBitmapTimeSeconds;
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    closeBitmap(this.currentBitmap);
    this.currentBitmap = null;
    this.currentBitmapTimeSeconds = null;
    this.currentBitmapMode = null;
    void this.bridge.disposeWebCodecsSource(nextRequestId(this.sourceId, 'dispose'), this.sourceId)
      .catch(() => undefined)
      .finally(() => {
        if (this.ownsBridge) {
          this.bridge.dispose();
        }
      });
  }

  private queueFrameRequest(
    mode: WorkerRenderHostWebCodecsSeekMode,
    timeSeconds: number,
    timeoutMs: number,
  ): void {
    if (this.destroyed || !this.ready) {
      return;
    }
    this.currentTime = timeSeconds;
    this.pendingTime = timeSeconds;
    this.requestSequence += 1;
    this.pendingRequest = {
      sequence: this.requestSequence,
      epoch: this.requestEpoch,
      mode,
      timeSeconds,
      timeoutMs,
    };
    if (!this.drainPromise) {
      this.drainPromise = this.drainFrameRequests().finally(() => {
        this.drainPromise = null;
      });
    }
  }

  private currentBitmapIsUsableForCurrentTarget(): boolean {
    if (!this.currentBitmap) {
      return false;
    }
    if (this.pendingTime === null) {
      return this.currentBitmapTimeSeconds !== null;
    }
    if (this.currentBitmapTimeSeconds === null) {
      return false;
    }
    const frameRate = this.frameRate > 0 ? this.frameRate : 30;
    const toleranceSeconds = Math.max(0.08, Math.min(0.16, 4 / Math.max(frameRate, 1)));
    if (Math.abs(this.currentBitmapTimeSeconds - this.pendingTime) <= toleranceSeconds) {
      return true;
    }
    return this.isPlaying &&
      this.currentBitmapMode === 'reverse' &&
      Math.abs(this.currentBitmapTimeSeconds - this.pendingTime) <=
        PLAYBACK_INTERMEDIATE_FRAME_TOLERANCE_SECONDS;
  }

  private async drainFrameRequests(): Promise<void> {
    while (!this.destroyed && this.pendingRequest) {
      const request = this.pendingRequest;
      this.pendingRequest = null;
      this.decodePending = true;
      this.activeRequest = request;
      try {
        const output = await this.bridge.readWebCodecsFrame(
          nextRequestId(this.sourceId, request.mode),
          this.sourceId,
          request.timeSeconds,
          request.mode,
          request.timeoutMs,
        );
        const outputFrame = output.webCodecs?.frame ?? null;
        if (request.epoch !== this.requestEpoch) {
          closeBitmap(outputFrame?.bitmap ?? null);
          continue;
        }
        const outputFrameNearRequest = outputFrame
          ? this.isOutputFrameNearRequest(request, outputFrame.timestampSeconds)
          : false;
        const queuedAfterRead = this.pendingRequest as PendingFrameRequest | null;
        const newerRequestWaiting = queuedAfterRead !== null &&
          queuedAfterRead.sequence > request.sequence;
        const shouldApplyIntermediatePlaybackFrame =
          this.isPlaying &&
          newerRequestWaiting &&
          queuedAfterRead.mode === request.mode &&
          (request.mode === 'advance' || request.mode === 'reverse') &&
          outputFrame &&
          outputFrameNearRequest &&
          this.shouldApplyIntermediateAdvanceFrame(outputFrame.timestampSeconds);
        if (newerRequestWaiting && this.currentBitmap && !shouldApplyIntermediatePlaybackFrame) {
          closeBitmap(outputFrame?.bitmap ?? null);
        } else {
          const latestPendingTarget = shouldApplyIntermediatePlaybackFrame
            ? queuedAfterRead?.timeSeconds ?? null
            : null;
          this.applyOutput(output, request);
          if (latestPendingTarget !== null) {
            this.pendingTime = latestPendingTarget;
          }
        }
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (this.activeRequest === request) {
          this.activeRequest = null;
        }
        this.decodePending = false;
      }
    }
  }

  private hasPlaybackRequestInFlight(): boolean {
    return isPlaybackFrameRequest(this.activeRequest) ||
      isPlaybackFrameRequest(this.pendingRequest);
  }

  private isOutputFrameNearRequest(
    request: PendingFrameRequest,
    timestampSeconds: number,
  ): boolean {
    if (request.mode === 'fast') {
      return true;
    }
    const frameRate = this.frameRate > 0 ? this.frameRate : 30;
    const maxFrameDelta = request.mode === 'advance' || request.mode === 'reverse' ? 4 : 4;
    const minTolerance = request.mode === 'advance' || request.mode === 'reverse' ? 0.08 : 0.06;
    const maxTolerance = request.mode === 'advance' || request.mode === 'reverse' ? 0.16 : 0.18;
    const toleranceSeconds = Math.max(
      minTolerance,
      Math.min(maxTolerance, maxFrameDelta / Math.max(frameRate, 1)),
    );
    return Math.abs(timestampSeconds - request.timeSeconds) <= toleranceSeconds;
  }

  private applyOutput(
    output: WorkerRenderHostRuntimeJobOutput,
    request?: PendingFrameRequest,
  ): void {
    const result = output.webCodecs;
    if (!result) {
      return;
    }
    if (
      request &&
      !result.frame &&
      this.currentBitmap &&
      (
        this.currentBitmapTimeSeconds === null ||
        !this.isOutputFrameNearRequest(request, this.currentBitmapTimeSeconds)
      )
    ) {
      closeBitmap(this.currentBitmap);
      this.currentBitmap = null;
      this.currentBitmapTimeSeconds = null;
      this.currentBitmapMode = null;
    }
    this.applyStatus(result);
    if (result.frame) {
      if (request && !this.isOutputFrameNearRequest(request, result.frame.timestampSeconds)) {
        closeBitmap(result.frame.bitmap);
        if (
          this.currentBitmap &&
          (
            this.currentBitmapTimeSeconds === null ||
            !this.isOutputFrameNearRequest(request, this.currentBitmapTimeSeconds)
          )
        ) {
          closeBitmap(this.currentBitmap);
          this.currentBitmap = null;
          this.currentBitmapTimeSeconds = null;
          this.currentBitmapMode = null;
        }
        return;
      }
      closeBitmap(this.currentBitmap);
      this.currentBitmap = result.frame.bitmap;
      this.currentBitmapTimeSeconds = result.frame.timestampSeconds;
      this.currentBitmapMode = request?.mode ?? null;
      this.currentTime = result.frame.timestampSeconds;
      this.width = result.frame.width;
      this.height = result.frame.height;
      this.pendingTime = null;
      this.onFrame?.();
    }
  }

  private shouldApplyIntermediateAdvanceFrame(timestampSeconds: number): boolean {
    if (!this.currentBitmap) {
      return true;
    }
    const frameRate = this.frameRate > 0 ? this.frameRate : 30;
    const minDistinctFrameDistance = (1 / frameRate) * 0.5;
    return Math.abs(timestampSeconds - this.currentTime) >= minDistinctFrameDistance;
  }

  private applyStatus(result: WorkerRenderHostWebCodecsResult): void {
    this.lastStatus = result.status;
    this.ready = result.status.ready;
    this.width = result.status.width || this.width;
    this.height = result.status.height || this.height;
    this.frameRate = result.status.frameRate || this.frameRate;
    this.currentTime = result.frame?.timestampSeconds ?? result.status.currentTime;
    this.decodePending = result.status.decodePending;
  }
}

function isPlaybackFrameRequest(
  request: PendingFrameRequest | null,
): request is PendingFrameRequest {
  return request?.mode === 'advance' || request?.mode === 'reverse';
}

export async function createWorkerWebCodecsFrameProvider(
  options: WorkerWebCodecsFrameProviderOptions,
): Promise<WorkerWebCodecsFrameProvider | null> {
  const provider = new WorkerWebCodecsFrameProvider(options);
  try {
    await provider.load();
    if (provider.isFullMode()) {
      return provider;
    }
    provider.destroy();
    return null;
  } catch (error) {
    provider.destroy();
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}
