import { useTimelineStore } from '../../../stores/timeline';
import { resolveVideoSyncMedia } from '../../layerBuilder/videoSyncMediaResolver';
import { renderHostPort } from '../../render/renderHostPort';
import type { ToolResult } from '../types';

interface NumberSummary {
  readonly count: number;
  readonly min: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

interface FramePacingSample {
  readonly atMs: number;
  readonly rafGapMs: number;
  readonly playhead: number;
  readonly playheadDeltaSec: number;
  readonly playheadVelocity: number;
  readonly domLeftPx: number | null;
  readonly domDeltaPx: number | null;
  readonly domVelocityPx: number | null;
  readonly renderCount: number | null;
  readonly isPlaying: boolean;
  readonly videoCurrentTime: number | null;
  readonly videoTotalFrames: number | null;
  readonly videoDroppedFrames: number | null;
  readonly videoReadyState: number | null;
  readonly videoPaused: boolean | null;
}

interface VideoSnapshot {
  readonly currentTime: number | null;
  readonly totalFrames: number | null;
  readonly droppedFrames: number | null;
  readonly corruptedFrames: number | null;
  readonly readyState: number | null;
  readonly paused: boolean | null;
  readonly playbackRate: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly count: number;
}

interface VideoFrameCallbackEvent {
  readonly atMs: number;
  readonly mediaTime: number | null;
  readonly presentedFrames: number | null;
  readonly expectedDisplayTime: number | null;
}

interface VideoFrameCallbackMetadataLike {
  readonly mediaTime?: number;
  readonly presentedFrames?: number;
  readonly expectedDisplayTime?: number;
}

interface LongAnimationFrameScriptLike {
  readonly duration?: number;
  readonly invoker?: string;
  readonly invokerType?: string;
  readonly sourceURL?: string;
  readonly sourceFunctionName?: string;
  readonly forcedStyleAndLayoutDuration?: number;
}

interface LongAnimationFrameEntryLike extends PerformanceEntry {
  readonly blockingDuration?: number;
  readonly renderStart?: number;
  readonly styleAndLayoutStart?: number;
  readonly scripts?: readonly LongAnimationFrameScriptLike[];
}

type VideoFrameCallbackHandle = number;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadataLike) => void
  ) => VideoFrameCallbackHandle;
  cancelVideoFrameCallback?: (handle: VideoFrameCallbackHandle) => void;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampDurationMs(value: unknown): number {
  const parsed = finiteNumber(value);
  return Math.max(500, Math.min(30000, Math.round(parsed ?? 10000)));
}

function summarizeNumbers(values: readonly number[]): NumberSummary {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return { count: 0, min: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = finiteValues.toSorted((left, right) => left - right);
  const percentile = (p: number): number => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
    return round(sorted[index] ?? 0);
  };
  const sum = finiteValues.reduce((total, value) => total + value, 0);
  return {
    count: finiteValues.length,
    min: round(sorted[0] ?? 0),
    avg: round(sum / finiteValues.length),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: round(sorted.at(-1) ?? 0),
  };
}

function countAtLeast(values: readonly number[], threshold: number): number {
  return values.filter((value) => value >= threshold).length;
}

function readRenderCount(): number | null {
  const loop = renderHostPort.getRenderLoop() as {
    readonly renderCount?: unknown;
    readonly getRenderCount?: () => unknown;
  } | null;
  const getterValue = typeof loop?.getRenderCount === 'function'
    ? finiteNumber(loop.getRenderCount())
    : null;
  return getterValue ?? finiteNumber(loop?.renderCount);
}

function readTimelinePlayheadLeftPx(): number | null {
  if (typeof document === 'undefined') return null;
  const playhead = document.querySelector<HTMLElement>('[data-ai-id="timeline-playhead"], .playhead');
  if (!playhead) return null;
  const liveLeft = Number.parseFloat(playhead.dataset.liveLeft ?? '');
  if (Number.isFinite(liveLeft)) return liveLeft;
  const inlineLeft = Number.parseFloat(playhead.style.left);
  return Number.isFinite(inlineLeft) ? inlineLeft : null;
}

function collectTimelineVideos(): VideoWithFrameCallback[] {
  const state = useTimelineStore.getState();
  const visibleVideoTrackIds = new Set(
    state.tracks
      .filter((track) => track.type === 'video' && track.visible !== false)
      .map((track) => track.id)
  );
  const scored: Array<{ readonly video: VideoWithFrameCallback; readonly score: number }> = [];
  for (const clip of state.clips) {
    const video = resolveVideoSyncMedia(clip).htmlVideoElement as VideoWithFrameCallback | null;
    if (!video) continue;
    const clipEnd = clip.startTime + clip.duration;
    const activeAtPlayhead = state.playheadPosition >= clip.startTime && state.playheadPosition < clipEnd;
    const visibleTrack = !clip.trackId || visibleVideoTrackIds.has(clip.trackId);
    scored.push({
      video,
      score:
        (activeAtPlayhead ? 1000 : 0) +
        (visibleTrack ? 100 : 0) +
        (video.paused ? 0 : 50) +
        video.readyState +
        (video.seeking ? -20 : 0),
    });
  }
  return scored
    .toSorted((left, right) => right.score - left.score)
    .map((entry) => entry.video);
}

function collectCandidateVideos(): VideoWithFrameCallback[] {
  const timelineVideos = collectTimelineVideos();
  if (typeof document === 'undefined') return timelineVideos;
  const videos = [...document.querySelectorAll<HTMLVideoElement>('video')];
  const seen = new Set<VideoWithFrameCallback>(timelineVideos);
  for (const video of videos) {
    if (!seen.has(video as VideoWithFrameCallback)) {
      timelineVideos.push(video as VideoWithFrameCallback);
      seen.add(video as VideoWithFrameCallback);
    }
  }
  return timelineVideos;
}

function selectPrimaryVideo(): VideoWithFrameCallback | null {
  const videos = collectCandidateVideos();
  if (videos.length === 0) return null;
  return videos.toSorted((left, right) => {
    const leftScore = (left.paused ? 0 : 100) + left.readyState + (left.seeking ? -10 : 0);
    const rightScore = (right.paused ? 0 : 100) + right.readyState + (right.seeking ? -10 : 0);
    return rightScore - leftScore;
  })[0] as VideoWithFrameCallback;
}

function readVideoSnapshot(video: VideoWithFrameCallback | null = selectPrimaryVideo()): VideoSnapshot {
  const videos = collectCandidateVideos().length;
  if (!video) {
    return {
      currentTime: null,
      totalFrames: null,
      droppedFrames: null,
      corruptedFrames: null,
      readyState: null,
      paused: null,
      playbackRate: null,
      width: null,
      height: null,
      count: videos,
    };
  }
  const quality = typeof video.getVideoPlaybackQuality === 'function'
    ? video.getVideoPlaybackQuality()
    : null;
  return {
    currentTime: finiteNumber(video.currentTime),
    totalFrames: finiteNumber(quality?.totalVideoFrames),
    droppedFrames: finiteNumber(quality?.droppedVideoFrames),
    corruptedFrames: finiteNumber(quality?.corruptedVideoFrames),
    readyState: finiteNumber(video.readyState),
    paused: video.paused,
    playbackRate: finiteNumber(video.playbackRate),
    width: finiteNumber(video.videoWidth),
    height: finiteNumber(video.videoHeight),
    count: videos,
  };
}

function changedGapSummary(
  samples: readonly FramePacingSample[],
  readValue: (sample: FramePacingSample) => number | null,
  epsilon: number,
): { readonly changeCount: number; readonly gapMs: NumberSummary } {
  const changedAt: number[] = [];
  let previous: number | null = null;
  for (const sample of samples) {
    const value = readValue(sample);
    if (value === null) continue;
    if (previous === null || Math.abs(value - previous) > epsilon) {
      changedAt.push(sample.atMs);
    }
    previous = value;
  }
  const gaps: number[] = [];
  for (let index = 1; index < changedAt.length; index++) {
    gaps.push(changedAt[index] - changedAt[index - 1]);
  }
  return {
    changeCount: changedAt.length,
    gapMs: summarizeNumbers(gaps),
  };
}

function summarizeRaf(samples: readonly FramePacingSample[], elapsedMs: number) {
  const gaps = samples.map((sample) => sample.rafGapMs).filter((gap) => gap > 0);
  return {
    sampleCount: samples.length,
    estimatedFps: round(samples.length / Math.max(0.001, elapsedMs / 1000)),
    gapMs: summarizeNumbers(gaps),
    over20ms: countAtLeast(gaps, 20),
    over25ms: countAtLeast(gaps, 25),
    over33ms: countAtLeast(gaps, 33),
    over50ms: countAtLeast(gaps, 50),
    over100ms: countAtLeast(gaps, 100),
    topGapsMs: gaps.toSorted((left, right) => right - left).slice(0, 12).map(round),
  };
}

function summarizePlayhead(samples: readonly FramePacingSample[]) {
  const deltas = samples.map((sample) => sample.playheadDeltaSec).filter(Number.isFinite);
  const velocities = samples.map((sample) => sample.playheadVelocity).filter(Number.isFinite);
  let backtrackCount = 0;
  let maxBacktrackSec = 0;
  let unchangedWhilePlaying = 0;
  for (const sample of samples) {
    if (sample.playheadDeltaSec < -0.0001) {
      backtrackCount += 1;
      maxBacktrackSec = Math.max(maxBacktrackSec, Math.abs(sample.playheadDeltaSec));
    }
    if (sample.isPlaying && Math.abs(sample.playheadDeltaSec) <= 0.0001) {
      unchangedWhilePlaying += 1;
    }
  }
  const first = samples[0] ?? null;
  const last = samples.at(-1) ?? null;
  return {
    start: first?.playhead ?? 0,
    end: last?.playhead ?? 0,
    advanceSec: round((last?.playhead ?? 0) - (first?.playhead ?? 0)),
    deltaSec: summarizeNumbers(deltas),
    velocity: summarizeNumbers(velocities),
    updateCadence: changedGapSummary(samples, (sample) => sample.playhead, 0.0001),
    unchangedWhilePlaying,
    backtrackCount,
    maxBacktrackSec: round(maxBacktrackSec),
  };
}

function summarizeDom(samples: readonly FramePacingSample[]) {
  const withDom = samples.filter((sample) => sample.domLeftPx !== null);
  const deltas = withDom
    .map((sample) => sample.domDeltaPx)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const velocities = withDom
    .map((sample) => sample.domVelocityPx)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  let backtrackCount = 0;
  let maxBacktrackPx = 0;
  let unchangedWhilePlaying = 0;
  for (const sample of withDom) {
    const delta = sample.domDeltaPx ?? 0;
    if (delta < -0.01) {
      backtrackCount += 1;
      maxBacktrackPx = Math.max(maxBacktrackPx, Math.abs(delta));
    }
    if (sample.isPlaying && Math.abs(delta) <= 0.01) {
      unchangedWhilePlaying += 1;
    }
  }
  return {
    sampleCount: withDom.length,
    deltaPx: summarizeNumbers(deltas),
    velocityPxPerSec: summarizeNumbers(velocities),
    updateCadence: changedGapSummary(samples, (sample) => sample.domLeftPx, 0.01),
    unchangedWhilePlaying,
    backtrackCount,
    maxBacktrackPx: round(maxBacktrackPx),
  };
}

function summarizeVideo(samples: readonly FramePacingSample[], initial: VideoSnapshot, final: VideoSnapshot, elapsedMs: number) {
  const videoSamples = samples.filter((sample) => sample.videoCurrentTime !== null);
  const first = videoSamples[0] ?? null;
  const last = videoSamples.at(-1) ?? null;
  const totalFrameAdvance = final.totalFrames !== null && initial.totalFrames !== null
    ? final.totalFrames - initial.totalFrames
    : null;
  const droppedFrameAdvance = final.droppedFrames !== null && initial.droppedFrames !== null
    ? final.droppedFrames - initial.droppedFrames
    : null;
  const sampleTotalFrameAdvance = last?.videoTotalFrames !== null && first?.videoTotalFrames !== null
    ? (last?.videoTotalFrames ?? 0) - (first?.videoTotalFrames ?? 0)
    : null;
  return {
    videoCount: final.count,
    selected: final,
    initial,
    totalFrameAdvance,
    droppedFrameAdvance,
    estimatedTotalFrameFps: totalFrameAdvance === null
      ? null
      : round(totalFrameAdvance / Math.max(0.001, elapsedMs / 1000)),
    sampleTotalFrameAdvance,
    sampleTotalFrameFps: sampleTotalFrameAdvance === null
      ? null
      : round(sampleTotalFrameAdvance / Math.max(0.001, elapsedMs / 1000)),
    currentTimeAdvanceSec: first?.videoCurrentTime !== null && last?.videoCurrentTime !== null
      ? round((last?.videoCurrentTime ?? 0) - (first?.videoCurrentTime ?? 0))
      : null,
    totalFrameCadence: changedGapSummary(samples, (sample) => sample.videoTotalFrames, 0.1),
    currentTimeCadence: changedGapSummary(samples, (sample) => sample.videoCurrentTime, 0.0001),
    readyState: summarizeNumbers(
      videoSamples
        .map((sample) => sample.videoReadyState)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ),
    pausedSamples: videoSamples.filter((sample) => sample.videoPaused === true).length,
  };
}

function summarizeVideoFrameCallbacks(events: readonly VideoFrameCallbackEvent[], elapsedMs: number) {
  const mediaTimes = events
    .map((event) => event.mediaTime)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const presentedFrames = events
    .map((event) => event.presentedFrames)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const gaps: number[] = [];
  for (let index = 1; index < events.length; index++) {
    gaps.push(events[index].atMs - events[index - 1].atMs);
  }
  const mediaGaps: number[] = [];
  for (let index = 1; index < mediaTimes.length; index++) {
    mediaGaps.push((mediaTimes[index] - mediaTimes[index - 1]) * 1000);
  }
  return {
    count: events.length,
    estimatedFps: round(events.length / Math.max(0.001, elapsedMs / 1000)),
    gapMs: summarizeNumbers(gaps),
    mediaGapMs: summarizeNumbers(mediaGaps),
    mediaTimeAdvanceSec: mediaTimes.length >= 2
      ? round((mediaTimes.at(-1) ?? 0) - (mediaTimes[0] ?? 0))
      : 0,
    presentedFrameAdvance: presentedFrames.length >= 2
      ? (presentedFrames.at(-1) ?? 0) - (presentedFrames[0] ?? 0)
      : 0,
    topGapsMs: gaps.toSorted((left, right) => right - left).slice(0, 12).map(round),
  };
}

export async function handleSamplePlaybackFramePacing(args: Record<string, unknown>): Promise<ToolResult> {
  const durationMs = clampDurationMs(args.durationMs);
  const startPlayback = args.startPlayback === true;
  const leavePlaying = args.leavePlaying === true;
  const includeSamples = args.includeSamples === true;
  const sampleLimit = Math.max(0, Math.min(2000, Math.round(finiteNumber(args.sampleLimit) ?? 240)));
  const startTime = finiteNumber(args.startTime);
  const timelineStore = useTimelineStore.getState();
  const wasPlaying = timelineStore.isPlaying;
  const initialPlayhead = timelineStore.playheadPosition;
  let measurementStartPlayhead = initialPlayhead;
  const initialRenderCount = readRenderCount();
  const samples: FramePacingSample[] = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const startedAt = performance.now();
  let frameId: number | null = null;
  let timeoutId: number | null = null;
  let previousFrameAt: number | null = null;
  let previousPlayhead: number | null = null;
  let previousDomLeft: number | null = null;
  let observer: PerformanceObserver | null = null;
  let primaryVideo: VideoWithFrameCallback | null = null;
  let initialVideoSnapshot: VideoSnapshot = readVideoSnapshot(null);
  let finalVideoSnapshot: VideoSnapshot = initialVideoSnapshot;
  let videoFrameCallbackHandle: VideoFrameCallbackHandle | null = null;
  let collectVideoFrameCallbacks = false;
  const videoFrameCallbackEvents: VideoFrameCallbackEvent[] = [];

  const scheduleVideoFrameCallback = () => {
    if (!collectVideoFrameCallbacks || !primaryVideo?.requestVideoFrameCallback) return;
    videoFrameCallbackHandle = primaryVideo.requestVideoFrameCallback((now, metadata) => {
      videoFrameCallbackHandle = null;
      if (!collectVideoFrameCallbacks) return;
      videoFrameCallbackEvents.push({
        atMs: round(now - startedAt),
        mediaTime: finiteNumber(metadata.mediaTime),
        presentedFrames: finiteNumber(metadata.presentedFrames),
        expectedDisplayTime: finiteNumber(metadata.expectedDisplayTime),
      });
      scheduleVideoFrameCallback();
    });
  };

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'long-animation-frame') {
            const frame = entry as LongAnimationFrameEntryLike;
            const scripts = [...(frame.scripts ?? [])]
              .toSorted((left, right) => (right.duration ?? 0) - (left.duration ?? 0))
              .slice(0, 5)
              .map((script) => ({
                durationMs: round(script.duration ?? 0),
                invoker: script.invoker ?? '',
                invokerType: script.invokerType ?? '',
                sourceURL: script.sourceURL ?? '',
                sourceFunctionName: script.sourceFunctionName ?? '',
                forcedStyleAndLayoutDurationMs: round(script.forcedStyleAndLayoutDuration ?? 0),
              }));
            longAnimationFrames.push({
              startMs: round(entry.startTime - startedAt),
              durationMs: round(entry.duration),
              blockingDurationMs: round(frame.blockingDuration ?? 0),
              renderStartMs: round((frame.renderStart ?? entry.startTime) - startedAt),
              styleAndLayoutStartMs: round((frame.styleAndLayoutStart ?? entry.startTime) - startedAt),
              scripts,
            });
          } else {
            longTasks.push({
              name: entry.name,
              startMs: round(entry.startTime - startedAt),
              durationMs: round(entry.duration),
              entryType: entry.entryType,
            });
          }
        }
      });
      observer.observe({ entryTypes: ['longtask', 'long-animation-frame'] });
    } catch {
      observer = null;
    }
  }

  try {
    if (startTime !== null) {
      useTimelineStore.getState().setPlayheadPosition(Math.max(0, startTime));
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    measurementStartPlayhead = useTimelineStore.getState().playheadPosition;
    if (startPlayback && !useTimelineStore.getState().isPlaying) {
      await useTimelineStore.getState().play();
    }
    primaryVideo = selectPrimaryVideo();
    initialVideoSnapshot = readVideoSnapshot(primaryVideo);
    collectVideoFrameCallbacks = true;
    scheduleVideoFrameCallback();

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      timeoutId = window.setTimeout(finish, durationMs + 1000);
      const tick = (timestamp: number) => {
        if (resolved) return;
        const state = useTimelineStore.getState();
        const domLeftPx = readTimelinePlayheadLeftPx();
        const videoSnapshot = readVideoSnapshot(primaryVideo);
        const rafGapMs = previousFrameAt === null ? 0 : timestamp - previousFrameAt;
        const playheadDeltaSec = previousPlayhead === null ? 0 : state.playheadPosition - previousPlayhead;
        const domDeltaPx = domLeftPx !== null && previousDomLeft !== null ? domLeftPx - previousDomLeft : null;
        samples.push({
          atMs: round(timestamp - startedAt),
          rafGapMs: round(rafGapMs),
          playhead: round(state.playheadPosition),
          playheadDeltaSec: round(playheadDeltaSec),
          playheadVelocity: rafGapMs > 0 ? round(playheadDeltaSec / (rafGapMs / 1000)) : 0,
          domLeftPx: domLeftPx === null ? null : round(domLeftPx),
          domDeltaPx: domDeltaPx === null ? null : round(domDeltaPx),
          domVelocityPx: domDeltaPx !== null && rafGapMs > 0 ? round(domDeltaPx / (rafGapMs / 1000)) : null,
          renderCount: readRenderCount(),
          isPlaying: state.isPlaying,
          videoCurrentTime: videoSnapshot.currentTime === null ? null : round(videoSnapshot.currentTime),
          videoTotalFrames: videoSnapshot.totalFrames,
          videoDroppedFrames: videoSnapshot.droppedFrames,
          videoReadyState: videoSnapshot.readyState,
          videoPaused: videoSnapshot.paused,
        });
        previousFrameAt = timestamp;
        previousPlayhead = state.playheadPosition;
        if (domLeftPx !== null) previousDomLeft = domLeftPx;
        if (timestamp - startedAt >= durationMs) {
          finish();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    collectVideoFrameCallbacks = false;
    if (
      videoFrameCallbackHandle !== null &&
      typeof primaryVideo?.cancelVideoFrameCallback === 'function'
    ) {
      primaryVideo.cancelVideoFrameCallback(videoFrameCallbackHandle);
    }
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    if (startPlayback && !wasPlaying && !leavePlaying) {
      useTimelineStore.getState().pause();
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const finalState = useTimelineStore.getState();
  finalVideoSnapshot = readVideoSnapshot(primaryVideo);
  const finalRenderCount = readRenderCount();
  const sampleTail = includeSamples && sampleLimit > 0
    ? samples.slice(-sampleLimit)
    : undefined;

  return {
    success: true,
    data: {
      durationMs,
      elapsedMs: round(elapsedMs),
      startedPlayback: startPlayback && !wasPlaying,
      wasPlaying,
      endedPlaying: finalState.isPlaying,
      page: {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      },
      timeline: {
        clipCount: finalState.clips.length,
        trackCount: finalState.tracks.length,
        originalPlayhead: round(initialPlayhead),
        initialPlayhead: round(measurementStartPlayhead),
        finalPlayhead: round(finalState.playheadPosition),
        playheadAdvanceSec: round(finalState.playheadPosition - measurementStartPlayhead),
      },
      renderLoop: {
        initialRenderCount,
        finalRenderCount,
        renderCountDelta: finalRenderCount !== null && initialRenderCount !== null
          ? finalRenderCount - initialRenderCount
          : null,
      },
      raf: summarizeRaf(samples, elapsedMs),
      playheadStore: summarizePlayhead(samples),
      domPlayhead: summarizeDom(samples),
      videoQuality: summarizeVideo(samples, initialVideoSnapshot, finalVideoSnapshot, elapsedMs),
      videoFrameCallbacks: summarizeVideoFrameCallbacks(videoFrameCallbackEvents, elapsedMs),
      longTaskCount: longTasks.length,
      longTasks: longTasks.slice(-24),
      longAnimationFrameCount: longAnimationFrames.length,
      longAnimationFrames: longAnimationFrames.slice(-12),
      ...(sampleTail ? { samples: sampleTail } : {}),
    },
  };
}
