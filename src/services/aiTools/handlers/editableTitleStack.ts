import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ToolResult } from '../types';
import { handleCreateMotionShapeClip } from './motionDesign';
import { handleCreateTextClip } from './text';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

interface TitleRow {
  text: string;
  name?: string;
  box: { x: number; y: number; width: number; height: number };
  textStyle: Record<string, unknown>;
  backplate: {
    color: string;
    opacity: number;
    paddingX: number;
    paddingY: number;
    cornerRadius: number;
  };
}

const TITLE_TEXT_STYLE_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'textAlign',
  'verticalAlign',
  'lineHeight',
  'letterSpacing',
  'strokeEnabled',
  'strokeColor',
  'strokeWidth',
  'shadowEnabled',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur',
]);

function failure(error: string): ToolResult {
  return { success: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function optionalNumber(
  value: unknown,
  fallback: number,
  path: string,
  minimum: number,
  maximum: number,
): number | Error {
  return value === undefined ? fallback : finiteInRange(value, path, minimum, maximum);
}

function optionalNonEmptyString(value: unknown, fallback: string, path: string): string | Error {
  if (value === undefined) return fallback;
  return typeof value === 'string' && value.trim()
    ? value
    : new Error(`${path} must be a non-empty string`);
}

function parseRows(value: unknown): TitleRow[] | Error {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    return new Error('rows must contain between 1 and 6 title rows');
  }

  const rows: TitleRow[] = [];
  for (const [index, rawRow] of value.entries()) {
    const path = `rows[${index}]`;
    if (!isRecord(rawRow)) return new Error(`${path} must be an object`);
    if (typeof rawRow.text !== 'string' || !rawRow.text.length) {
      return new Error(`${path}.text must be a non-empty string`);
    }
    if (rawRow.name !== undefined && (typeof rawRow.name !== 'string' || !rawRow.name.trim())) {
      return new Error(`${path}.name must be a non-empty string`);
    }
    if (!isRecord(rawRow.box)) return new Error(`${path}.box must be an object`);
    const x = finiteInRange(rawRow.box.x, `${path}.box.x`, -100_000, 100_000);
    const y = finiteInRange(rawRow.box.y, `${path}.box.y`, -100_000, 100_000);
    const width = finiteInRange(rawRow.box.width, `${path}.box.width`, 24, 100_000);
    const height = finiteInRange(rawRow.box.height, `${path}.box.height`, 24, 100_000);
    for (const parsed of [x, y, width, height]) if (parsed instanceof Error) return parsed;

    const textStyle = rawRow.textStyle === undefined ? {} : rawRow.textStyle;
    if (!isRecord(textStyle)) return new Error(`${path}.textStyle must be an object`);
    const unsupportedTextStyleKey = Object.keys(textStyle).find(
      (key) => !TITLE_TEXT_STYLE_KEYS.has(key),
    );
    if (unsupportedTextStyleKey) {
      return new Error(`${path}.textStyle.${unsupportedTextStyleKey} is not supported`);
    }
    const backplate = rawRow.backplate === undefined ? {} : rawRow.backplate;
    if (!isRecord(backplate)) return new Error(`${path}.backplate must be an object`);
    const color = optionalNonEmptyString(backplate.color, '#000000', `${path}.backplate.color`);
    const opacity = optionalNumber(backplate.opacity, 0.9, `${path}.backplate.opacity`, 0, 1);
    const paddingX = optionalNumber(backplate.paddingX, 24, `${path}.backplate.paddingX`, 0, 2_000);
    const paddingY = optionalNumber(backplate.paddingY, 8, `${path}.backplate.paddingY`, 0, 2_000);
    const cornerRadius = optionalNumber(backplate.cornerRadius, 12, `${path}.backplate.cornerRadius`, 0, 10_000);
    for (const parsed of [color, opacity, paddingX, paddingY, cornerRadius]) {
      if (parsed instanceof Error) return parsed;
    }

    rows.push({
      text: rawRow.text,
      ...(rawRow.name === undefined ? {} : { name: rawRow.name as string }),
      box: { x, y, width, height } as TitleRow['box'],
      textStyle,
      backplate: { color, opacity, paddingX, paddingY, cornerRadius } as TitleRow['backplate'],
    });
  }
  return rows;
}

function overlaps(clip: TimelineClip, startTime: number, endTime: number): boolean {
  return clip.startTime < endTime && clip.startTime + clip.duration > startTime;
}

function availableVideoTracks(
  store: TimelineStore,
  startTime: number,
  endTime: number,
): TimelineTrack[] {
  return store.tracks.filter((track) => (
    track.type === 'video'
    && track.locked !== true
    && track.visible !== false
    && track.muted !== true
    && !store.clips.some((clip) => clip.trackId === track.id && overlaps(clip, startTime, endTime))
  ));
}

function resolveExplicitTracks(
  trackIdsInput: unknown,
  requiredCount: number,
  store: TimelineStore,
  startTime: number,
  endTime: number,
): TimelineTrack[] | Error | null {
  if (trackIdsInput === undefined) return null;
  if (
    !Array.isArray(trackIdsInput)
    || trackIdsInput.length !== requiredCount
    || trackIdsInput.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    return new Error(`trackIds must contain exactly ${requiredCount} unique video track IDs in TOPMOST-FIRST order`);
  }
  const ids = trackIdsInput as string[];
  if (new Set(ids).size !== ids.length) return new Error('trackIds must not contain duplicates');
  const tracks = ids.map((id) => store.tracks.find((track) => track.id === id));
  if (tracks.some((track) => !track)) return new Error('One or more trackIds do not exist');
  const resolved = tracks as TimelineTrack[];
  for (const track of resolved) {
    if (track.type !== 'video') return new Error(`Title stacks require video tracks: ${track.id}`);
    if (track.locked) return new Error(`Track is locked: ${track.id}`);
    if (track.visible === false || track.muted === true) {
      return new Error(`Track must be visible and unmuted: ${track.id}`);
    }
    if (store.clips.some((clip) => clip.trackId === track.id && overlaps(clip, startTime, endTime))) {
      return new Error(`Track already contains a clip in the requested interval: ${track.id}`);
    }
  }
  const order = new Map(store.tracks.map((track, index) => [track.id, index]));
  if (resolved.some((track, index) => index > 0 && order.get(resolved[index - 1].id)! >= order.get(track.id)!)) {
    return new Error('trackIds must follow the editor TOPMOST-FIRST track order');
  }
  return resolved;
}

export async function handleCreateEditableTitleStack(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const rows = parseRows(args.rows);
  if (rows instanceof Error) return failure(rows.message);
  const startTime = args.startTime === undefined
    ? timelineStore.playheadPosition
    : finiteInRange(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  if (startTime instanceof Error) return failure(startTime.message);
  const duration = args.duration === undefined
    ? 5
    : finiteInRange(args.duration, 'duration', Number.EPSILON, Number.MAX_SAFE_INTEGER);
  if (duration instanceof Error) return failure(duration.message);

  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const requiredTrackCount = rows.length * 2;
  const stateRevisionBefore = getTimelineRevision();
  const clipsBefore = new Set(timelineStore.clips.map((clip) => clip.id));
  const tracksBefore = new Set(timelineStore.tracks.map((track) => track.id));
  const endTime = startTime + duration;

  let tracks = resolveExplicitTracks(
    args.trackIds,
    requiredTrackCount,
    timelineStore,
    startTime,
    endTime,
  );
  if (tracks instanceof Error) return failure(tracks.message);
  if (!tracks) {
    tracks = availableVideoTracks(timelineStore, startTime, endTime);
    while (tracks.length < requiredTrackCount) {
      useTimelineStore.getState().addTrack('video');
      tracks = availableVideoTracks(useTimelineStore.getState(), startTime, endTime);
    }
    tracks = tracks.slice(0, requiredTrackCount);
  }

  const textTracks = tracks.slice(0, rows.length);
  const backplateTracks = tracks.slice(rows.length);
  const createdRows: Array<Record<string, unknown>> = [];

  for (const [index, row] of rows.entries()) {
    const shapeX = row.box.x + row.box.width / 2 - compositionWidth / 2;
    const shapeY = row.box.y + row.box.height / 2 - compositionHeight / 2;
    const backplateResult = await handleCreateMotionShapeClip({
      trackId: backplateTracks[index].id,
      name: `${row.name ?? row.text} Backplate`,
      primitive: 'rectangle',
      startTime,
      duration,
      x: shapeX,
      y: shapeY,
      width: row.box.width + row.backplate.paddingX * 2,
      height: row.box.height + row.backplate.paddingY * 2,
      cornerRadius: row.backplate.cornerRadius,
      fill: { color: row.backplate.color, opacity: row.backplate.opacity },
    }, useTimelineStore.getState());
    if (!backplateResult.success) return backplateResult;

    const textResult = await handleCreateTextClip({
      trackId: textTracks[index].id,
      startTime,
      duration,
      text: row.text,
      fontFamily: 'Arial',
      fontSize: 64,
      fontWeight: 700,
      color: '#ffffff',
      textAlign: 'center',
      verticalAlign: 'middle',
      boxEnabled: true,
      boxX: row.box.x,
      boxY: row.box.y,
      boxWidth: row.box.width,
      boxHeight: row.box.height,
      ...row.textStyle,
    }, useTimelineStore.getState());
    if (!textResult.success) return textResult;

    createdRows.push({
      text: row.text,
      textClipId: (textResult.data as { clipId: string }).clipId,
      textTrackId: textTracks[index].id,
      backplateClipId: (backplateResult.data as { clipId: string }).clipId,
      backplateTrackId: backplateTracks[index].id,
      box: row.box,
      backplateCenter: { x: shapeX, y: shapeY },
    });
  }

  const current = useTimelineStore.getState();
  return {
    success: true,
    data: {
      startTime,
      duration,
      composition: { width: compositionWidth, height: compositionHeight },
      trackOrder: 'TOPMOST-FIRST',
      rows: createdRows,
      createdTrackIds: current.tracks.filter((track) => !tracksBefore.has(track.id)).map((track) => track.id),
      stateRevisionBefore,
      stateRevisionAfter: getTimelineRevision(),
      entities: {
        created: [
          ...current.tracks.filter((track) => !tracksBefore.has(track.id)).map((track) => ({ kind: 'track', id: track.id })),
          ...current.clips.filter((clip) => !clipsBefore.has(clip.id)).map((clip) => ({ kind: 'clip', id: clip.id })),
        ],
        updated: [],
        deleted: [],
      },
    },
  };
}
