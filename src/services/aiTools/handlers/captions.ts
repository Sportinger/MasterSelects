import { createTextBoundsFromRect } from '../../textLayout';
import {
  getCaptionSourceCandidates,
  resolveCaptionSourceWords,
} from '../../captions/captionRuntime';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { CaptionPropertiesPatch } from '../../../stores/timeline/types';
import type {
  CaptionBackgroundProperties,
  CaptionClipProperties,
  CaptionHighlightProperties,
} from '../../../types/caption';
import type { TextClipProperties } from '../../../types/text';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';
import { handleUpdateTextProperties } from './text';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const CAPTION_TOP_LEVEL_KEYS = new Set([
  'background',
  'clipId',
  'duration',
  'gapThreshold',
  'highlight',
  'holdAfter',
  'maxLines',
  'maxWidth',
  'positionX',
  'positionY',
  'sourceClipId',
  'startTime',
  'textStyle',
  'textTransform',
  'trackId',
  'wordsPerCaption',
]);

const BACKGROUND_KEYS = new Set<keyof CaptionBackgroundProperties>([
  'borderRadius',
  'color',
  'enabled',
  'opacity',
  'paddingX',
  'paddingY',
]);

const HIGHLIGHT_KEYS = new Set<keyof CaptionHighlightProperties>([
  'backgroundColor',
  'backgroundOpacity',
  'enabled',
  'mode',
  'scale',
  'scaleEnabled',
  'style',
  'textColor',
  'underlineColor',
  'underlineWidth',
]);

const TEXT_STYLE_KEYS = new Set<keyof TextClipProperties>([
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'shadowBlur',
  'shadowColor',
  'shadowEnabled',
  'shadowOffsetX',
  'shadowOffsetY',
  'strokeColor',
  'strokeEnabled',
  'strokeWidth',
  'textAlign',
]);

const LAYOUT_KEYS = ['positionX', 'positionY', 'maxWidth', 'maxLines'] as const;

interface ParsedCaptionUpdate {
  captionPatch: CaptionPropertiesPatch;
  hasLayoutPatch: boolean;
  textStyle: Partial<TextClipProperties>;
}

function failure(error: string): ToolResult {
  return { success: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | Error {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return new Error(`${path} must be a finite number`);
  }
  if (value < minimum || value > maximum) {
    return new Error(`${path} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string | Error {
  return typeof value === 'string' && value.trim()
    ? value
    : new Error(`${path} must be a non-empty string`);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): Error | null {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  return unknown ? new Error(`${path}.${unknown} is not supported`) : null;
}

function parseBackground(value: unknown): Partial<CaptionBackgroundProperties> | Error {
  if (!isRecord(value)) return new Error('background must be an object');
  const unknown = rejectUnknownKeys(value, BACKGROUND_KEYS, 'background');
  if (unknown) return unknown;
  const result: Partial<CaptionBackgroundProperties> = {};
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') return new Error('background.enabled must be a boolean');
    result.enabled = value.enabled;
  }
  if (value.color !== undefined) {
    const color = nonEmptyString(value.color, 'background.color');
    if (color instanceof Error) return color;
    result.color = color;
  }
  for (const [key, minimum, maximum] of [
    ['opacity', 0, 1],
    ['paddingX', 0, 200],
    ['paddingY', 0, 200],
    ['borderRadius', 0, 200],
  ] as const) {
    if (value[key] === undefined) continue;
    const parsed = finiteInRange(value[key], `background.${key}`, minimum, maximum);
    if (parsed instanceof Error) return parsed;
    result[key] = parsed;
  }
  return result;
}

function parseHighlight(value: unknown): Partial<CaptionHighlightProperties> | Error {
  if (!isRecord(value)) return new Error('highlight must be an object');
  const unknown = rejectUnknownKeys(value, HIGHLIGHT_KEYS, 'highlight');
  if (unknown) return unknown;
  const result: Partial<CaptionHighlightProperties> = {};
  for (const key of ['enabled', 'scaleEnabled'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') return new Error(`highlight.${key} must be a boolean`);
    result[key] = value[key];
  }
  const enums = {
    mode: ['active-word', 'spoken-words', 'caption-group'],
    style: ['text', 'background', 'underline'],
  } as const;
  for (const key of Object.keys(enums) as Array<keyof typeof enums>) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || !enums[key].includes(value[key] as never)) {
      return new Error(`highlight.${key} must be one of: ${enums[key].join(', ')}`);
    }
    Object.assign(result, { [key]: value[key] });
  }
  for (const key of [
    'textColor',
    'backgroundColor',
    'underlineColor',
  ] as const) {
    if (value[key] === undefined) continue;
    const parsed = nonEmptyString(value[key], `highlight.${key}`);
    if (parsed instanceof Error) return parsed;
    result[key] = parsed;
  }
  for (const [key, minimum, maximum] of [
    ['scale', 1, 3],
    ['backgroundOpacity', 0, 1],
    ['underlineWidth', 1, 30],
  ] as const) {
    if (value[key] === undefined) continue;
    const parsed = finiteInRange(value[key], `highlight.${key}`, minimum, maximum);
    if (parsed instanceof Error) return parsed;
    result[key] = parsed;
  }
  return result;
}

function parseTextStyle(value: unknown): Partial<TextClipProperties> | Error {
  if (!isRecord(value)) return new Error('textStyle must be an object');
  const unknown = rejectUnknownKeys(value, TEXT_STYLE_KEYS, 'textStyle');
  if (unknown) return unknown;
  const result: Partial<TextClipProperties> = {};
  for (const key of ['fontFamily', 'color', 'strokeColor', 'shadowColor'] as const) {
    if (value[key] === undefined) continue;
    const parsed = nonEmptyString(value[key], `textStyle.${key}`);
    if (parsed instanceof Error) return parsed;
    result[key] = parsed;
  }
  for (const [key, minimum, maximum] of [
    ['fontSize', 8, 500],
    ['fontWeight', 100, 900],
    ['lineHeight', 0.5, 3],
    ['letterSpacing', -10, 50],
    ['strokeWidth', 0.5, 20],
    ['shadowOffsetX', -50, 50],
    ['shadowOffsetY', -50, 50],
    ['shadowBlur', 0, 50],
  ] as const) {
    if (value[key] === undefined) continue;
    const parsed = finiteInRange(value[key], `textStyle.${key}`, minimum, maximum);
    if (parsed instanceof Error) return parsed;
    if (key === 'fontWeight' && !Number.isInteger(parsed)) {
      return new Error('textStyle.fontWeight must be an integer');
    }
    Object.assign(result, { [key]: parsed });
  }
  for (const key of ['strokeEnabled', 'shadowEnabled'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') return new Error(`textStyle.${key} must be a boolean`);
    result[key] = value[key];
  }
  if (value.fontStyle !== undefined) {
    if (value.fontStyle !== 'normal' && value.fontStyle !== 'italic') {
      return new Error('textStyle.fontStyle must be one of: normal, italic');
    }
    result.fontStyle = value.fontStyle;
  }
  if (value.textAlign !== undefined) {
    if (!['left', 'center', 'right'].includes(String(value.textAlign))) {
      return new Error('textStyle.textAlign must be one of: left, center, right');
    }
    result.textAlign = value.textAlign as TextClipProperties['textAlign'];
  }
  return result;
}

function parseCaptionUpdate(args: Record<string, unknown>): ParsedCaptionUpdate | Error {
  const unknown = rejectUnknownKeys(args, CAPTION_TOP_LEVEL_KEYS, 'caption');
  if (unknown) return unknown;
  const captionPatch: CaptionPropertiesPatch = {};
  if (Object.hasOwn(args, 'sourceClipId')) {
    if (args.sourceClipId === null) captionPatch.sourceClipId = null;
    else {
      const sourceClipId = nonEmptyString(args.sourceClipId, 'sourceClipId');
      if (sourceClipId instanceof Error) return sourceClipId;
      captionPatch.sourceClipId = sourceClipId;
    }
  }
  for (const [key, minimum, maximum, integer] of [
    ['wordsPerCaption', 1, 20, true],
    ['gapThreshold', 0, 5, false],
    ['holdAfter', 0, 3, false],
    ['positionX', 0, 100, false],
    ['positionY', 0, 100, false],
    ['maxWidth', 10, 100, false],
    ['maxLines', 1, 10, true],
  ] as const) {
    if (args[key] === undefined) continue;
    const parsed = finiteInRange(args[key], key, minimum, maximum);
    if (parsed instanceof Error) return parsed;
    if (integer && !Number.isInteger(parsed)) return new Error(`${key} must be an integer`);
    Object.assign(captionPatch, { [key]: parsed });
  }
  if (args.textTransform !== undefined) {
    const values = ['none', 'uppercase', 'lowercase', 'capitalize'] as const;
    if (typeof args.textTransform !== 'string' || !values.includes(args.textTransform as never)) {
      return new Error(`textTransform must be one of: ${values.join(', ')}`);
    }
    captionPatch.textTransform = args.textTransform as CaptionClipProperties['textTransform'];
  }
  if (args.background !== undefined) {
    const background = parseBackground(args.background);
    if (background instanceof Error) return background;
    if (Object.keys(background).length > 0) captionPatch.background = background;
  }
  if (args.highlight !== undefined) {
    const highlight = parseHighlight(args.highlight);
    if (highlight instanceof Error) return highlight;
    if (Object.keys(highlight).length > 0) captionPatch.highlight = highlight;
  }
  const textStyle = args.textStyle === undefined ? {} : parseTextStyle(args.textStyle);
  if (textStyle instanceof Error) return textStyle;

  // Keep the durable caption fallback in sync with editable text values. This
  // matters when a legacy caption needs to rebuild its Text clip after reload.
  for (const key of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'color',
    'textAlign',
    'lineHeight',
    'letterSpacing',
  ] as const) {
    if (textStyle[key] !== undefined) Object.assign(captionPatch, { [key]: textStyle[key] });
  }
  if (textStyle.strokeEnabled !== undefined) captionPatch.outlineEnabled = textStyle.strokeEnabled;
  if (textStyle.strokeColor !== undefined) captionPatch.outlineColor = textStyle.strokeColor;
  if (textStyle.strokeWidth !== undefined) captionPatch.outlineWidth = textStyle.strokeWidth;

  return {
    captionPatch,
    hasLayoutPatch: LAYOUT_KEYS.some((key) => args[key] !== undefined),
    textStyle,
  };
}

function overlaps(clip: TimelineClip, startTime: number, endTime: number): boolean {
  return clip.startTime < endTime && clip.startTime + clip.duration > startTime;
}

function resolveCaptionTrack(
  requestedTrackId: unknown,
  store: TimelineStore,
  startTime: number,
  endTime: number,
): TimelineTrack | Error | null {
  if (requestedTrackId !== undefined) {
    const trackId = nonEmptyString(requestedTrackId, 'trackId');
    if (trackId instanceof Error) return trackId;
    const track = store.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return new Error(`Track not found: ${trackId}`);
    if (track.type !== 'video') return new Error(`Caption clips require a video track: ${track.id}`);
    if (track.locked) return new Error(`Track is locked: ${track.id}`);
    if (track.visible === false || track.muted === true) {
      return new Error(`Track must be visible and unmuted: ${track.id}`);
    }
    const collision = store.clips.find((clip) => (
      clip.trackId === track.id && overlaps(clip, startTime, endTime)
    ));
    return collision
      ? new Error(`Track ${track.id} overlaps clip ${collision.id} in the requested interval`)
      : track;
  }
  return store.tracks.find((track) => (
    track.type === 'video'
    && track.locked !== true
    && track.visible !== false
    && track.muted !== true
    && !store.clips.some((clip) => clip.trackId === track.id && overlaps(clip, startTime, endTime))
  )) ?? null;
}

function findCaptionClip(
  clipIdInput: unknown,
  store: TimelineStore,
  options: { allowLocked?: boolean } = {},
): TimelineClip | ToolResult {
  const clipId = nonEmptyString(clipIdInput, 'clipId');
  if (clipId instanceof Error) return failure(clipId.message);
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return failure(`Clip not found: ${clipId}`);
  if (!clip.captionProperties) return failure(`Clip is not a dynamic caption clip: ${clipId}`);
  const track = store.tracks.find((candidate) => candidate.id === clip.trackId);
  if (track?.locked && options.allowLocked !== true) return failure(`Track is locked: ${track.id}`);
  return clip;
}

function isToolResult(value: TimelineClip | ToolResult): value is ToolResult {
  return 'success' in value;
}

function validateCaptionSource(
  sourceClipId: string,
  store: TimelineStore,
  range?: { startTime: number; endTime: number },
): TimelineClip | Error {
  const source = store.clips.find((clip) => clip.id === sourceClipId);
  if (!source) return new Error(`Caption source clip not found: ${sourceClipId}`);
  if (source.captionProperties || (source.source?.type !== 'video' && source.source?.type !== 'audio')) {
    return new Error(`Caption source must be a video or audio clip: ${sourceClipId}`);
  }
  if (!resolveCaptionSourceWords(source, store.clips)?.length) {
    return new Error(`Caption source has no transcript words: ${sourceClipId}`);
  }
  if (range && !(source.startTime < range.endTime && source.startTime + source.duration > range.startTime)) {
    return new Error(`Caption source ${sourceClipId} is not active in the requested interval`);
  }
  return source;
}

function activeAutomaticSource(store: TimelineStore, startTime: number): TimelineClip | null {
  return getCaptionSourceCandidates(store.clips)
    .map((candidate) => candidate.clip)
    .find((clip) => startTime >= clip.startTime && startTime < clip.startTime + clip.duration)
    ?? null;
}

function captionLayoutTextPatch(clip: TimelineClip): Partial<TextClipProperties> {
  const caption = clip.captionProperties!;
  const text = clip.textProperties!;
  const activeComposition = useMediaStore.getState().getActiveComposition();
  const width = Math.max(1, Math.round(activeComposition?.width ?? clip.source?.textCanvas?.width ?? 1920));
  const height = Math.max(1, Math.round(activeComposition?.height ?? clip.source?.textCanvas?.height ?? 1080));
  const boxWidth = width * Math.max(0.1, Math.min(1, caption.maxWidth / 100));
  const boxHeight = Math.max(
    text.fontSize * text.lineHeight * Math.max(1, caption.maxLines) + text.fontSize * 0.7,
    height * 0.14,
  );
  const box = {
    x: width * (caption.positionX / 100) - boxWidth / 2,
    y: height * (caption.positionY / 100) - boxHeight / 2,
    width: boxWidth,
    height: boxHeight,
  };
  return {
    boxEnabled: true,
    boxX: box.x,
    boxY: box.y,
    boxWidth: box.width,
    boxHeight: box.height,
    textBounds: createTextBoundsFromRect(box, width, height, undefined, { clampToCanvas: false }),
  };
}

async function applyCaptionUpdate(
  clipId: string,
  update: ParsedCaptionUpdate,
): Promise<ToolResult | null> {
  if (Object.keys(update.captionPatch).length > 0) {
    useTimelineStore.getState().updateCaptionProperties(clipId, update.captionPatch);
  }
  if (Object.keys(update.textStyle).length > 0) {
    const textResult = await handleUpdateTextProperties(
      { clipId, ...update.textStyle },
      useTimelineStore.getState(),
    );
    if (!textResult.success) return textResult;
  }
  if (update.hasLayoutPatch) {
    const current = useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
    if (!current?.captionProperties || !current.textProperties) {
      return failure(`Caption clip disappeared: ${clipId}`);
    }
    useTimelineStore.getState().updateTextProperties(clipId, captionLayoutTextPatch(current));
  }
  useTimelineStore.getState().invalidateCache();
  selectClipAndOpenTab(clipId, 'captions');
  return null;
}

function describeCaptionClip(clip: TimelineClip, store: TimelineStore): Record<string, unknown> {
  return {
    captionProperties: structuredClone(clip.captionProperties),
    clipId: clip.id,
    duration: clip.duration,
    endTime: clip.startTime + clip.duration,
    startTime: clip.startTime,
    textProperties: clip.textProperties ? structuredClone(clip.textProperties) : null,
    trackId: clip.trackId,
    availableSources: getCaptionSourceCandidates(store.clips, clip.id).map(({ clip: source, words }) => ({
      clipId: source.id,
      duration: source.duration,
      name: source.name,
      startTime: source.startTime,
      trackId: source.trackId,
      wordCount: words.length,
    })),
  };
}

export async function handleGetCaptionProperties(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clip = findCaptionClip(args.clipId, timelineStore, { allowLocked: true });
  if (isToolResult(clip)) return clip;
  return { success: true, data: describeCaptionClip(clip, timelineStore) };
}

export async function handleCreateCaptionClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const parsedUpdate = parseCaptionUpdate(args);
  if (parsedUpdate instanceof Error) return failure(parsedUpdate.message);

  let requestedSource: TimelineClip | null = null;
  if (typeof parsedUpdate.captionPatch.sourceClipId === 'string') {
    const source = validateCaptionSource(parsedUpdate.captionPatch.sourceClipId, timelineStore);
    if (source instanceof Error) return failure(source.message);
    requestedSource = source;
  }
  const rawStart = args.startTime === undefined
    ? requestedSource?.startTime ?? timelineStore.playheadPosition
    : finiteInRange(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  if (rawStart instanceof Error) return failure(rawStart.message);
  const automaticSource = requestedSource ?? activeAutomaticSource(timelineStore, rawStart);
  if (!automaticSource) {
    return failure('No transcript-bearing source clip is active at startTime');
  }
  const rawDuration = args.duration === undefined
    ? Math.max(0.1, automaticSource.startTime + automaticSource.duration - rawStart)
    : finiteInRange(args.duration, 'duration', 0.1, Number.MAX_SAFE_INTEGER);
  if (rawDuration instanceof Error) return failure(rawDuration.message);
  const endTime = rawStart + rawDuration;
  const validSource = validateCaptionSource(automaticSource.id, timelineStore, {
    startTime: rawStart,
    endTime,
  });
  if (validSource instanceof Error) return failure(validSource.message);

  const clipSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);
  const trackIdsBefore = new Set(timelineStore.tracks.map((track) => track.id));
  let track = resolveCaptionTrack(args.trackId, timelineStore, rawStart, endTime);
  if (track instanceof Error) return failure(track.message);
  if (!track) {
    const trackId = useTimelineStore.getState().addTrack('video');
    track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId) ?? null;
  }
  if (!track) return failure('The editor could not allocate a collision-free caption layer');

  const clipId = await useTimelineStore.getState().addCaptionClip(
    track.id,
    rawStart,
    rawDuration,
    parsedUpdate.captionPatch.sourceClipId ?? null,
  );
  if (!clipId) return failure('The editor could not create the caption clip');
  const updateFailure = await applyCaptionUpdate(clipId, parsedUpdate);
  if (updateFailure) return updateFailure;

  const current = useTimelineStore.getState();
  const finalClip = current.clips.find((clip) => clip.id === clipId);
  if (!finalClip?.captionProperties) return failure(`Created caption clip disappeared: ${clipId}`);
  return {
    success: true,
    data: {
      ...describeCaptionClip(finalClip, current),
      allocatedNewTrack: !trackIdsBefore.has(track.id),
      ...describeMutationEntities(clipSnapshot, current.clips),
    },
  };
}

export async function handleUpdateCaptionProperties(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const initialClip = findCaptionClip(args.clipId, timelineStore);
  if (isToolResult(initialClip)) return initialClip;
  const parsedUpdate = parseCaptionUpdate(args);
  if (parsedUpdate instanceof Error) return failure(parsedUpdate.message);
  if (
    Object.keys(parsedUpdate.captionPatch).length === 0
    && Object.keys(parsedUpdate.textStyle).length === 0
  ) {
    return failure('No caption properties provided');
  }
  if (typeof parsedUpdate.captionPatch.sourceClipId === 'string') {
    const source = validateCaptionSource(parsedUpdate.captionPatch.sourceClipId, timelineStore, {
      startTime: initialClip.startTime,
      endTime: initialClip.startTime + initialClip.duration,
    });
    if (source instanceof Error) return failure(source.message);
  }

  const mutationSnapshot = captureMutationEntitySnapshot('clip', [initialClip]);
  const migrated = await useTimelineStore.getState().ensureCaptionTextClip(initialClip.id);
  if (!migrated) return failure(`Caption clip could not be made editable: ${initialClip.id}`);
  const updateFailure = await applyCaptionUpdate(initialClip.id, parsedUpdate);
  if (updateFailure) return updateFailure;
  const current = useTimelineStore.getState();
  const updatedClip = current.clips.find((clip) => clip.id === initialClip.id);
  if (!updatedClip?.captionProperties) return failure(`Caption clip disappeared: ${initialClip.id}`);
  return {
    success: true,
    data: {
      ...describeCaptionClip(updatedClip, current),
      ...describeMutationEntities(
        mutationSnapshot,
        [updatedClip],
        { updatedEntityIds: [updatedClip.id] },
      ),
    },
  };
}
