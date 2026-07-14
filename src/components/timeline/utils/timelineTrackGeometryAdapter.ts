import type { TimelineTrackProps } from '../types';
import type {
  ClipInteractionShellGeometry,
  ClipInteractionShellRect,
} from '../interactionShell';
import {
  buildTimelineGeometrySnapshot,
  createTimelineRect,
  timelineTimeRangeToRect,
  type TimelineClipBodyGeometry,
  type TimelineGeometrySnapshot,
  type TimelineProjection,
  type TimelineProjectionSourceKind,
  type TimelineProjectionTrackKind,
} from '../../../timeline';

type TimelineTrackGeometryClip = TimelineTrackProps['clips'][number];
type TimelineTrackGeometryTrack = TimelineTrackProps['track'];

export type TimelineTrackGeometryFadeState = { fadeInDuration: number; fadeOutDuration: number };

const TIMELINE_PROJECTION_SOURCE_KINDS = new Set<string>([
  'video', 'audio', 'image', 'text', 'solid', 'camera', 'light',
  'composition', 'model', 'gaussian-splat', 'vector-animation', 'midi', 'data',
]);

const mapTrackProjectionKind = (trackType: TimelineTrackGeometryTrack['type']): TimelineProjectionTrackKind => {
  if (trackType === 'video') return 'video';
  if (trackType === 'audio') return 'audio';
  return 'data';
};

const mapClipProjectionSourceKind = (sourceType: string | undefined): TimelineProjectionSourceKind => {
  if (sourceType && TIMELINE_PROJECTION_SOURCE_KINDS.has(sourceType)) {
    return sourceType as TimelineProjectionSourceKind;
  }
  if (sourceType === 'lottie' || sourceType === 'rive') return 'vector-animation';
  if (sourceType === 'gaussian-avatar') return 'gaussian-splat';
  return 'unknown';
};

export const createTimelineTrackShellRect = (
  x: number,
  y: number,
  width: number,
  height: number,
): ClipInteractionShellRect => ({
  x,
  y,
  width: Math.max(0, width),
  height: Math.max(0, height),
});

const clampTimelineTrackShellRectX = (
  rect: ClipInteractionShellRect,
  viewport: ClipInteractionShellRect,
): ClipInteractionShellRect => {
  const left = Math.max(rect.x, viewport.x);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  return createTimelineTrackShellRect(left, rect.y, right - left, rect.height);
};

export const buildTimelineTrackHostProjection = ({
  track,
  clips,
  baseHeight,
  trackColor,
  selectedClipIds,
  hoveredClipId,
}: {
  track: TimelineTrackGeometryTrack;
  clips: readonly TimelineTrackGeometryClip[];
  baseHeight: number;
  trackColor?: string;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId: string | null;
}): TimelineProjection => {
  const hidden = track.type === 'video' && track.visible === false;
  return {
    schemaVersion: 1,
    tracks: [{
      id: track.id,
      index: 0,
      name: track.name,
      kind: mapTrackProjectionKind(track.type),
      color: trackColor ?? 'rgba(120, 160, 200, 1)',
      locked: track.locked === true,
      muted: track.muted,
      hidden,
      expanded: true,
      dimmed: hidden,
      baseHeightPx: baseHeight,
      heightPx: baseHeight,
    }],
    clips: clips.map((clip, index) => ({
      id: clip.id,
      trackId: track.id,
      index,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      speed: clip.speed ?? 1,
      reversed: clip.reversed === true,
      sourceKind: mapClipProjectionSourceKind(clip.source?.type),
      sourceId: clip.signalRefId ?? clip.source?.runtimeSourceId,
      mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
      label: clip.name,
      palette: {
        fill: '#334155',
        stroke: '#94a3b8',
        text: '#ffffff',
      },
      state: {
        selected: selectedClipIds.has(clip.id),
        hovered: hoveredClipId === clip.id,
        locked: track.locked === true,
        muted: track.muted,
        linked: Boolean(clip.linkedClipId || clip.linkedGroupId),
        inLinkedGroup: Boolean(clip.linkedGroupId),
        dimmed: hidden,
        disabled: hidden,
      },
      badges: {},
      cacheRefs: {},
      markers: [],
    })),
    selectedClipIds: [...selectedClipIds].filter((clipId) => clips.some((clip) => clip.id === clipId)),
    hoveredClipId,
    primarySelectedClipId: [...selectedClipIds].find((clipId) => clips.some((clip) => clip.id === clipId)) ?? null,
  };
};

export function buildTimelineTrackHostGeometrySnapshot({
  track,
  clips,
  baseHeight,
  trackColor,
  selectedClipIds,
  hoveredClipId,
  viewportWidth,
  scrollX,
  zoom,
  clipVerticalInsetPx,
}: {
  track: TimelineTrackGeometryTrack;
  clips: readonly TimelineTrackGeometryClip[];
  baseHeight: number;
  trackColor?: string;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId: string | null;
  viewportWidth: number;
  scrollX: number;
  zoom: number;
  clipVerticalInsetPx: number;
}): TimelineGeometrySnapshot {
  const projection = buildTimelineTrackHostProjection({
    track,
    clips,
    baseHeight,
    trackColor,
    selectedClipIds,
    hoveredClipId,
  });

  return buildTimelineGeometrySnapshot({
    projection,
    viewportRect: createTimelineRect(0, 0, viewportWidth, baseHeight),
    scrollX,
    scrollY: 0,
    pxPerSecond: Math.max(zoom, 0.001),
    layoutVersion: `${track.id}:${baseHeight}:${track.type}:${track.visible}:${track.locked === true}`,
    timingVersion: clips
      .map((clip) => `${clip.id}:${clip.trackId}:${clip.startTime}:${clip.duration}:${clip.inPoint}:${clip.outPoint}`)
      .join('|'),
    zoomVersion: String(zoom),
    rulerHeightPx: 0,
    clipVerticalInsetPx,
  });
}

export const buildTimelineTrackClipGeometryMap = (
  snapshot: TimelineGeometrySnapshot,
): Map<string, TimelineClipBodyGeometry> => (
  new Map(snapshot.clips.map((clip) => [clip.clipId, clip]))
);

export function buildTimelineTrackRangeShellRect({
  snapshot,
  canvasContentWidth,
  baseHeight,
  clipVerticalInsetPx,
  startTime,
  duration,
}: {
  snapshot: TimelineGeometrySnapshot;
  canvasContentWidth: number;
  baseHeight: number;
  clipVerticalInsetPx: number;
  startTime: number;
  duration: number;
}): ClipInteractionShellRect {
  const trackGeometry = snapshot.tracks[0];
  const fallbackTrackRect = createTimelineRect(
    0,
    clipVerticalInsetPx,
    canvasContentWidth,
    Math.max(1, baseHeight - clipVerticalInsetPx * 2),
  );
  const rect = timelineTimeRangeToRect(
    { startTime, duration },
    trackGeometry?.clipRowRect ?? fallbackTrackRect,
    snapshot.viewport.pxPerSecond,
  );
  return createTimelineTrackShellRect(rect.x, rect.y, rect.width, rect.height);
}

export function buildTimelineTrackClipShellGeometry({
  clip,
  clipGeometry,
  timeToPixel,
  baseHeight,
  scrollX,
  viewportWidth,
  canvasContentWidth,
  clipVerticalInsetPx,
  shellHandleWidthPx,
  fadeHandleSizePx,
  fade,
}: {
  clip: Pick<TimelineTrackGeometryClip, 'startTime' | 'duration'>;
  clipGeometry?: TimelineClipBodyGeometry;
  timeToPixel: (time: number) => number;
  baseHeight: number;
  scrollX: number;
  viewportWidth: number;
  canvasContentWidth: number;
  clipVerticalInsetPx: number;
  shellHandleWidthPx: number;
  fadeHandleSizePx: number;
  fade: TimelineTrackGeometryFadeState;
}): ClipInteractionShellGeometry {
  const clipRect = clipGeometry
    ? createTimelineTrackShellRect(
      clipGeometry.bodyRect.x,
      clipGeometry.bodyRect.y,
      clipGeometry.bodyRect.width,
      clipGeometry.bodyRect.height,
    )
    : createTimelineTrackShellRect(
      timeToPixel(clip.startTime),
      clipVerticalInsetPx,
      Math.max(1, timeToPixel(clip.duration)),
      Math.max(1, baseHeight - clipVerticalInsetPx * 2),
    );
  const left = clipRect.x;
  const width = clipRect.width;
  const top = clipRect.y;
  const height = clipRect.height;
  const viewportRect = createTimelineTrackShellRect(scrollX, 0, viewportWidth, baseHeight);
  const fadeInPx = Math.max(0, Math.min(width, timeToPixel(fade.fadeInDuration)));
  const fadeOutPx = Math.max(0, Math.min(width, timeToPixel(fade.fadeOutDuration)));
  const fadeHandleOffset = fadeHandleSizePx / 2;
  const leftFadeHandleX = left + (fade.fadeInDuration > 0 ? fadeInPx - fadeHandleOffset : 0);
  const rightFadeHandleX = left + width - (
    fade.fadeOutDuration > 0
      ? fadeOutPx + fadeHandleOffset
      : fadeHandleSizePx
  );

  return {
    clip: clipRect,
    visibleClip: clipGeometry
      ? createTimelineTrackShellRect(
        clipGeometry.visibleBodyRect.x,
        clipGeometry.visibleBodyRect.y,
        clipGeometry.visibleBodyRect.width,
        clipGeometry.visibleBodyRect.height,
      )
      : clampTimelineTrackShellRectX(clipRect, viewportRect),
    track: createTimelineTrackShellRect(0, 0, canvasContentWidth, baseHeight),
    viewport: viewportRect,
    trimHandles: {
      left: createTimelineTrackShellRect(left - shellHandleWidthPx / 2, top, shellHandleWidthPx, height),
      right: createTimelineTrackShellRect(left + width - shellHandleWidthPx / 2, top, shellHandleWidthPx, height),
    },
    fadeHandles: {
      left: createTimelineTrackShellRect(leftFadeHandleX, top, fadeHandleSizePx, fadeHandleSizePx),
      right: createTimelineTrackShellRect(rightFadeHandleX, top, fadeHandleSizePx, fadeHandleSizePx),
    },
    keyframeRows: [],
  };
}
