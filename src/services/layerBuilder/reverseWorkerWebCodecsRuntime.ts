import type { TimelineClip } from '../../types';
import { flags } from '../../engine/featureFlags';
import { renderHostPort } from '../render/renderHostPort';
import {
  bindSourceRuntimeToClip,
  releaseClipSourceRuntime,
} from '../mediaRuntime/clipBindings';
import {
  ensureRuntimeFrameProvider,
  peekRuntimeFrameProvider,
  releaseRuntimePlaybackSession,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { getClipTimeInfo, getMediaFileForClip } from './FrameContext';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';
import type { FrameContext } from './types';
import type { MediaFile } from '../../stores/mediaStore/types';

const reverseWorkerRuntimeSources = new Map<string, TimelineClip['source']>();
const reverseWorkerPrimeRequests = new Map<string, number>();
let reverseWorkerPrimeSequence = 0;
const REVERSE_WORKER_PRIME_READY_TIMEOUT_MS = 1800;
const REVERSE_WORKER_PRIME_CACHE_MIN_FRAMES = 24;
const REVERSE_WORKER_PRIME_FRAME_TOLERANCE_SECONDS = 0.08;

export interface ReverseWorkerWebCodecsRuntimeCheck {
  readonly clipId: string;
  readonly isPlaying: boolean;
  readonly playbackSpeed: number;
  readonly clipReversed: boolean;
  readonly sourceType?: string;
  readonly renderHostMode: string;
  readonly timeInfoSpeed?: number;
  readonly candidate: boolean;
  readonly reason: string;
  readonly runtimeSourceId?: string;
  readonly runtimeSessionKey?: string;
}

export interface ReverseWorkerWebCodecsRuntimeSourceStatus {
  readonly clipId: string;
  readonly runtimeSourceId?: string;
  readonly runtimeSessionKey?: string;
  readonly hasProvider: boolean;
  readonly providerFullMode: boolean;
  readonly hasFrame: boolean;
  readonly isSeeking: boolean;
  readonly isDecodePending: boolean;
  readonly pendingSeekTime: number | null;
  readonly currentTime: number | null;
  readonly frameRate: number | null;
  readonly debugInfo: {
    readonly codec: string;
    readonly hwAccel: string;
      readonly decodeQueueSize: number;
      readonly samplesLoaded: number;
      readonly sampleIndex: number;
      readonly feedIndex?: number;
      readonly decoderState?: string | null;
      readonly currentFrameTimestampSeconds?: number | null;
      readonly pendingSeekKind?: string | null;
      readonly pendingSeekTargetSeconds?: number | null;
      readonly pendingSeekFeedEndIndex?: number | null;
      readonly decodeErrorCount?: number;
      readonly lastDecodeError?: string | null;
      readonly lastError?: string | null;
      readonly decodedFrameCount?: number;
      readonly lastDecodedFrameTimestampSeconds?: number | null;
      readonly reverseFrameCacheSize?: number;
      readonly lastSeekPlan?: {
        readonly targetIndex: number;
        readonly keyframeIndex: number;
        readonly feedEndIndex: number;
        readonly targetTimeSeconds: number;
        readonly targetSampleTimeSeconds: number | null;
        readonly keyframeTimeSeconds: number | null;
      } | null;
  } | null;
}

let lastCheck: ReverseWorkerWebCodecsRuntimeCheck | null = null;

function recordCheck(check: ReverseWorkerWebCodecsRuntimeCheck): void {
  lastCheck = check;
}

function selectReverseWorkerRuntimeStatus(
  statuses: readonly ReverseWorkerWebCodecsRuntimeSourceStatus[],
): ReverseWorkerWebCodecsRuntimeSourceStatus | null {
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    const status = statuses[index];
    if (
      status.providerFullMode ||
      status.hasFrame ||
      status.isSeeking ||
      status.isDecodePending
    ) {
      return status;
    }
  }
  return statuses.at(-1) ?? null;
}

function runtimeProviderFrameTimestampSeconds(provider: RuntimeFrameProvider): number | null {
  const timestamp = provider.getDebugInfo?.()?.currentFrameTimestampSeconds;
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function reverseRuntimeProviderReadyAtTime(
  provider: RuntimeFrameProvider,
  clipTime: number,
): boolean {
  if (!provider.isFullMode() || provider.hasFrame?.() !== true) {
    return false;
  }
  const pendingSeekTime = provider.getPendingSeekTime?.();
  if (pendingSeekTime !== null && pendingSeekTime !== undefined) {
    return false;
  }
  const debugInfo = provider.getDebugInfo?.();
  const reverseCacheSize = debugInfo?.reverseFrameCacheSize;
  const hasWarmReverseCache =
    typeof reverseCacheSize === 'number' &&
    reverseCacheSize >= REVERSE_WORKER_PRIME_CACHE_MIN_FRAMES;
  if (provider.isDecodePending?.() === true && !hasWarmReverseCache) {
    return false;
  }
  const frameTime = runtimeProviderFrameTimestampSeconds(provider);
  if (frameTime === null) {
    return true;
  }
  return Math.abs(frameTime - clipTime) <= REVERSE_WORKER_PRIME_FRAME_TOLERANCE_SECONDS;
}

async function waitForReverseRuntimeProviderReady(
  provider: RuntimeFrameProvider,
  clipTime: number,
): Promise<boolean> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < REVERSE_WORKER_PRIME_READY_TIMEOUT_MS) {
    if (reverseRuntimeProviderReadyAtTime(provider, clipTime)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
  return reverseRuntimeProviderReadyAtTime(provider, clipTime);
}

async function primeReverseWorkerRuntimeSourceAtTime(
  clip: TimelineClip,
  source: TimelineClip['source'],
  clipTime: number,
): Promise<boolean> {
  reverseWorkerPrimeSequence += 1;
  const requestId = reverseWorkerPrimeSequence;
  reverseWorkerPrimeRequests.set(clip.id, requestId);
  updateRuntimePlaybackTime(source, clipTime);
  const provider = await ensureRuntimeFrameProvider(source, 'interactive', clipTime, {
    preferWorkerWebCodecs: true,
  });
  if (reverseWorkerPrimeRequests.get(clip.id) !== requestId) return false;
  if (!provider?.isFullMode()) return false;
  if (typeof provider.advanceReverseToTime === 'function') {
    provider.advanceReverseToTime(clipTime);
  } else {
    provider.seek(clipTime);
  }
  renderHostPort.requestNewFrameRender();
  return waitForReverseRuntimeProviderReady(provider, clipTime);
}

function primeReverseWorkerRuntimeSource(
  clip: TimelineClip,
  ctx: FrameContext,
  source: TimelineClip['source'],
): void {
  if (ctx.isPlaying) {
    return;
  }
  const timeInfo = getClipTimeInfo(ctx, clip);
  void primeReverseWorkerRuntimeSourceAtTime(clip, source, timeInfo.clipTime);
}

function findMediaFileForClip(
  mediaFiles: readonly MediaFile[],
  clip: TimelineClip,
): MediaFile | undefined {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (mediaFileId) {
    const byId = mediaFiles.find((file) => file.id === mediaFileId);
    if (byId) return byId;
  }
  const fileName = clip.file?.name;
  return fileName
    ? mediaFiles.find((file) => file.name === fileName)
    : undefined;
}

function calculateReversePrimeClipTime(input: {
  readonly clip: TimelineClip;
  readonly playheadPosition: number;
  readonly getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  readonly getInterpolatedSpeed?: (clipId: string, clipLocalTime: number) => number;
}): number {
  const { clip, playheadPosition, getSourceTimeForClip, getInterpolatedSpeed } = input;
  const clipLocalTime = playheadPosition - clip.startTime;
  const mappedTime = resolveTransitionSourceMapTime(clip.transitionSourceMap, clipLocalTime);
  if (mappedTime) return mappedTime.sourceTime;
  const isTransitionHold = clip.transitionSourceHold === true;
  const initialSpeed = isTransitionHold
    ? 1
    : getInterpolatedSpeed?.(clip.id, 0) ?? clip.speed ?? (clip.reversed ? -1 : 1);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  const sourceOverride = clip.transitionSourceTimeOverride;
  const baseSourceTime = Number.isFinite(sourceOverride)
    ? sourceOverride! - startPoint
    : getSourceTimeForClip(clip.id, clipLocalTime);
  return Number.isFinite(sourceOverride)
    ? sourceOverride!
    : Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + baseSourceTime));
}

function hasNegativeTransitionSourceRate(clip: TimelineClip, playheadPosition: number): boolean {
  const mappedTime = resolveTransitionSourceMapTime(
    clip.transitionSourceMap,
    playheadPosition - clip.startTime,
  );
  return mappedTime ? mappedTime.sourceRate < 0 : false;
}

function bindReverseWorkerRuntimeSourceForPlaybackPrime(
  clip: TimelineClip,
  mediaFiles: readonly MediaFile[],
): TimelineClip['source'] {
  if (clip.source?.runtimeSourceId && clip.source.runtimeSessionKey) {
    return clip.source;
  }

  const cached = reverseWorkerRuntimeSources.get(clip.id);
  if (cached?.runtimeSourceId && cached.runtimeSessionKey) {
    return cached;
  }

  const mediaFile = findMediaFileForClip(mediaFiles, clip);
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId ?? mediaFile?.id;
  const file = clip.file ?? clip.source?.file ?? mediaFile?.file;
  if (!mediaFileId || !file) {
    return null;
  }

  const boundSource = bindSourceRuntimeToClip({
    clipId: clip.id,
    source: clip.source,
    file,
    mediaFileId,
  });
  if (boundSource?.runtimeSourceId && boundSource.runtimeSessionKey) {
    reverseWorkerRuntimeSources.set(clip.id, boundSource);
    return boundSource;
  }
  return null;
}

export async function primeReverseWorkerRuntimeSourcesForPlayback(input: {
  readonly clips: readonly TimelineClip[];
  readonly mediaFiles?: readonly MediaFile[];
  readonly playheadPosition: number;
  readonly playbackSpeed: number;
  readonly getSourceTimeForClip: (clipId: string, clipLocalTime: number) => number;
  readonly getInterpolatedSpeed?: (clipId: string, clipLocalTime: number) => number;
}): Promise<number> {
  if (!flags.useFullWebCodecsPlayback) return 0;
  const mode = renderHostPort.getTelemetry().mode;
  if (mode !== 'worker-presenting' && mode !== 'worker-only' && mode !== 'worker-gpu-only') return 0;
  const seenClipIds = new Set<string>();
  const readyPrimes: Promise<boolean>[] = [];

  for (const clip of input.clips) {
    if (seenClipIds.has(clip.id)) continue;
    seenClipIds.add(clip.id);
    const reverseRequested =
      input.playbackSpeed < 0 ||
      clip.reversed === true ||
      hasNegativeTransitionSourceRate(clip, input.playheadPosition);
    if (!reverseRequested || clip.source?.type !== 'video') continue;

    const source = bindReverseWorkerRuntimeSourceForPlaybackPrime(clip, input.mediaFiles ?? []);
    if (!source?.runtimeSourceId || !source.runtimeSessionKey) continue;

    const clipTime = calculateReversePrimeClipTime({
      clip,
      playheadPosition: input.playheadPosition,
      getSourceTimeForClip: input.getSourceTimeForClip,
      getInterpolatedSpeed: input.getInterpolatedSpeed,
    });
    recordCheck({
      clipId: clip.id,
      isPlaying: false,
      playbackSpeed: input.playbackSpeed,
      clipReversed: clip.reversed === true,
      sourceType: clip.source?.type,
      renderHostMode: mode,
      candidate: true,
      reason: 'playback-start-prime',
      runtimeSourceId: source.runtimeSourceId,
      runtimeSessionKey: source.runtimeSessionKey,
    });
    readyPrimes.push(primeReverseWorkerRuntimeSourceAtTime(clip, source, clipTime));
  }

  const results = await Promise.all(readyPrimes);
  return results.filter(Boolean).length;
}

export function getReverseWorkerWebCodecsRuntimeDebugSnapshot(): {
  readonly cachedSourceCount: number;
  readonly lastCheck: ReverseWorkerWebCodecsRuntimeCheck | null;
  readonly lastStatus: ReverseWorkerWebCodecsRuntimeSourceStatus | null;
  readonly statuses: readonly ReverseWorkerWebCodecsRuntimeSourceStatus[];
} {
  const statuses = [...reverseWorkerRuntimeSources].map(([clipId, source]) => {
    const provider = peekRuntimeFrameProvider(source);
    return {
      clipId,
      runtimeSourceId: source?.runtimeSourceId,
      runtimeSessionKey: source?.runtimeSessionKey,
      hasProvider: Boolean(provider),
      providerFullMode: provider?.isFullMode() === true,
      hasFrame: provider?.hasFrame?.() === true || Boolean(provider?.getCurrentFrame()),
      isSeeking: provider?.isSeeking?.() === true,
      isDecodePending: provider?.isDecodePending?.() === true,
      pendingSeekTime: provider?.getPendingSeekTime?.() ?? null,
      currentTime: typeof provider?.currentTime === 'number' && Number.isFinite(provider.currentTime)
        ? provider.currentTime
        : null,
      frameRate: provider?.getFrameRate?.() ?? null,
      debugInfo: provider?.getDebugInfo?.() ?? null,
    };
  });
  return {
    cachedSourceCount: reverseWorkerRuntimeSources.size,
    lastCheck,
    lastStatus: selectReverseWorkerRuntimeStatus(statuses),
    statuses,
  };
}

export function isReverseWorkerWebCodecsCandidate(
  clip: TimelineClip,
  ctx: FrameContext,
): boolean {
  const mode = renderHostPort.getTelemetry().mode;
  const baseCheck = {
    clipId: clip.id,
    isPlaying: ctx.isPlaying,
    playbackSpeed: ctx.playbackSpeed,
    clipReversed: clip.reversed === true,
    sourceType: clip.source?.type,
    renderHostMode: mode,
  };
  const timeInfo = getClipTimeInfo(ctx, clip);
  const reverseRequested = ctx.playbackSpeed < 0 || clip.reversed || timeInfo.speed < 0;
  if (!flags.useFullWebCodecsPlayback) {
    recordCheck({ ...baseCheck, candidate: false, reason: 'webcodecs-disabled' });
    return false;
  }
  if (!ctx.isPlaying && !reverseRequested) {
    recordCheck({ ...baseCheck, candidate: false, reason: 'not-playing' });
    return false;
  }
  if (!clip.source || clip.source.type !== 'video') {
    recordCheck({ ...baseCheck, candidate: false, reason: 'not-video-source' });
    return false;
  }
  if (mode !== 'worker-presenting' && mode !== 'worker-only' && mode !== 'worker-gpu-only') {
    recordCheck({ ...baseCheck, candidate: false, reason: 'not-worker-render-host' });
    return false;
  }
  if (reverseRequested) {
    recordCheck({
      ...baseCheck,
      candidate: true,
      reason: ctx.isPlaying ? 'reverse-playback-speed-or-clip' : 'paused-reverse-prime',
    });
    return true;
  }
  recordCheck({ ...baseCheck, timeInfoSpeed: timeInfo.speed, candidate: false, reason: 'forward-playback' });
  return false;
}

export function getReverseWorkerRuntimeSource(
  clip: TimelineClip,
  ctx: FrameContext,
): TimelineClip['source'] {
  if (!isReverseWorkerWebCodecsCandidate(clip, ctx)) {
    return null;
  }
  if (clip.source?.runtimeSourceId && clip.source.runtimeSessionKey) {
    recordCheck({
      ...(lastCheck ?? {
        clipId: clip.id,
        isPlaying: ctx.isPlaying,
        playbackSpeed: ctx.playbackSpeed,
        clipReversed: clip.reversed === true,
        sourceType: clip.source?.type,
        renderHostMode: renderHostPort.getTelemetry().mode,
        candidate: true,
        reason: 'existing-runtime-source',
      }),
      candidate: true,
      reason: 'existing-runtime-source',
      runtimeSourceId: clip.source.runtimeSourceId,
      runtimeSessionKey: clip.source.runtimeSessionKey,
    });
    primeReverseWorkerRuntimeSource(clip, ctx, clip.source);
    return clip.source;
  }

  const cached = reverseWorkerRuntimeSources.get(clip.id);
  if (cached?.runtimeSourceId && cached.runtimeSessionKey) {
    recordCheck({
      ...(lastCheck ?? {
        clipId: clip.id,
        isPlaying: ctx.isPlaying,
        playbackSpeed: ctx.playbackSpeed,
        clipReversed: clip.reversed === true,
        sourceType: clip.source?.type,
        renderHostMode: renderHostPort.getTelemetry().mode,
        candidate: true,
        reason: 'cached-runtime-source',
      }),
      candidate: true,
      reason: 'cached-runtime-source',
      runtimeSourceId: cached.runtimeSourceId,
      runtimeSessionKey: cached.runtimeSessionKey,
    });
    primeReverseWorkerRuntimeSource(clip, ctx, cached);
    return cached;
  }

  const mediaFile = getMediaFileForClip(ctx, clip);
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId ?? mediaFile?.id;
  const file = clip.file ?? mediaFile?.file;
  if (!mediaFileId || !file) {
    recordCheck({
      ...(lastCheck ?? {
        clipId: clip.id,
        isPlaying: ctx.isPlaying,
        playbackSpeed: ctx.playbackSpeed,
        clipReversed: clip.reversed === true,
        sourceType: clip.source?.type,
        renderHostMode: renderHostPort.getTelemetry().mode,
        candidate: true,
        reason: 'missing-runtime-file',
      }),
      candidate: true,
      reason: !mediaFileId ? 'missing-media-file-id' : 'missing-file',
    });
    return null;
  }

  const boundSource = bindSourceRuntimeToClip({
    clipId: clip.id,
    source: clip.source,
    file,
    mediaFileId,
  });
  if (!boundSource?.runtimeSourceId || !boundSource.runtimeSessionKey) {
    recordCheck({
      ...(lastCheck ?? {
        clipId: clip.id,
        isPlaying: ctx.isPlaying,
        playbackSpeed: ctx.playbackSpeed,
        clipReversed: clip.reversed === true,
        sourceType: clip.source?.type,
        renderHostMode: renderHostPort.getTelemetry().mode,
        candidate: true,
        reason: 'bind-runtime-source-failed',
      }),
      candidate: true,
      reason: 'bind-runtime-source-failed',
    });
    return null;
  }

  reverseWorkerRuntimeSources.set(clip.id, boundSource);
  recordCheck({
    ...(lastCheck ?? {
      clipId: clip.id,
      isPlaying: ctx.isPlaying,
      playbackSpeed: ctx.playbackSpeed,
      clipReversed: clip.reversed === true,
      sourceType: clip.source?.type,
      renderHostMode: renderHostPort.getTelemetry().mode,
      candidate: true,
      reason: 'bound-runtime-source',
    }),
    candidate: true,
    reason: 'bound-runtime-source',
    runtimeSourceId: boundSource.runtimeSourceId,
    runtimeSessionKey: boundSource.runtimeSessionKey,
  });
  primeReverseWorkerRuntimeSource(clip, ctx, boundSource);
  return boundSource;
}

export function releaseReverseWorkerRuntimeSources(): void {
  for (const [clipId, source] of reverseWorkerRuntimeSources) {
    releaseRuntimePlaybackSession(source);
    releaseClipSourceRuntime({ id: clipId, source });
    reverseWorkerPrimeRequests.delete(clipId);
  }
  reverseWorkerRuntimeSources.clear();
}
