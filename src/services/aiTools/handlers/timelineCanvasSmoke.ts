import { engine } from '../../../engine/WebGPUEngine';
import { flags } from '../../../engine/featureFlags';
import type { TimelineClip, TimelineTrack } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { getLastRamPreviewGenerationError } from '../../../stores/timeline/ramPreviewSlice';
import { useMediaStore } from '../../../stores/mediaStore';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import { DEFAULT_TRACKS, DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import { RamPreviewEngine } from '../../ramPreviewEngine';
import { thumbnailCacheService } from '../../thumbnailCacheService';
import { ensureThumbnailBitmap, hasThumbnailBitmap } from '../../timeline/thumbnailBitmapCache';
import {
  buildTimelineCanvasStoreDiagnostics,
  getTimelineCanvasDiagnostics,
} from '../../timeline/timelineCanvasDiagnostics';
import { timelineRuntimeCoordinator } from '../../timeline/timelineRuntimeCoordinator';
import {
  createRamPreviewRunId,
  releaseRamPreviewRunResources,
  reportRamPreviewRunJob,
} from '../../timeline/ramPreviewRuntimeReporting';
import {
  compareFrameFingerprints,
  fingerprintDataUrl,
  fingerprintImageBitmap,
} from '../frameFingerprint';
import type {
  FrameFingerprint,
  FrameFingerprintComparison,
  FrameFingerprintComparisonThresholds,
} from '../frameFingerprint';
import type { ToolResult } from '../types';
import { handleSimulatePlayback } from './playback';
import { handleDebugExport } from './export';
import { handleCaptureFrame } from './preview';
import type { Composition, MediaFile } from '../../../stores/mediaStore/types';
import { clearAINodeRuntimeCache } from '../../nodeGraph';

type TimelineCanvasSmokeGlobal = typeof globalThis & {
  __TIMELINE_CANVAS_SMOKE_ACTIVE__?: boolean;
  __TIMELINE_CANVAS_SMOKE_ACTIVE_DEPTH__?: number;
};

interface NumberSummary {
  count: number;
  min: number;
  max: number;
  avg: number;
}

interface TimelineCanvasSmokePhaseTiming {
  label: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

interface TimelineCanvasSmokeDomSnapshot {
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

interface TimelineCanvasSmokeSnapshot {
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

interface TimelineCanvasSmokeStep {
  label: string;
  requestedZoom?: number;
  zoom: number;
  scrollFraction?: number;
  requestedScrollX?: number;
  scrollX: number;
  dom: TimelineCanvasSmokeDomSnapshot;
  canvasTotals: Record<string, unknown>;
}

interface TimelineCanvasExportPreviewFingerprintSample {
  exportMode: 'fast' | 'precise';
  exportProgress: number | null;
  exportCurrentTime: number | null;
  previewFrameTime: number | null;
  fingerprint: FrameFingerprint;
}

interface TimelineCanvasExportPreviewParityRun {
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

interface TimelineCanvasExportPreviewReferenceAttempt {
  requestedTime: number;
  success: boolean;
  error: string | null;
  fingerprint: FrameFingerprint | null;
}

interface TimelineCanvasFrameLoopBudget {
  minEstimatedFps: number;
  maxDroppedFrameEstimate: number;
  maxSlowFrameCount: number;
  maxFrameDeltaMs: number;
}

type TimelineStoreSnapshot = ReturnType<typeof useTimelineStore.getState>;

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

function beginTimelineCanvasSmokeMutation(): () => void {
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
  engine.requestNewFrameRender();
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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function getResultDataObject(result: ToolResult): Record<string, unknown> {
  return result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? result.data as Record<string, unknown>
    : {};
}

function getNumberField(source: Record<string, unknown>, key: string, fallback = 0): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getExportBlobSize(result: ToolResult): number {
  const data = getResultDataObject(result);
  const blob = data.blob;
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
    return 0;
  }
  return getNumberField(blob as Record<string, unknown>, 'size', 0);
}

function readExportPreviewParityThresholds(args: Record<string, unknown>): FrameFingerprintComparisonThresholds {
  return {
    maxAvgRgbDelta: clampNumber(args.maxAvgRgbDelta, 42, 0, 255),
    maxMeanLumaDelta: clampNumber(args.maxMeanLumaDelta, 32, 0, 255),
    maxNonBlankRatioDelta: clampNumber(args.maxNonBlankRatioDelta, 0.45, 0, 1),
    minReferenceNonBlankRatio: clampNumber(args.minReferenceNonBlankRatio, 0.05, 0, 1),
    minCandidateNonBlankRatio: clampNumber(args.minCandidateNonBlankRatio, 0.05, 0, 1),
    maxColorRangeDelta: clampNumber(args.maxColorRangeDelta, 120, 0, 255),
  };
}

function selectClosestExportPreviewSample(
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

function resolveExportPreviewParitySampleTimes(args: Record<string, unknown>, maxStartTime: number): number[] {
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

function readLargeProjectFrameLoopBudget(args: Record<string, unknown>): TimelineCanvasFrameLoopBudget {
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

function hasBrowserDom(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function createSmokeFile(name: string): File {
  if (typeof File === 'function') {
    return new File([], name, { type: 'application/octet-stream' });
  }
  return { name, size: 0, type: 'application/octet-stream' } as File;
}

export function createTimelineCanvasSmokeTracks(videoTrackCount: number, audioTrackCount = 0): TimelineTrack[] {
  const videoTracks = Array.from({ length: Math.max(1, Math.round(videoTrackCount)) }, (_, index): TimelineTrack => ({
    id: `smoke-video-${index + 1}`,
    name: `Smoke Video ${index + 1}`,
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  }));

  const audioTracks = Array.from({ length: Math.max(0, Math.round(audioTrackCount)) }, (_, index): TimelineTrack => ({
    id: `smoke-audio-${index + 1}`,
    name: `Smoke Audio ${index + 1}`,
    type: 'audio',
    height: 44,
    muted: false,
    visible: true,
    solo: false,
  }));

  return [...videoTracks, ...audioTracks];
}

export function createTimelineCanvasSmokeClips(input: {
  tracks: readonly TimelineTrack[];
  clipCount: number;
  durationSeconds: number;
  clipDurationSeconds?: number;
  sourceType?: 'solid' | 'image' | 'video';
  imageElement?: HTMLImageElement;
  mediaFileId?: string;
  sourceDurationSeconds?: number;
}): TimelineClip[] {
  const videoTracks = input.tracks.filter((track) => track.type === 'video');
  const targetTracks = videoTracks.length > 0 ? videoTracks : input.tracks;
  const clipCount = Math.max(1, Math.round(input.clipCount));
  const clipDuration = clampNumber(input.clipDurationSeconds, 2, 0.05, 30);
  const durationSeconds = Math.max(clipDuration, input.durationSeconds);
  const lanes = Math.max(1, targetTracks.length);
  const colorPalette = ['#4c9aff', '#59d38c', '#f5c542', '#ff7a59', '#b98cff', '#5ed1d1'];

  return Array.from({ length: clipCount }, (_, index): TimelineClip => {
    const track = targetTracks[index % lanes];
    const laneIndex = Math.floor(index / lanes);
    const startTime = Math.min(
      Math.max(0, durationSeconds - clipDuration),
      laneIndex * (clipDuration + 0.18) + (index % 3) * 0.05,
    );
    const color = colorPalette[index % colorPalette.length];
    const source = input.sourceType === 'image' && input.imageElement
      ? {
        type: 'image' as const,
        imageElement: input.imageElement,
        naturalDuration: clipDuration,
      }
      : input.sourceType === 'video' && input.mediaFileId
        ? {
          type: 'video' as const,
          mediaFileId: input.mediaFileId,
          naturalDuration: input.sourceDurationSeconds ?? durationSeconds,
        }
      : {
        type: 'solid' as const,
        naturalDuration: clipDuration,
      };
    return {
      id: `smoke-clip-${index + 1}`,
      trackId: track.id,
      name: `Smoke Clip ${index + 1}`,
      file: createSmokeFile(`smoke-clip-${index + 1}.dat`),
      startTime,
      duration: clipDuration,
      inPoint: 0,
      outPoint: clipDuration,
      mediaFileId: input.sourceType === 'video' ? input.mediaFileId : undefined,
      source,
      solidColor: color,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };
  });
}

function readCanvasTotals(snapshot: TimelineCanvasSmokeSnapshot): Record<string, unknown> {
  const diagnostics = snapshot.canvasDiagnostics as { totals?: Record<string, unknown> };
  return diagnostics.totals ?? {};
}

function compactSmokeSnapshot(snapshot: TimelineCanvasSmokeSnapshot | null): Record<string, unknown> | null {
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

function buildSmokePhaseRecorder(): {
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

function collectSmokeSnapshot(label: string): TimelineCanvasSmokeSnapshot {
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

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

async function waitForFrames(count = 1, timeoutMs = 120): Promise<void> {
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

async function warmThumbnailBitmapsForSource(
  mediaFileId: string,
  fileHash: string | undefined,
  durationSeconds: number,
  timeoutMs: number,
): Promise<number> {
  await thumbnailCacheService.loadCachedForSource(mediaFileId, fileHash);
  const urls = new Set<string>();
  const maxSecond = Math.max(0, Math.ceil(durationSeconds) + 1);
  for (let second = 0; second <= maxSecond; second += 1) {
    const url = thumbnailCacheService.getThumbnail(mediaFileId, second);
    if (url) {
      urls.add(url);
    }
  }
  if (urls.size === 0) return 0;

  urls.forEach((url) => {
    ensureThumbnailBitmap(url, () => undefined, mediaFileId);
  });

  const timeoutAt = nowMs() + Math.max(0, timeoutMs);
  while (nowMs() < timeoutAt) {
    let readyCount = 0;
    urls.forEach((url) => {
      if (hasThumbnailBitmap(url)) readyCount += 1;
    });
    if (readyCount >= urls.size) return readyCount;
    await waitForFrames(1, 180);
  }

  let readyCount = 0;
  urls.forEach((url) => {
    if (hasThumbnailBitmap(url)) readyCount += 1;
  });
  return readyCount;
}

function getSmokeClipThumbnailMediaFileId(clip: TimelineClip): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

async function warmWorkerThumbnailBitmapsForCurrentTimeline(input: {
  timeoutMs: number;
  maxSecondsPerSource: number;
}): Promise<{
  sourceCount: number;
  requestedUrlCount: number;
  warmedBitmapCount: number;
  missingSourceIds: string[];
}> {
  const clips = useTimelineStore.getState().clips;
  const mediaFilesById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  const sources = new Map<string, {
    fileHash?: string;
    durationSeconds: number;
  }>();

  for (const clip of clips) {
    const mediaFileId = getSmokeClipThumbnailMediaFileId(clip);
    if (!mediaFileId) continue;
    const mediaFile = mediaFilesById.get(mediaFileId);
    const durationSeconds = Math.max(
      clip.source?.naturalDuration ?? 0,
      clip.outPoint ?? 0,
      clip.duration ?? 0,
      mediaFile?.duration ?? 0,
    );
    sources.set(mediaFileId, {
      fileHash: mediaFile?.fileHash,
      durationSeconds: Math.max(durationSeconds, sources.get(mediaFileId)?.durationSeconds ?? 0),
    });
  }

  const urls = new Map<string, { url: string; mediaFileId: string }>();
  const missingSourceIds: string[] = [];
  for (const [mediaFileId, source] of sources) {
    await thumbnailCacheService.loadCachedForSource(mediaFileId, source.fileHash);
    const maxSecond = Math.max(0, Math.min(
      Math.ceil(source.durationSeconds) + 1,
      Math.round(input.maxSecondsPerSource),
    ));
    let sourceUrlCount = 0;
    for (let second = 0; second <= maxSecond; second += 1) {
      const url = thumbnailCacheService.getThumbnail(mediaFileId, second);
      if (!url) continue;
      sourceUrlCount += 1;
      urls.set(url, { url, mediaFileId });
    }
    if (sourceUrlCount === 0) {
      missingSourceIds.push(mediaFileId);
    }
  }

  urls.forEach(({ url, mediaFileId }) => {
    ensureThumbnailBitmap(url, () => undefined, mediaFileId);
  });

  const timeoutAt = nowMs() + Math.max(0, input.timeoutMs);
  while (nowMs() < timeoutAt) {
    let readyCount = 0;
    urls.forEach(({ url }) => {
      if (hasThumbnailBitmap(url)) readyCount += 1;
    });
    if (readyCount >= urls.size) {
      return {
        sourceCount: sources.size,
        requestedUrlCount: urls.size,
        warmedBitmapCount: readyCount,
        missingSourceIds,
      };
    }
    await waitForFrames(1, 180);
  }

  let warmedBitmapCount = 0;
  urls.forEach(({ url }) => {
    if (hasThumbnailBitmap(url)) warmedBitmapCount += 1;
  });
  return {
    sourceCount: sources.size,
    requestedUrlCount: urls.size,
    warmedBitmapCount,
    missingSourceIds,
  };
}

async function sampleFrameLoop(durationMs: number): Promise<{
  durationMs: number;
  frameCount: number;
  estimatedFps: number;
  frameDeltaMs: NumberSummary;
  slowFrameCount: number;
  droppedFrameEstimate: number;
}> {
  const safeDurationMs = Math.max(100, Math.min(10000, Math.round(durationMs)));
  const expectedFrameMs = 1000 / 60;
  const startedAt = nowMs();
  const deltas: number[] = [];
  let previousFrameAt: number | null = null;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    const scheduleNext = () => {
      if (nowMs() - startedAt >= safeDurationMs) {
        finish();
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        const timeout = setTimeout(() => tick(nowMs()), 120);
        requestAnimationFrame((timestamp) => {
          clearTimeout(timeout);
          tick(timestamp);
        });
      } else {
        setTimeout(() => tick(Date.now()), 16);
      }
    };
    const tick = (timestamp: number) => {
      if (resolved) {
        return;
      }
      if (previousFrameAt !== null) {
        deltas.push(timestamp - previousFrameAt);
      }
      previousFrameAt = timestamp;
      if (timestamp - startedAt >= safeDurationMs) {
        finish();
        return;
      }
      scheduleNext();
    };

    scheduleNext();
  });

  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);

  return {
    durationMs: safeDurationMs,
    frameCount: deltas.length,
    estimatedFps: round(deltas.length / Math.max(0.001, safeDurationMs / 1000)),
    frameDeltaMs: summarizeNumbers(deltas),
    slowFrameCount: deltas.filter((delta) => delta > expectedFrameMs * 1.75).length,
    droppedFrameEstimate,
  };
}

export function assertTimelineCanvasFrameLoopBudget(
  frameLoop: Awaited<ReturnType<typeof sampleFrameLoop>>,
  budget: TimelineCanvasFrameLoopBudget,
): string[] {
  const failures: string[] = [];
  if (frameLoop.estimatedFps < budget.minEstimatedFps) {
    failures.push(`large project estimated FPS ${frameLoop.estimatedFps}/${budget.minEstimatedFps}`);
  }
  if (frameLoop.droppedFrameEstimate > budget.maxDroppedFrameEstimate) {
    failures.push(`large project dropped frame estimate ${frameLoop.droppedFrameEstimate}/${budget.maxDroppedFrameEstimate}`);
  }
  if (frameLoop.slowFrameCount > budget.maxSlowFrameCount) {
    failures.push(`large project slow frame count ${frameLoop.slowFrameCount}/${budget.maxSlowFrameCount}`);
  }
  if (frameLoop.frameDeltaMs.max > budget.maxFrameDeltaMs) {
    failures.push(`large project max frame delta ${frameLoop.frameDeltaMs.max}ms/${budget.maxFrameDeltaMs}ms`);
  }
  return failures;
}

function readPlayheadLeftPx(): number | null {
  if (!hasBrowserDom()) return null;
  const playhead = document.querySelector<HTMLElement>('[data-ai-id="timeline-playhead"], .playhead');
  if (!playhead) return null;
  const styleLeft = Number.parseFloat(playhead.style.left);
  if (Number.isFinite(styleLeft)) {
    return styleLeft;
  }
  const computedLeft = Number.parseFloat(window.getComputedStyle(playhead).left);
  return Number.isFinite(computedLeft) ? computedLeft : null;
}

async function samplePlayheadMotion(durationMs: number): Promise<{
  durationMs: number;
  sampleCount: number;
  forwardDistancePx: number;
  backtrackCount: number;
  maxBacktrackPx: number;
  backtrackDistancePx: number;
  leftPx: NumberSummary;
  frameDeltaMs: NumberSummary;
  samples: Array<{ atMs: number; leftPx: number; storeTime: number }>;
}> {
  const safeDurationMs = Math.max(200, Math.min(10000, Math.round(durationMs)));
  const startedAt = nowMs();
  const samples: Array<{ atMs: number; leftPx: number; storeTime: number }> = [];
  const frameDeltas: number[] = [];
  let previousFrameAt: number | null = null;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    const tick = (timestamp: number) => {
      if (resolved) {
        return;
      }
      if (previousFrameAt !== null) {
        frameDeltas.push(timestamp - previousFrameAt);
      }
      previousFrameAt = timestamp;

      const leftPx = readPlayheadLeftPx();
      if (leftPx !== null) {
        samples.push({
          atMs: round(nowMs() - startedAt),
          leftPx: round(leftPx),
          storeTime: round(useTimelineStore.getState().playheadPosition),
        });
      }

      if (nowMs() - startedAt >= safeDurationMs) {
        finish();
        return;
      }

      if (typeof requestAnimationFrame === 'function') {
        const timeout = setTimeout(() => tick(nowMs()), 120);
        requestAnimationFrame((nextTimestamp) => {
          clearTimeout(timeout);
          tick(nextTimestamp);
        });
      } else {
        setTimeout(() => tick(Date.now()), 16);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(tick);
    } else {
      setTimeout(() => tick(Date.now()), 16);
    }
  });

  let backtrackCount = 0;
  let maxBacktrackPx = 0;
  let backtrackDistancePx = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].leftPx;
    const current = samples[index].leftPx;
    if (current < previous) {
      const delta = previous - current;
      backtrackCount += 1;
      backtrackDistancePx += delta;
      maxBacktrackPx = Math.max(maxBacktrackPx, delta);
    }
  }

  const firstLeft = samples[0]?.leftPx ?? 0;
  const lastLeft = samples[samples.length - 1]?.leftPx ?? firstLeft;
  return {
    durationMs: safeDurationMs,
    sampleCount: samples.length,
    forwardDistancePx: round(lastLeft - firstLeft),
    backtrackCount,
    maxBacktrackPx: round(maxBacktrackPx),
    backtrackDistancePx: round(backtrackDistancePx),
    leftPx: summarizeNumbers(samples.map((sample) => sample.leftPx)),
    frameDeltaMs: summarizeNumbers(frameDeltas),
    samples: samples.slice(0, 160),
  };
}

async function createSmokeImageElement(): Promise<HTMLImageElement | null> {
  if (!hasBrowserDom() || typeof Image !== 'function') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.fillStyle = '#2458d6';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f3c742';
  context.fillRect(24, 24, 112, 112);
  context.fillStyle = '#ffffff';
  context.fillRect(156, 44, 132, 92);

  const image = new Image();
  const dataUrl = canvas.toDataURL('image/png');
  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = dataUrl;
  });

  return image.complete && image.naturalWidth > 0 ? image : null;
}

function chooseSmokeVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

async function createSmokeVideoSourceUrl(durationMs = 1100): Promise<{
  url: string;
  durationSeconds: number;
  mimeType: string;
  revokeOnCleanup: boolean;
  reusedMediaFileId?: string;
  sourceName?: string;
} | null> {
  if (
    !hasBrowserDom() ||
    typeof MediaRecorder === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  ) {
    return null;
  }

  const mimeType = chooseSmokeVideoMimeType();
  if (!mimeType) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const stream = canvas.captureStream(12);
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const frameCount = Math.max(6, Math.ceil(durationMs / 85));
  for (let index = 0; index < frameCount; index += 1) {
    const hue = (index * 37) % 360;
    context.fillStyle = `hsl(${hue}, 66%, 36%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = `hsl(${(hue + 140) % 360}, 78%, 58%)`;
    context.fillRect(24 + (index % 5) * 14, 28, 108, 104);
    context.fillStyle = '#ffffff';
    context.font = '48px sans-serif';
    context.fillText(String(index % 10), 172, 112);
    await new Promise((resolve) => setTimeout(resolve, 85));
  }

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) return null;

  return {
    url: URL.createObjectURL(blob),
    durationSeconds: Math.max(0.5, durationMs / 1000),
    mimeType,
    revokeOnCleanup: true,
  };
}

function resolveExistingThumbnailSmokeVideoSource(args: Record<string, unknown>): {
  url: string;
  durationSeconds: number;
  mimeType: string;
  revokeOnCleanup: boolean;
  reusedMediaFileId: string;
  sourceName: string;
} | null {
  if (args.useExistingMediaFile !== true && typeof args.mediaFileId !== 'string') {
    return null;
  }

  const requestedMediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId : null;
  const mediaFile = useMediaStore.getState().files.find((candidate) => (
    candidate.type === 'video' &&
    Boolean(candidate.url) &&
    (requestedMediaFileId ? candidate.id === requestedMediaFileId : true)
  ));
  if (!mediaFile?.url) {
    return null;
  }

  const sourceDurationSeconds = clampNumber(
    args.sourceDurationSeconds,
    Math.min(Math.max(mediaFile.duration || 5, 0.5), 8),
    0.5,
    Math.max(0.5, mediaFile.duration || 8),
  );

  return {
    url: mediaFile.url,
    durationSeconds: sourceDurationSeconds,
    mimeType: mediaFile.file instanceof File && mediaFile.file.type ? mediaFile.file.type : 'video/mp4',
    revokeOnCleanup: false,
    reusedMediaFileId: mediaFile.id,
    sourceName: mediaFile.name,
  };
}

function resolveBundledThumbnailSmokeVideoSource(args: Record<string, unknown>): {
  url: string;
  durationSeconds: number;
  mimeType: string;
  revokeOnCleanup: boolean;
  reusedMediaFileId?: string;
  sourceName: string;
} | null {
  if (!hasBrowserDom()) {
    return null;
  }

  const sourceDurationSeconds = clampNumber(
    args.sourceDurationSeconds,
    Math.max(0.5, Math.round(clampNumber(args.sourceDurationMs, 1400, 500, 5000)) / 1000),
    0.5,
    12,
  );

  return {
    url: '/masterselects_github.mp4',
    durationSeconds: sourceDurationSeconds,
    mimeType: 'video/mp4',
    revokeOnCleanup: false,
    sourceName: 'Bundled masterselects_github.mp4',
  };
}

function getTimelineThumbnailReloadSmokeMediaFiles(): MediaFile[] {
  return useMediaStore.getState().files.filter((file) => (
    file.type === 'video' &&
    (file.id.startsWith('timeline-thumb-reload-smoke-') || file.name === 'Timeline Thumbnail Reload Smoke.webm')
  ));
}

async function cleanupTimelineThumbnailReloadSmokeMediaFiles(): Promise<string[]> {
  const staleFiles = getTimelineThumbnailReloadSmokeMediaFiles();
  if (staleFiles.length === 0) return [];

  const staleIds = new Set(staleFiles.map((file) => file.id));
  useMediaStore.setState((state) => ({
    files: state.files.filter((file) => !staleIds.has(file.id)),
    selectedIds: state.selectedIds?.filter((id) => !staleIds.has(id)) ?? state.selectedIds,
  }));

  for (const mediaFileId of staleIds) {
    await thumbnailCacheService.clearSource(mediaFileId);
  }

  return [...staleIds];
}

function removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline(): {
  removedClipCount: number;
  removedTrackCount: number;
} {
  const timelineStore = useTimelineStore.getState();
  const smokeMediaFileIds = new Set(getTimelineThumbnailReloadSmokeMediaFiles().map((file) => file.id));
  const nextClips = timelineStore.clips.filter((clip) => {
    const source = clip.source as TimelineClip['source'] & { mediaFileId?: string; sourceId?: string };
    const mediaFileId = source?.mediaFileId ?? source?.sourceId ?? null;
    if (mediaFileId && mediaFileId.startsWith('timeline-thumb-reload-smoke-')) return false;
    return !(mediaFileId && smokeMediaFileIds.has(mediaFileId));
  });
  if (nextClips.length === timelineStore.clips.length) {
    return { removedClipCount: 0, removedTrackCount: 0 };
  }

  const usedTrackIds = new Set(nextClips.map((clip) => clip.trackId));
  const nextTracks = timelineStore.tracks.filter((track) => (
    !track.name.startsWith('Smoke Video') || usedTrackIds.has(track.id)
  ));
  useTimelineStore.setState({
    clips: nextClips,
    tracks: nextTracks,
    selectedClipIds: new Set([...timelineStore.selectedClipIds].filter((clipId) => (
      nextClips.some((clip) => clip.id === clipId)
    ))),
  });

  return {
    removedClipCount: timelineStore.clips.length - nextClips.length,
    removedTrackCount: timelineStore.tracks.length - nextTracks.length,
  };
}

async function createSyntheticTimeline(args: Record<string, unknown>): Promise<{
  trackCount: number;
  clipCount: number;
  durationSeconds: number;
}> {
  const clipCount = Math.round(clampNumber(args.clipCount, 720, 1, 5000));
  const videoTrackCount = Math.round(clampNumber(args.videoTrackCount, 8, 1, 64));
  const audioTrackCount = Math.round(clampNumber(args.audioTrackCount, 0, 0, 64));
  const durationSeconds = clampNumber(args.durationSeconds, 360, 5, 7200);
  const clipDurationSeconds = clampNumber(args.clipDurationSeconds, 2, 0.05, 60);
  const tracks = createTimelineCanvasSmokeTracks(videoTrackCount, audioTrackCount);
  const imageElement = args.syntheticSourceType === 'image'
    ? await createSmokeImageElement()
    : null;
  const syntheticVideoMediaFileId = typeof args.syntheticVideoMediaFileId === 'string'
    ? args.syntheticVideoMediaFileId
    : undefined;
  const clips = createTimelineCanvasSmokeClips({
    tracks,
    clipCount,
    durationSeconds,
    clipDurationSeconds,
    sourceType: syntheticVideoMediaFileId ? 'video' : imageElement ? 'image' : 'solid',
    imageElement: imageElement ?? undefined,
    mediaFileId: syntheticVideoMediaFileId,
    sourceDurationSeconds: clampNumber(args.syntheticSourceDurationSeconds, durationSeconds, 0.5, 7200),
  });
  const expandedTracks = new Set(tracks.map((track) => track.id));

  useTimelineStore.getState().pause();
  const currentState = useTimelineStore.getState();
  useTimelineStore.setState({
    tracks,
    clips,
    layers: [],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    clipKeyframes: new Map(),
    selectedKeyframeIds: new Set(),
    expandedTracks,
    expandedTrackPropertyGroups: new Map(),
    expandedCurveProperties: new Map(),
    markers: [],
    duration: durationSeconds,
    durationLocked: true,
    playheadPosition: 0,
    waveformsEnabled: typeof args.waveformsEnabled === 'boolean'
      ? args.waveformsEnabled
      : currentState.waveformsEnabled,
    scrollX: 0,
    zoom: clampNumber(args.initialZoom, 12, 1, 1000),
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
  });
  engine.requestNewFrameRender();
  await waitForFrames(3);

  return {
    trackCount: tracks.length,
    clipCount: clips.length,
    durationSeconds,
  };
}

async function resolveSmokeMediaFile(args: Record<string, unknown>): Promise<{
  mediaFile: MediaFile;
  file: File;
} | null> {
  const requestedMediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId : null;
  const mediaFile = useMediaStore.getState().files.find((candidate) => (
    candidate.type === 'video' &&
    (requestedMediaFileId ? candidate.id === requestedMediaFileId : true)
  ));
  if (!mediaFile) return null;

  if (mediaFile.file instanceof File) {
    return { mediaFile, file: mediaFile.file };
  }

  if (mediaFile.url) {
    try {
      const response = await fetch(mediaFile.url);
      const blob = await response.blob();
      if (blob.size > 0) {
        return {
          mediaFile,
          file: new File([blob], mediaFile.name, { type: blob.type || 'video/mp4' }),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function createExistingMediaTimeline(args: Record<string, unknown>): Promise<{
  mediaFileId: string;
  mediaFileName: string;
  trackCount: number;
  clipCount: number;
  durationSeconds: number;
  clipId: string | undefined;
} | null> {
  const resolved = await resolveSmokeMediaFile(args);
  if (!resolved) return null;

  const mediaDuration = Math.max(0.5, resolved.mediaFile.duration || 5);
  const durationSeconds = clampNumber(args.durationSeconds, Math.min(mediaDuration, 18), 0.5, mediaDuration);
  const tracks = DEFAULT_TRACKS.map((track) => ({ ...track }));
  const expandedTracks = new Set(tracks.map((track) => track.id));
  useTimelineStore.getState().pause();
  useTimelineStore.setState({
    tracks,
    clips: [],
    layers: [],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    clipKeyframes: new Map(),
    selectedKeyframeIds: new Set(),
    expandedTracks,
    expandedTrackPropertyGroups: new Map(),
    expandedCurveProperties: new Map(),
    markers: [],
    duration: durationSeconds,
    durationLocked: true,
    playheadPosition: 0,
    scrollX: 0,
    zoom: clampNumber(args.initialZoom, 72, 8, 1000),
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
  });
  const clipId = await useTimelineStore.getState().addClip(
    'video-1',
    resolved.file,
    0,
    durationSeconds,
    resolved.mediaFile.id,
    'video',
  );
  if (clipId) {
    useTimelineStore.getState().selectClip(clipId, false);
  }
  engine.requestNewFrameRender();
  await waitForFrames(8, 250);

  return {
    mediaFileId: resolved.mediaFile.id,
    mediaFileName: resolved.mediaFile.name,
    trackCount: useTimelineStore.getState().tracks.length,
    clipCount: useTimelineStore.getState().clips.length,
    durationSeconds,
    clipId,
  };
}

function maxTimelineScrollX(duration: number, zoom: number): number {
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

function hasCulledDrawStep(steps: readonly TimelineCanvasSmokeStep[], clipCount: number): boolean {
  if (clipCount <= 100) {
    return true;
  }
  return steps.some((step) => {
    const drawnClipCount = Number(step.canvasTotals.drawnClipCount ?? 0);
    return drawnClipCount > 0 && drawnClipCount < clipCount;
  });
}

function dispatchMouseEvent(target: EventTarget, type: string, options: MouseEventInit): boolean {
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

async function runMarqueeDrag(): Promise<{
  started: boolean;
  startClientX: number;
  startClientY: number;
  endClientX: number;
  endClientY: number;
}> {
  if (!hasBrowserDom()) {
    return {
      started: false,
      startClientX: 0,
      startClientY: 0,
      endClientX: 0,
      endClientY: 0,
    };
  }

  const section = document.querySelector<HTMLElement>('.timeline-section-tracks');
  const row = document.querySelector<HTMLElement>('.track-lane[data-track-id] .track-clip-row');
  if (!section || !row) {
    return {
      started: false,
      startClientX: 0,
      startClientY: 0,
      endClientX: 0,
      endClientY: 0,
    };
  }

  const rowRect = row.getBoundingClientRect();
  const startClientX = rowRect.left + 8;
  const startClientY = rowRect.top + Math.max(8, Math.min(24, rowRect.height / 2));
  const endClientX = Math.min(rowRect.right - 8, startClientX + 760);
  const endClientY = Math.min(window.innerHeight - 8, startClientY + 180);

  dispatchMouseEvent(row, 'mousedown', { clientX: startClientX, clientY: startClientY });
  await waitForFrames(1);
  dispatchMouseEvent(document, 'mousemove', { clientX: endClientX, clientY: endClientY });
  await waitForFrames(2);
  dispatchMouseEvent(document, 'mouseup', { clientX: endClientX, clientY: endClientY, buttons: 0 });
  await waitForFrames(2);

  return {
    started: true,
    startClientX: round(startClientX),
    startClientY: round(startClientY),
    endClientX: round(endClientX),
    endClientY: round(endClientY),
  };
}

async function runBladeToolGesture(args: Record<string, unknown>): Promise<{
  started: boolean;
  rowFound: boolean;
  targetClipId: string | null;
  splitTime: number;
  clientX: number;
  clientY: number;
  beforeClipCount: number;
  afterClipCount: number;
  previewBeforeClick: TimelineStoreSnapshot['timelineToolPreview'];
}> {
  const store = useTimelineStore.getState();
  const targetClip = store.clips
    .filter((clip) => clip.source?.type !== 'audio')
    .toSorted((a, b) => a.startTime - b.startTime)[0] ?? null;
  const splitTime = targetClip
    ? clampNumber(args.splitTime, targetClip.startTime + targetClip.duration * 0.5, targetClip.startTime + 0.05, targetClip.startTime + targetClip.duration - 0.05)
    : 0;

  if (!hasBrowserDom() || !targetClip) {
    return {
      started: false,
      rowFound: false,
      targetClipId: targetClip?.id ?? null,
      splitTime,
      clientX: 0,
      clientY: 0,
      beforeClipCount: store.clips.length,
      afterClipCount: store.clips.length,
      previewBeforeClick: null,
    };
  }

  const row = document.querySelector<HTMLElement>(`.track-lane[data-track-id="${targetClip.trackId}"] .track-clip-row`)
    ?? document.querySelector<HTMLElement>('.track-lane[data-track-id] .track-clip-row');
  if (!row) {
    return {
      started: false,
      rowFound: false,
      targetClipId: targetClip.id,
      splitTime,
      clientX: 0,
      clientY: 0,
      beforeClipCount: store.clips.length,
      afterClipCount: store.clips.length,
      previewBeforeClick: null,
    };
  }

  const rowRect = row.getBoundingClientRect();
  const zoom = Math.max(0.001, useTimelineStore.getState().zoom);
  const clientX = rowRect.left + splitTime * zoom;
  const clientY = rowRect.top + Math.max(8, Math.min(24, rowRect.height / 2));
  const beforeClipCount = useTimelineStore.getState().clips.length;

  useTimelineStore.getState().setTimelineToolPreview(null);
  useTimelineStore.getState().setActiveTimelineTool('blade');
  await waitForFrames(2);
  dispatchMouseEvent(row, 'mousemove', { clientX, clientY, buttons: 0 });
  await waitForFrames(2);
  const previewBeforeClick = useTimelineStore.getState().timelineToolPreview;
  dispatchMouseEvent(row, 'mousedown', { clientX, clientY, buttons: 1 });
  await waitForFrames(1);
  dispatchMouseEvent(document, 'mouseup', { clientX, clientY, buttons: 0 });
  await waitForFrames(2);

  return {
    started: true,
    rowFound: true,
    targetClipId: targetClip.id,
    splitTime: round(splitTime),
    clientX: round(clientX),
    clientY: round(clientY),
    beforeClipCount,
    afterClipCount: useTimelineStore.getState().clips.length,
    previewBeforeClick,
  };
}

async function runDirectRamPreviewSmokeRange(start: number, end: number): Promise<{
  completed: boolean;
  frameCount: number;
  error: { message: string; stack?: string } | null;
}> {
  const store = useTimelineStore.getState();
  const runId = createRamPreviewRunId();
  reportRamPreviewRunJob({
    runId,
    start,
    end,
    centerTime: (start + end) / 2,
    label: 'Timeline canvas verification direct RAM preview smoke',
    startedAtMs: Date.now(),
  });

  engine.setGeneratingRamPreview(true);
  try {
    const preview = new RamPreviewEngine(engine);
    const result = await preview.generate(
      {
        start,
        end,
        centerTime: (start + end) / 2,
        clips: store.clips,
        tracks: store.tracks,
        runId,
      },
      {
        isCancelled: () => false,
        isFrameCached: (qt) => useTimelineStore.getState().cachedFrameTimes.has(qt),
        getSourceTimeForClip: (id, t) => useTimelineStore.getState().getSourceTimeForClip(id, t),
        getInterpolatedSpeed: (id, t) => useTimelineStore.getState().getInterpolatedSpeed(id, t),
        getCompositionDimensions: (compId) => {
          const comp = useMediaStore.getState().compositions.find((candidate) => candidate.id === compId);
          return { width: comp?.width || 1920, height: comp?.height || 1080 };
        },
        onFrameCached: (time) => useTimelineStore.getState().addCachedFrame(time),
        onProgress: () => undefined,
      },
    );
    return {
      completed: result.completed,
      frameCount: result.frameCount,
      error: null,
    };
  } catch (error) {
    return {
      completed: false,
      frameCount: 0,
      error: error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) },
    };
  } finally {
    engine.setGeneratingRamPreview(false);
    releaseRamPreviewRunResources(runId);
    useTimelineStore.setState({ isRamPreviewing: false, ramPreviewProgress: null });
  }
}

export async function handleRunTimelineCanvasExportPreviewParitySmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const failures: string[] = [];
  const captureFailures: string[] = [];
  const previewSamples: TimelineCanvasExportPreviewFingerprintSample[] = [];
  const fingerprintOptions = {
    sampleWidth: Math.round(clampNumber(args.sampleWidth, 16, 4, 64)),
    sampleHeight: Math.round(clampNumber(args.sampleHeight, 16, 4, 64)),
  };
  const comparisonThresholds = readExportPreviewParityThresholds(args);
  const includePrecise = args.includePrecise === true;
  const exportWidth = Math.round(clampNumber(args.width, 320, 64, 3840));
  const exportHeight = Math.round(clampNumber(args.height, 180, 64, 2160));
  const exportFps = clampNumber(args.fps, 8, 1, 60);
  const maxSampleTimeDeltaSeconds = clampNumber(args.maxSampleTimeDeltaSeconds, 0.35, 0, 10);
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let reference: {
    capturedAt: number;
    width: number | null;
    height: number | null;
    mode: string | null;
    canvasSource: string | null;
    fingerprint: FrameFingerprint;
  } | null = null;
  let runtimeBeforeExport: ReturnType<typeof timelineRuntimeCoordinator.getBridgeStats> | null = null;
  let runtimeAfterExport: ReturnType<typeof timelineRuntimeCoordinator.getBridgeStats> | null = null;
  let activeExportMode: 'fast' | 'precise' = 'fast';
  const referenceAttempts: TimelineCanvasExportPreviewReferenceAttempt[] = [];

  const unsubscribe = useTimelineStore.subscribe((state, previousState) => {
    if (!state.exportPreviewFrame || state.exportPreviewFrame === previousState.exportPreviewFrame) {
      return;
    }
    try {
      previewSamples.push({
        exportMode: activeExportMode,
        exportProgress: state.exportProgress,
        exportCurrentTime: state.exportCurrentTime,
        previewFrameTime: state.exportPreviewFrameTime,
        fingerprint: fingerprintImageBitmap(state.exportPreviewFrame, fingerprintOptions),
      });
    } catch (error) {
      captureFailures.push(error instanceof Error
        ? `preview frame fingerprint failed: ${error.message}`
        : `preview frame fingerprint failed: ${String(error)}`);
    }
  });

  const runExport = async (
    exportMode: 'fast' | 'precise',
    startTime: number,
    durationSeconds: number,
  ): Promise<TimelineCanvasExportPreviewParityRun> => {
    activeExportMode = exportMode;
    const beforeSampleCount = previewSamples.length;
    const maxRuntimeMs = Math.round(clampNumber(
      exportMode === 'precise'
        ? args.preciseMaxRuntimeMs ?? args.maxRuntimeMs
        : args.fastMaxRuntimeMs ?? args.maxRuntimeMs,
      exportMode === 'precise' ? 60000 : 30000,
      1000,
      600000,
    ));
    const result = await handleDebugExport({
      startTime,
      durationSeconds,
      width: exportWidth,
      height: exportHeight,
      fps: exportFps,
      includeAudio: false,
      exportMode,
      download: false,
      maxRuntimeMs,
    });
    await waitForFrames(2, 180);

    const data = getResultDataObject(result);
    const elapsedMs = typeof data.elapsedMs === 'number' && Number.isFinite(data.elapsedMs)
      ? Math.round(data.elapsedMs)
      : null;
    const modeSamples = previewSamples
      .slice(beforeSampleCount)
      .filter((sample) => sample.exportMode === exportMode);
    const bestSample = selectClosestExportPreviewSample(modeSamples, startTime);
    const runFailures: string[] = [];
    let comparison: FrameFingerprintComparison | null = null;
    const blobSize = getExportBlobSize(result);

    if (!result.success) {
      runFailures.push(result.error ?? `${exportMode} debugExport failed`);
    }
    if (blobSize <= 0) {
      runFailures.push(`${exportMode} debugExport returned empty blob`);
    }
    if (modeSamples.length === 0) {
      runFailures.push(`${exportMode} export published no preview fingerprint samples`);
    }
    if (bestSample && reference) {
      const sampleTime = bestSample.previewFrameTime ?? bestSample.exportCurrentTime;
      if (typeof sampleTime === 'number' && Number.isFinite(sampleTime)) {
        const sampleDelta = Math.abs(sampleTime - startTime);
        if (sampleDelta > maxSampleTimeDeltaSeconds) {
          runFailures.push(`${exportMode} preview sample time delta ${round(sampleDelta)}s/${maxSampleTimeDeltaSeconds}s`);
        }
      }
      comparison = compareFrameFingerprints(reference.fingerprint, bestSample.fingerprint, comparisonThresholds);
      runFailures.push(...comparison.failures.map((failure) => `${exportMode} ${failure}`));
    }

    return {
      exportMode,
      success: runFailures.length === 0,
      error: runFailures.length > 0 ? runFailures.join('; ') : null,
      blobSize,
      elapsedMs,
      sampleCount: modeSamples.length,
      bestSample,
      comparison,
      failures: runFailures,
    };
  };

  let fastRun: TimelineCanvasExportPreviewParityRun | null = null;
  let preciseRun: TimelineCanvasExportPreviewParityRun | null = null;
  let sampleTime = 0;
  let exportDurationSeconds = 0.75;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    synthetic = args.createSynthetic === false
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 12, 1, 240),
        videoTrackCount: clampNumber(args.videoTrackCount, 3, 1, 16),
        audioTrackCount: 0,
        durationSeconds: clampNumber(args.durationSeconds, 6, 1, 120),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2.4, 0.2, 20),
        initialZoom: clampNumber(args.initialZoom, 72, 8, 1000),
      });
    before = collectSmokeSnapshot('before');
    const timelineStore = useTimelineStore.getState();
    const timelineDuration = Math.max(0, timelineStore.duration);
    const maxStartTime = Math.max(0, timelineDuration - 0.1);
    const sampleTimeCandidates = resolveExportPreviewParitySampleTimes(args, maxStartTime);
    sampleTime = sampleTimeCandidates[0] ?? 0;
    exportDurationSeconds = clampNumber(
      args.exportDurationSeconds,
      0.75,
      0.1,
      Math.max(0.1, timelineDuration - sampleTime),
    );

    if (!hasBrowserDom()) {
      failures.push('browser DOM is unavailable');
    }
    if (timelineStore.clips.length === 0) {
      failures.push('timeline has no clips for export preview parity smoke');
    }

    if (failures.length === 0) {
      const captureMode = args.captureMode === 'dom' ? 'dom' : 'gpu';
      for (const candidateTime of sampleTimeCandidates) {
        let attemptError: string | null = null;
        let attemptFingerprint: FrameFingerprint | null = null;
        let referenceCapture = await handleCaptureFrame({ time: candidateTime, mode: captureMode }, useTimelineStore.getState());
        if (!referenceCapture.success && captureMode === 'gpu') {
          referenceCapture = await handleCaptureFrame({ time: candidateTime, mode: 'dom' }, useTimelineStore.getState());
        }

        if (!referenceCapture.success) {
          attemptError = referenceCapture.error ?? 'reference frame capture failed';
        } else {
          const captureData = getResultDataObject(referenceCapture);
          const dataUrl = typeof captureData.dataUrl === 'string' ? captureData.dataUrl : null;
          if (!dataUrl) {
            attemptError = 'reference frame capture did not return a dataUrl';
          } else {
            attemptFingerprint = await fingerprintDataUrl(dataUrl, fingerprintOptions);
            reference = {
              capturedAt: getNumberField(captureData, 'capturedAt', candidateTime),
              width: typeof captureData.width === 'number' ? captureData.width : null,
              height: typeof captureData.height === 'number' ? captureData.height : null,
              mode: typeof captureData.mode === 'string' ? captureData.mode : null,
              canvasSource: typeof captureData.canvasSource === 'string' ? captureData.canvasSource : null,
              fingerprint: attemptFingerprint,
            };
            sampleTime = candidateTime;
          }
        }

        referenceAttempts.push({
          requestedTime: candidateTime,
          success: Boolean(attemptFingerprint),
          error: attemptError,
          fingerprint: attemptFingerprint,
        });

        if (
          attemptFingerprint &&
          attemptFingerprint.nonBlankRatio >= (comparisonThresholds.minReferenceNonBlankRatio ?? 0.05)
        ) {
          break;
        }
      }

      if (!reference) {
        failures.push(`reference frame capture failed for ${sampleTimeCandidates.length} sample candidates`);
      }
    }

    if (reference) {
      runtimeBeforeExport = timelineRuntimeCoordinator.getBridgeStats();
      const exportResourcesBefore = runtimeBeforeExport.policies.export.resources.length;
      if (exportResourcesBefore !== 0) {
        failures.push(`export runtime resources existed before parity smoke: ${exportResourcesBefore}`);
      }
      fastRun = await runExport('fast', sampleTime, exportDurationSeconds);
      failures.push(...fastRun.failures);
      if (includePrecise) {
        preciseRun = await runExport('precise', sampleTime, Math.min(exportDurationSeconds, 0.5));
        failures.push(...preciseRun.failures);
      }
      runtimeAfterExport = timelineRuntimeCoordinator.getBridgeStats();
      const exportResourcesAfter = runtimeAfterExport.policies.export.resources.length;
      if (exportResourcesAfter !== 0) {
        failures.push(`export runtime resources retained after parity smoke: ${exportResourcesAfter}`);
      }
    }

    failures.push(...captureFailures);
    after = collectSmokeSnapshot('after');
    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
    }));
  } finally {
    try {
      unsubscribe();
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      sampleTime,
      exportDurationSeconds,
      fingerprintOptions,
      comparisonThresholds,
      reference,
      referenceAttempts,
      fastRun,
      preciseRun,
      before,
      after,
      runtimeBeforeExport,
      runtimeAfterExport,
      previewSampleCount: previewSamples.length,
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasLargeProjectSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const createSynthetic = args.createSynthetic !== false;
  const steps: TimelineCanvasSmokeStep[] = [];
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let frameLoop: Awaited<ReturnType<typeof sampleFrameLoop>> | null = null;
  let workerThumbnailWarmup: Awaited<ReturnType<typeof warmWorkerThumbnailBitmapsForCurrentTimeline>> | null = null;
  const compactResult = args.compactResult === true;
  const phaseRecorder = buildSmokePhaseRecorder();
  const frameLoopBudget = readLargeProjectFrameLoopBudget(args);
  const minWorkerTrackCount = Math.round(clampNumber(args.minWorkerTrackCount, 0, 0, 1000));
  const minWorkerEligibleTrackCount = Math.round(clampNumber(args.minWorkerEligibleTrackCount, 0, 0, 1000));
  const minWorkerWarmThumbnailBitmapCount = Math.round(clampNumber(
    args.minWorkerWarmThumbnailBitmapCount,
    0,
    0,
    100000,
  ));
  const maxWorkerTrackCount = typeof args.maxWorkerTrackCount === 'number'
    ? clampNumber(args.maxWorkerTrackCount, 0, 0, 1000)
    : minWorkerTrackCount > 0
      ? 1000
      : 0;
  const maxWorkerFallbackTrackCount = typeof args.maxWorkerFallbackTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerFallbackTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerPendingTrackCount = typeof args.maxWorkerPendingTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerPendingTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerErrorTrackCount = typeof args.maxWorkerErrorTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerErrorTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerResourceBytes = typeof args.maxWorkerResourceBytes === 'number'
    ? Math.round(clampNumber(args.maxWorkerResourceBytes, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER))
    : undefined;
  const requiredWorkerFallbackReasons = Array.isArray(args.requiredWorkerFallbackReasons)
    ? args.requiredWorkerFallbackReasons.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    : [];
  const allowedWorkerFallbackReasons = Array.isArray(args.allowedWorkerFallbackReasons)
    ? args.allowedWorkerFallbackReasons.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    : [];
  const maxShellCount = clampNumber(args.maxShellCount, 0, 0, 1000);
  const forcedTimelineCanvasWorker = typeof args.forceTimelineCanvasWorker === 'boolean'
    ? args.forceTimelineCanvasWorker
    : null;
  const previousTimelineCanvasWorkerFlag = flags.timelineCanvasWorker;
  const failures: string[] = [];
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    let phaseStartMs = nowMs();
    if (forcedTimelineCanvasWorker !== null) {
      flags.timelineCanvasWorker = forcedTimelineCanvasWorker;
    }
    phaseRecorder.record('worker-flag', phaseStartMs);
    phaseStartMs = nowMs();
    synthetic = createSynthetic ? await createSyntheticTimeline(args) : null;
    phaseRecorder.record(createSynthetic ? 'synthetic-timeline' : 'existing-timeline', phaseStartMs);
    if (args.warmWorkerThumbnails === true) {
      phaseStartMs = nowMs();
      workerThumbnailWarmup = await warmWorkerThumbnailBitmapsForCurrentTimeline({
        timeoutMs: clampNumber(args.workerThumbnailWarmupTimeoutMs, 6000, 0, 30000),
        maxSecondsPerSource: clampNumber(args.workerThumbnailWarmupMaxSecondsPerSource, 300, 1, 3600),
      });
      if (workerThumbnailWarmup.warmedBitmapCount < minWorkerWarmThumbnailBitmapCount) {
        failures.push(
          `worker thumbnail warmup bitmaps ${workerThumbnailWarmup.warmedBitmapCount}/${minWorkerWarmThumbnailBitmapCount}`
        );
      }
      await waitForFrames(3, 180);
      phaseRecorder.record('worker-thumbnail-warmup', phaseStartMs);
    }
    phaseStartMs = nowMs();
    before = collectSmokeSnapshot('before');
    phaseRecorder.record('before-snapshot', phaseStartMs);
    const initialZoom = before.timeline.zoom;
    const zoomLevels = Array.isArray(args.zoomLevels) && args.zoomLevels.length > 0
      ? args.zoomLevels.map((value) => clampNumber(value, initialZoom, 1, 1000))
      : [initialZoom, Math.max(4, initialZoom * 0.5), Math.min(1000, initialZoom * 2)];
    const scrollFractions = Array.isArray(args.scrollFractions) && args.scrollFractions.length > 0
      ? args.scrollFractions.map((value) => clampNumber(value, 0, 0, 1))
      : [0, 0.5, 1];
    const timelineStore = useTimelineStore.getState();

    for (const zoom of zoomLevels) {
      const zoomStartMs = nowMs();
      timelineStore.setZoom(zoom);
      await waitForFrames(2);
      phaseRecorder.record(`zoom:${zoom}`, zoomStartMs);
      const stateAtZoom = useTimelineStore.getState();
      const effectiveZoom = stateAtZoom.zoom;
      const maxScroll = maxTimelineScrollX(stateAtZoom.duration, effectiveZoom);
      for (const fraction of scrollFractions) {
        const scrollStartMs = nowMs();
        const scrollX = Math.round(maxScroll * fraction);
        useTimelineStore.getState().setScrollX(scrollX);
        await waitForFrames(2);
        const stepSnapshot = collectSmokeSnapshot(`zoom:${zoom}:scroll:${fraction}`);
        phaseRecorder.record(`step:${effectiveZoom}:${fraction}`, scrollStartMs);
        steps.push({
          label: stepSnapshot.label,
          requestedZoom: effectiveZoom,
          zoom: stepSnapshot.timeline.zoom,
          scrollFraction: fraction,
          requestedScrollX: scrollX,
          scrollX: stepSnapshot.timeline.scrollX,
          dom: stepSnapshot.dom,
          canvasTotals: readCanvasTotals(stepSnapshot),
        });
      }
    }

    if (args.selectAll !== false) {
      const selectStartMs = nowMs();
      const clipIds = useTimelineStore.getState().clips.map((clip) => clip.id);
      useTimelineStore.getState().selectClips(clipIds);
      await waitForFrames(3);
      phaseRecorder.record('select-all', selectStartMs);
    }

    phaseStartMs = nowMs();
    frameLoop = await sampleFrameLoop(clampNumber(args.frameSampleMs, 750, 100, 10000));
    phaseRecorder.record('frame-loop-sample', phaseStartMs);
    phaseStartMs = nowMs();
    after = collectSmokeSnapshot('after');
    phaseRecorder.record('after-snapshot', phaseStartMs);
    const workerSettleTimeoutMs = clampNumber(
      args.workerSettleTimeoutMs,
      typeof maxWorkerPendingTrackCount === 'number' ? 3000 : 0,
      0,
      30000,
    );
    if (workerSettleTimeoutMs > 0) {
      phaseStartMs = nowMs();
      const settleTimeoutAt = nowMs() + workerSettleTimeoutMs;
      let settleTotals = readCanvasTotals(after);
      while (
        nowMs() < settleTimeoutAt &&
        (
          (typeof maxWorkerPendingTrackCount === 'number' && Number(settleTotals.workerPendingTrackCount ?? 0) > maxWorkerPendingTrackCount) ||
          (typeof maxWorkerErrorTrackCount === 'number' && Number(settleTotals.workerErrorTrackCount ?? 0) > maxWorkerErrorTrackCount)
        )
      ) {
        await waitForFrames(2, 180);
        after = collectSmokeSnapshot('after');
        settleTotals = readCanvasTotals(after);
      }
      phaseRecorder.record('worker-settle', phaseStartMs);
    }
    phaseStartMs = nowMs();
    failures.push(
      ...assertCanvasSmokeSnapshot(after, {
        requireTimelineDom: args.requireTimelineDom !== false,
        requireCulling: args.requireCulling !== false,
        requireSelectedAll: args.selectAll !== false,
        expectedSelectedClipCount: args.selectAll !== false ? after.timeline.clipCount : undefined,
        maxWorkerTrackCount,
        minWorkerTrackCount,
        minWorkerEligibleTrackCount,
        maxWorkerFallbackTrackCount,
        maxWorkerPendingTrackCount,
        maxWorkerErrorTrackCount,
        maxWorkerResourceBytes,
        requiredWorkerFallbackReasons,
        allowedWorkerFallbackReasons,
        maxShellCount,
      }),
      ...steps.flatMap((step) => assertTimelineCanvasStepInvariants(step, {
        requireTimelineDom: args.requireTimelineDom !== false,
        maxWorkerTrackCount,
        maxWorkerResourceBytes,
        maxShellCount,
        assertRequestedPosition: true,
      })),
      ...assertTimelineCanvasFrameLoopBudget(frameLoop, frameLoopBudget),
    );
    if (args.requireCulling !== false && !hasCulledDrawStep(steps, after.timeline.clipCount)) {
      failures.push(`large project did not report a partially culled draw step for ${after.timeline.clipCount} clips`);
    }
    phaseRecorder.record('assertions', phaseStartMs);
  } finally {
    const restoreStartMs = nowMs();
    try {
      if (forcedTimelineCanvasWorker !== null) {
        flags.timelineCanvasWorker = previousTimelineCanvasWorkerFlag;
      }
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
    phaseRecorder.record('restore', restoreStartMs);
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      before: compactResult ? compactSmokeSnapshot(before) : before,
      after: compactResult ? compactSmokeSnapshot(after) : after,
      steps,
      frameLoop,
      frameLoopBudget,
      workerThumbnailWarmup,
      phaseTimings: phaseRecorder.timings,
      invariantBudget: {
        maxWorkerTrackCount,
        minWorkerTrackCount,
        minWorkerEligibleTrackCount,
        minWorkerWarmThumbnailBitmapCount,
        maxWorkerFallbackTrackCount,
        maxWorkerPendingTrackCount,
        maxWorkerErrorTrackCount,
        maxWorkerResourceBytes,
        requiredWorkerFallbackReasons,
        allowedWorkerFallbackReasons,
        maxShellCount,
      },
      workerFlag: {
        forced: forcedTimelineCanvasWorker,
        previous: previousTimelineCanvasWorkerFlag,
        restored: flags.timelineCanvasWorker,
      },
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasMarqueeSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let drag: Awaited<ReturnType<typeof runMarqueeDrag>> | null = null;
  const minSelectedClipCount = Math.round(clampNumber(args.minSelectedClipCount, 1, 0, 100000));
  const failures: string[] = [];
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    synthetic = args.createSynthetic === false
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 160, 1, 1000),
        videoTrackCount: clampNumber(args.videoTrackCount, 4, 1, 16),
        durationSeconds: clampNumber(args.durationSeconds, 120, 5, 3600),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2, 0.05, 30),
        initialZoom: clampNumber(args.initialZoom, 16, 1, 1000),
      });
    before = collectSmokeSnapshot('before');

    if (args.clearSelection !== false) {
      useTimelineStore.getState().selectClip(null, false);
      useTimelineStore.getState().deselectAllKeyframes();
      await waitForFrames(2);
    }

    drag = await runMarqueeDrag();
    if (!drag.started) {
      failures.push('marquee drag target was not found');
    }

    after = collectSmokeSnapshot('after');
    if (after.timeline.selectedClipCount < minSelectedClipCount) {
      failures.push(`marquee selected ${after.timeline.selectedClipCount}/${minSelectedClipCount} required clips`);
    }

    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
    }));
  } finally {
    try {
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      drag,
      minSelectedClipCount,
      before,
      after,
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasBladeToolSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const failures: string[] = [];
  let mediaSetup: Awaited<ReturnType<typeof createExistingMediaTimeline>> | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let gesture: Awaited<ReturnType<typeof runBladeToolGesture>> | null = null;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    mediaSetup = args.useExistingMediaFile === true
      ? await createExistingMediaTimeline({
        ...args,
        durationSeconds: clampNumber(args.durationSeconds, 18, 0.5, 7200),
      })
      : null;
    synthetic = mediaSetup || args.useExistingMediaFile === true
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 1, 1, 4),
        videoTrackCount: clampNumber(args.videoTrackCount, 1, 1, 4),
        audioTrackCount: 0,
        durationSeconds: clampNumber(args.durationSeconds, 8, 1, 120),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 6, 0.2, 60),
        initialZoom: clampNumber(args.initialZoom, 72, 8, 1000),
      });
    before = collectSmokeSnapshot('before');
    gesture = await runBladeToolGesture(args);
    after = collectSmokeSnapshot('after');

    if (args.useExistingMediaFile === true && !mediaSetup) {
      failures.push('no existing video MediaFile was available for blade tool smoke');
    }
    if (!gesture.rowFound) {
      failures.push('blade smoke could not find a canvas track row');
    }
    if (!gesture.started) {
      failures.push('blade smoke did not dispatch the pointer gesture');
    }
    if (gesture.previewBeforeClick?.toolId !== 'blade') {
      failures.push('blade hover did not publish a blade tool preview');
    }
    if (gesture.previewBeforeClick?.clipId !== gesture.targetClipId) {
      failures.push('blade hover preview did not target the hit clip');
    }
    if (Math.abs((gesture.previewBeforeClick?.time ?? Number.NaN) - gesture.splitTime) > 0.05) {
      failures.push(`blade hover preview time ${gesture.previewBeforeClick?.time ?? 'missing'} did not match split time ${gesture.splitTime}`);
    }
    if (gesture.afterClipCount <= gesture.beforeClipCount) {
      failures.push(`blade click did not split the clip: ${gesture.beforeClipCount} -> ${gesture.afterClipCount}`);
    }
    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
    }));
  } finally {
    try {
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      mediaSetup,
      synthetic,
      before,
      after,
      gesture,
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasThumbnailReloadSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const failures: string[] = [];
  const durationMs = Math.round(clampNumber(args.sourceDurationMs, 1100, 500, 5000));
  const source = resolveExistingThumbnailSmokeVideoSource(args)
    ?? resolveBundledThumbnailSmokeVideoSource(args)
    ?? await createSmokeVideoSourceUrl(durationMs);
  if (!source) {
    return {
      success: false,
      error: 'could not create synthetic video source for thumbnail reload smoke',
      data: {
        restore: {
          enabled: Boolean(restoreState),
          result: null,
        },
        failures: ['video source unavailable'],
      },
    };
  }

  const mediaFileId = `timeline-thumb-reload-smoke-${Date.now()}`;
  const fileHash = `${mediaFileId}-hash`;
  const mediaFile: MediaFile = {
    id: mediaFileId,
    name: 'Timeline Thumbnail Reload Smoke.webm',
    type: 'video',
    parentId: null,
    createdAt: Date.now(),
    url: source.url,
    duration: source.durationSeconds,
    width: 320,
    height: 180,
    fps: 12,
    fileSize: 0,
    hasAudio: false,
    fileHash,
  };

  let generatedThumbnailCount = 0;
  let warmedThumbnailBitmapCount = 0;
  let generationError: string | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let totals: ReturnType<typeof readCanvasTotals> = {};
  const minThumbnailClipCount = Math.round(clampNumber(args.minThumbnailClipCount, 1, 0, 100000));
  const minThumbnailDrawCount = Math.round(clampNumber(args.minThumbnailDrawCount, 1, 0, 100000));
  const minWorkerTrackCount = Math.round(clampNumber(args.minWorkerTrackCount, 0, 0, 1000));
  const minWorkerEligibleTrackCount = Math.round(clampNumber(args.minWorkerEligibleTrackCount, 0, 0, 1000));
  const maxWorkerFallbackTrackCount = typeof args.maxWorkerFallbackTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerFallbackTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerPendingTrackCount = typeof args.maxWorkerPendingTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerPendingTrackCount, 1000, 0, 1000))
    : undefined;
  const maxWorkerErrorTrackCount = typeof args.maxWorkerErrorTrackCount === 'number'
    ? Math.round(clampNumber(args.maxWorkerErrorTrackCount, 1000, 0, 1000))
    : undefined;
  const minWorkerResourceBytes = Math.round(clampNumber(args.minWorkerResourceBytes, 0, 0, Number.MAX_SAFE_INTEGER));
  const maxWorkerResourceBytes = typeof args.maxWorkerResourceBytes === 'number'
    ? Math.round(clampNumber(args.maxWorkerResourceBytes, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER))
    : undefined;
  const forcedTimelineCanvasWorker = typeof args.forceTimelineCanvasWorker === 'boolean'
    ? args.forceTimelineCanvasWorker
    : null;
  const previousTimelineCanvasWorkerFlag = flags.timelineCanvasWorker;
  let thumbnailClipCount = 0;
  let thumbnailDrawCount = 0;
  let workerTrackCount = 0;
  let workerEligibleTrackCount = 0;
  let workerFallbackTrackCount = 0;
  let workerPendingTrackCount = 0;
  let workerErrorTrackCount = 0;
  let workerResourceBytes = 0;
  let preRunCleanupIds: string[] = [];
  let postRunCleanupIds: string[] = [];
  let postRunTimelineCleanup: ReturnType<typeof removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline> | null = null;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    preRunCleanupIds = await cleanupTimelineThumbnailReloadSmokeMediaFiles();
    if (forcedTimelineCanvasWorker !== null) {
      flags.timelineCanvasWorker = forcedTimelineCanvasWorker;
    }
    useMediaStore.setState((state) => ({
      files: [mediaFile, ...state.files.filter((file) => file.id !== mediaFileId)],
    }));

    await thumbnailCacheService.generateForSourceUrl(
      mediaFileId,
      source.url,
      source.durationSeconds,
      fileHash,
      'anonymous',
    );
    generatedThumbnailCount = thumbnailCacheService.getCount(mediaFileId);
    generationError = thumbnailCacheService.getLastGenerationError(mediaFileId);
    if (generatedThumbnailCount <= 0) {
      failures.push(generationError
        ? `synthetic source thumbnail generation produced no frames: ${generationError}`
        : 'synthetic source thumbnail generation produced no frames');
    }

    thumbnailCacheService.evictFromMemory(mediaFileId);
    if (forcedTimelineCanvasWorker === true) {
      warmedThumbnailBitmapCount = await warmThumbnailBitmapsForSource(
        mediaFileId,
        fileHash,
        source.durationSeconds,
        clampNumber(args.workerThumbnailWarmupTimeoutMs, 3000, 0, 10000),
      );
    }
    synthetic = await createSyntheticTimeline({
      createSynthetic: true,
      clipCount: clampNumber(args.clipCount, 18, 1, 160),
      videoTrackCount: clampNumber(args.videoTrackCount, 2, 1, 8),
      durationSeconds: clampNumber(args.durationSeconds, 24, 2, 240),
      clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2, 0.5, 20),
      initialZoom: clampNumber(args.initialZoom, 72, 8, 1000),
      syntheticVideoMediaFileId: mediaFileId,
      syntheticSourceDurationSeconds: source.durationSeconds,
    });

    after = collectSmokeSnapshot('after');
    totals = readCanvasTotals(after);
    const timeoutAt = nowMs() + clampNumber(args.timeoutMs, 7000, 1000, 30000);

    while (
      nowMs() < timeoutAt &&
      (
        Number(totals.thumbnailClipCount ?? 0) < minThumbnailClipCount ||
        Number(totals.thumbnailDrawCount ?? 0) < minThumbnailDrawCount ||
        Number(totals.workerTrackCount ?? 0) < minWorkerTrackCount ||
        Number(totals.workerEligibleTrackCount ?? 0) < minWorkerEligibleTrackCount ||
        (typeof maxWorkerFallbackTrackCount === 'number' && Number(totals.workerFallbackTrackCount ?? 0) > maxWorkerFallbackTrackCount) ||
        (typeof maxWorkerPendingTrackCount === 'number' && Number(totals.workerPendingTrackCount ?? 0) > maxWorkerPendingTrackCount) ||
        (typeof maxWorkerErrorTrackCount === 'number' && Number(totals.workerErrorTrackCount ?? 0) > maxWorkerErrorTrackCount) ||
        Number(totals.workerResourceBytes ?? 0) < minWorkerResourceBytes
      )
    ) {
      await waitForFrames(3, 180);
      after = collectSmokeSnapshot('after');
      totals = readCanvasTotals(after);
    }

    thumbnailClipCount = Number(totals.thumbnailClipCount ?? 0);
    thumbnailDrawCount = Number(totals.thumbnailDrawCount ?? 0);
    workerTrackCount = Number(totals.workerTrackCount ?? 0);
    workerEligibleTrackCount = Number(totals.workerEligibleTrackCount ?? 0);
    workerFallbackTrackCount = Number(totals.workerFallbackTrackCount ?? 0);
    workerPendingTrackCount = Number(totals.workerPendingTrackCount ?? 0);
    workerErrorTrackCount = Number(totals.workerErrorTrackCount ?? 0);
    workerResourceBytes = Number(totals.workerResourceBytes ?? 0);
    if (thumbnailClipCount < minThumbnailClipCount) {
      failures.push(`thumbnailClipCount ${thumbnailClipCount}/${minThumbnailClipCount}`);
    }
    if (thumbnailDrawCount < minThumbnailDrawCount) {
      failures.push(`thumbnailDrawCount ${thumbnailDrawCount}/${minThumbnailDrawCount}`);
    }
    if (workerTrackCount < minWorkerTrackCount) {
      failures.push(`worker tracks ${workerTrackCount}/${minWorkerTrackCount} required`);
    }
    if (workerEligibleTrackCount < minWorkerEligibleTrackCount) {
      failures.push(`worker eligible tracks ${workerEligibleTrackCount}/${minWorkerEligibleTrackCount} required`);
    }
    if (typeof maxWorkerFallbackTrackCount === 'number' && workerFallbackTrackCount > maxWorkerFallbackTrackCount) {
      failures.push(`worker fallback tracks ${workerFallbackTrackCount}/${maxWorkerFallbackTrackCount}`);
    }
    if (typeof maxWorkerPendingTrackCount === 'number' && workerPendingTrackCount > maxWorkerPendingTrackCount) {
      failures.push(`worker pending tracks ${workerPendingTrackCount}/${maxWorkerPendingTrackCount}`);
    }
    if (typeof maxWorkerErrorTrackCount === 'number' && workerErrorTrackCount > maxWorkerErrorTrackCount) {
      failures.push(`worker error tracks ${workerErrorTrackCount}/${maxWorkerErrorTrackCount}`);
    }
    if (workerResourceBytes < minWorkerResourceBytes) {
      failures.push(`worker resource bytes ${workerResourceBytes}/${minWorkerResourceBytes}`);
    }
    if (typeof maxWorkerResourceBytes === 'number' && workerResourceBytes > maxWorkerResourceBytes) {
      failures.push(`worker resource bytes ${workerResourceBytes}/${maxWorkerResourceBytes} max`);
    }

    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
      maxWorkerPendingTrackCount,
      maxWorkerErrorTrackCount,
    }));
  } finally {
    try {
      if (forcedTimelineCanvasWorker !== null) {
        flags.timelineCanvasWorker = previousTimelineCanvasWorkerFlag;
      }
      postRunTimelineCleanup = removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline();
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
      const postRestoreTimelineCleanup = removeTimelineThumbnailReloadSmokeClipsFromCurrentTimeline();
      postRunTimelineCleanup = {
        removedClipCount: (postRunTimelineCleanup?.removedClipCount ?? 0) + postRestoreTimelineCleanup.removedClipCount,
        removedTrackCount: (postRunTimelineCleanup?.removedTrackCount ?? 0) + postRestoreTimelineCleanup.removedTrackCount,
      };
      useMediaStore.setState((state) => ({
        files: state.files.filter((file) => file.id !== mediaFileId),
      }));
      await thumbnailCacheService.clearSource(mediaFileId);
      postRunCleanupIds = await cleanupTimelineThumbnailReloadSmokeMediaFiles();
      if (source.revokeOnCleanup) {
        URL.revokeObjectURL(source.url);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      source: {
        mediaFileId,
        fileHash,
        mimeType: source.mimeType,
        durationSeconds: source.durationSeconds,
        reusedMediaFileId: source.reusedMediaFileId,
        sourceName: source.sourceName,
        generatedThumbnailCount,
        warmedThumbnailBitmapCount,
        generationError,
      },
      minThumbnailClipCount,
      minThumbnailDrawCount,
      minWorkerTrackCount,
      minWorkerEligibleTrackCount,
      maxWorkerFallbackTrackCount,
      maxWorkerPendingTrackCount,
      maxWorkerErrorTrackCount,
      minWorkerResourceBytes,
      maxWorkerResourceBytes,
      after,
      thumbnailClipCount,
      thumbnailDrawCount,
      workerTrackCount,
      workerEligibleTrackCount,
      workerFallbackTrackCount,
      workerPendingTrackCount,
      workerErrorTrackCount,
      workerResourceBytes,
      workerFlag: {
        forced: forcedTimelineCanvasWorker,
        previous: previousTimelineCanvasWorkerFlag,
        restored: flags.timelineCanvasWorker,
      },
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      smokeCleanup: {
        preRunMediaFileIds: preRunCleanupIds,
        postRunMediaFileIds: postRunCleanupIds,
        postRunTimelineCleanup,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasPlayheadSmoothnessSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreTimelineAfterRun = shouldRestoreTimelineAfterCanvasSmoke(args);
  const restoreState = restoreTimelineAfterRun
    ? captureTimelineCanvasSmokeRestoreState()
    : null;
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let mediaSetup: Awaited<ReturnType<typeof createExistingMediaTimeline>> | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  const failures: string[] = [];
  let startTime = 0;
  let durationMs = 1200;
  const maxAllowedBacktrackPx = clampNumber(args.maxAllowedBacktrackPx, 2, 0, 50);
  const maxAllowedBacktrackCount = Math.round(clampNumber(args.maxAllowedBacktrackCount, 0, 0, 60));
  const minForwardDistancePx = clampNumber(args.minForwardDistancePx, 20, 0, 10000);
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  let motion: Awaited<ReturnType<typeof samplePlayheadMotion>> | null = null;
  try {
    mediaSetup = args.useExistingMediaFile === true
      ? await createExistingMediaTimeline(args)
      : null;
    synthetic = mediaSetup || args.useExistingMediaFile === true || args.createSynthetic === false
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 36, 1, 500),
        videoTrackCount: clampNumber(args.videoTrackCount, 3, 1, 12),
        durationSeconds: clampNumber(args.durationSeconds, 18, 2, 600),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2, 0.1, 30),
        initialZoom: clampNumber(args.initialZoom, 96, 16, 1000),
      });
    const timelineStore = useTimelineStore.getState();
    before = collectSmokeSnapshot('before');
    startTime = clampNumber(args.startTime, 0, 0, Math.max(0, timelineStore.duration - 0.1));
    durationMs = clampNumber(args.durationMs, 1200, 300, 10000);

    if (!hasBrowserDom()) {
      failures.push('browser DOM is unavailable');
    }
    if (args.useExistingMediaFile === true && !mediaSetup) {
      failures.push('no existing video MediaFile was available for playhead smoothness smoke');
    }
    if (readPlayheadLeftPx() === null) {
      failures.push('timeline playhead DOM node was not found');
    }
    if (timelineStore.duration <= startTime) {
      failures.push('timeline duration is too short for playhead smoothness smoke');
    }

    const previousSpeed = timelineStore.playbackSpeed;
    const wasPlaying = timelineStore.isPlaying;
    try {
      if (failures.length === 0) {
        if (timelineStore.isPlaying) {
          timelineStore.pause();
          await waitForFrames(2);
        }
        useTimelineStore.setState({
          playheadPosition: startTime,
          playbackSpeed: 1,
          isDraggingPlayhead: false,
        });
        if (args.ensurePlayheadVisible !== false) {
          const { zoom } = useTimelineStore.getState();
          useTimelineStore.getState().setScrollX(Math.max(0, Math.round(startTime * zoom - 80)));
        }
        await waitForFrames(3);
        await useTimelineStore.getState().play();
        await waitForFrames(2);
        motion = await samplePlayheadMotion(durationMs);
        if (motion.sampleCount < 8) {
          failures.push(`playhead motion sampled only ${motion.sampleCount} frames`);
        }
        if (motion.forwardDistancePx < minForwardDistancePx) {
          failures.push(`playhead advanced only ${motion.forwardDistancePx}px/${minForwardDistancePx}px`);
        }
        if (motion.backtrackCount > maxAllowedBacktrackCount) {
          failures.push(`playhead backtracked ${motion.backtrackCount}/${maxAllowedBacktrackCount} frames`);
        }
        if (motion.maxBacktrackPx > maxAllowedBacktrackPx) {
          failures.push(`playhead max backtrack ${motion.maxBacktrackPx}px/${maxAllowedBacktrackPx}px`);
        }
      }
    } finally {
      useTimelineStore.getState().pause();
      useTimelineStore.setState({ playbackSpeed: previousSpeed });
      if (wasPlaying) {
        void useTimelineStore.getState().play();
      }
    }

    after = collectSmokeSnapshot('after');
    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
    }));
  } finally {
    try {
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      mediaSetup,
      before,
      after,
      restore: {
        enabled: restoreTimelineAfterRun,
        result: restoreResult,
      },
      motion,
      thresholds: {
        maxAllowedBacktrackPx,
        maxAllowedBacktrackCount,
        minForwardDistancePx,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasRamPreviewSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreTimelineAfterRun = args.restoreTimelineAfterRun === true ||
    (args.createSynthetic === true && args.restoreTimelineAfterRun !== false);
  const restoreState = restoreTimelineAfterRun
    ? captureTimelineCanvasSmokeRestoreState()
    : null;
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let start = 0;
  let end = 0.35;
  const requireNested = args.requireNested === true;
  const requireVideo = args.requireVideo !== false;
  const failures: string[] = [];
  let completed = false;
  let mode: 'store' | 'direct-engine-fallback' = 'store';
  let directResult: Awaited<ReturnType<typeof runDirectRamPreviewSmokeRange>> | null = null;
  let cachedRanges: ReturnType<TimelineStoreSnapshot['getCachedRanges']> = [];
  let generationError: Awaited<ReturnType<typeof runDirectRamPreviewSmokeRange>>['error'] | ReturnType<typeof getLastRamPreviewGenerationError> = null;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    synthetic = args.createSynthetic === true
      ? await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 1, 1, 16),
        videoTrackCount: clampNumber(args.videoTrackCount, 1, 1, 4),
        audioTrackCount: 0,
        durationSeconds: clampNumber(args.durationSeconds, 1, 0.35, 30),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 1, 0.35, 30),
        syntheticSourceType: 'image',
      })
      : null;
    const timelineStore = useTimelineStore.getState();
    before = collectSmokeSnapshot('before');
    start = clampNumber(args.startTime, 0, 0, Math.max(0, timelineStore.duration));
    const defaultEnd = Math.min(Math.max(start + 0.35, 0.35), Math.max(0.35, timelineStore.duration || 0.35));
    end = clampNumber(args.endTime, defaultEnd, start + 0.05, Math.max(start + 0.05, timelineStore.duration || defaultEnd));

    if (timelineStore.clips.length === 0) {
      failures.push('timeline has no clips for RAM preview smoke');
    }
    if (requireNested && before.timeline.compositionClipCount === 0) {
      failures.push('timeline has no nested composition clip for RAM preview smoke');
    }
    if (requireVideo && !timelineStore.clips.some((clip) => clip.source?.type !== 'audio')) {
      failures.push('timeline has no video/visual clip for RAM preview smoke');
    }

    if (failures.length === 0) {
      await timelineStore.clearRamPreview();
      completed = await useTimelineStore.getState().startRamPreviewForRange(start, end, {
        centerTime: (start + end) / 2,
        label: 'Timeline canvas verification smoke',
      });
      const storeGenerationError = getLastRamPreviewGenerationError();
      if (
        !completed &&
        args.allowDirectEngineFallback !== false &&
        storeGenerationError?.message.includes('isRamPreviewing became false')
      ) {
        await useTimelineStore.getState().clearRamPreview();
        directResult = await runDirectRamPreviewSmokeRange(start, end);
        completed = directResult.completed;
        mode = 'direct-engine-fallback';
      }
      await waitForFrames(2);
      if (!completed) {
        failures.push('RAM preview generation did not complete');
      }
    }

    after = collectSmokeSnapshot('after');
    cachedRanges = useTimelineStore.getState().getCachedRanges();
    generationError = directResult?.error ?? getLastRamPreviewGenerationError();
    if (completed && cachedRanges.length === 0) {
      failures.push('RAM preview completed without cached ranges');
    }
    if (!completed && generationError) {
      failures.push(`RAM preview error: ${generationError.message}`);
    }

    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom === true,
    }));
  } finally {
    try {
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      range: { start, end },
      mode,
      completed,
      generationError,
      directResult,
      cachedRanges,
      before,
      after,
      restore: {
        enabled: restoreTimelineAfterRun,
        result: restoreResult,
      },
      failures,
    },
  };
}

export async function handleRunTimelineCanvasSpectralPlaybackSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const timelineStore = useTimelineStore.getState();
  const previousAudioDisplayMode = timelineStore.audioDisplayMode;
  const previousWaveformsEnabled = timelineStore.waveformsEnabled;
  const requireAudioLike = args.requireAudioLike === true;
  const before = collectSmokeSnapshot('before');
  const failures: string[] = [];
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  if (timelineStore.clips.length === 0) {
    failures.push('timeline has no clips for spectral playback smoke');
  }
  if (requireAudioLike && before.timeline.audioLikeClipCount === 0) {
    failures.push('timeline has no audio-like clip for spectral playback smoke');
  }

  let playbackResult: ToolResult | null = null;
  try {
    if (failures.length === 0) {
      timelineStore.setAudioDisplayMode('spectral');
      timelineStore.setWaveformsEnabled(true);
      await waitForFrames(3);
      playbackResult = await handleSimulatePlayback({
        startTime: clampNumber(args.startTime, 0, 0, Math.max(0, timelineStore.duration)),
        durationMs: clampNumber(args.durationMs, 1000, 250, 10000),
        settleMs: clampNumber(args.settleMs, 150, 0, 5000),
        resetDiagnostics: args.resetDiagnostics !== false,
      }, useTimelineStore.getState());
      if (!playbackResult.success) {
        failures.push(playbackResult.error ?? 'simulatePlayback failed');
      }
    }
  } finally {
    if (args.restoreAudioDisplayMode !== false) {
      useTimelineStore.getState().setAudioDisplayMode(previousAudioDisplayMode);
      useTimelineStore.getState().setWaveformsEnabled(previousWaveformsEnabled);
    }
    endSmokeMutation();
  }

  const after = collectSmokeSnapshot('after');
  failures.push(...assertCanvasSmokeSnapshot(after, {
    requireTimelineDom: args.requireTimelineDom === true,
  }));

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      before,
      after,
      playback: playbackResult,
      failures,
    },
  };
}
