import { useTimelineStore } from '../../../stores/timeline';
import { undo as historyUndo, redo as historyRedo } from '../../../stores/historyStore';
import type { ToolResult } from '../types';
import { flashPreviewCanvas, animateMarker } from '../aiFeedback';
import { createScrubPlan, sampleScrubPlan } from '../scrubSimulation';
import { wcPipelineMonitor } from '../../wcPipelineMonitor';
import { vfPipelineMonitor } from '../../vfPipelineMonitor';
import { playbackHealthMonitor } from '../../playbackHealthMonitor';
import { useEngineStore } from '../../../stores/engineStore';
import { buildPlaybackRunDiagnostics } from '../../playbackDebugStats';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;
type PlaybackPathPreset = 'play_scrub_stress_v1';

type PlaybackPathStep =
  | {
    kind: 'play';
    label: string;
    durationMs: number;
    pauseAtEnd: boolean;
  }
  | {
    kind: 'scrub';
    label: string;
    durationMs: number;
    targetTime: number;
    beginWhilePlaying: boolean;
    pauseOnRelease: boolean;
  };

type ScrubMotionResult = {
  dragMode: 'dom_playhead' | 'store_fallback';
  actualDurationMs: number;
  initialPosition: number;
  finalPosition: number;
  requestedEndTime: number;
  framesApplied: number;
  minVisited: number;
  maxVisited: number;
  startedPlaying: boolean;
  pausedAfterGrab: boolean;
  endedPlaying: boolean;
  zoom: number;
  scrollX: number;
  startClientX?: number;
  endClientX?: number;
  pixelDistance?: number;
};

type TimelineDomDragTargets = {
  playhead: HTMLElement;
  tracks: HTMLElement;
};

export async function handlePlay(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  await timelineStore.play();
  return { success: true, data: { playing: true } };
}

export async function handlePause(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  timelineStore.pause();
  return { success: true, data: { playing: false } };
}

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(resolve);
      return;
    }
    setTimeout(() => resolve(performance.now()), 16);
  });
}

function clampPlaybackTime(time: number, duration: number): number {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return Math.min(safeDuration, Math.max(0, time));
}

function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function collectPlaybackRunDiagnostics(startMs: number, endMs: number) {
  const windowMs = Math.max(100, Math.ceil(endMs - startMs + 250));
  const { engineStats } = useEngineStore.getState();
  const healthAnomalies = playbackHealthMonitor
    .anomalies()
    .filter((anomaly) => anomaly.timestamp >= startMs && anomaly.timestamp <= endMs);

  return buildPlaybackRunDiagnostics({
    decoder: engineStats.decoder,
    startMs,
    endMs,
    wcEvents: wcPipelineMonitor.timeline(windowMs),
    vfEvents: vfPipelineMonitor.timeline(windowMs),
    healthVideos: playbackHealthMonitor.videos(),
    healthAnomalies,
  });
}

function getTimelineDomDragTargets(): TimelineDomDragTargets | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const playhead = document.querySelector<HTMLElement>('[data-ai-id="timeline-playhead"], .playhead');
  const tracks = document.querySelector<HTMLElement>('[data-ai-id="timeline-tracks"], .timeline-tracks');
  if (!playhead || !tracks) {
    return null;
  }

  return { playhead, tracks };
}

function dispatchSyntheticMouseEvent(
  target: Document | HTMLElement,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number
): void {
  if (typeof MouseEvent !== 'function') {
    return;
  }

  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: typeof window !== 'undefined' ? window : null,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
}

function getTimelineClientXForTime(time: number, tracks: HTMLElement): number {
  const { zoom, scrollX } = useTimelineStore.getState();
  return tracks.getBoundingClientRect().left + time * zoom - scrollX;
}

async function runStoreDrivenScrubMotion(
  timelineStore: TimelineStore,
  durationMs: number,
  sampleTimeAtElapsed: (elapsedMs: number) => number,
  pauseOnRelease: boolean
): Promise<ScrubMotionResult> {
  const state = useTimelineStore.getState();
  const duration = state.duration;
  const initialPosition = state.playheadPosition;
  const startedPlaying = state.isPlaying;
  const startedAt = performance.now();
  let framesApplied = 0;
  let minVisited = initialPosition;
  let maxVisited = initialPosition;
  let requestedEndTime = initialPosition;

  timelineStore.setDraggingPlayhead(true);

  try {
    while (true) {
      const elapsedMs = performance.now() - startedAt;
      requestedEndTime = clampPlaybackTime(sampleTimeAtElapsed(elapsedMs), duration);
      timelineStore.setPlayheadPosition(requestedEndTime);
      framesApplied++;
      const actualPosition = useTimelineStore.getState().playheadPosition;
      minVisited = Math.min(minVisited, requestedEndTime, actualPosition);
      maxVisited = Math.max(maxVisited, requestedEndTime, actualPosition);

      if (elapsedMs >= durationMs) {
        break;
      }

      await waitForAnimationFrame();
    }
  } finally {
    timelineStore.setDraggingPlayhead(false);
  }

  timelineStore.setPlayheadPosition(requestedEndTime);
  await waitForAnimationFrame();

  if (pauseOnRelease && useTimelineStore.getState().isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  const finalState = useTimelineStore.getState();
  return {
    dragMode: 'store_fallback',
    actualDurationMs: Math.round(performance.now() - startedAt),
    initialPosition,
    finalPosition: finalState.playheadPosition,
    requestedEndTime,
    framesApplied,
    minVisited,
    maxVisited,
    startedPlaying,
    pausedAfterGrab: false,
    endedPlaying: finalState.isPlaying,
    zoom: state.zoom,
    scrollX: state.scrollX,
  };
}

async function runDomPlayheadScrubMotion(
  timelineStore: TimelineStore,
  domTargets: TimelineDomDragTargets,
  durationMs: number,
  sampleTimeAtElapsed: (elapsedMs: number) => number,
  pauseOnRelease: boolean
): Promise<ScrubMotionResult> {
  const initialState = useTimelineStore.getState();
  const initialPosition = initialState.playheadPosition;
  const duration = initialState.duration;
  const startedPlaying = initialState.isPlaying;
  const playheadRect = domTargets.playhead.getBoundingClientRect();
  const tracksRect = domTargets.tracks.getBoundingClientRect();
  const startClientX =
    playheadRect.width > 0
      ? playheadRect.left + playheadRect.width / 2
      : getTimelineClientXForTime(initialPosition, domTargets.tracks);
  const clientY =
    playheadRect.height > 0
      ? playheadRect.top + playheadRect.height / 2
      : tracksRect.top + Math.min(12, Math.max(4, tracksRect.height / 2));

  dispatchSyntheticMouseEvent(domTargets.playhead, 'mousedown', startClientX, clientY);
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  const pausedAfterGrab = startedPlaying && !useTimelineStore.getState().isPlaying;

  const startedAt = performance.now();
  let framesApplied = 0;
  let minVisited = initialPosition;
  let maxVisited = initialPosition;
  let requestedEndTime = initialPosition;

  while (true) {
    const elapsedMs = performance.now() - startedAt;
    requestedEndTime = clampPlaybackTime(sampleTimeAtElapsed(elapsedMs), duration);
    const nextClientX = getTimelineClientXForTime(requestedEndTime, domTargets.tracks);
    dispatchSyntheticMouseEvent(document, 'mousemove', nextClientX, clientY);
    framesApplied++;
    const actualPosition = useTimelineStore.getState().playheadPosition;
    minVisited = Math.min(minVisited, requestedEndTime, actualPosition);
    maxVisited = Math.max(maxVisited, requestedEndTime, actualPosition);

    if (elapsedMs >= durationMs) {
      break;
    }

    await waitForAnimationFrame();
  }

  const endClientX = getTimelineClientXForTime(requestedEndTime, domTargets.tracks);
  dispatchSyntheticMouseEvent(document, 'mousemove', endClientX, clientY);
  dispatchSyntheticMouseEvent(document, 'mouseup', endClientX, clientY);
  await waitForAnimationFrame();
  await waitForAnimationFrame();

  if (useTimelineStore.getState().isDraggingPlayhead) {
    timelineStore.setDraggingPlayhead(false);
  }

  if (pauseOnRelease && useTimelineStore.getState().isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  const finalState = useTimelineStore.getState();
  return {
    dragMode: 'dom_playhead',
    actualDurationMs: Math.round(performance.now() - startedAt),
    initialPosition,
    finalPosition: finalState.playheadPosition,
    requestedEndTime,
    framesApplied,
    minVisited,
    maxVisited,
    startedPlaying,
    pausedAfterGrab,
    endedPlaying: finalState.isPlaying,
    zoom: initialState.zoom,
    scrollX: initialState.scrollX,
    startClientX,
    endClientX,
    pixelDistance: Math.abs(endClientX - startClientX),
  };
}

async function runScrubMotion(
  timelineStore: TimelineStore,
  durationMs: number,
  sampleTimeAtElapsed: (elapsedMs: number) => number,
  pauseOnRelease: boolean
): Promise<ScrubMotionResult> {
  const domTargets = getTimelineDomDragTargets();
  if (domTargets) {
    return runDomPlayheadScrubMotion(
      timelineStore,
      domTargets,
      durationMs,
      sampleTimeAtElapsed,
      pauseOnRelease
    );
  }

  return runStoreDrivenScrubMotion(
    timelineStore,
    durationMs,
    sampleTimeAtElapsed,
    pauseOnRelease
  );
}

function findPlaybackPathAnchor(timelineStore: TimelineStore): {
  clipStartTime: number;
  clipId?: string;
  clipName?: string;
} {
  const videoTrackIds = new Set(
    timelineStore.tracks
      .filter((track) => track.type === 'video')
      .map((track) => track.id)
  );
  const videoClips = timelineStore.clips
    .filter((clip) => videoTrackIds.has(clip.trackId))
    .sort((a, b) => a.startTime - b.startTime);
  const activeClip = videoClips.find((clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return timelineStore.playheadPosition >= clip.startTime && timelineStore.playheadPosition < clipEnd;
  }) ?? videoClips[0];

  if (!activeClip) {
    return {
      clipStartTime: clampPlaybackTime(timelineStore.playheadPosition, timelineStore.duration),
    };
  }

  return {
    clipStartTime: activeClip.startTime,
    clipId: activeClip.id,
    clipName: activeClip.name,
  };
}

function buildPlaybackPathPreset(
  preset: PlaybackPathPreset,
  clipStartTime: number
): PlaybackPathStep[] {
  switch (preset) {
    case 'play_scrub_stress_v1':
    default:
      return [
        {
          kind: 'play',
          label: 'play_1s_from_clip_start',
          durationMs: 1000,
          pauseAtEnd: false,
        },
        {
          kind: 'scrub',
          label: 'scrub_while_playing_to_30s_in_1s',
          durationMs: 1000,
          targetTime: clipStartTime + 30,
          beginWhilePlaying: true,
          pauseOnRelease: true,
        },
        {
          kind: 'play',
          label: 'play_1s_after_30s_scrub',
          durationMs: 1000,
          pauseAtEnd: false,
        },
        {
          kind: 'scrub',
          label: 'scrub_while_playing_to_3m_in_2s',
          durationMs: 2000,
          targetTime: clipStartTime + 180,
          beginWhilePlaying: true,
          pauseOnRelease: true,
        },
        {
          kind: 'play',
          label: 'play_2s_after_3m_scrub',
          durationMs: 2000,
          pauseAtEnd: false,
        },
        {
          kind: 'scrub',
          label: 'scrub_while_playing_back_to_10s_in_1s',
          durationMs: 1000,
          targetTime: clipStartTime + 10,
          beginWhilePlaying: true,
          pauseOnRelease: true,
        },
        {
          kind: 'play',
          label: 'play_5s_after_return_to_10s',
          durationMs: 5000,
          pauseAtEnd: true,
        },
      ];
  }
}

async function runPlaybackPathPlayStep(
  timelineStore: TimelineStore,
  step: Extract<PlaybackPathStep, { kind: 'play' }>
): Promise<Record<string, unknown>> {
  timelineStore.setDraggingPlayhead(false);
  if (!useTimelineStore.getState().isPlaying) {
    await timelineStore.play();
  }

  const startedAt = performance.now();
  const initialPosition = useTimelineStore.getState().playheadPosition;
  let previousPosition = initialPosition;
  let framesObserved = 0;
  let movingFrames = 0;
  let stalledFrames = 0;
  let minVisited = initialPosition;
  let maxVisited = initialPosition;

  while (performance.now() - startedAt < step.durationMs) {
    await waitForAnimationFrame();
    const position = useTimelineStore.getState().playheadPosition;
    const moved = Math.abs(position - previousPosition) > 0.0001;
    framesObserved++;
    if (moved) {
      movingFrames++;
    } else {
      stalledFrames++;
    }
    minVisited = Math.min(minVisited, position);
    maxVisited = Math.max(maxVisited, position);
    previousPosition = position;
  }

  if (step.pauseAtEnd) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  const finalState = useTimelineStore.getState();
  return {
    kind: step.kind,
    label: step.label,
    requestedDurationMs: step.durationMs,
    actualDurationMs: Math.round(performance.now() - startedAt),
    initialPosition,
    finalPosition: finalState.playheadPosition,
    deltaSeconds: finalState.playheadPosition - initialPosition,
    framesObserved,
    movingFrames,
    stalledFrames,
    minVisited,
    maxVisited,
    endedPlaying: finalState.isPlaying,
  };
}

async function runPlaybackPathScrubStep(
  timelineStore: TimelineStore,
  step: Extract<PlaybackPathStep, { kind: 'scrub' }>
): Promise<Record<string, unknown>> {
  if (step.beginWhilePlaying && !useTimelineStore.getState().isPlaying) {
    await timelineStore.play();
    await waitForAnimationFrame();
  }

  const duration = useTimelineStore.getState().duration;
  const initialPosition = useTimelineStore.getState().playheadPosition;
  const targetTime = clampPlaybackTime(step.targetTime, duration);
  const scrubResult = await runScrubMotion(
    timelineStore,
    step.durationMs,
    (elapsedMs) => {
      const progress = Math.min(1, elapsedMs / Math.max(step.durationMs, 1));
      return initialPosition + (targetTime - initialPosition) * progress;
    },
    step.pauseOnRelease
  );

  return {
    kind: step.kind,
    label: step.label,
    requestedDurationMs: step.durationMs,
    actualDurationMs: scrubResult.actualDurationMs,
    initialPosition: scrubResult.initialPosition,
    finalPosition: scrubResult.finalPosition,
    targetTime,
    requestedEndTime: scrubResult.requestedEndTime,
    framesApplied: scrubResult.framesApplied,
    minVisited: scrubResult.minVisited,
    maxVisited: scrubResult.maxVisited,
    dragMode: scrubResult.dragMode,
    pausedAfterGrab: scrubResult.pausedAfterGrab,
    zoom: scrubResult.zoom,
    scrollX: scrubResult.scrollX,
    startClientX: scrubResult.startClientX,
    endClientX: scrubResult.endClientX,
    pixelDistance: scrubResult.pixelDistance,
    beganWhilePlaying: step.beginWhilePlaying,
    pausedOnRelease: step.pauseOnRelease,
    endedPlaying: scrubResult.endedPlaying,
  };
}

export async function handleSimulateScrub(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const wasPlaying = timelineStore.isPlaying;
  const resetDiagnostics = args.resetDiagnostics !== false;
  if (wasPlaying) {
    timelineStore.pause();
  }

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
): Promise<ToolResult> {
  const requestedDurationMs =
    typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
      ? Math.max(100, Math.round(args.durationMs))
      : 10_000;
  const settleMs =
    typeof args.settleMs === 'number' && Number.isFinite(args.settleMs)
      ? Math.max(0, Math.round(args.settleMs))
      : 150;
  const playbackSpeed =
    typeof args.playbackSpeed === 'number' && Number.isFinite(args.playbackSpeed) && args.playbackSpeed !== 0
      ? args.playbackSpeed
      : 1;
  const resetDiagnostics = args.resetDiagnostics !== false;

  const wasPlaying = timelineStore.isPlaying;
  const previousSpeed = timelineStore.playbackSpeed;

  if (wasPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  if (typeof args.startTime === 'number' && Number.isFinite(args.startTime)) {
    timelineStore.setPlayheadPosition(
      clampPlaybackTime(args.startTime, timelineStore.duration)
    );
  }

  timelineStore.setDraggingPlayhead(false);
  await waitForAnimationFrame();

  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }

  await timelineStore.play();
  timelineStore.setPlaybackSpeed(playbackSpeed);

  const startedAt = performance.now();
  const initialPosition = useTimelineStore.getState().playheadPosition;
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

  while (true) {
    const now = await waitForAnimationFrame();
    const state = useTimelineStore.getState();
    const position = state.playheadPosition;
    const stepSeconds = Math.abs(position - previousPosition);

    framesObserved++;
    minVisited = Math.min(minVisited, position);
    maxVisited = Math.max(maxVisited, position);
    maxStepSeconds = Math.max(maxStepSeconds, stepSeconds);

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

    if (now - startedAt >= requestedDurationMs) {
      break;
    }
  }

  if (currentStallFrames > 0) {
    longestStallFrames = Math.max(longestStallFrames, currentStallFrames);
    longestStallMs = Math.max(longestStallMs, performance.now() - currentStallStartedAt);
  }

  timelineStore.pause();
  if (settleMs > 0) {
    await waitForTimeout(settleMs);
  }
  await waitForAnimationFrame();

  const finalState = useTimelineStore.getState();
  const finalPosition = finalState.playheadPosition;
  const endedAt = performance.now();
  const actualDurationMs = Math.round(endedAt - startedAt);
  const deltaSeconds = finalPosition - initialPosition;
  const expectedDeltaSeconds = (requestedDurationMs / 1000) * playbackSpeed;
  const runDiagnostics = collectPlaybackRunDiagnostics(startedAt, endedAt);

  if (wasPlaying) {
    await timelineStore.play();
    timelineStore.setPlaybackSpeed(previousSpeed);
  }

  return {
    success: true,
    data: {
      requestedDurationMs,
      actualDurationMs,
      playbackSpeed,
      initialPosition,
      finalPosition,
      deltaSeconds,
      expectedDeltaSeconds,
      driftSeconds: deltaSeconds - expectedDeltaSeconds,
      framesObserved,
      movingFrames,
      stalledFrames,
      longestStallFrames,
      longestStallMs: Math.round(longestStallMs),
      minVisited,
      maxVisited,
      maxStepSeconds,
      wasPlaying,
      resetDiagnostics,
      settled: settleMs > 0,
      endedPlaying: finalState.isPlaying,
      runDiagnostics,
    },
  };
}

export async function handleSimulatePlaybackPath(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const preset =
    args.preset === 'play_scrub_stress_v1'
      ? 'play_scrub_stress_v1'
      : 'play_scrub_stress_v1';
  const resetDiagnostics = args.resetDiagnostics !== false;
  const playbackSpeed =
    typeof args.playbackSpeed === 'number' && Number.isFinite(args.playbackSpeed) && args.playbackSpeed > 0
      ? args.playbackSpeed
      : 1;
  const anchor = findPlaybackPathAnchor(timelineStore);
  const startTime =
    typeof args.startTime === 'number' && Number.isFinite(args.startTime)
      ? clampPlaybackTime(args.startTime, timelineStore.duration)
      : clampPlaybackTime(anchor.clipStartTime, timelineStore.duration);
  const steps = buildPlaybackPathPreset(preset, startTime);
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
      clipStartTime: startTime,
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

export async function handleSetClipSpeed(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const store = useTimelineStore.getState();

  if (args.speed !== undefined) {
    const speed = args.speed as number;
    if (speed <= 0) return { success: false, error: 'Speed must be positive. Use "reverse: true" for reverse playback.' };

    // Use keyframe system for speed
    store.setPropertyValue(clipId, 'speed', speed);
  }

  if (args.reverse !== undefined) {
    store.toggleClipReverse(clipId);
    // If already in desired state, toggle back
    const updated = useTimelineStore.getState().clips.find(c => c.id === clipId);
    if (updated && updated.reversed !== (args.reverse as boolean)) {
      useTimelineStore.getState().toggleClipReverse(clipId);
    }
  }

  if (args.preservePitch !== undefined) {
    store.setClipPreservesPitch(clipId, args.preservePitch as boolean);
  }

  store.invalidateCache();

  const finalClip = useTimelineStore.getState().clips.find(c => c.id === clipId);
  return {
    success: true,
    data: {
      clipId,
      speed: finalClip?.speed ?? 1,
      reversed: finalClip?.reversed ?? false,
      preservesPitch: finalClip?.preservesPitch ?? true,
    },
  };
}

export async function handleUndo(): Promise<ToolResult> {
  historyUndo();
  flashPreviewCanvas('undo');
  return { success: true, data: { action: 'undo' } };
}

export async function handleRedo(): Promise<ToolResult> {
  historyRedo();
  flashPreviewCanvas('redo');
  return { success: true, data: { action: 'redo' } };
}

export async function handleAddMarker(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const time = args.time as number;
  const label = args.label as string | undefined;
  const color = args.color as string | undefined;

  const markerId = timelineStore.addMarker(time, label, color);

  // Visual feedback: marker pop animation
  animateMarker(markerId, 'add');

  return {
    success: true,
    data: { markerId, time, label, color },
  };
}

export async function handleGetMarkers(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const markers = timelineStore.markers || [];
  return {
    success: true,
    data: {
      markers: markers.map(m => ({
        id: m.id,
        time: m.time,
        label: m.label,
        color: m.color,
      })),
    },
  };
}

export async function handleRemoveMarker(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const markerId = args.markerId as string;

  // Visual feedback: marker fade animation before removal
  animateMarker(markerId, 'remove');

  timelineStore.removeMarker(markerId);
  return { success: true, data: { removedMarkerId: markerId } };
}
