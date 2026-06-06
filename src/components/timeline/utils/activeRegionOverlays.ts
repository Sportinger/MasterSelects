import type { ClipAudioEditOperation, VideoBakeRegion } from '../../../types';
import type {
  TimelineAudioRegionSelection,
  TimelineVideoBakeRegionSelection,
} from '../../../stores/timeline/types';
import {
  AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS,
  AUDIO_REGION_TIMELINE_EPSILON,
  audioRegionGainDbToYPercent,
  clampAudioRegionGainDb,
  getInlineAudioEditLabel,
} from './audioRegionDisplay';

const VIDEO_BAKE_REGION_TIMELINE_EPSILON = 0.001;

export interface TimelineRegionOverlay {
  left: number;
  width: number;
}

export interface AudioRegionGainControlOverlay {
  regionDuration: number;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  yPercent: number;
  fadeInPx: number;
  fadeOutPx: number;
}

export interface AudioRegionGainControlDragState {
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
}

export interface AudioEditOperationOverlay {
  id: string;
  left: number;
  width: number;
  top: number;
  height: number;
  label: string;
  type: string;
  selection: TimelineAudioRegionSelection;
}

export interface ClipVideoBakeRegionOverlay {
  id: string;
  left: number;
  width: number;
  status: VideoBakeRegion['status'];
  selection: boolean;
}

type ClipVideoBakeRegionOverlayInputRegion = Pick<
  VideoBakeRegion,
  | 'id'
  | 'startTime'
  | 'endTime'
  | 'status'
  | 'sourceInPoint'
  | 'sourceOutPoint'
>;

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveTimelineRegionOverlay(input: {
  startTime: number;
  endTime: number;
  displayStartTime: number;
  displayDuration: number;
  width: number;
  epsilon?: number;
  minWidth?: number;
}): TimelineRegionOverlay | null {
  const epsilon = input.epsilon ?? AUDIO_REGION_TIMELINE_EPSILON;
  const timelineStart = Math.min(input.startTime, input.endTime);
  const timelineEnd = Math.max(input.startTime, input.endTime);
  const regionStart = Math.max(input.displayStartTime, timelineStart);
  const regionEnd = Math.min(input.displayStartTime + input.displayDuration, timelineEnd);
  if (regionEnd <= regionStart) return null;

  const safeDuration = Math.max(epsilon, input.displayDuration);
  const left = ((regionStart - input.displayStartTime) / safeDuration) * input.width;
  const rawWidth = ((regionEnd - regionStart) / safeDuration) * input.width;

  return {
    left,
    width: Math.max(input.minWidth ?? 0, rawWidth),
  };
}

export function resolveAudioRegionOverlay(input: {
  selection: TimelineAudioRegionSelection | null;
  displayStartTime: number;
  displayDuration: number;
  width: number;
}): TimelineRegionOverlay | null {
  if (!input.selection) return null;
  if (input.selection.endTime - input.selection.startTime <= AUDIO_REGION_TIMELINE_EPSILON) return null;

  return resolveTimelineRegionOverlay({
    startTime: input.selection.startTime,
    endTime: input.selection.endTime,
    displayStartTime: input.displayStartTime,
    displayDuration: input.displayDuration,
    width: input.width,
  });
}

export function resolveAudioRegionGainControl(input: {
  selection: TimelineAudioRegionSelection | null;
  overlayWidth: number;
  selectedOperation?: Pick<ClipAudioEditOperation, 'params'> | null;
  dragState?: AudioRegionGainControlDragState | null;
}): AudioRegionGainControlOverlay | null {
  if (!input.selection) return null;

  const regionDuration = Math.max(
    AUDIO_REGION_TIMELINE_EPSILON,
    Math.abs(input.selection.sourceOutPoint - input.selection.sourceInPoint),
  );
  const gainDb = input.dragState?.currentGainDb ??
    finiteNumberOr(input.selectedOperation?.params.gainDb, 0);
  const fadeInSeconds = input.dragState?.currentFadeInSeconds ??
    finiteNumberOr(input.selectedOperation?.params.fadeInSeconds, AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS);
  const fadeOutSeconds = input.dragState?.currentFadeOutSeconds ??
    finiteNumberOr(input.selectedOperation?.params.fadeOutSeconds, AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS);
  const maxFadeSeconds = regionDuration / 2;

  return {
    regionDuration,
    gainDb: Number(clampAudioRegionGainDb(gainDb).toFixed(1)),
    fadeInSeconds: Math.max(0, Math.min(maxFadeSeconds, fadeInSeconds)),
    fadeOutSeconds: Math.max(0, Math.min(maxFadeSeconds, fadeOutSeconds)),
    yPercent: audioRegionGainDbToYPercent(gainDb),
    fadeInPx: Math.max(0, Math.min(input.overlayWidth / 2, (fadeInSeconds / regionDuration) * input.overlayWidth)),
    fadeOutPx: Math.max(0, Math.min(input.overlayWidth / 2, (fadeOutSeconds / regionDuration) * input.overlayWidth)),
  };
}

export function resolveAudioEditOperationOverlays(input: {
  operations: readonly ClipAudioEditOperation[];
  audioRegionSelection: TimelineAudioRegionSelection | null;
  clipId: string;
  trackId: string;
  displayStartTime: number;
  displayDuration: number;
  width: number;
  trackBaseHeight: number;
  sourceTimeToDisplayTimelineTime: (sourceTime: number) => number;
}): AudioEditOperationOverlay[] {
  const baseOverlays = input.operations.flatMap((operation) => {
    if (operation.enabled === false || !operation.timeRange) return [];
    const sourceStart = Math.min(operation.timeRange.start, operation.timeRange.end);
    const sourceEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
    if (
      input.audioRegionSelection &&
      Math.abs(input.audioRegionSelection.sourceInPoint - sourceStart) <= AUDIO_REGION_TIMELINE_EPSILON &&
      Math.abs(input.audioRegionSelection.sourceOutPoint - sourceEnd) <= AUDIO_REGION_TIMELINE_EPSILON
    ) {
      return [];
    }

    const timelineStart = input.sourceTimeToDisplayTimelineTime(sourceStart);
    const timelineEnd = input.sourceTimeToDisplayTimelineTime(sourceEnd);
    const selectionStartTime = Math.min(timelineStart, timelineEnd);
    const selectionEndTime = Math.max(timelineStart, timelineEnd);
    const regionStart = Math.max(input.displayStartTime, Math.min(timelineStart, timelineEnd));
    const regionEnd = Math.min(input.displayStartTime + input.displayDuration, Math.max(timelineStart, timelineEnd));
    if (regionEnd <= regionStart && operation.type !== 'insert-silence') return [];

    const nominalLeft = ((regionStart - input.displayStartTime) / Math.max(AUDIO_REGION_TIMELINE_EPSILON, input.displayDuration)) * input.width;
    const nominalWidth = ((regionEnd - regionStart) / Math.max(AUDIO_REGION_TIMELINE_EPSILON, input.displayDuration)) * input.width;
    const overlayWidth = Math.max(operation.type === 'insert-silence' ? 6 : 3, nominalWidth);
    const left = Math.max(0, Math.min(input.width - overlayWidth, nominalLeft));

    return [{
      id: operation.id,
      left,
      width: overlayWidth,
      top: 0,
      height: 0,
      label: getInlineAudioEditLabel(operation.type, operation.params as Record<string, unknown>),
      type: operation.type,
      selection: {
        clipId: input.clipId,
        trackId: input.trackId,
        startTime: selectionStartTime,
        endTime: selectionEndTime,
        sourceInPoint: sourceStart,
        sourceOutPoint: sourceEnd,
      },
    }];
  });

  const laneRightEdges: number[] = [];
  const laneHeight = Math.max(14, Math.min(18, Math.round(input.trackBaseHeight * 0.16)));
  const laneGap = 2;
  const topPadding = 4;
  const bottomPadding = 4;
  const maxTop = Math.max(topPadding, input.trackBaseHeight - bottomPadding - laneHeight);
  const topForLane = (lane: number) => Math.min(maxTop, topPadding + lane * (laneHeight + laneGap));

  return baseOverlays
    .toSorted((a, b) => a.left - b.left || b.width - a.width || a.id.localeCompare(b.id))
    .map((overlay) => {
      let lane = 0;
      while (lane < laneRightEdges.length && overlay.left < laneRightEdges[lane] - 1) {
        lane += 1;
      }
      laneRightEdges[lane] = Math.max(laneRightEdges[lane] ?? 0, overlay.left + overlay.width);
      return {
        ...overlay,
        top: topForLane(lane),
        height: laneHeight,
      };
    });
}

export function resolveClipVideoBakeRegionOverlays(input: {
  isAudioClip: boolean;
  bakeRegions?: readonly ClipVideoBakeRegionOverlayInputRegion[];
  selection?: TimelineVideoBakeRegionSelection | null;
  displayStartTime: number;
  displayDuration: number;
  width: number;
  sourceTimeToVideoBakeTimelineTime: (sourceTime: number) => number;
}): ClipVideoBakeRegionOverlay[] {
  if (input.isAudioClip) return [];

  const buildOverlay = (
    id: string,
    startTime: number,
    endTime: number,
    status: VideoBakeRegion['status'],
    selection = false,
  ): ClipVideoBakeRegionOverlay | null => {
    const overlay = resolveTimelineRegionOverlay({
      startTime,
      endTime,
      displayStartTime: input.displayStartTime,
      displayDuration: input.displayDuration,
      width: input.width,
      epsilon: VIDEO_BAKE_REGION_TIMELINE_EPSILON,
      minWidth: 3,
    });
    return overlay ? { id, status, selection, ...overlay } : null;
  };

  const overlays = (input.bakeRegions ?? []).flatMap((region) => {
    const hasSourceRange = Number.isFinite(region.sourceInPoint) && Number.isFinite(region.sourceOutPoint);
    const startTime = hasSourceRange
      ? input.sourceTimeToVideoBakeTimelineTime(region.sourceInPoint as number)
      : region.startTime;
    const endTime = hasSourceRange
      ? input.sourceTimeToVideoBakeTimelineTime(region.sourceOutPoint as number)
      : region.endTime;
    const overlay = buildOverlay(region.id, startTime, endTime, region.status);
    return overlay ? [overlay] : [];
  });

  if (input.selection) {
    const selectionOverlay = buildOverlay(
      'clip-video-bake-selection',
      input.selection.startTime,
      input.selection.endTime,
      'marked',
      true,
    );
    if (selectionOverlay) overlays.push(selectionOverlay);
  }

  return overlays;
}
