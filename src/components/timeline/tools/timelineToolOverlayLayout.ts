import type { TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineToolId, TimelineToolPreview } from '../../../stores/timeline/types';
import {
  isTimelineBladeTool,
  isTimelineTrackSelectTool,
} from './pointer/timelineToolPointerDispatcher';

export type TimelineToolOverlayKind =
  | 'track-selection'
  | 'blade-line'
  | 'placement-ghost'
  | 'operation-ghost'
  | 'blocked-message';

export interface TimelineToolOverlayItem {
  id: string;
  kind: TimelineToolOverlayKind;
  toolId: TimelineToolId;
  left: number;
  top: number;
  height: number;
  width?: number;
  trackId?: string;
  direction?: 'forward' | 'backward';
  message?: string;
  sourceInPoint?: number;
  sourceOutPoint?: number;
  label?: string;
  variant?: string;
}

export interface TimelineToolOverlayLayout {
  items: TimelineToolOverlayItem[];
  contentHeight: number;
}

export interface ResolveTimelineToolOverlayLayoutArgs {
  preview: TimelineToolPreview | null;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  duration: number;
  timeToPixel: (time: number) => number;
  getTrackHeight: (track: TimelineTrack) => number;
}

interface TrackRow {
  track: TimelineTrack;
  top: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTrackEligible(track: TimelineTrack): boolean {
  return track.locked !== true && track.visible !== false;
}

function getTrackRows(
  tracks: TimelineTrack[],
  getTrackHeight: (track: TimelineTrack) => number,
): { rows: TrackRow[]; contentHeight: number } {
  let top = 0;
  const rows = tracks.map((track) => {
    const height = Math.max(1, getTrackHeight(track));
    const row = { track, top, height };
    top += height;
    return row;
  });

  return {
    rows,
    contentHeight: top,
  };
}

function resolveBlockedMessageOverlay(
  preview: TimelineToolPreview,
  rowsByTrackId: Map<string, TrackRow>,
  clipsById: Map<string, TimelineClip>,
  duration: number,
  timeToPixel: (time: number) => number,
): TimelineToolOverlayItem[] {
  const clip = preview.clipId ? clipsById.get(preview.clipId) : undefined;
  const trackId = preview.trackId ?? clip?.trackId;
  if (!trackId) return [];

  const row = rowsByTrackId.get(trackId);
  if (!row) return [];

  const anchorTime = isFiniteNumber(preview.time)
    ? preview.time
    : clip
      ? clip.startTime + Math.min(Math.max(clip.duration * 0.5, 0), 0.25)
      : 0;
  const left = timeToPixel(clamp(anchorTime, 0, Math.max(0, duration)));

  return [{
    id: `blocked:${preview.toolId}:${trackId}:${preview.clipId ?? 'track'}`,
    kind: 'blocked-message',
    toolId: preview.toolId,
    trackId,
    left,
    top: row.top + 6,
    height: Math.min(24, Math.max(18, row.height - 12)),
    message: preview.message ?? 'Unavailable',
  }];
}

function resolveTrackSelectionOverlays(
  preview: TimelineToolPreview,
  rows: TrackRow[],
  duration: number,
  timeToPixel: (time: number) => number,
): TimelineToolOverlayItem[] {
  if (!isTimelineTrackSelectTool(preview.toolId) || !isFiniteNumber(preview.time)) return [];

  const time = clamp(preview.time, 0, Math.max(0, duration));
  const direction = preview.toolId === 'track-select-backward' ? 'backward' : 'forward';
  const startTime = direction === 'backward' ? 0 : time;
  const endTime = direction === 'backward' ? time : Math.max(time, duration);
  const left = timeToPixel(startTime);
  const width = Math.max(1, timeToPixel(endTime) - timeToPixel(startTime));
  const targetRows = preview.toolId === 'track-select-forward-all'
    ? rows.filter((row) => isTrackEligible(row.track))
    : rows.filter((row) => row.track.id === preview.trackId && isTrackEligible(row.track));

  return targetRows.map((row) => ({
    id: `track-selection:${preview.toolId}:${row.track.id}:${time}`,
    kind: 'track-selection',
    toolId: preview.toolId,
    trackId: row.track.id,
    direction,
    left,
    width,
    top: row.top + 3,
    height: Math.max(1, row.height - 6),
  }));
}

function resolveBladeLineOverlay(
  preview: TimelineToolPreview,
  rows: TrackRow[],
  contentHeight: number,
  duration: number,
  timeToPixel: (time: number) => number,
): TimelineToolOverlayItem[] {
  if (
    preview.toolId !== 'blade-all-tracks' ||
    !isTimelineBladeTool(preview.toolId) ||
    preview.plane !== 'section-scrolled' ||
    !isFiniteNumber(preview.time)
  ) {
    return [];
  }

  const hasEligibleTrack = rows.some((row) => isTrackEligible(row.track));
  if (!hasEligibleTrack || contentHeight <= 0) return [];

  const left = timeToPixel(clamp(preview.time, 0, Math.max(0, duration))) - 1;
  return [{
    id: `blade-line:${preview.toolId}:${preview.time}`,
    kind: 'blade-line',
    toolId: preview.toolId,
    left,
    top: 0,
    width: 2,
    height: contentHeight,
  }];
}

function isPlacementPreviewTool(toolId: TimelineToolId): boolean {
  return toolId === 'position-overwrite' ||
    toolId === 'insert' ||
    toolId === 'overwrite' ||
    toolId === 'replace' ||
    toolId === 'fit-to-fill' ||
    toolId === 'append-at-end' ||
    toolId === 'place-on-top' ||
    toolId === 'ripple-overwrite';
}

function resolvePlacementGhostOverlays(
  preview: TimelineToolPreview,
  rows: TrackRow[],
  duration: number,
  timeToPixel: (time: number) => number,
): TimelineToolOverlayItem[] {
  if (
    !isPlacementPreviewTool(preview.toolId) ||
    preview.plane !== 'section-scrolled' ||
    !isFiniteNumber(preview.startTime) ||
    !isFiniteNumber(preview.endTime)
  ) {
    return [];
  }

  const maxPreviewTime = Math.max(duration, preview.endTime, preview.startTime + 0.001);
  const startTime = clamp(preview.startTime, 0, maxPreviewTime);
  const endTime = clamp(Math.max(preview.endTime, preview.startTime + 0.001), startTime, maxPreviewTime);
  const targetTrackIds = new Set(preview.trackIds ?? (preview.trackId ? [preview.trackId] : []));
  if (targetTrackIds.size === 0) return [];

  const left = timeToPixel(startTime);
  const width = Math.max(1, timeToPixel(endTime) - left);

  return rows
    .filter((row) => targetTrackIds.has(row.track.id) && isTrackEligible(row.track))
    .map((row) => ({
      id: `placement-ghost:${preview.toolId}:${row.track.id}:${startTime}:${endTime}`,
      kind: 'placement-ghost',
      toolId: preview.toolId,
      trackId: row.track.id,
      left,
      width,
      top: row.top + 4,
      height: Math.max(1, row.height - 8),
      sourceInPoint: preview.sourceInPoint,
      sourceOutPoint: preview.sourceOutPoint,
      label: preview.label,
      message: preview.message,
    }));
}

function resolveOperationGhostOverlays(
  preview: TimelineToolPreview,
  rows: TrackRow[],
  duration: number,
  timeToPixel: (time: number) => number,
): TimelineToolOverlayItem[] {
  if (preview.plane !== 'section-scrolled' || !preview.ghostRanges?.length) return [];

  const rowsByTrackId = new Map(rows.map((row) => [row.track.id, row]));
  const maxPreviewTime = Math.max(
    duration,
    ...preview.ghostRanges.map((range) => Math.max(range.startTime, range.endTime)),
    0.001,
  );

  return preview.ghostRanges.flatMap((range) => {
    const row = rowsByTrackId.get(range.trackId);
    if (!row || !isTrackEligible(row.track)) return [];

    const startTime = clamp(Math.min(range.startTime, range.endTime), 0, maxPreviewTime);
    const endTime = clamp(Math.max(range.startTime, range.endTime, startTime + 0.001), startTime, maxPreviewTime);
    const left = timeToPixel(startTime);
    const width = Math.max(1, timeToPixel(endTime) - left);

    return [{
      id: `operation-ghost:${preview.toolId}:${range.id}:${startTime}:${endTime}`,
      kind: 'operation-ghost' as const,
      toolId: preview.toolId,
      trackId: range.trackId,
      left,
      width,
      top: row.top + 4,
      height: Math.max(1, row.height - 8),
      label: range.label,
      variant: range.variant,
    }];
  });
}

export function resolveTimelineToolOverlayLayout({
  preview,
  tracks,
  clips,
  duration,
  timeToPixel,
  getTrackHeight,
}: ResolveTimelineToolOverlayLayoutArgs): TimelineToolOverlayLayout {
  const { rows, contentHeight } = getTrackRows(tracks, getTrackHeight);
  if (!preview || rows.length === 0) {
    return { items: [], contentHeight };
  }

  const rowsByTrackId = new Map(rows.map((row) => [row.track.id, row]));
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));

  if (preview.blocked) {
    return {
      items: resolveBlockedMessageOverlay(preview, rowsByTrackId, clipsById, duration, timeToPixel),
      contentHeight,
    };
  }

  return {
    items: [
      ...resolveTrackSelectionOverlays(preview, rows, duration, timeToPixel),
      ...resolveBladeLineOverlay(preview, rows, contentHeight, duration, timeToPixel),
      ...resolvePlacementGhostOverlays(preview, rows, duration, timeToPixel),
      ...resolveOperationGhostOverlays(preview, rows, duration, timeToPixel),
    ],
    contentHeight,
  };
}
