export type TimelineGeometrySnapshotVersion = 1;

export interface TimelinePoint {
  x: number;
  y: number;
}

export interface TimelineRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineTimeRange {
  startTime: number;
  duration: number;
}

export interface TimelineViewportGeometry {
  scrollContainerRect: TimelineRect;
  visibleContentRect: TimelineRect;
  viewportRect: TimelineRect;
  scrollX: number;
  scrollY: number;
  pxPerSecond: number;
  measuredAtMs?: number;
}

export interface TimelineTrackLaneGeometry {
  trackId: string;
  index: number;
  laneRect: TimelineRect;
  rowViewportRect: TimelineRect;
  clipRowRect: TimelineRect;
  keyframeAreaRect?: TimelineRect;
}

export interface TimelineSourceExtensionGhostGeometry {
  clipId: string;
  edge: 'left' | 'right';
  rect: TimelineRect;
  sourceStartTime: number;
  sourceEndTime: number;
}

export interface TimelineTrimPreviewGeometry {
  clipId: string;
  leadClipId: string;
  edge: 'left' | 'right';
  bodyRect: TimelineRect;
  trimGhostRect?: TimelineRect;
  role: 'lead' | 'linked-follower' | 'selected-follower';
}

export interface TimelineFadeCurveGeometry {
  id: string;
  clipId: string;
  edge: 'left' | 'right' | 'both';
  controlPoints: TimelinePoint[];
  boundingRect: TimelineRect;
  handleRectIds?: Partial<Record<'left' | 'right', string>>;
}

export interface TimelineClipBodyGeometry {
  clipId: string;
  trackId: string;
  bodyRect: TimelineRect;
  visibleBodyRect: TimelineRect;
  labelRect?: TimelineRect;
  thumbnailStripRect?: TimelineRect;
  waveformRect?: TimelineRect;
  spectrogramRect?: TimelineRect;
  badgeAnchorRects: Record<string, TimelineRect>;
  sourceExtensionGhosts: TimelineSourceExtensionGhostGeometry[];
  trimPreview?: TimelineTrimPreviewGeometry;
  fadeCurve?: TimelineFadeCurveGeometry;
}

export type TimelineHandleKind =
  | 'trim-left'
  | 'trim-right'
  | 'fade-left'
  | 'fade-right'
  | 'keyframe-diamond'
  | 'audio-gain'
  | 'spectral-region'
  | 'video-bake'
  | 'stem-menu';

export interface TimelineHandleGeometry {
  id: string;
  clipId: string;
  trackId: string;
  kind: TimelineHandleKind;
  rect: TimelineRect;
  hitRect: TimelineRect;
  active: boolean;
}

export interface TimelineKeyframeDiamondGeometry {
  keyframeId: string;
  rectId: string;
  clipId: string;
  trackId: string;
  property: string;
  time: number;
  rect: TimelineRect;
  selected: boolean;
}

export interface TimelineKeyframeRowGeometry {
  id: string;
  trackId: string;
  clipId?: string;
  property: string;
  rowRect: TimelineRect;
  diamonds: TimelineKeyframeDiamondGeometry[];
}

export interface TimelineTransitionJunctionGeometry {
  id: string;
  trackId: string;
  time: number;
  rect: TimelineRect;
  dropZoneRect: TimelineRect;
  beforeClipId?: string;
  afterClipId?: string;
  transitionId?: string;
}

export type TimelineMarqueeExclusionKind =
  | 'timeline-header'
  | 'track-resize'
  | 'clip-handle'
  | 'active-control'
  | 'context-menu'
  | 'keyframe-editor'
  | 'scrollbar'
  | 'custom';

export interface TimelineMarqueeExclusionGeometry {
  id: string;
  kind: TimelineMarqueeExclusionKind;
  rect: TimelineRect;
  clipId?: string;
  trackId?: string;
}

export type TimelineDropTargetKind =
  | 'clip-body'
  | 'track-empty'
  | 'new-track'
  | 'transition'
  | 'image-layer'
  | 'spectral-region'
  | 'audio-region'
  | 'tool'
  | 'split-target';

export interface TimelineDropTargetGeometry {
  id: string;
  kind: TimelineDropTargetKind;
  rect: TimelineRect;
  trackId?: string;
  clipId?: string;
  accepts: string[];
}

export interface TimelineRulerGeometry {
  rect: TimelineRect;
  contentWidth: number;
  timeOrigin: number;
  pxPerSecond: number;
}

export interface TimelineGeometrySnapshot {
  schemaVersion: TimelineGeometrySnapshotVersion;
  viewport: TimelineViewportGeometry;
  contentWidth: number;
  tracks: TimelineTrackLaneGeometry[];
  clips: TimelineClipBodyGeometry[];
  trimPreviews: TimelineTrimPreviewGeometry[];
  handles: TimelineHandleGeometry[];
  keyframeRows: TimelineKeyframeRowGeometry[];
  transitionJunctions: TimelineTransitionJunctionGeometry[];
  marqueeExclusions: TimelineMarqueeExclusionGeometry[];
  dropTargets: TimelineDropTargetGeometry[];
  ruler: TimelineRulerGeometry;
}

export function createTimelineRect(x: number, y: number, width: number, height: number): TimelineRect {
  return {
    x,
    y,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

export function isTimelineRect(value: unknown): value is TimelineRect {
  if (value === null || typeof value !== 'object') return false;
  const rect = value as Record<string, unknown>;
  return (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number' &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

export function timelineRectContainsPoint(rect: TimelineRect, point: TimelinePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function timelineRectsIntersect(a: TimelineRect, b: TimelineRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function findTimelineMarqueeExclusionAtPoint(
  exclusions: readonly TimelineMarqueeExclusionGeometry[],
  point: TimelinePoint,
): TimelineMarqueeExclusionGeometry | null {
  return exclusions.find(exclusion => timelineRectContainsPoint(exclusion.rect, point)) ?? null;
}

export function findTimelineMarqueeExclusionsIntersectingRect(
  exclusions: readonly TimelineMarqueeExclusionGeometry[],
  rect: TimelineRect,
): TimelineMarqueeExclusionGeometry[] {
  return exclusions.filter(exclusion => timelineRectsIntersect(exclusion.rect, rect));
}

export function clampTimelineRectToViewport(rect: TimelineRect, viewport: TimelineRect): TimelineRect {
  const x = Math.max(rect.x, viewport.x);
  const y = Math.max(rect.y, viewport.y);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  const bottom = Math.min(rect.y + rect.height, viewport.y + viewport.height);
  return createTimelineRect(x, y, right - x, bottom - y);
}

export function timelineTimeRangeToRect(
  range: TimelineTimeRange,
  trackRect: TimelineRect,
  pxPerSecond: number,
): TimelineRect {
  return createTimelineRect(
    range.startTime * pxPerSecond,
    trackRect.y,
    range.duration * pxPerSecond,
    trackRect.height,
  );
}
