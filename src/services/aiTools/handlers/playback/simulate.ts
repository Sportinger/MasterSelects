import { useTimelineStore } from '../../../../stores/timeline';
import { getPlayheadPosition } from '../../../layerBuilder/PlayheadState';
import { playbackHealthMonitor } from '../../../playbackHealthMonitor';
import { vfPipelineMonitor } from '../../../vfPipelineMonitor';
import { wcPipelineMonitor } from '../../../wcPipelineMonitor';
import { getReverseWorkerWebCodecsRuntimeDebugSnapshot } from '../../../layerBuilder/reverseWorkerWebCodecsRuntime';
import { renderHostPort } from '../../../render/renderHostPort';
import { fingerprintCanvas, type FrameFingerprint } from '../../frameFingerprint';
import { createScrubPlan, sampleScrubPlan } from '../../scrubSimulation';
import {
  clampPlaybackTime,
  collectPlaybackRunDiagnostics,
  readDurationMsArg,
  readFiniteNumber,
  waitForAnimationFrame,
  waitForTimeout,
  type PlaybackToolResult,
  type TimelineStore,
} from './runtime';
import {
  buildPlaybackPathPreset,
  findPlaybackPathAnchor,
  type PlaybackPathAnchor,
  type PlaybackPathPreset,
} from './pathPreset';
import {
  runPlaybackPathPlayStep,
  runPlaybackPathScrubStep,
} from './pathSteps';
import { runScrubMotion } from './scrubMotion';

const PLAYBACK_SAMPLE_INTERVAL_MS = 16;

interface VisiblePlaybackSample {
  readonly elapsedMs: number;
  readonly playheadPosition: number;
  readonly hash: string;
  readonly meanLuma: number;
  readonly nonBlankRatio: number;
  readonly colorRangeLuma: number;
}

interface ManualPauseRenderStats {
  decoder?: string;
  renderLoop?: {
    isPlaying?: boolean;
    isIdle?: boolean;
  };
  renderDispatcher?: {
    collectedLayerDetails?: Array<{
      previewPath?: string;
      targetMediaTime?: number;
      displayedMediaTime?: number;
    }>;
  };
}

function collectVisiblePlaybackSample(input: {
  readonly startedAt: number;
  readonly playheadPosition: number;
}): VisiblePlaybackSample | null {
  const canvas = renderHostPort.getCaptureCanvas()?.canvas ?? null;
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }

  let fingerprint: FrameFingerprint;
  try {
    fingerprint = fingerprintCanvas(canvas, {
      sampleWidth: 32,
      sampleHeight: 18,
    });
  } catch {
    return null;
  }

  return {
    elapsedMs: Math.round(performance.now() - input.startedAt),
    playheadPosition: Math.round(input.playheadPosition * 1000) / 1000,
    hash: fingerprint.hash,
    meanLuma: fingerprint.meanLuma,
    nonBlankRatio: fingerprint.nonBlankRatio,
    colorRangeLuma: fingerprint.colorRange.luma,
  };
}

function summarizeVisiblePlaybackSamples(samples: readonly VisiblePlaybackSample[]) {
  let hashChanges = 0;
  let previousHash: string | null = null;
  for (const sample of samples) {
    if (previousHash !== null && sample.hash !== previousHash) {
      hashChanges += 1;
    }
    previousHash = sample.hash;
  }
  const distinctHashes = new Set(samples.map((sample) => sample.hash)).size;
  return {
    sampleCount: samples.length,
    distinctHashes,
    hashChanges,
    firstHash: samples[0]?.hash ?? null,
    lastHash: samples.at(-1)?.hash ?? null,
    samples: samples.slice(0, 40),
  };
}

function summarizePreviewEvents(startMs: number, endMs: number) {
  const windowMs = Math.max(250, Math.ceil(endMs - startMs + 500));
  const events = vfPipelineMonitor.timeline(windowMs)
    .filter((event) => event.t >= startMs && event.t <= endMs);
  const previewEvents = events.filter((event) => event.type === 'vf_preview_frame');
  const previewPathCounts: Record<string, number> = {};
  const backwardFrames: Array<{
    t: number;
    previewPath?: string;
    targetTimeMs?: number;
    displayedTimeMs?: number;
    driftMs: number;
    changed?: string;
    targetMoved?: string;
  }> = [];
  const emptyFrames: Array<{
    t: number;
    previewPath?: string;
    targetTimeMs?: number;
    displayedTimeMs?: number;
  }> = [];

  for (const event of previewEvents) {
    const previewPath =
      typeof event.detail?.previewPath === 'string'
        ? event.detail.previewPath
        : 'unknown';
    previewPathCounts[previewPath] = (previewPathCounts[previewPath] ?? 0) + 1;

    const targetTimeMs =
      typeof event.detail?.targetTimeMs === 'number'
        ? event.detail.targetTimeMs
        : undefined;
    const displayedTimeMs =
      typeof event.detail?.displayedTimeMs === 'number'
        ? event.detail.displayedTimeMs
        : undefined;
    if (targetTimeMs !== undefined && displayedTimeMs !== undefined) {
      const signedDriftMs = displayedTimeMs - targetTimeMs;
      if (signedDriftMs < -20) {
        backwardFrames.push({
          t: Math.round(event.t * 10) / 10,
          previewPath,
          targetTimeMs,
          displayedTimeMs,
          driftMs: Math.round(signedDriftMs * 10) / 10,
          changed: typeof event.detail?.changed === 'string' ? event.detail.changed : undefined,
          targetMoved: typeof event.detail?.targetMoved === 'string' ? event.detail.targetMoved : undefined,
        });
      }
    }
    if (/^empty$|empty-hold|paused-empty-hold/.test(previewPath)) {
      emptyFrames.push({
        t: Math.round(event.t * 10) / 10,
        previewPath,
        targetTimeMs,
        displayedTimeMs,
      });
    }
  }

  return {
    eventCount: events.length,
    previewEventCount: previewEvents.length,
    previewPathCounts,
    backwardFrames: backwardFrames.slice(-20),
    emptyFrames: emptyFrames.slice(-20),
    pauseEvents: events
      .filter((event) => /pause|settle|seek|stop/.test(event.type))
      .slice(-20)
      .map((event) => ({
        t: Math.round(event.t * 10) / 10,
        type: event.type,
        detail: event.detail,
      })),
  };
}

function collectManualPauseVisibleSample(input: {
  readonly startedAt: number;
  readonly pauseAt: number | null;
  readonly timelineStore: TimelineStore;
  readonly phase: 'before' | 'after';
}) {
  const visible = collectVisiblePlaybackSample({
    startedAt: input.startedAt,
    playheadPosition: input.timelineStore.playheadPosition,
  });
  if (!visible) {
    return null;
  }

  const renderStats = renderHostPort.getStats() as ManualPauseRenderStats;
  const primaryLayer = renderStats.renderDispatcher?.collectedLayerDetails?.[0] ?? null;
  return {
    ...visible,
    phase: input.phase,
    sincePauseMs: input.pauseAt === null ? null : Math.round(performance.now() - input.pauseAt),
    isPlaying: input.timelineStore.isPlaying,
    previewPath: primaryLayer?.previewPath,
    targetMediaTime: primaryLayer?.targetMediaTime,
    displayedMediaTime: primaryLayer?.displayedMediaTime,
    renderLoopPlaying: renderStats.renderLoop?.isPlaying,
    renderLoopIdle: renderStats.renderLoop?.isIdle,
  };
}

function summarizeManualPauseSamples(
  samples: readonly NonNullable<ReturnType<typeof collectManualPauseVisibleSample>>[]
) {
  const afterSamples = samples.filter((sample) => sample.phase === 'after');
  const beforeSamples = samples.filter((sample) => sample.phase === 'before');
  const hashChanges = summarizeVisiblePlaybackSamples(afterSamples).hashChanges;
  const blankSamples = afterSamples.filter((sample) => sample.nonBlankRatio < 0.05);
  const countPreviewPaths = (
    pathSamples: readonly NonNullable<ReturnType<typeof collectManualPauseVisibleSample>>[]
  ) => {
    const counts: Record<string, number> = {};
    for (const sample of pathSamples) {
      const path = sample.previewPath ?? 'unknown';
      counts[path] = (counts[path] ?? 0) + 1;
    }
    return counts;
  };
  const visibleChanges: Array<{
    sincePauseMs: number | null;
    fromHash: string;
    toHash: string;
    fromPath?: string;
    toPath?: string;
    fromDisplayed?: number;
    toDisplayed?: number;
    fromTarget?: number;
    toTarget?: number;
    meanLumaDelta: number;
  }> = [];

  for (let i = 1; i < afterSamples.length; i += 1) {
    const previous = afterSamples[i - 1];
    const current = afterSamples[i];
    if (!previous || !current || previous.hash === current.hash) {
      continue;
    }
    visibleChanges.push({
      sincePauseMs: current.sincePauseMs,
      fromHash: previous.hash,
      toHash: current.hash,
      fromPath: previous.previewPath,
      toPath: current.previewPath,
      fromDisplayed: previous.displayedMediaTime,
      toDisplayed: current.displayedMediaTime,
      fromTarget: previous.targetMediaTime,
      toTarget: current.targetMediaTime,
      meanLumaDelta: Math.round(Math.abs(current.meanLuma - previous.meanLuma) * 100) / 100,
    });
  }
  const stateTransitions: Array<{
    atMs: number;
    phase: 'before' | 'after';
    fromPlaying: boolean;
    toPlaying: boolean;
    fromRenderLoopPlaying?: boolean;
    toRenderLoopPlaying?: boolean;
    fromPath?: string;
    toPath?: string;
    fromTarget?: number;
    toTarget?: number;
    fromDisplayed?: number;
    toDisplayed?: number;
  }> = [];
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (!previous || !current) {
      continue;
    }
    const changedPlayback = previous.isPlaying !== current.isPlaying
      || previous.renderLoopPlaying !== current.renderLoopPlaying;
    if (!changedPlayback) {
      continue;
    }
    stateTransitions.push({
      atMs: Math.round(current.elapsedMs),
      phase: current.phase,
      fromPlaying: previous.isPlaying,
      toPlaying: current.isPlaying,
      fromRenderLoopPlaying: previous.renderLoopPlaying,
      toRenderLoopPlaying: current.renderLoopPlaying,
      fromPath: previous.previewPath,
      toPath: current.previewPath,
      fromTarget: previous.targetMediaTime,
      toTarget: current.targetMediaTime,
      fromDisplayed: previous.displayedMediaTime,
      toDisplayed: current.displayedMediaTime,
    });
  }

  return {
    beforeSampleCount: beforeSamples.length,
    beforePlayingSampleCount: beforeSamples.filter((sample) => sample.isPlaying).length,
    beforeRenderLoopPlayingSampleCount: beforeSamples.filter((sample) => sample.renderLoopPlaying).length,
    afterSampleCount: afterSamples.length,
    afterDistinctHashes: new Set(afterSamples.map((sample) => sample.hash)).size,
    afterHashChanges: hashChanges,
    blankAfterSampleCount: blankSamples.length,
    previewPathCounts: countPreviewPaths(afterSamples),
    beforePreviewPathCounts: countPreviewPaths(beforeSamples),
    allPreviewPathCounts: countPreviewPaths(samples),
    stateTransitions: stateTransitions.slice(-20),
    firstBeforeSamples: beforeSamples.slice(0, 8),
    lastBeforeSamples: beforeSamples.slice(-12),
    visibleChanges: visibleChanges.slice(-20),
    firstAfterSamples: afterSamples.slice(0, 8),
    lastAfterSamples: afterSamples.slice(-12),
  };
}

function describeManualPauseEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }
  return {
    tagName: target.tagName,
    id: target.id || undefined,
    role: target.getAttribute('role') || undefined,
    ariaLabel: target.getAttribute('aria-label') || undefined,
    title: target.getAttribute('title') || undefined,
    className: typeof target.className === 'string'
      ? target.className.slice(0, 160)
      : undefined,
  };
}

function createManualPauseInputRecorder(startedAt: number) {
  const inputEvents: Array<Record<string, unknown>> = [];
  const eventTypes = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click'] as const;
  const listener = (event: Event) => {
    const base: Record<string, unknown> = {
      atMs: Math.round(performance.now() - startedAt),
      type: event.type,
      target: describeManualPauseEventTarget(event.target),
    };
    if (event instanceof KeyboardEvent) {
      base.key = event.key;
      base.code = event.code;
      base.repeat = event.repeat;
    }
    if (event instanceof PointerEvent) {
      base.pointerType = event.pointerType;
      base.button = event.button;
    }
    if (event instanceof MouseEvent && !(event instanceof PointerEvent)) {
      base.button = event.button;
    }
    inputEvents.push(base);
  };

  for (const type of eventTypes) {
    window.addEventListener(type, listener, true);
  }

  return {
    inputEvents,
    dispose: () => {
      for (const type of eventTypes) {
        window.removeEventListener(type, listener, true);
      }
    },
  };
}

export async function handleMonitorManualPause(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const waitMs = readDurationMsArg(args, 'waitMs', 20_000, 500, 120_000);
  const afterPauseMs = readDurationMsArg(args, 'afterPauseMs', 1_500, 100, 10_000);
  const sampleIntervalMs = readDurationMsArg(args, 'sampleIntervalMs', 33, 8, 1_000);
  const resetDiagnostics = args.resetDiagnostics !== false;
  const startPlayback = args.startPlayback === true;
  const autoPauseAfterMsValue = readFiniteNumber(args.autoPauseAfterMs);
  const autoPauseAfterMs =
    autoPauseAfterMsValue !== null
      ? Math.max(50, Math.min(60_000, autoPauseAfterMsValue))
      : null;
  const startTime = readFiniteNumber(args.startTime);
  const requestedPlaybackSpeed = readFiniteNumber(args.playbackSpeed);
  const playbackSpeed =
    requestedPlaybackSpeed !== null && requestedPlaybackSpeed !== 0
      ? requestedPlaybackSpeed
      : 1;
  const previousSpeed = timelineStore.playbackSpeed;

  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }

  const startedAt = performance.now();
  const inputRecorder = createManualPauseInputRecorder(startedAt);
  const waitDeadline = startedAt + waitMs;
  const samples: Array<NonNullable<ReturnType<typeof collectManualPauseVisibleSample>>> = [];
  let lastSampleAt = 0;
  let currentTimelineState = useTimelineStore.getState();
  let hasSeenPlaying = currentTimelineState.isPlaying;
  let previousPlaying = currentTimelineState.isPlaying;
  let pauseAt: number | null = null;
  let playbackWasAutoStarted = false;

  try {
    if (startPlayback) {
      if (currentTimelineState.isPlaying) {
        timelineStore.pause();
        await waitForAnimationFrame();
      }
      if (startTime !== null) {
        timelineStore.setPlayheadPosition(clampPlaybackTime(startTime, timelineStore.duration));
      }
      timelineStore.setDraggingPlayhead(false);
      timelineStore.setPlaybackSpeed(playbackSpeed);
      await waitForAnimationFrame();
      await timelineStore.play();
      timelineStore.setPlaybackSpeed(playbackSpeed);
      playbackWasAutoStarted = true;
      currentTimelineState = useTimelineStore.getState();
      hasSeenPlaying = currentTimelineState.isPlaying;
      previousPlaying = currentTimelineState.isPlaying;
      await waitForAnimationFrame(sampleIntervalMs);
    }

    const autoPauseAt = playbackWasAutoStarted && autoPauseAfterMs !== null
      ? performance.now() + autoPauseAfterMs
      : null;
    while (performance.now() < waitDeadline) {
      currentTimelineState = useTimelineStore.getState();
      const now = performance.now();
      if (now - lastSampleAt >= sampleIntervalMs) {
        const sample = collectManualPauseVisibleSample({
          startedAt,
          pauseAt: null,
          timelineStore: currentTimelineState,
          phase: 'before',
        });
        if (sample) {
          samples.push(sample);
        }
        lastSampleAt = now;
      }

      if (currentTimelineState.isPlaying) {
        hasSeenPlaying = true;
      }
      if (autoPauseAt !== null && currentTimelineState.isPlaying && now >= autoPauseAt) {
        timelineStore.pause();
        pauseAt = performance.now();
        previousPlaying = false;
        break;
      }
      if (hasSeenPlaying && previousPlaying && !currentTimelineState.isPlaying) {
        pauseAt = performance.now();
        break;
      }
      previousPlaying = currentTimelineState.isPlaying;
      await waitForAnimationFrame(sampleIntervalMs);
    }

    if (pauseAt !== null) {
      const afterDeadline = pauseAt + afterPauseMs;
      lastSampleAt = 0;
      while (performance.now() < afterDeadline) {
        currentTimelineState = useTimelineStore.getState();
        const now = performance.now();
        if (now - lastSampleAt >= sampleIntervalMs) {
          const sample = collectManualPauseVisibleSample({
            startedAt,
            pauseAt,
            timelineStore: currentTimelineState,
            phase: 'after',
          });
          if (sample) {
            samples.push(sample);
          }
          lastSampleAt = now;
        }
        await waitForAnimationFrame(sampleIntervalMs);
      }
      }
  } finally {
    inputRecorder.dispose();
    if (playbackWasAutoStarted) {
      if (pauseAt === null) {
        timelineStore.pause();
      }
      timelineStore.setPlaybackSpeed(previousSpeed);
    }
  }

  const endedAt = performance.now();
  const finalStats = renderHostPort.getStats() as ManualPauseRenderStats;
  return {
    success: true,
    data: {
      detectedPause: pauseAt !== null,
      waitMs,
      afterPauseMs,
      sampleIntervalMs,
      startPlayback,
      autoPauseAfterMs,
      startTime,
      playbackSpeed,
      totalDurationMs: Math.round(endedAt - startedAt),
      pauseAtMs: pauseAt === null ? null : Math.round(pauseAt - startedAt),
      inputEvents: inputRecorder.inputEvents.slice(-80),
      sampleSummary: summarizeManualPauseSamples(samples),
      previewEvents: summarizePreviewEvents(startedAt, endedAt),
      finalRenderStats: {
        decoder: finalStats.decoder,
        renderLoop: finalStats.renderLoop,
        renderDispatcher: finalStats.renderDispatcher,
      },
    },
  };
}

export async function handleSimulateScrub(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const wasPlaying = timelineStore.isPlaying;
  const resetDiagnostics = args.resetDiagnostics !== false;
  timelineStore.pause();
  await waitForAnimationFrame();

  const plan = createScrubPlan(args, timelineStore.playheadPosition, timelineStore.duration);
  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }
  const startedAt = performance.now();
  const scrubResult = await runScrubMotion(
    timelineStore,
    plan.totalDurationMs,
    (elapsedMs) => sampleScrubPlan(plan, elapsedMs),
    false
  );
  const endedAt = performance.now();
  const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, endedAt);

  return {
    success: true,
    data: {
      pattern: plan.pattern,
      speed: plan.speed,
      durationMs: scrubResult.actualDurationMs,
      requestedDurationMs: plan.totalDurationMs,
      segmentDurationMs: plan.segmentDurationMs,
      waypoints: plan.points.slice(0, 16),
      waypointCount: plan.points.length,
      initialPosition: scrubResult.initialPosition,
      finalPosition: scrubResult.finalPosition,
      minTime: plan.minTime,
      maxTime: plan.maxTime,
      minVisited: scrubResult.minVisited,
      maxVisited: scrubResult.maxVisited,
      framesApplied: scrubResult.framesApplied,
      wasPlaying,
      dragMode: scrubResult.dragMode,
      pausedAfterGrab: scrubResult.pausedAfterGrab,
      zoom: scrubResult.zoom,
      scrollX: scrubResult.scrollX,
      startClientX: scrubResult.startClientX,
      endClientX: scrubResult.endClientX,
      pixelDistance: scrubResult.pixelDistance,
      released: true,
      seed: plan.seed,
      resetDiagnostics,
      runDiagnostics,
    },
  };
}

export async function handleSimulatePlayback(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const requestedDurationMs = readDurationMsArg(args, 'durationMs', 10_000, 100, 60_000);
  const settleMs = readDurationMsArg(args, 'settleMs', 150, 0, 5_000);
  const requestedPlaybackSpeed = readFiniteNumber(args.playbackSpeed);
  const playbackSpeed =
    requestedPlaybackSpeed !== null && requestedPlaybackSpeed !== 0
      ? requestedPlaybackSpeed
      : 1;
  const resetDiagnostics = args.resetDiagnostics !== false;
  const restorePlaybackState = args.restorePlaybackState === true;
  const sampleVisibleFrames = args.sampleVisibleFrames === true;
  const visibleSampleIntervalMs = readDurationMsArg(args, 'visibleSampleIntervalMs', 100, 16, 2000);

  const wasPlaying = timelineStore.isPlaying;
  const previousSpeed = timelineStore.playbackSpeed;
  let completed = false;
  let restoredPlaybackState = false;

  try {
    if (wasPlaying) {
      timelineStore.pause();
      await waitForAnimationFrame();
    }

    const startTime = readFiniteNumber(args.startTime);
    if (startTime !== null) {
      timelineStore.setPlayheadPosition(
        clampPlaybackTime(startTime, timelineStore.duration)
      );
    }

    timelineStore.setDraggingPlayhead(false);
    await waitForAnimationFrame();

    if (resetDiagnostics) {
      wcPipelineMonitor.reset();
      vfPipelineMonitor.reset();
      playbackHealthMonitor.reset();
    }

    timelineStore.setPlaybackSpeed(playbackSpeed);
    await waitForAnimationFrame();
    await timelineStore.play();
    timelineStore.setPlaybackSpeed(playbackSpeed);

    const startedAt = performance.now();
    const deadlineAt = startedAt + requestedDurationMs;
    const initialState = useTimelineStore.getState();
    const initialPosition = getPlayheadPosition(initialState.playheadPosition);
    let previousPosition = initialPosition;
    let framesObserved = 0;
    let movingFrames = 0;
    let stalledFrames = 0;
    let currentStallFrames = 0;
    let currentStallStartedAt = startedAt;
    let longestStallFrames = 0;
    let longestStallMs = 0;
    let minVisited = initialPosition;
    let maxVisited = initialPosition;
    let maxStepSeconds = 0;
    let lastVisibleSampleAt = Number.NEGATIVE_INFINITY;
    const visibleSamples: VisiblePlaybackSample[] = [];

    while (true) {
      const remainingMs = Math.max(0, deadlineAt - performance.now());
      await waitForTimeout(Math.min(PLAYBACK_SAMPLE_INTERVAL_MS, remainingMs));
      const now = performance.now();
      const state = useTimelineStore.getState();
      const position = getPlayheadPosition(state.playheadPosition);
      const stepSeconds = Math.abs(position - previousPosition);

      framesObserved++;
      minVisited = Math.min(minVisited, position);
      maxVisited = Math.max(maxVisited, position);
      maxStepSeconds = Math.max(maxStepSeconds, stepSeconds);
      if (sampleVisibleFrames && now - lastVisibleSampleAt >= visibleSampleIntervalMs) {
        const visibleSample = collectVisiblePlaybackSample({
          startedAt,
          playheadPosition: position,
        });
        if (visibleSample) {
          visibleSamples.push(visibleSample);
          lastVisibleSampleAt = now;
        }
      }

      if (stepSeconds > 0.0001) {
        movingFrames++;
        if (currentStallFrames > 0) {
          longestStallFrames = Math.max(longestStallFrames, currentStallFrames);
          longestStallMs = Math.max(longestStallMs, now - currentStallStartedAt);
          currentStallFrames = 0;
        }
      } else {
        stalledFrames++;
        if (currentStallFrames === 0) {
          currentStallStartedAt = now;
        }
        currentStallFrames++;
      }

      previousPosition = position;

      if (now >= deadlineAt || performance.now() >= deadlineAt) {
        break;
      }
    }

    if (currentStallFrames > 0) {
      longestStallFrames = Math.max(longestStallFrames, currentStallFrames);
      longestStallMs = Math.max(longestStallMs, performance.now() - currentStallStartedAt);
    }

    const playbackEndedAt = performance.now();
    const playbackEndState = useTimelineStore.getState();
    const playbackEndPosition = getPlayheadPosition(playbackEndState.playheadPosition);
    const reverseWorkerWebCodecsBeforePause = getReverseWorkerWebCodecsRuntimeDebugSnapshot();
    const renderHostBeforePause = renderHostPort.getTelemetry();
    const pauseSnapshots: Record<string, unknown>[] = [
      readWorkerGpuPauseSnapshot('beforePause'),
    ];
    timelineStore.pause();
    pauseSnapshots.push(readWorkerGpuPauseSnapshot('afterPauseCall'));
    await waitForAnimationFrame();
    pauseSnapshots.push(readWorkerGpuPauseSnapshot('afterPauseFrame'));
    if (settleMs > 0) {
      await waitForTimeout(settleMs);
    }
    await waitForAnimationFrame();
    pauseSnapshots.push(readWorkerGpuPauseSnapshot('afterSettle'));

    timelineStore.setPlaybackSpeed(previousSpeed);
    if (restorePlaybackState && wasPlaying) {
      await timelineStore.play();
      timelineStore.setPlaybackSpeed(previousSpeed);
      restoredPlaybackState = true;
    }

    const finalState = useTimelineStore.getState();
    const actualDurationMs = Math.round(playbackEndedAt - startedAt);
    const observedSampleFps = actualDurationMs > 0
      ? Math.round((framesObserved / (actualDurationMs / 1000)) * 10) / 10
      : 0;
    const deltaSeconds = playbackEndPosition - initialPosition;
    const expectedDeltaSeconds = (requestedDurationMs / 1000) * playbackSpeed;
    const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, playbackEndedAt);

    completed = true;
    return {
      success: true,
      data: {
        requestedDurationMs,
        actualDurationMs,
        playbackSpeed,
        initialPosition,
        finalPosition: playbackEndPosition,
        deltaSeconds,
        expectedDeltaSeconds,
        driftSeconds: deltaSeconds - expectedDeltaSeconds,
        framesObserved,
        movingFrames,
        stalledFrames,
        observedSampleFps,
        longestStallFrames,
        longestStallMs: Math.round(longestStallMs),
        minVisited,
        maxVisited,
        maxStepSeconds,
        wasPlaying,
        restoredPlaybackState,
        resetDiagnostics,
        sampleVisibleFrames,
        visiblePlayback: sampleVisibleFrames
          ? summarizeVisiblePlaybackSamples(visibleSamples)
          : null,
        settled: settleMs > 0,
        endedPlaying: finalState.isPlaying,
        reverseWorkerWebCodecsBeforePause,
        renderHostBeforePause,
        pauseSnapshots,
        runDiagnostics,
      },
    };
  } finally {
    if (!completed || !restoredPlaybackState) {
      timelineStore.pause();
      timelineStore.setPlaybackSpeed(previousSpeed);
    }
  }
}

function summarizePulseNumbers(values: readonly number[]) {
  const finite = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (finite.length === 0) {
    return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
  }
  const sum = finite.reduce((total, value) => total + value, 0);
  const p95Index = Math.min(finite.length - 1, Math.floor((finite.length - 1) * 0.95));
  return {
    count: finite.length,
    min: Math.round((finite[0] ?? 0) * 100) / 100,
    avg: Math.round((sum / finite.length) * 100) / 100,
    p95: Math.round((finite[p95Index] ?? 0) * 100) / 100,
    max: Math.round((finite.at(-1) ?? 0) * 100) / 100,
  };
}

function readWorkerGpuVideoTimestamp(): number | null {
  const value = renderHostPort.getTelemetry().diagnostics?.lastGpuOnlyVideoFrameTimestampSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readWorkerGpuVideoDiagnostics(): Record<string, unknown> | null {
  const diagnostics = renderHostPort.getTelemetry().diagnostics ?? null;
  const stats = diagnostics?.lastGpuOnlyVideoFrameStats;
  if (!stats || typeof stats !== 'object') {
    return null;
  }
  return {
    presented: (stats as Record<string, unknown>)['workerGpu.videoFrame.presented'],
    mode: (stats as Record<string, unknown>)['workerGpu.videoFrame.mode'],
    timestampSeconds: (stats as Record<string, unknown>)['workerGpu.videoFrame.timestampSeconds'],
    targetMediaTime: (stats as Record<string, unknown>)['workerGpu.videoFrame.targetMediaTime'],
    currentFrameTimestampSeconds: (stats as Record<string, unknown>)['workerGpu.videoFrame.currentFrameTimestampSeconds'],
    decodePending: (stats as Record<string, unknown>)['workerGpu.videoFrame.decodePending'],
    decodeQueueSize: (stats as Record<string, unknown>)['workerGpu.videoFrame.decodeQueueSize'],
    frameBufferSize: (stats as Record<string, unknown>)['workerGpu.videoFrame.frameBufferSize'],
    sampleIndex: (stats as Record<string, unknown>)['workerGpu.videoFrame.sampleIndex'],
    feedIndex: (stats as Record<string, unknown>)['workerGpu.videoFrame.feedIndex'],
    pendingSeekKind: (stats as Record<string, unknown>)['workerGpu.videoFrame.pendingSeekKind'],
    pendingSeekTargetSeconds: (stats as Record<string, unknown>)['workerGpu.videoFrame.pendingSeekTargetSeconds'],
    pendingSeekFeedEndIndex: (stats as Record<string, unknown>)['workerGpu.videoFrame.pendingSeekFeedEndIndex'],
    lastDecodedFrameTimestampSeconds: (stats as Record<string, unknown>)['workerGpu.videoFrame.lastDecodedFrameTimestampSeconds'],
    reverseFrameCacheSize: (stats as Record<string, unknown>)['workerGpu.videoFrame.reverseFrameCacheSize'],
    decodeErrorCount: (stats as Record<string, unknown>)['workerGpu.videoFrame.decodeErrorCount'],
  };
}

function readWorkerGpuPauseSnapshot(label: string): Record<string, unknown> {
  const state = useTimelineStore.getState();
  const telemetry = renderHostPort.getTelemetry();
  const diagnostics = telemetry.diagnostics ?? null;
  const statsValue = diagnostics?.lastGpuOnlyVideoFrameStats;
  const stats = statsValue && typeof statsValue === 'object'
    ? statsValue as Record<string, unknown>
    : {};
  return {
    label,
    isPlaying: state.isPlaying,
    playheadPosition: getPlayheadPosition(state.playheadPosition),
    renderHostMode: telemetry.mode,
    lastGpuOnlyVideoFrameTimestampSeconds:
      diagnostics?.lastGpuOnlyVideoFrameTimestampSeconds ?? null,
    pendingGpuFrameCount: diagnostics?.pendingGpuFrameCount ?? null,
    inFlightGpuFrameCount: diagnostics?.inFlightGpuFrameCount ?? null,
    activeGpuStreamCount: diagnostics?.activeGpuStreamCount ?? null,
    pendingGpuStreamStartCount: diagnostics?.pendingGpuStreamStartCount ?? null,
    mode: stats['workerGpu.videoFrame.mode'] ?? null,
    streaming: stats['workerGpu.videoFrame.streaming'] ?? null,
    targetMediaTime: stats['workerGpu.videoFrame.targetMediaTime'] ?? null,
    timestampSeconds: stats['workerGpu.videoFrame.timestampSeconds'] ?? null,
    currentFrameTimestampSeconds: stats['workerGpu.videoFrame.currentFrameTimestampSeconds'] ?? null,
    decodePending: stats['workerGpu.videoFrame.decodePending'] ?? null,
    pendingSeekKind: stats['workerGpu.videoFrame.pendingSeekKind'] ?? null,
    pendingSeekTargetSeconds: stats['workerGpu.videoFrame.pendingSeekTargetSeconds'] ?? null,
    presented: stats['workerGpu.videoFrame.presented'] ?? null,
    submitted: stats['workerGpu.videoFrame.submitted'] ?? null,
    workerStreamPresentedFrameCount:
      stats['workerGpu.videoFrame.workerStream.presentedFrameCount'] ?? null,
    workerStreamDistinctFrameCount:
      stats['workerGpu.videoFrame.workerStream.distinctFrameCount'] ?? null,
    workerStreamFailureCount:
      stats['workerGpu.videoFrame.workerStream.failureCount'] ?? null,
  };
}

async function samplePulsePhase(input: {
  readonly cycleStartedAt: number;
  readonly deadlineAt: number;
  readonly startPosition: number;
  readonly previousPosition: number;
  readonly firstPlayingMs: number | null;
  readonly firstMovementMs: number | null;
}): Promise<{
  readonly previousPosition: number;
  readonly firstPlayingMs: number | null;
  readonly firstMovementMs: number | null;
  readonly framesObserved: number;
  readonly movingFrames: number;
  readonly stalledPlayingFrames: number;
  readonly sourceMovingFrames: number;
  readonly sourceStalledPlayingFrames: number;
  readonly longestSourceStallMs: number;
  readonly rafGapsMs: number[];
  readonly maxStepSeconds: number;
}> {
  let previousPosition = input.previousPosition;
  let firstPlayingMs = input.firstPlayingMs;
  let firstMovementMs = input.firstMovementMs;
  let previousFrameAt: number | null = null;
  let framesObserved = 0;
  let movingFrames = 0;
  let stalledPlayingFrames = 0;
  let previousSourceTimestamp = readWorkerGpuVideoTimestamp();
  let sourceMovingFrames = 0;
  let sourceStalledPlayingFrames = 0;
  let currentSourceStallStartedAt: number | null = null;
  let longestSourceStallMs = 0;
  let maxStepSeconds = 0;
  const rafGapsMs: number[] = [];

  while (performance.now() < input.deadlineAt) {
    const timestamp = await waitForAnimationFrame();
    const state = useTimelineStore.getState();
    const position = getPlayheadPosition(state.playheadPosition);
    const sourceTimestamp = readWorkerGpuVideoTimestamp();
    const stepSeconds = Math.abs(position - previousPosition);
    const sourceStepSeconds = sourceTimestamp !== null && previousSourceTimestamp !== null
      ? Math.abs(sourceTimestamp - previousSourceTimestamp)
      : 0;
    if (previousFrameAt !== null) {
      rafGapsMs.push(timestamp - previousFrameAt);
    }
    previousFrameAt = timestamp;
    framesObserved += 1;
    maxStepSeconds = Math.max(maxStepSeconds, stepSeconds);
    if (firstPlayingMs === null && state.isPlaying) {
      firstPlayingMs = performance.now() - input.cycleStartedAt;
    }
    if (firstMovementMs === null && Math.abs(position - input.startPosition) > 0.0001) {
      firstMovementMs = performance.now() - input.cycleStartedAt;
    }
    if (stepSeconds > 0.0001) {
      movingFrames += 1;
    } else if (state.isPlaying) {
      stalledPlayingFrames += 1;
    }
    if (state.isPlaying) {
      if (sourceStepSeconds > 0.0001) {
        sourceMovingFrames += 1;
        if (currentSourceStallStartedAt !== null) {
          longestSourceStallMs = Math.max(longestSourceStallMs, timestamp - currentSourceStallStartedAt);
          currentSourceStallStartedAt = null;
        }
      } else {
        sourceStalledPlayingFrames += 1;
        currentSourceStallStartedAt ??= timestamp;
      }
    }
    previousPosition = position;
    previousSourceTimestamp = sourceTimestamp;
  }

  if (currentSourceStallStartedAt !== null) {
    longestSourceStallMs = Math.max(longestSourceStallMs, performance.now() - currentSourceStallStartedAt);
  }

  return {
    previousPosition,
    firstPlayingMs,
    firstMovementMs,
    framesObserved,
    movingFrames,
    stalledPlayingFrames,
    sourceMovingFrames,
    sourceStalledPlayingFrames,
    longestSourceStallMs: Math.round(longestSourceStallMs * 10) / 10,
    rafGapsMs,
    maxStepSeconds,
  };
}

export async function handleSimulatePlaybackPulses(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const cycles = readDurationMsArg(args, 'cycles', 10, 1, 30);
  const firstPlayMs = readDurationMsArg(args, 'firstPlayMs', 1000, 50, 10_000);
  const playMs = readDurationMsArg(args, 'playMs', 500, 50, 10_000);
  const pauseMs = readDurationMsArg(args, 'pauseMs', 500, 0, 10_000);
  const initialPauseMs = readDurationMsArg(args, 'initialPauseMs', 500, 0, 10_000);
  const playbackSpeed = readFiniteNumber(args.playbackSpeed) ?? 1;
  const resetDiagnostics = args.resetDiagnostics !== false;
  const startTime = readFiniteNumber(args.startTime);
  const previousSpeed = timelineStore.playbackSpeed;
  const wasPlaying = timelineStore.isPlaying;
  let completed = false;

  try {
    if (wasPlaying) {
      timelineStore.pause();
      await waitForAnimationFrame();
    }
    timelineStore.setDraggingPlayhead(false);
    timelineStore.setPlaybackSpeed(playbackSpeed);
    if (startTime !== null) {
      timelineStore.setPlayheadPosition(clampPlaybackTime(startTime, timelineStore.duration));
    }
    if (initialPauseMs > 0) {
      await waitForTimeout(initialPauseMs);
    }
    await waitForAnimationFrame();

    if (resetDiagnostics) {
      wcPipelineMonitor.reset();
      vfPipelineMonitor.reset();
      playbackHealthMonitor.reset();
    }

    const runStartedAt = performance.now();
    const results: Record<string, unknown>[] = [];

    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const requestedPlayMs = cycle === 1 ? firstPlayMs : playMs;
      const cycleStartedAt = performance.now();
      const startState = useTimelineStore.getState();
      const startPosition = getPlayheadPosition(startState.playheadPosition);
      const startSourceTs = readWorkerGpuVideoTimestamp();
      const startVideoDiagnostics = readWorkerGpuVideoDiagnostics();
      let playResolvedAt: number | null = null;
      let playError: string | null = null;
      const playPromise = useTimelineStore.getState().play()
        .then(() => {
          playResolvedAt = performance.now();
        })
        .catch((error: unknown) => {
          playResolvedAt = performance.now();
          playError = error instanceof Error ? error.message : String(error);
        });

      let phase = await samplePulsePhase({
        cycleStartedAt,
        deadlineAt: cycleStartedAt + requestedPlayMs,
        startPosition,
        previousPosition: startPosition,
        firstPlayingMs: null,
        firstMovementMs: null,
      });
      if (playResolvedAt === null) {
        await playPromise;
      }
      if (performance.now() < cycleStartedAt + requestedPlayMs) {
        phase = await samplePulsePhase({
          cycleStartedAt,
          deadlineAt: cycleStartedAt + requestedPlayMs,
          startPosition,
          previousPosition: phase.previousPosition,
          firstPlayingMs: phase.firstPlayingMs,
          firstMovementMs: phase.firstMovementMs,
        });
      }

      const beforePauseState = useTimelineStore.getState();
      const beforePausePosition = getPlayheadPosition(beforePauseState.playheadPosition);
      const beforePauseSourceTs = readWorkerGpuVideoTimestamp();
      const beforePauseVideoDiagnostics = readWorkerGpuVideoDiagnostics();
      timelineStore.pause();
      const pausedAt = performance.now();
      if (pauseMs > 0) {
        await waitForTimeout(pauseMs);
      }
      await waitForAnimationFrame();
      const afterPauseState = useTimelineStore.getState();
      const afterPausePosition = getPlayheadPosition(afterPauseState.playheadPosition);
      const afterPauseSourceTs = readWorkerGpuVideoTimestamp();
      const afterPauseVideoDiagnostics = readWorkerGpuVideoDiagnostics();

      results.push({
        cycle,
        requestedPlayMs,
        pauseMs,
        playResolveMs: playResolvedAt === null ? null : Math.round((playResolvedAt - cycleStartedAt) * 10) / 10,
        firstPlayingMs: phase.firstPlayingMs === null ? null : Math.round(phase.firstPlayingMs * 10) / 10,
        firstMovementMs: phase.firstMovementMs === null ? null : Math.round(phase.firstMovementMs * 10) / 10,
        playError,
        startPosition,
        beforePausePosition,
        afterPausePosition,
        playheadAdvanceSeconds: beforePausePosition - startPosition,
        pauseDriftSeconds: afterPausePosition - beforePausePosition,
        startSourceTs,
        beforePauseSourceTs,
        afterPauseSourceTs,
        startVideoDiagnostics,
        beforePauseVideoDiagnostics,
        afterPauseVideoDiagnostics,
        endSourceDriftSeconds: beforePauseSourceTs === null ? null : beforePauseSourceTs - beforePausePosition,
        framesObserved: phase.framesObserved,
        movingFrames: phase.movingFrames,
        stalledPlayingFrames: phase.stalledPlayingFrames,
        sourceMovingFrames: phase.sourceMovingFrames,
        sourceStalledPlayingFrames: phase.sourceStalledPlayingFrames,
        longestSourceStallMs: phase.longestSourceStallMs,
        maxStepSeconds: phase.maxStepSeconds,
        rafGapMs: summarizePulseNumbers(phase.rafGapsMs),
        pausedAtMs: Math.round((pausedAt - cycleStartedAt) * 10) / 10,
      });
    }

    timelineStore.pause();
    timelineStore.setPlaybackSpeed(previousSpeed);
    const runEndedAt = performance.now();
    const runDiagnostics = collectPlaybackRunDiagnostics(runStartedAt, runEndedAt);
    completed = true;
    return {
      success: true,
      data: {
        cycles,
        firstPlayMs,
        playMs,
        pauseMs,
        initialPauseMs,
        playbackSpeed,
        startTime,
        resetDiagnostics,
        totalDurationMs: Math.round(runEndedAt - runStartedAt),
        results,
        renderHost: renderHostPort.getTelemetry(),
        runDiagnostics,
      },
    };
  } finally {
    if (!completed) {
      timelineStore.pause();
      timelineStore.setPlaybackSpeed(previousSpeed);
    }
  }
}

export async function handleSimulatePlaybackPath(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const preset: PlaybackPathPreset =
    args.preset === 'play_scrub_stress_v1'
      ? 'play_scrub_stress_v1'
      : 'play_scrub_stress_v1';
  const resetDiagnostics = args.resetDiagnostics !== false;
  const playbackSpeed =
    typeof args.playbackSpeed === 'number' && Number.isFinite(args.playbackSpeed) && args.playbackSpeed > 0
      ? args.playbackSpeed
      : 1;
  const anchor = findPlaybackPathAnchor(timelineStore);
  const requestedStartTime =
    typeof args.startTime === 'number' && Number.isFinite(args.startTime)
      ? clampPlaybackTime(args.startTime, timelineStore.duration)
      : clampPlaybackTime(anchor.clipStartTime, timelineStore.duration);
  const latestPlayableStartTime = Math.max(0, anchor.playableEndTime - 0.5);
  const startTime = clampPlaybackTime(
    Math.min(requestedStartTime, latestPlayableStartTime),
    timelineStore.duration
  );
  const pathAnchor: PlaybackPathAnchor = {
    ...anchor,
    clipStartTime: startTime,
    playableEndTime: Math.max(startTime, anchor.playableEndTime),
  };
  const steps = buildPlaybackPathPreset(preset, pathAnchor);
  const previousSpeed = timelineStore.playbackSpeed;

  timelineStore.pause();
  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlaybackSpeed(playbackSpeed);
  timelineStore.setPlayheadPosition(startTime);
  await waitForAnimationFrame();

  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }

  const startedAt = performance.now();
  const results: Record<string, unknown>[] = [];

  for (const step of steps) {
    if (step.kind === 'play') {
      results.push(await runPlaybackPathPlayStep(timelineStore, step));
    } else {
      results.push(await runPlaybackPathScrubStep(timelineStore, step));
    }
  }

  timelineStore.pause();
  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlaybackSpeed(previousSpeed);
  await waitForAnimationFrame();

  const finalState = useTimelineStore.getState();
  const endedAt = performance.now();
  const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, endedAt);

  return {
    success: true,
    data: {
      preset,
      diagnosticMode: 'playback_scrub_stress',
      clipStartTime: startTime,
      requestedStartTime,
      playableEndTime: pathAnchor.playableEndTime,
      clipId: anchor.clipId,
      clipName: anchor.clipName,
      playbackSpeed,
      resetDiagnostics,
      totalDurationMs: Math.round(endedAt - startedAt),
      steps: results,
      finalPosition: finalState.playheadPosition,
      endedPlaying: finalState.isPlaying,
      runDiagnostics,
    },
  };
}
