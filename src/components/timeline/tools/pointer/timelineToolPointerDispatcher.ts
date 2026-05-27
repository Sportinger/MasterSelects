import type { TimelineClip, TimelineTrack } from '../../../../types';
import type { TimelineToolId, TimelineToolPreview } from '../../../../stores/timeline/types';
import type { TimelineEditOperation } from '../../../../stores/timeline/editOperations/types';

export const TIMELINE_TOOL_SNAP_THRESHOLD_PX = 10;

export interface TimelineClipPointerContext {
  toolId: TimelineToolId;
  clip: TimelineClip;
  track: TimelineTrack;
  clips: TimelineClip[];
  playheadPosition: number;
  snappingEnabled: boolean;
  displayStartTime: number;
  displayDuration: number;
  width: number;
  clientX: number;
  rectLeft: number;
  altKey: boolean;
}

export interface TimelineClipPointerDispatchResult {
  handled: boolean;
  preview?: TimelineToolPreview | null;
  operation?: TimelineEditOperation;
  nextToolId?: TimelineToolId;
}

export function isTimelineBladeTool(toolId: TimelineToolId): toolId is 'blade' | 'blade-all-tracks' {
  return toolId === 'blade' || toolId === 'blade-all-tracks';
}

export function isTimelineTrackSelectTool(
  toolId: TimelineToolId,
): toolId is 'track-select-forward' | 'track-select-backward' | 'track-select-forward-all' {
  return toolId === 'track-select-forward' ||
    toolId === 'track-select-backward' ||
    toolId === 'track-select-forward-all';
}

export function isTimelinePointerTool(toolId: TimelineToolId): boolean {
  return isTimelineBladeTool(toolId) ||
    isTimelineTrackSelectTool(toolId) ||
    toolId === 'range-select' ||
    toolId === 'edge-trim' ||
    toolId === 'ripple-trim' ||
    toolId === 'rolling-edit' ||
    toolId === 'slip' ||
    toolId === 'slide' ||
    toolId === 'rate-stretch' ||
    toolId === 'position-overwrite' ||
    toolId === 'hand' ||
    toolId === 'zoom' ||
    toolId === 'pen-keyframe';
}

function createIconCursor(
  paths: string[],
  fallback: string,
  hotspotX = 8,
  hotspotY = 8,
): string {
  const content = paths.join('');
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<g transform="translate(4 4)" fill="none" stroke-linecap="round" stroke-linejoin="round">',
    `<g stroke="white" stroke-width="5">${content}</g>`,
    `<g stroke="#111827" stroke-width="2.35">${content}</g>`,
    '</g>',
    '</svg>',
  ].join('');
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspotX} ${hotspotY}, ${fallback}`;
}

const CURSOR_PATHS = {
  pointer: [
    '<path d="M5 3l14 9-6 1.5 3.5 6-3 1.7-3.4-6-4.1 4z" />',
  ],
  blade: [
    '<path d="M16 4l-7 16" />',
    '<path d="M8 20h7" />',
    '<path d="M13 4h6" />',
  ],
  bladeAllTracks: [
    '<path d="M5 6h14" />',
    '<path d="M5 12h14" />',
    '<path d="M5 18h14" />',
    '<path d="M15 4l-6 16" />',
  ],
  trackForward: [
    '<path d="M4 6h10" />',
    '<path d="M4 12h13" />',
    '<path d="M4 18h10" />',
    '<path d="M17 8l4 4-4 4" />',
  ],
  trackBackward: [
    '<path d="M10 6h10" />',
    '<path d="M7 12h13" />',
    '<path d="M10 18h10" />',
    '<path d="M7 8l-4 4 4 4" />',
  ],
  range: [
    '<rect x="5" y="5" width="14" height="14" rx="2" />',
    '<path d="M9 5v14" />',
    '<path d="M15 5v14" />',
  ],
  trim: [
    '<path d="M7 5v14" />',
    '<path d="M17 5v14" />',
    '<path d="M10 8h4" />',
    '<path d="M10 16h4" />',
  ],
  rippleTrim: [
    '<path d="M6 5v14" />',
    '<path d="M10 8h8" />',
    '<path d="M10 16h8" />',
    '<path d="M15 11l3 3-3 3" />',
  ],
  rolling: [
    '<path d="M11 5v14" />',
    '<path d="M13 5v14" />',
    '<path d="M4 9h5" />',
    '<path d="M15 9h5" />',
    '<path d="M8 7l2 2-2 2" />',
    '<path d="M16 7l-2 2 2 2" />',
  ],
  slip: [
    '<path d="M5 7h14" />',
    '<path d="M5 17h14" />',
    '<path d="M9 12h6" />',
    '<path d="M9 12l2-2" />',
    '<path d="M9 12l2 2" />',
    '<path d="M15 12l-2-2" />',
    '<path d="M15 12l-2 2" />',
  ],
  slide: [
    '<path d="M4 8h5" />',
    '<path d="M15 8h5" />',
    '<path d="M8 16h8" />',
    '<path d="M8 16l2-2" />',
    '<path d="M8 16l2 2" />',
    '<path d="M16 16l-2-2" />',
    '<path d="M16 16l-2 2" />',
  ],
  stretch: [
    '<path d="M4 12h16" />',
    '<path d="M8 8l-4 4 4 4" />',
    '<path d="M16 8l4 4-4 4" />',
    '<path d="M12 5v14" />',
  ],
  hand: [
    '<path d="M8 12V7a2 2 0 0 1 4 0v5" />',
    '<path d="M12 11V5a2 2 0 0 1 4 0v7" />',
    '<path d="M16 12V8a2 2 0 0 1 4 0v6" />',
    '<path d="M8 12l-1-1.5a2 2 0 0 0-3.4 2.1l4 6.2A5 5 0 0 0 12 21h4a5 5 0 0 0 5-5v-2" />',
  ],
  zoom: [
    '<circle cx="10" cy="10" r="6" />',
    '<path d="M14.5 14.5L21 21" />',
    '<path d="M10 7v6" />',
    '<path d="M7 10h6" />',
  ],
  marker: [
    '<path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" />',
    '<circle cx="12" cy="10" r="2" />',
  ],
  pen: [
    '<path d="M4 20l4-1 11-11a2 2 0 0 0-3-3L5 16z" />',
    '<path d="M13 6l5 5" />',
  ],
} satisfies Record<string, string[]>;

const TIMELINE_TOOL_ICON_CURSORS = {
  select: undefined,
  'track-select-forward': createIconCursor(CURSOR_PATHS.trackForward, 'e-resize', 19, 16),
  'track-select-backward': createIconCursor(CURSOR_PATHS.trackBackward, 'w-resize', 5, 16),
  'track-select-forward-all': createIconCursor(CURSOR_PATHS.trackForward, 'copy', 19, 16),
  'range-select': createIconCursor(CURSOR_PATHS.range, 'crosshair', 16, 16),
  blade: createIconCursor(CURSOR_PATHS.blade, 'crosshair', 12, 12),
  'blade-all-tracks': createIconCursor(CURSOR_PATHS.bladeAllTracks, 'crosshair', 12, 12),
  'split-at-playhead': createIconCursor(CURSOR_PATHS.blade, 'crosshair', 12, 12),
  'split-all-at-playhead': createIconCursor(CURSOR_PATHS.bladeAllTracks, 'crosshair', 12, 12),
  'trim-start-to-playhead': createIconCursor(CURSOR_PATHS.trim, 'ew-resize', 16, 16),
  'trim-end-to-playhead': createIconCursor(CURSOR_PATHS.trim, 'ew-resize', 16, 16),
  'ripple-trim-start-to-playhead': createIconCursor(CURSOR_PATHS.rippleTrim, 'ew-resize', 16, 16),
  'ripple-trim-end-to-playhead': createIconCursor(CURSOR_PATHS.rippleTrim, 'ew-resize', 16, 16),
  'ripple-delete': undefined,
  'delete-gap': undefined,
  'lift-range': undefined,
  'extract-range': undefined,
  'edge-trim': createIconCursor(CURSOR_PATHS.trim, 'ew-resize', 16, 16),
  'ripple-trim': createIconCursor(CURSOR_PATHS.rippleTrim, 'ew-resize', 16, 16),
  'rolling-edit': createIconCursor(CURSOR_PATHS.rolling, 'ew-resize', 16, 16),
  slip: createIconCursor(CURSOR_PATHS.slip, 'move', 16, 16),
  slide: createIconCursor(CURSOR_PATHS.slide, 'move', 16, 16),
  'rate-stretch': createIconCursor(CURSOR_PATHS.stretch, 'ew-resize', 16, 16),
  'position-overwrite': createIconCursor(CURSOR_PATHS.pointer, 'move', 6, 5),
  insert: undefined,
  overwrite: undefined,
  replace: undefined,
  'fit-to-fill': undefined,
  'append-at-end': undefined,
  'place-on-top': undefined,
  'ripple-overwrite': undefined,
  hand: createIconCursor(CURSOR_PATHS.hand, 'grab', 12, 12),
  zoom: createIconCursor(CURSOR_PATHS.zoom, 'zoom-in', 10, 10),
  marker: createIconCursor(CURSOR_PATHS.marker, 'copy', 12, 21),
  'in-point': createIconCursor(CURSOR_PATHS.trim, 'crosshair', 9, 16),
  'out-point': createIconCursor(CURSOR_PATHS.trim, 'crosshair', 19, 16),
  'pen-keyframe': createIconCursor(CURSOR_PATHS.pen, 'crosshair', 5, 20),
} satisfies Record<TimelineToolId, string | undefined>;

export function getTimelineToolCursor(toolId: TimelineToolId): string | undefined {
  return TIMELINE_TOOL_ICON_CURSORS[toolId];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSnapTargets(clips: TimelineClip[], playheadPosition: number): number[] {
  const targets = [playheadPosition];
  for (const clip of clips) {
    targets.push(clip.startTime, clip.startTime + clip.duration);
  }
  return targets;
}

export function resolveTimelineClipPointerTime(context: TimelineClipPointerContext): {
  rawTime: number;
  time: number;
  snapped: boolean;
} {
  const width = Math.max(1, context.width);
  const displayDuration = Math.max(0.001, context.displayDuration);
  const localX = clamp(context.clientX - context.rectLeft, 0, width);
  const rawTime = context.displayStartTime + (localX / width) * displayDuration;
  const shouldSnap = context.snappingEnabled !== context.altKey;

  if (!shouldSnap) {
    return { rawTime, time: rawTime, snapped: false };
  }

  const snapThresholdTime = (TIMELINE_TOOL_SNAP_THRESHOLD_PX / width) * displayDuration;
  let nearestTarget = rawTime;
  let nearestDistance = Infinity;

  for (const target of getSnapTargets(context.clips, context.playheadPosition)) {
    const distance = Math.abs(target - rawTime);
    if (distance <= snapThresholdTime && distance < nearestDistance) {
      nearestTarget = target;
      nearestDistance = distance;
    }
  }

  return {
    rawTime,
    time: nearestTarget,
    snapped: nearestTarget !== rawTime,
  };
}

export function dispatchTimelineClipPointerMove(
  context: TimelineClipPointerContext,
): TimelineClipPointerDispatchResult {
  if (isTimelineTrackSelectTool(context.toolId)) {
    const { rawTime } = resolveTimelineClipPointerTime({
      ...context,
      snappingEnabled: false,
      altKey: false,
    });
    return {
      handled: true,
      preview: {
        toolId: context.toolId,
        plane: context.toolId === 'track-select-forward-all' ? 'section-scrolled' : 'clip-local',
        clipId: context.clip.id,
        trackId: context.track.id,
        time: rawTime,
      },
    };
  }

  if (!isTimelineBladeTool(context.toolId)) return { handled: false };

  if (context.track.locked === true) {
    return {
      handled: true,
      preview: {
        toolId: context.toolId,
        plane: 'clip-local',
        clipId: context.clip.id,
        trackId: context.track.id,
        blocked: true,
        message: 'Track is locked.',
      },
    };
  }

  const { time } = resolveTimelineClipPointerTime(context);
  return {
    handled: true,
    preview: {
      toolId: context.toolId,
      plane: context.toolId === 'blade-all-tracks' ? 'section-scrolled' : 'clip-local',
      clipId: context.clip.id,
      trackId: context.track.id,
      time,
    },
  };
}

export function dispatchTimelineClipPointerClick(
  context: TimelineClipPointerContext,
): TimelineClipPointerDispatchResult {
  if (isTimelineTrackSelectTool(context.toolId)) {
    const { rawTime } = resolveTimelineClipPointerTime({
      ...context,
      snappingEnabled: false,
      altKey: false,
    });
    return {
      handled: true,
      operation: {
        id: `${context.toolId}:${context.track.id}:${rawTime}`,
        type: 'select-clips-from-time',
        time: rawTime,
        direction: context.toolId === 'track-select-backward' ? 'backward' : 'forward',
        trackIds: context.toolId === 'track-select-forward-all' ? undefined : [context.track.id],
        includeLinked: true,
      },
    };
  }

  if (!isTimelineBladeTool(context.toolId)) return { handled: false };

  if (context.track.locked === true) {
    return dispatchTimelineClipPointerMove(context);
  }

  const { time } = resolveTimelineClipPointerTime(context);
  const operation: TimelineEditOperation = context.toolId === 'blade-all-tracks'
    ? {
        id: `blade-all-tracks:${time}`,
        type: 'split-all-at-time',
        time,
        includeLinked: true,
      }
    : {
        id: `blade:${context.clip.id}:${time}`,
        type: 'split-at-time',
        clipIds: [context.clip.id],
        time,
        includeLinked: true,
      };

  return {
    handled: true,
    operation,
    nextToolId: 'select',
  };
}
