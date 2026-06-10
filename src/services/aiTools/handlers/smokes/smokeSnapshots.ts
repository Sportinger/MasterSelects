import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import {
  buildTimelineCanvasStoreDiagnostics,
  getTimelineCanvasDiagnostics,
} from '../../../timeline/timelineCanvasDiagnostics';
import { timelineRuntimeCoordinator } from '../../../timeline/timelineRuntimeCoordinator';
import {
  hasBrowserDom,
  nowMs,
  round,
  type TimelineCanvasSmokeDomSnapshot,
  type TimelineCanvasSmokePhaseTiming,
  type TimelineCanvasSmokeSnapshot,
  type TimelineCanvasSmokeStep,
} from './smokeRuntime';

export function readCanvasTotals(snapshot: TimelineCanvasSmokeSnapshot): Record<string, unknown> {
  const diagnostics = snapshot.canvasDiagnostics as { totals?: Record<string, unknown> };
  return diagnostics.totals ?? {};
}

export function compactSmokeSnapshot(snapshot: TimelineCanvasSmokeSnapshot | null): Record<string, unknown> | null {
  if (!snapshot) return null;
  const diagnostics = snapshot.canvasDiagnostics as { totals?: Record<string, unknown> };
  const runtimeCoordinator = snapshot.runtimeCoordinator as {
    totals?: unknown;
    diagnostics?: { messages?: readonly unknown[] };
  };

  return {
    label: snapshot.label,
    timeline: snapshot.timeline,
    dom: snapshot.dom,
    canvasDiagnostics: {
      totals: diagnostics.totals ?? {},
    },
    runtimeCoordinator: {
      totals: runtimeCoordinator?.totals ?? null,
      diagnosticMessageCount: Array.isArray(runtimeCoordinator?.diagnostics?.messages)
        ? runtimeCoordinator.diagnostics.messages.length
        : null,
    },
  };
}

export function buildSmokePhaseRecorder(): {
  timings: TimelineCanvasSmokePhaseTiming[];
  record: (label: string, startMs: number, endMs?: number) => void;
} {
  const timings: TimelineCanvasSmokePhaseTiming[] = [];
  return {
    timings,
    record: (label, startMs, endMs = nowMs()) => {
      timings.push({
        label,
        startMs: round(startMs),
        endMs: round(endMs),
        durationMs: round(endMs - startMs),
      });
    },
  };
}

function collectDomSnapshot(): TimelineCanvasSmokeDomSnapshot {
  if (!hasBrowserDom()) {
    return {
      hasDocument: false,
      hasTimelineTracks: false,
      timelineCanvasCount: 0,
      legacyClipBodyCount: 0,
      previewClipCount: 0,
      domOverlayCount: 0,
      interactionShellCount: 0,
      trackLaneCount: 0,
      guidedScrollX: null,
      guidedZoom: null,
    };
  }

  const tracks = document.querySelector<HTMLElement>('[data-ai-id="timeline-tracks"]');
  return {
    hasDocument: true,
    hasTimelineTracks: Boolean(tracks),
    timelineCanvasCount: document.querySelectorAll('.timeline-clip-canvas').length,
    legacyClipBodyCount: document.querySelectorAll('.timeline-clip:not(.timeline-clip-preview)').length,
    previewClipCount: document.querySelectorAll('.timeline-clip-preview').length,
    domOverlayCount: document.querySelectorAll('.timeline-canvas-dom-overlay').length,
    interactionShellCount: document.querySelectorAll('.clip-interaction-shell').length,
    trackLaneCount: document.querySelectorAll('.track-lane').length,
    guidedScrollX: tracks?.getAttribute('data-guided-timeline-scroll-x') ?? null,
    guidedZoom: tracks?.getAttribute('data-guided-timeline-zoom') ?? null,
  };
}

function countAudioLikeClips(clips: readonly TimelineClip[]): number {
  return clips.filter((clip) => (
    clip.source?.type === 'audio' ||
    clip.waveform?.length ||
    clip.waveformChannels?.length ||
    clip.audioState?.sourceAnalysisRefs?.waveformPyramidId ||
    clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId ||
    clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.length ||
    clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.length
  )).length;
}

export function collectSmokeSnapshot(label: string): TimelineCanvasSmokeSnapshot {
  const state = useTimelineStore.getState();
  return {
    label,
    timeline: {
      trackCount: state.tracks.length,
      clipCount: state.clips.length,
      selectedClipCount: state.selectedClipIds.size,
      zoom: state.zoom,
      scrollX: state.scrollX,
      duration: state.duration,
      audioDisplayMode: state.audioDisplayMode,
      ramPreviewRange: state.ramPreviewRange,
      cachedFrameCount: state.cachedFrameTimes.size,
      compositionClipCount: state.clips.filter((clip) => clip.isComposition).length,
      audioLikeClipCount: countAudioLikeClips(state.clips),
    },
    dom: collectDomSnapshot(),
    canvasDiagnostics: getTimelineCanvasDiagnostics(buildTimelineCanvasStoreDiagnostics({
      tracks: state.tracks,
      clips: state.clips,
    })),
    runtimeCoordinator: timelineRuntimeCoordinator.getBridgeStats(),
  };
}

export function maxTimelineScrollX(duration: number, zoom: number): number {
  if (!hasBrowserDom()) {
    return Math.max(0, duration * zoom);
  }
  const viewport = document.querySelector<HTMLElement>('[data-ai-id="timeline-tracks"]')
    ?? document.querySelector<HTMLElement>('.timeline-section-viewport')
    ?? document.querySelector<HTMLElement>('.timeline-container');
  const viewportWidth = viewport?.clientWidth ?? 1200;
  return Math.max(0, duration * zoom - viewportWidth);
}

export function assertCanvasSmokeSnapshot(
  snapshot: TimelineCanvasSmokeSnapshot,
  options: {
    requireTimelineDom?: boolean;
    requireCulling?: boolean;
    requireSelectedAll?: boolean;
    expectedSelectedClipCount?: number;
    maxWorkerTrackCount?: number;
    minWorkerTrackCount?: number;
    minWorkerEligibleTrackCount?: number;
    maxWorkerFallbackTrackCount?: number;
    maxWorkerPendingTrackCount?: number;
    maxWorkerErrorTrackCount?: number;
    maxWorkerResourceBytes?: number;
    requiredWorkerFallbackReasons?: readonly string[];
    allowedWorkerFallbackReasons?: readonly string[];
    maxShellCount?: number;
  } = {},
): string[] {
  const failures: string[] = [];
  const totals = readCanvasTotals(snapshot);
  const domClipBodyCount = Number(totals.domClipBodyCount ?? 0);
  const drawnClipCount = Number(totals.drawnClipCount ?? totals.visibleClipCount ?? 0);
  const workerTrackCount = Number(totals.workerTrackCount ?? 0);
  const workerEligibleTrackCount = Number(totals.workerEligibleTrackCount ?? 0);
  const workerFallbackTrackCount = Number(totals.workerFallbackTrackCount ?? 0);
  const workerPendingTrackCount = Number(totals.workerPendingTrackCount ?? 0);
  const workerErrorTrackCount = Number(totals.workerErrorTrackCount ?? 0);
  const workerResourceBytes = Number(totals.workerResourceBytes ?? 0);
  const workerFallbackReasons = totals.workerFallbackReasons && typeof totals.workerFallbackReasons === 'object'
    ? totals.workerFallbackReasons as Record<string, unknown>
    : {};
  const workerErrors = totals.workerErrors && typeof totals.workerErrors === 'object'
    ? totals.workerErrors as Record<string, unknown>
    : {};
  const shellCount = Number(totals.shellCount ?? 0);

  if (options.requireTimelineDom && !snapshot.dom.hasTimelineTracks) {
    failures.push('timeline DOM target was not found');
  }
  if (snapshot.dom.legacyClipBodyCount !== 0) {
    failures.push(`legacy .timeline-clip bodies mounted: ${snapshot.dom.legacyClipBodyCount}`);
  }
  if (domClipBodyCount !== 0) {
    failures.push(`canvas diagnostics reported DOM clip bodies: ${domClipBodyCount}`);
  }
  if (typeof options.maxWorkerTrackCount === 'number' && workerTrackCount > options.maxWorkerTrackCount) {
    failures.push(`worker tracks ${workerTrackCount}/${options.maxWorkerTrackCount}`);
  }
  if (typeof options.minWorkerTrackCount === 'number' && workerTrackCount < options.minWorkerTrackCount) {
    failures.push(`worker tracks ${workerTrackCount}/${options.minWorkerTrackCount} required`);
  }
  if (
    typeof options.minWorkerEligibleTrackCount === 'number' &&
    workerEligibleTrackCount < options.minWorkerEligibleTrackCount
  ) {
    failures.push(`worker eligible tracks ${workerEligibleTrackCount}/${options.minWorkerEligibleTrackCount} required`);
  }
  if (
    typeof options.maxWorkerFallbackTrackCount === 'number' &&
    workerFallbackTrackCount > options.maxWorkerFallbackTrackCount
  ) {
    failures.push(`worker fallback tracks ${workerFallbackTrackCount}/${options.maxWorkerFallbackTrackCount}`);
  }
  if (
    typeof options.maxWorkerPendingTrackCount === 'number' &&
    workerPendingTrackCount > options.maxWorkerPendingTrackCount
  ) {
    failures.push(`worker pending tracks ${workerPendingTrackCount}/${options.maxWorkerPendingTrackCount}`);
  }
  if (
    typeof options.maxWorkerErrorTrackCount === 'number' &&
    workerErrorTrackCount > options.maxWorkerErrorTrackCount
  ) {
    const errorSummary = Object.entries(workerErrors)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(',');
    failures.push(`worker error tracks ${workerErrorTrackCount}/${options.maxWorkerErrorTrackCount}${errorSummary ? ` (${errorSummary})` : ''}`);
  }
  if (typeof options.maxWorkerResourceBytes === 'number' && workerResourceBytes > options.maxWorkerResourceBytes) {
    failures.push(`worker resource bytes ${workerResourceBytes}/${options.maxWorkerResourceBytes} max`);
  }
  options.requiredWorkerFallbackReasons?.forEach((reason) => {
    const count = Number(workerFallbackReasons[reason] ?? 0);
    if (count <= 0) {
      failures.push(`missing worker fallback reason: ${reason}`);
    }
  });
  if (options.allowedWorkerFallbackReasons && options.allowedWorkerFallbackReasons.length > 0) {
    const allowedReasons = new Set(options.allowedWorkerFallbackReasons);
    for (const [reason, rawCount] of Object.entries(workerFallbackReasons)) {
      const count = Number(rawCount ?? 0);
      if (count > 0 && !allowedReasons.has(reason)) {
        failures.push(`unexpected worker fallback reason: ${reason}:${count}`);
      }
    }
  }
  if (typeof options.maxShellCount === 'number' && shellCount > options.maxShellCount) {
    failures.push(`interaction shells ${shellCount}/${options.maxShellCount}`);
  }
  if (
    options.requireSelectedAll &&
    typeof options.expectedSelectedClipCount === 'number' &&
    snapshot.timeline.selectedClipCount !== options.expectedSelectedClipCount
  ) {
    failures.push(`select-all selected ${snapshot.timeline.selectedClipCount}/${options.expectedSelectedClipCount} clips`);
  }
  if (
    options.requireCulling &&
    snapshot.timeline.clipCount > 100 &&
    drawnClipCount > 0 &&
    drawnClipCount >= snapshot.timeline.clipCount
  ) {
    failures.push(`large project was not culled: drawn ${drawnClipCount}/${snapshot.timeline.clipCount}`);
  }

  return failures;
}

export function assertTimelineCanvasStepInvariants(
  step: {
    label?: string;
    requestedZoom?: number;
    zoom?: number;
    requestedScrollX?: number;
    scrollX?: number;
    dom: TimelineCanvasSmokeDomSnapshot;
    canvasTotals: Record<string, unknown>;
  },
  options: {
    requireTimelineDom?: boolean;
    maxWorkerTrackCount?: number;
    maxWorkerPendingTrackCount?: number;
    maxWorkerErrorTrackCount?: number;
    maxWorkerResourceBytes?: number;
    maxShellCount?: number;
    assertRequestedPosition?: boolean;
  } = {},
): string[] {
  const label = step.label ? `${step.label}: ` : '';
  const failures: string[] = [];
  const domClipBodyCount = Number(step.canvasTotals.domClipBodyCount ?? 0);
  const workerTrackCount = Number(step.canvasTotals.workerTrackCount ?? 0);
  const workerPendingTrackCount = Number(step.canvasTotals.workerPendingTrackCount ?? 0);
  const workerErrorTrackCount = Number(step.canvasTotals.workerErrorTrackCount ?? 0);
  const workerResourceBytes = Number(step.canvasTotals.workerResourceBytes ?? 0);
  const workerErrors = step.canvasTotals.workerErrors && typeof step.canvasTotals.workerErrors === 'object'
    ? step.canvasTotals.workerErrors as Record<string, unknown>
    : {};
  const shellCount = Number(step.canvasTotals.shellCount ?? 0);

  if (options.requireTimelineDom && !step.dom.hasTimelineTracks) {
    failures.push(`${label}timeline DOM target was not found`);
  }
  if (step.dom.legacyClipBodyCount !== 0) {
    failures.push(`${label}legacy .timeline-clip bodies mounted: ${step.dom.legacyClipBodyCount}`);
  }
  if (domClipBodyCount !== 0) {
    failures.push(`${label}canvas diagnostics reported DOM clip bodies: ${domClipBodyCount}`);
  }
  if (typeof options.maxWorkerTrackCount === 'number' && workerTrackCount > options.maxWorkerTrackCount) {
    failures.push(`${label}worker tracks ${workerTrackCount}/${options.maxWorkerTrackCount}`);
  }
  if (
    typeof options.maxWorkerPendingTrackCount === 'number' &&
    workerPendingTrackCount > options.maxWorkerPendingTrackCount
  ) {
    failures.push(`${label}worker pending tracks ${workerPendingTrackCount}/${options.maxWorkerPendingTrackCount}`);
  }
  if (
    typeof options.maxWorkerErrorTrackCount === 'number' &&
    workerErrorTrackCount > options.maxWorkerErrorTrackCount
  ) {
    const errorSummary = Object.entries(workerErrors)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(',');
    failures.push(`${label}worker error tracks ${workerErrorTrackCount}/${options.maxWorkerErrorTrackCount}${errorSummary ? ` (${errorSummary})` : ''}`);
  }
  if (typeof options.maxWorkerResourceBytes === 'number' && workerResourceBytes > options.maxWorkerResourceBytes) {
    failures.push(`${label}worker resource bytes ${workerResourceBytes}/${options.maxWorkerResourceBytes} max`);
  }
  if (typeof options.maxShellCount === 'number' && shellCount > options.maxShellCount) {
    failures.push(`${label}interaction shells ${shellCount}/${options.maxShellCount}`);
  }
  if (
    options.assertRequestedPosition &&
    typeof step.requestedZoom === 'number' &&
    typeof step.zoom === 'number' &&
    Math.abs(step.zoom - step.requestedZoom) > 0.001
  ) {
    failures.push(`${label}zoom ${step.zoom}/${step.requestedZoom}`);
  }
  if (
    options.assertRequestedPosition &&
    typeof step.requestedScrollX === 'number' &&
    typeof step.scrollX === 'number' &&
    Math.abs(step.scrollX - step.requestedScrollX) > 1
  ) {
    failures.push(`${label}scrollX ${step.scrollX}/${step.requestedScrollX}`);
  }

  return failures;
}

export function hasCulledDrawStep(steps: readonly TimelineCanvasSmokeStep[], clipCount: number): boolean {
  if (clipCount <= 100) {
    return true;
  }
  return steps.some((step) => {
    const drawnClipCount = Number(step.canvasTotals.drawnClipCount ?? 0);
    return drawnClipCount > 0 && drawnClipCount < clipCount;
  });
}

export function dispatchMouseEvent(target: EventTarget, type: string, options: MouseEventInit): boolean {
  if (!hasBrowserDom() || typeof MouseEvent !== 'function') {
    return false;
  }
  return target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    ...options,
  }));
}