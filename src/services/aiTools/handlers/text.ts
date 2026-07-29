import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  createTextBoundsPathProperty,
  type MaskPathKeyframeValue,
  type TextClipProperties,
  type TimelineClip,
} from '../../../types';
import {
  createTextBoundsFromRect,
  getTextBoundsPathValue,
  resolveTextBoxRect,
} from '../../textLayout';
import { getTimelineGeneratedCanvasRuntimeDimensions } from '../../timeline/timelineGeneratedCanvasRuntime';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const TEXT_PROPERTY_KEYS = [
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'textAlign',
  'verticalAlign',
  'lineHeight',
  'letterSpacing',
  'boxEnabled',
  'boxX',
  'boxY',
  'boxWidth',
  'boxHeight',
  'strokeEnabled',
  'strokeColor',
  'strokeWidth',
  'shadowEnabled',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur',
  'pathEnabled',
  'pathPoints',
] as const satisfies readonly (keyof TextClipProperties)[];

const BOX_PROPERTY_KEYS = ['boxX', 'boxY', 'boxWidth', 'boxHeight'] as const;

export async function handleGetTextProperties(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const textClip = findTextClip(args.clipId, timelineStore, { allowLocked: true });
  if (!textClip.success) return textClip.result;

  return {
    success: true,
    data: describeTextClip(textClip.clip),
  };
}

export async function handleCreateTextClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const validation = validateTextPropertyInputs(args, {
    requireText: true,
    existingPathPointCount: 0,
  });
  if (validation) return validation;

  const startTime = args.startTime === undefined
    ? timelineStore.playheadPosition
    : finiteNumberInRange(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  if (typeof startTime !== 'number') return startTime;

  const duration = args.duration === undefined
    ? 5
    : finiteNumberInRange(args.duration, 'duration', Number.EPSILON, Number.MAX_SAFE_INTEGER);
  if (typeof duration !== 'number') return duration;

  const requestedTrackId = optionalString(args.trackId);
  if (requestedTrackId instanceof Error) {
    return failure(requestedTrackId.message);
  }
  const track = requestedTrackId
    ? timelineStore.tracks.find((candidate) => candidate.id === requestedTrackId)
    : timelineStore.tracks.find((candidate) => (
        candidate.type === 'video' && candidate.locked !== true && candidate.visible !== false
      )) ?? timelineStore.tracks.find((candidate) => (
        candidate.type === 'video' && candidate.locked !== true
      ));

  if (!track) {
    return failure(requestedTrackId
      ? `Track not found: ${requestedTrackId}`
      : 'No unlocked video track is available for a text clip');
  }
  if (track.type !== 'video') {
    return failure(`Text clips require a video track: ${track.id}`);
  }
  if (track.locked) {
    return failure(`Track is locked: ${track.id}`);
  }

  const mutationSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
  const { addTextClip } = useTimelineStore.getState();
  const clipId = await addTextClip(track.id, startTime, duration);
  if (!clipId) {
    return failure('The editor could not create the text clip');
  }

  const created = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
  if (!created?.textProperties) {
    return failure(`Created text clip could not be resolved: ${clipId}`);
  }

  const updates = buildTextPropertyUpdates(args, created);
  if (Object.keys(updates).length > 0) {
    useTimelineStore.getState().updateTextProperties(clipId, updates);
  }
  useTimelineStore.getState().invalidateCache();
  selectClipAndOpenTab(clipId, 'text');

  const finalClip = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
  if (!finalClip?.textProperties) {
    return failure(`Created text clip disappeared: ${clipId}`);
  }

  return {
    success: true,
    data: {
      ...describeTextClip(finalClip),
      ...describeMutationEntities(mutationSnapshot, useTimelineStore.getState().clips),
    },
  };
}

export async function handleUpdateTextProperties(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const textClip = findTextClip(args.clipId, timelineStore);
  if (!textClip.success) return textClip.result;
  const validation = validateTextPropertyInputs(args, {
    existingPathPointCount: textClip.clip.textProperties?.pathPoints.length ?? 0,
  });
  if (validation) return validation;

  const updates = buildTextPropertyUpdates(args, textClip.clip);
  if (Object.keys(updates).length === 0) {
    return failure('No text properties provided');
  }

  const mutationSnapshot = captureMutationEntitySnapshot('clip', [textClip.clip]);
  useTimelineStore.getState().updateTextProperties(textClip.clip.id, updates);
  selectClipAndOpenTab(textClip.clip.id, 'text');

  const updatedClip = useTimelineStore.getState().clips.find((clip) => clip.id === textClip.clip.id);
  if (!updatedClip?.textProperties) {
    return failure(`Text clip disappeared: ${textClip.clip.id}`);
  }

  return {
    success: true,
    data: {
      ...describeTextClip(updatedClip),
      updatedProperties: Object.keys(updates),
      ...describeMutationEntities(
        mutationSnapshot,
        [updatedClip],
        { updatedEntityIds: [updatedClip.id] },
      ),
    },
  };
}

export async function handleSetTextBox(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const textClip = findTextClip(args.clipId, timelineStore);
  if (!textClip.success) return textClip.result;

  const enabled = optionalBoolean(args.enabled, 'enabled');
  if (enabled instanceof Error) return failure(enabled.message);
  const rectangle = validateRectangleArgs(args, {
    xKey: 'x',
    yKey: 'y',
    widthKey: 'width',
    heightKey: 'height',
  });
  if (!rectangle.success) return rectangle.result;
  if (enabled === undefined && !rectangle.hasAny) {
    return failure('No text-field properties provided');
  }

  const { width: canvasWidth, height: canvasHeight } = getTextCanvasDimensions(textClip.clip);
  const currentBox = resolveTextBoxRect(textClip.clip.textProperties!, canvasWidth, canvasHeight);
  const nextBox = {
    x: rectangle.x ?? currentBox.x,
    y: rectangle.y ?? currentBox.y,
    width: rectangle.width ?? currentBox.width,
    height: rectangle.height ?? currentBox.height,
  };
  const updates: Partial<TextClipProperties> = {
    ...(enabled === undefined ? {} : { boxEnabled: enabled }),
    ...(rectangle.hasAny ? {
      boxX: nextBox.x,
      boxY: nextBox.y,
      boxWidth: nextBox.width,
      boxHeight: nextBox.height,
      textBounds: createTextBoundsFromRect(
        nextBox,
        canvasWidth,
        canvasHeight,
        undefined,
        { clampToCanvas: false },
      ),
    } : {}),
  };

  const mutationSnapshot = captureMutationEntitySnapshot('clip', [textClip.clip]);
  useTimelineStore.getState().updateTextProperties(textClip.clip.id, updates);
  selectClipAndOpenTab(textClip.clip.id, 'text');

  const updatedClip = useTimelineStore.getState().clips.find((clip) => clip.id === textClip.clip.id);
  if (!updatedClip?.textProperties) {
    return failure(`Text clip disappeared: ${textClip.clip.id}`);
  }

  return {
    success: true,
    data: {
      ...describeTextClip(updatedClip),
      updatedProperties: Object.keys(updates),
      ...describeMutationEntities(
        mutationSnapshot,
        [updatedClip],
        { updatedEntityIds: [updatedClip.id] },
      ),
    },
  };
}

export async function handleAddTextBoundsKeyframe(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const textClip = findTextClip(args.clipId, timelineStore);
  if (!textClip.success) return textClip.result;

  const time = args.time === undefined
    ? undefined
    : finiteNumberInRange(args.time, 'time', 0, Number.MAX_SAFE_INTEGER);
  if (time !== undefined && typeof time !== 'number') return time;
  const easing = optionalString(args.easing);
  if (easing instanceof Error) return failure(easing.message);

  const rectangle = validateRectangleArgs(args, {
    xKey: 'x',
    yKey: 'y',
    widthKey: 'width',
    heightKey: 'height',
  });
  if (!rectangle.success) return rectangle.result;

  const { width: canvasWidth, height: canvasHeight } = getTextCanvasDimensions(textClip.clip);
  let pathValue: MaskPathKeyframeValue | undefined;
  if (rectangle.hasAny) {
    const currentBox = resolveTextBoxRect(textClip.clip.textProperties!, canvasWidth, canvasHeight);
    const bounds = createTextBoundsFromRect({
      x: rectangle.x ?? currentBox.x,
      y: rectangle.y ?? currentBox.y,
      width: rectangle.width ?? currentBox.width,
      height: rectangle.height ?? currentBox.height,
    }, canvasWidth, canvasHeight, undefined, { clampToCanvas: false });
    pathValue = getTextBoundsPathValue(bounds);
  }

  const mutationSnapshot = captureMutationEntitySnapshot(
    'keyframe',
    timelineStore.getClipKeyframes(textClip.clip.id),
  );
  const { addTextBoundsPathKeyframe, invalidateCache } = useTimelineStore.getState();
  addTextBoundsPathKeyframe(
    textClip.clip.id,
    pathValue,
    time,
    easing,
    { source: 'ai-tool', historyLabel: 'AI: animate text field' },
  );
  invalidateCache();
  selectClipAndOpenTab(textClip.clip.id, 'text');

  const property = createTextBoundsPathProperty();
  const keyframes = useTimelineStore.getState().getClipKeyframes(textClip.clip.id);
  const propertyKeyframes = keyframes.filter((keyframe) => keyframe.property === property);
  const targetTime = time === undefined
    ? undefined
    : Math.max(0, Math.min(time, textClip.clip.duration));
  const newKeyframe = targetTime === undefined
    ? propertyKeyframes[propertyKeyframes.length - 1]
    : propertyKeyframes.find((keyframe) => keyframe.time === targetTime)
      ?? propertyKeyframes[propertyKeyframes.length - 1];

  if (!newKeyframe) {
    return failure('The text bounds keyframe could not be created');
  }

  return {
    success: true,
    data: {
      clipId: textClip.clip.id,
      keyframeId: newKeyframe.id,
      property,
      time: newKeyframe.time,
      easing: newKeyframe.easing,
      pathValue: newKeyframe.pathValue,
      ...describeMutationEntities(mutationSnapshot, keyframes),
    },
  };
}

function buildTextPropertyUpdates(
  args: Record<string, unknown>,
  clip: TimelineClip,
): Partial<TextClipProperties> {
  const updates: Partial<TextClipProperties> = {};
  for (const key of TEXT_PROPERTY_KEYS) {
    if (args[key] !== undefined) {
      if (key === 'pathPoints' && Array.isArray(args.pathPoints)) {
        updates.pathPoints = args.pathPoints.map((value) => {
          const point = value as Record<string, unknown>;
          return {
            x: point.x as number,
            y: point.y as number,
            handleIn: normalizePointHandle(point.handleIn),
            handleOut: normalizePointHandle(point.handleOut),
          };
        });
      } else {
        Object.assign(updates, { [key]: args[key] });
      }
    }
  }

  const hasBoxRectangle = BOX_PROPERTY_KEYS.some((key) => args[key] !== undefined);
  if (hasBoxRectangle && clip.textProperties) {
    const { width: canvasWidth, height: canvasHeight } = getTextCanvasDimensions(clip);
    const currentBox = resolveTextBoxRect(clip.textProperties, canvasWidth, canvasHeight);
    const nextBox = {
      x: typeof args.boxX === 'number' ? args.boxX : currentBox.x,
      y: typeof args.boxY === 'number' ? args.boxY : currentBox.y,
      width: typeof args.boxWidth === 'number' ? args.boxWidth : currentBox.width,
      height: typeof args.boxHeight === 'number' ? args.boxHeight : currentBox.height,
    };
    updates.boxX = nextBox.x;
    updates.boxY = nextBox.y;
    updates.boxWidth = nextBox.width;
    updates.boxHeight = nextBox.height;
    updates.textBounds = createTextBoundsFromRect(
      nextBox,
      canvasWidth,
      canvasHeight,
      undefined,
      { clampToCanvas: false },
    );
  }

  return updates;
}

function describeTextClip(
  clip: TimelineClip,
) {
  const { width, height } = getTextCanvasDimensions(clip);
  const textProperties = structuredClone(clip.textProperties!);
  return {
    clipId: clip.id,
    trackId: clip.trackId,
    startTime: clip.startTime,
    duration: clip.duration,
    canvasDimensions: { width, height },
    textBox: resolveTextBoxRect(textProperties, width, height),
    textProperties,
  };
}

function getTextCanvasDimensions(
  clip: TimelineClip,
) {
  const activeComposition = useMediaStore.getState().getActiveComposition();
  return getTimelineGeneratedCanvasRuntimeDimensions(clip, {
    width: activeComposition?.width ?? 1920,
    height: activeComposition?.height ?? 1080,
  });
}

function findTextClip(
  clipIdInput: unknown,
  timelineStore: TimelineStore,
  options: { allowLocked?: boolean } = {},
):
  | { success: true; clip: TimelineClip }
  | { success: false; result: ToolResult } {
  if (typeof clipIdInput !== 'string' || !clipIdInput.trim()) {
    return { success: false, result: failure('clipId must be a non-empty string') };
  }
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipIdInput);
  if (!clip) {
    return { success: false, result: failure(`Clip not found: ${clipIdInput}`) };
  }
  if (!clip.textProperties) {
    return { success: false, result: failure(`Clip is not an editable text clip: ${clipIdInput}`) };
  }
  const track = timelineStore.tracks.find((candidate) => candidate.id === clip.trackId);
  if (track?.locked && options.allowLocked !== true) {
    return { success: false, result: failure(`Track is locked: ${track.id}`) };
  }
  return { success: true, clip };
}

function validateTextPropertyInputs(
  args: Record<string, unknown>,
  options: { requireText?: boolean; existingPathPointCount?: number } = {},
): ToolResult | null {
  if (options.requireText && (typeof args.text !== 'string' || args.text.length === 0)) {
    return failure('text must be a non-empty string');
  }

  for (const key of ['text', 'fontFamily', 'color', 'strokeColor', 'shadowColor'] as const) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || (key !== 'text' && !args[key].trim()))) {
      return failure(`${key} must be ${key === 'text' ? 'a string' : 'a non-empty string'}`);
    }
  }
  for (const [key, min, max] of [
    ['fontSize', 8, 500],
    ['fontWeight', 100, 900],
    ['lineHeight', 0.5, 3],
    ['letterSpacing', -10, 50],
    ['boxX', -100000, 100000],
    ['boxY', -100000, 100000],
    ['boxWidth', 24, 100000],
    ['boxHeight', 24, 100000],
    ['strokeWidth', 0.5, 20],
    ['shadowOffsetX', -50, 50],
    ['shadowOffsetY', -50, 50],
    ['shadowBlur', 0, 50],
  ] as const) {
    const error = validateOptionalFiniteRange(args[key], key, min, max);
    if (error) return failure(error);
  }
  if (args.fontWeight !== undefined && !Number.isInteger(args.fontWeight)) {
    return failure('fontWeight must be an integer');
  }

  const enumChecks: Array<[string, readonly string[]]> = [
    ['fontStyle', ['normal', 'italic']],
    ['textAlign', ['left', 'center', 'right']],
    ['verticalAlign', ['top', 'middle', 'bottom']],
  ];
  for (const [key, values] of enumChecks) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !values.includes(args[key]))) {
      return failure(`${key} must be one of: ${values.join(', ')}`);
    }
  }

  for (const key of ['boxEnabled', 'strokeEnabled', 'shadowEnabled', 'pathEnabled']) {
    if (args[key] !== undefined && typeof args[key] !== 'boolean') {
      return failure(`${key} must be a boolean`);
    }
  }

  if (args.pathPoints !== undefined) {
    if (!Array.isArray(args.pathPoints)) {
      return failure('pathPoints must be an array');
    }
    for (const [index, value] of args.pathPoints.entries()) {
      if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
        return failure(`pathPoints[${index}] must contain finite x and y numbers`);
      }
      for (const handleKey of ['handleIn', 'handleOut'] as const) {
        const handle = value[handleKey];
        if (
          handle !== undefined
          && (!isRecord(handle) || !isFiniteNumber(handle.x) || !isFiniteNumber(handle.y))
        ) {
          return failure(`pathPoints[${index}].${handleKey} must contain finite x and y numbers`);
        }
      }
    }
  }
  if (
    args.pathEnabled === true
    && (Array.isArray(args.pathPoints)
      ? args.pathPoints.length
      : options.existingPathPointCount ?? 0) < 2
  ) {
    return failure('pathEnabled requires at least two pathPoints');
  }

  return null;
}

function validateRectangleArgs(
  args: Record<string, unknown>,
  keys: { xKey: string; yKey: string; widthKey: string; heightKey: string },
):
  | { success: true; hasAny: boolean; x?: number; y?: number; width?: number; height?: number }
  | { success: false; result: ToolResult } {
  const values = {
    x: args[keys.xKey],
    y: args[keys.yKey],
    width: args[keys.widthKey],
    height: args[keys.heightKey],
  };
  const ranges = {
    x: [-100000, 100000],
    y: [-100000, 100000],
    width: [24, 100000],
    height: [24, 100000],
  } as const;
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    const [min, max] = ranges[key];
    const error = validateOptionalFiniteRange(values[key], key, min, max);
    if (error) return { success: false, result: failure(error) };
  }
  return {
    success: true,
    hasAny: Object.values(values).some((value) => value !== undefined),
    ...(values.x === undefined ? {} : { x: values.x as number }),
    ...(values.y === undefined ? {} : { y: values.y as number }),
    ...(values.width === undefined ? {} : { width: values.width as number }),
    ...(values.height === undefined ? {} : { height: values.height as number }),
  };
}

function finiteNumberInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | ToolResult {
  const error = validateOptionalFiniteRange(value, name, min, max);
  return error ? failure(error) : value as number;
}

function validateOptionalFiniteRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): string | null {
  if (value === undefined) return null;
  if (!isFiniteNumber(value)) return `${name} must be a finite number`;
  if (value < min || value > max) return `${name} must be between ${min} and ${max}`;
  return null;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined | Error {
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : new Error(`${name} must be a boolean`);
}

function optionalString(value: unknown): string | undefined | Error {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.trim()
    ? value
    : new Error('Expected a non-empty string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePointHandle(value: unknown): { x: number; y: number } {
  if (!isRecord(value)) return { x: 0, y: 0 };
  return {
    x: isFiniteNumber(value.x) ? value.x : 0,
    y: isFiniteNumber(value.y) ? value.y : 0,
  };
}

function failure(error: string): ToolResult {
  return { success: false, error };
}
