import { renderHostPort } from '../../../render/renderHostPort';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import type { TimelineAudioDisplayMode } from '../../../../stores/timeline/types';
import { timelineRuntimeCoordinator } from '../../../timeline/timelineRuntimeCoordinator';
import type { Composition } from '../../../../stores/mediaStore/types';
import { clearAINodeRuntimeCache } from '../../../nodeGraph';
import type {
  FrameFingerprint,
  FrameFingerprintComparison,
  FrameFingerprintComparisonThresholds,
} from '../../frameFingerprint';
import type { ToolResult } from '../../types';

type TimelineCanvasSmokeGlobal = typeof globalThis & {
  __TIMELINE_CANVAS_SMOKE_ACTIVE__?: boolean;
  __TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__?: number;
};

export interface NumberSummary {
  count: number;
  min: number;
  max: number;
  avg: number;
}

export interface TimelineCanvasSmokePhaseTiming {
  label: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimelineCanvasSmokeDomSnapshot {
  hasDocument: boolean;
  hasTimelineTracks: boolean;
  timelineCanvasCount: number;
  legacyClipBodyCount: number;
  previewClipCount: number;
  domOverlayCount: number;
  interactionShellCount: number;
  trackLaneCount: number;
  guidedScrollX: string | null;
  guidedZoom: string | null;
}

export interface TimelineCanvasSmokeSnapshot {
  label: string;
  timeline: {
    trackCount: number;
    clipCount: number;
    selectedClipCount: number;
    zoom: number;
    scrollX: number;
    duration: number;
    audioDisplayMode: TimelineAudioDisplayMode;
    ramPreviewRange: { start: number; end: number } | null;
    cachedFrameCount: number;
    compositionClipCount: number;
    audioLikeClipCount: number;
  };
  dom: TimelineCanvasSmokeDomSnapshot;
  canvasDiagnostics: Record<string, unknown>;
  runtimeCoordinator: ReturnType<typeof timelineRuntimeCoordinator.getBridgeStats>;
}

export interface TimelineCanvasSmokeStep {
  label: string;
  requestedZoom?: number;
  zoom: number;
  scrollFraction?: number;
  requestedScrollX?: number;
  scrollX: number;
  dom: TimelineCanvasSmokeDomSnapshot;
  canvasTotals: Record<string, unknown>;
}

export interface TimelineCanvasExportPreviewFingerprintSample {
  exportMode: 'fast' | 'precise';
  exportProgress: number | null;
  exportCurrentTime: number | null;
  previewFrameTime: number | null;
  fingerprint: FrameFingerprint;
}

export interface TimelineCanvasExportPreviewParityRun {
  exportMode: 'fast' | 'precise';
  success: boolean;
  error: string | null;
  blobSize: number;
  elapsedMs: number | null;
  sampleCount: number;
  bestSample: TimelineCanvasExportPreviewFingerprintSample | null;
  comparison: FrameFingerprintComparison | null;
  failures: string[];
}

export interface TimelineCanvasExportPreviewReferenceAttempt {
  requestedTime: number;
  success: boolean;
  error: string | null;
  fingerprint: FrameFingerprint | null;
}

export interface TimelineCanvasFrameLoopBudget {
  minEstimatedFps: number;
  maxDroppedFrameEstimate: number;
  maxSlowFrameCount: number;
  maxFrameDeltaMs: number;
}

export type TimelineStoreSnapshot = ReturnType<typeof useTimelineStore.getState>;

export interface TimelineCanvasSmokeRestoreState {
  compositions: Composition[];
  activeCompositionId: string | null;
  openCompositionIds: string[];
  tracks: TimelineStoreSnapshot['tracks'];
  clips: TimelineStoreSnapshot['clips'];
  layers: TimelineStoreSnapshot['layers'];
  selectedClipIds: TimelineStoreSnapshot['selectedClipIds'];
  primarySelectedClipId: TimelineStoreSnapshot['primarySelectedClipId'];
  propertiesSelection: TimelineStoreSnapshot['propertiesSelection'];
  clipKeyframes: TimelineStoreSnapshot['clipKeyframes'];
  selectedKeyframeIds: TimelineStoreSnapshot['selectedKeyframeIds'];
  expandedTracks: TimelineStoreSnapshot['expandedTracks'];
  expandedTrackPropertyGroups: TimelineStoreSnapshot['expandedTrackPropertyGroups'];
  expandedCurveProperties: TimelineStoreSnapshot['expandedCurveProperties'];
  markers: TimelineStoreSnapshot['markers'];
  duration: TimelineStoreSnapshot['duration'];
  durationLocked: TimelineStoreSnapshot['durationLocked'];
  playheadPosition: TimelineStoreSnapshot['playheadPosition'];
  playbackSpeed: TimelineStoreSnapshot['playbackSpeed'];
  isDraggingPlayhead: TimelineStoreSnapshot['isDraggingPlayhead'];
  waveformsEnabled: TimelineStoreSnapshot['waveformsEnabled'];
  isPlaying: TimelineStoreSnapshot['isPlaying'];
  toolMode: TimelineStoreSnapshot['toolMode'];
  activeTimelineToolId: TimelineStoreSnapshot['activeTimelineToolId'];
  previousTimelineToolId: TimelineStoreSnapshot['previousTimelineToolId'];
  lastTimelineToolByGroup: TimelineStoreSnapshot['lastTimelineToolByGroup'];
  openTimelineToolGroupId: TimelineStoreSnapshot['openTimelineToolGroupId'];
  momentaryTimelineToolId: TimelineStoreSnapshot['momentaryTimelineToolId'];
  scrollX: TimelineStoreSnapshot['scrollX'];
  zoom: TimelineStoreSnapshot['zoom'];
  cachedFrameTimes: TimelineStoreSnapshot['cachedFrameTimes'];
  ramPreviewRange: TimelineStoreSnapshot['ramPreviewRange'];
  ramPreviewProgress: TimelineStoreSnapshot['ramPreviewProgress'];
  isRamPreviewing: TimelineStoreSnapshot['isRamPreviewing'];
  timelineRangeSelection: TimelineStoreSnapshot['timelineRangeSelection'];
  clipDragPreview: TimelineStoreSnapshot['clipDragPreview'];
  timelineToolPreview: TimelineStoreSnapshot['timelineToolPreview'];
}

export interface TimelineCanvasSmokeRestoreResult {
  restoredTrackCount: number;
  restoredClipCount: number;
  restoredPlayheadPosition: number;
  resumedPlayback: boolean;
}

function cloneSetMap<T>(source: Map<string, Set<T>>): Map<string, Set<T>> {
  return new Map([...source.entries()].map(([key, value]) => [key, new Set(value)]));
}

export function shouldRestoreTimelineAfterCanvasSmoke(args: Record<string, unknown>): boolean {
  if (args.restoreTimelineAfterRun === false) {
    return false;
  }

  return args.restoreTimelineAfterRun === true ||
    args.useExistingMediaFile === true ||
    args.createSynthetic !== false;
}

export function captureTimelineCanvasSmokeRestoreState(): TimelineCanvasSmokeRestoreState {
  const state = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  return {
    compositions: mediaState.compositions,
    activeCompositionId: mediaState.activeCompositionId,
    openCompositionIds: mediaState.openCompositionIds,
    tracks: state.tracks,
    clips: state.clips,
    layers: state.layers,
    selectedClipIds: new Set(state.selectedClipIds),
    primarySelectedClipId: state.primarySelectedClipId,
    propertiesSelection: state.propertiesSelection,
    clipKeyframes: new Map([...state.clipKeyframes.entries()].map(([clipId, keyframes]) => [clipId, [...keyframes]])),
    selectedKeyframeIds: new Set(state.selectedKeyframeIds),
    expandedTracks: new Set(state.expandedTracks),
    expandedTrackPropertyGroups: cloneSetMap(state.expandedTrackPropertyGroups),
    expandedCurveProperties: cloneSetMap(state.expandedCurveProperties),
    markers: state.markers,
    duration: state.duration,
    durationLocked: state.durationLocked,
    playheadPosition: state.playheadPosition,
    playbackSpeed: state.playbackSpeed,
    isDraggingPlayhead: state.isDraggingPlayhead,
    waveformsEnabled: state.waveformsEnabled,
    isPlaying: state.isPlaying,
    toolMode: state.toolMode,
    activeTimelineToolId: state.activeTimelineToolId,
    previousTimelineToolId: state.previousTimelineToolId,
    lastTimelineToolByGroup: state.lastTimelineToolByGroup,
    openTimelineToolGroupId: state.openTimelineToolGroupId,
    momentaryTimelineToolId: state.momentaryTimelineToolId,
    scrollX: state.scrollX,
    zoom: state.zoom,
    cachedFrameTimes: new Set(state.cachedFrameTimes),
    ramPreviewRange: state.ramPreviewRange,
    ramPreviewProgress: state.ramPreviewProgress,
    isRamPreviewing: state.isRamPreviewing,
    timelineRangeSelection: state.timelineRangeSelection,
    clipDragPreview: state.clipDragPreview,
    timelineToolPreview: state.timelineToolPreview,
  };
}

export function beginTimelineCanvasSmokeMutation(): () => void {
  const smokeGlobal = globalThis as TimelineCanvasSmokeGlobal;
  smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__ = (smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__ ?? 0) + 1;
  smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE__ = true;
  return () => {
    smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__ = Math.max(
      0,
      (smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__ ?? 1) - 1,
    );
    smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE__ = smokeGlobal.__TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__ > 0;
  };
}

export async function restoreTimelineCanvasSmokeState(
  snapshot: TimelineCanvasSmokeRestoreState,
): Promise<TimelineCanvasSmokeRestoreResult> {
  useTimelineStore.getState().pause();
  clearAINodeRuntimeCache();
  useMediaStore.setState({
    compositions: snapshot.compositions,
    activeCompositionId: snapshot.activeCompositionId,
    openCompositionIds: snapshot.openCompositionIds,
  });
  useTimelineStore.setState({
    tracks: snapshot.tracks,
    clips: snapshot.clips,
    layers: snapshot.layers,
    selectedClipIds: new Set(snapshot.selectedClipIds),
    primarySelectedClipId: snapshot.primarySelectedClipId,
    propertiesSelection: snapshot.propertiesSelection,
    clipKeyframes: new Map([...snapshot.clipKeyframes.entries()].map(([clipId, keyframes]) => [clipId, [...keyframes]])),
    selectedKeyframeIds: new Set(snapshot.selectedKeyframeIds),
    expandedTracks: new Set(snapshot.expandedTracks),
    expandedTrackPropertyGroups: cloneSetMap(snapshot.expandedTrackPropertyGroups),
    expandedCurveProperties: cloneSetMap(snapshot.expandedCurveProperties),
    markers: snapshot.markers,
    duration: snapshot.duration,
    durationLocked: snapshot.durationLocked,
    playheadPosition: snapshot.playheadPosition,
    playbackSpeed: snapshot.playbackSpeed,
    isDraggingPlayhead: snapshot.isDraggingPlayhead,
    waveformsEnabled: snapshot.waveformsEnabled,
    isPlaying: false,
    toolMode: snapshot.toolMode,
    activeTimelineToolId: snapshot.activeTimelineToolId,
    previousTimelineToolId: snapshot.previousTimelineToolId,
    lastTimelineToolByGroup: snapshot.lastTimelineToolByGroup,
    openTimelineToolGroupId: snapshot.openTimelineToolGroupId,
    momentaryTimelineToolId: snapshot.momentaryTimelineToolId,
    scrollX: snapshot.scrollX,
    zoom: snapshot.zoom,
    cachedFrameTimes: new Set(snapshot.cachedFrameTimes),
    ramPreviewRange: snapshot.ramPreviewRange,
    ramPreviewProgress: snapshot.ramPreviewProgress,
    isRamPreviewing: snapshot.isRamPreviewing,
    timelineRangeSelection: snapshot.timelineRangeSelection,
    clipDragPreview: snapshot.clipDragPreview,
    timelineToolPreview: snapshot.timelineToolPreview,
  });
  renderHostPort.requestNewFrameRender();
  await waitForFrames(2);

  if (snapshot.isPlaying) {
    void useTimelineStore.getState().play();
  }

  return {
    restoredTrackCount: snapshot.tracks.length,
    restoredClipCount: snapshot.clips.length,
    restoredPlayheadPosition: snapshot.playheadPosition,
    resumedPlayback: snapshot.isPlaying,
  };
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getResultDataObject(result: ToolResult): Record<string, unknown> {
  return result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? result.data as Record<string, unknown>
    : {};
}

export function getNumberField(source: Record<string, unknown>, key: string, fallback = 0): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getExportBlobSize(result: ToolResult): number {
  const data = getResultDataObject(result);
  const blob = data.blob;
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    return 0;
  }
  return getNumberField(blob as Record<string, unknown>, 'size', 0);
}


export function readExportPreviewParityThresholds(args: Record<string, unknown>): FrameFingerprintComparisonThresholds {
  return {
    maxAvgRgbDelta: clampNumber(args.maxAvgRgbDelta, 42, 0, 255),
    maxMeanLumaDelta: clampNumber(args.maxMeanLumaDelta, 32, 0, 255),
    maxNonBlankRatioDelta: clampNumber(args.maxNonBlankRatioDelta, 0.45, 0, 1),
    minReferenceNonBlankRatio: clampNumber(args.minReferenceNonBlankRatio, 0.05, 0, 1),
    minCandidateNonBlankRatio: clampNumber(args.minCandidateNonBlankRatio, 0.05, 0, 1),
    maxColorRangeDelta: clampNumber(args.maxColorRangeDelta, 120, 0, 255),
  };
}

export function selectClosestExportPreviewSample(
  samples: readonly TimelineCanvasExportPreviewFingerprintSample[],
  targetTime: number,
): TimelineCanvasExportPreviewFingerprintSample | null {
  let best: TimelineCanvasExportPreviewFingerprintSample | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const sampleTime = sample.previewFrameTime ?? sample.exportCurrentTime;
    const delta = typeof sampleTime === 'number' && Number.isFinite(sampleTime)
      ? Math.abs(sampleTime - targetTime)
      : Number.POSITIVE_INFINITY;
    if (!best || delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  return best;
}

function createUniqueSortedTimes(values: readonly number[], maxTime: number): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const clamped = Math.max(0, Math.min(maxTime, value));
    const rounded = Math.round(clamped * 1000) / 1000;
    const key = rounded.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rounded);
  }
  return result;
}

export function resolveExportPreviewParitySampleTimes(args: Record<string, unknown>, maxStartTime: number): number[] {
  const explicitTimes = Array.isArray(args.sampleTimes)
    ? args.sampleTimes.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  if (explicitTimes.length > 0) {
    return createUniqueSortedTimes(explicitTimes, maxStartTime);
  }

  const requestedSampleTime = typeof args.sampleTime === 'number' && Number.isFinite(args.sampleTime)
    ? args.sampleTime
    : Math.min(0.35, maxStartTime);
  return createUniqueSortedTimes([
    requestedSampleTime,
    0.35,
    2,
    10,
    maxStartTime * 0.15,
    maxStartTime * 0.3,
    maxStartTime * 0.5,
  ], maxStartTime);
}

export function readLargeProjectFrameLoopBudget(args: Record<string, unknown>): TimelineCanvasFrameLoopBudget {
  return {
    minEstimatedFps: clampNumber(args.minEstimatedFps, 45, 1, 240),
    maxDroppedFrameEstimate: clampNumber(args.maxDroppedFrameEstimate, 8, 0, 1000),
    maxSlowFrameCount: clampNumber(args.maxSlowFrameCount, 4, 0, 1000),
    maxFrameDeltaMs: clampNumber(args.maxFrameDeltaMs, 70, 1, 1000),
  };
}

export function summarizeNumbers(values: readonly number[]): NumberSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0 };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    avg: round(sum / values.length),
  };
}

export function hasBrowserDom(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function waitForFrames(count = 1, timeoutMs = 120): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolve();
      };
      if (typeof requestAnimationFrame === 'function') {
        const timeout = setTimeout(finish, timeoutMs);
        requestAnimationFrame(() => {
          clearTimeout(timeout);
          finish();
        });
        return;
      }
      setTimeout(finish, Math.min(16, timeoutMs));
    });
  }
}
