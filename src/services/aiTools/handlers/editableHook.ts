import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';
import type { TimelineClip } from '../../../types';
import type { ToolResult } from '../types';
import { resolveEditableHookLayerMetadata } from '../editableHookIdentity';
import { handleCreateEditableTitleStack } from './editableTitleStack';
import {
  handleUpdateMotionAppearances,
  handleUpdateMotionProperties,
} from './motionDesign';
import {
  handleSetTextBox,
  handleUpdateTextProperties,
} from './text';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export const EDITABLE_HOOK_PRESETS = [
  'top-banner',
  'stacked-center',
  'center-card',
  'lower-third',
  'bottom-banner',
] as const;

type EditableHookPreset = typeof EDITABLE_HOOK_PRESETS[number];

interface EditableHookRowInput {
  backgroundColor?: string;
  backgroundOpacity?: number;
  fontSize?: number;
  fontWeight?: number;
  text: string;
  textColor?: string;
}

interface EditableHookStylePatch {
  backgroundColor?: string;
  backgroundOpacity?: number;
  cornerRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  paddingX?: number;
  paddingY?: number;
  textAlign?: 'center' | 'left' | 'right';
  textColor?: string;
}

interface EditableHookPlacementPatch {
  gap?: number;
  rowHeight?: number;
  width?: number;
  x?: number;
  y?: number;
}

interface EditableHookRequest {
  action: 'create' | 'update';
  duration?: number;
  hookId: string;
  placement?: EditableHookPlacementPatch;
  preset?: EditableHookPreset;
  rows?: EditableHookRowInput[];
  startTime?: number;
  style?: EditableHookStylePatch;
}

interface EditableHookTextBoxPatch {
  height?: number;
  width?: number;
  x?: number;
  y?: number;
}

interface EditableHookTextEdit {
  box?: EditableHookTextBoxPatch;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: 'normal' | 'italic';
  fontWeight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  rowIndex: number;
  shadowBlur?: number;
  shadowColor?: string;
  shadowEnabled?: boolean;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  strokeColor?: string;
  strokeEnabled?: boolean;
  strokeWidth?: number;
  text?: string;
  textAlign?: 'center' | 'left' | 'right';
  textColor?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

interface EditableHookBackgroundEdit {
  centerX?: number;
  centerY?: number;
  cornerRadius?: number;
  fillColor?: string;
  fillOpacity?: number;
  height?: number;
  rowIndex: number;
  strokeAlignment?: 'center' | 'inside' | 'outside';
  strokeColor?: string;
  strokeEnabled?: boolean;
  strokeOpacity?: number;
  strokeWidth?: number;
  width?: number;
}

interface EditableHookRefinementRequest {
  backgroundEdits?: EditableHookBackgroundEdit[];
  hookId: string;
  textEdits?: EditableHookTextEdit[];
}

interface ResolvedPlacement {
  gap: number;
  rowHeight: number;
  width: number;
  x: number;
  y: number;
}

interface ExistingHookRow {
  backplateClip: TimelineClip;
  index: number;
  textClip: TimelineClip;
}

const HOOK_ID_PATTERN = /^hook-[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const MAX_HOOK_ROWS = 4;

const PRESET_PLACEMENTS: Record<EditableHookPreset, ResolvedPlacement> = {
  'top-banner': { x: 0.08, y: 0.06, width: 0.84, rowHeight: 0.085, gap: 0.018 },
  'stacked-center': { x: 0.12, y: 0.18, width: 0.76, rowHeight: 0.1, gap: 0.024 },
  'center-card': { x: 0.14, y: 0.36, width: 0.72, rowHeight: 0.12, gap: 0.026 },
  'lower-third': { x: 0.06, y: 0.66, width: 0.72, rowHeight: 0.09, gap: 0.018 },
  'bottom-banner': { x: 0.08, y: 0.76, width: 0.84, rowHeight: 0.09, gap: 0.018 },
};

function failure(error: string): ToolResult {
  return { success: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(
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
  path: string,
  minimum: number,
  maximum: number,
): number | undefined | Error {
  if (value === undefined || value === null) return undefined;
  return finiteNumber(value, path, minimum, maximum);
}

function optionalFontSize(
  value: unknown,
  path: string,
): number | undefined | Error {
  return optionalNumber(value, path, 8, 500);
}

function resolveFontSize(value: number | undefined): number | undefined {
  return value;
}

function resolvePixelMeasure(value: number | undefined): number | undefined {
  return value;
}

function optionalString(value: unknown, path: string): string | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    return new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined | Error {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'boolean' ? value : new Error(`${path} must be a boolean`);
}

function optionalEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined | Error {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : new Error(`${path} must be one of: ${allowed.join(', ')}`);
}

function optionalColor(value: unknown, path: string): string | undefined | Error {
  const parsed = optionalString(value, path);
  if (parsed instanceof Error || parsed === undefined) return parsed;
  return HEX_COLOR_PATTERN.test(parsed)
    ? parsed
    : new Error(`${path} must be a hex color`);
}

function parseRows(value: unknown): EditableHookRowInput[] | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HOOK_ROWS) {
    return new Error(`rows must contain between 1 and ${MAX_HOOK_ROWS} rows`);
  }
  const rows: EditableHookRowInput[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return new Error(`rows[${index}] must be an object`);
    if (typeof raw.text !== 'string' || !raw.text.trim()) {
      return new Error(`rows[${index}].text must be a non-empty string`);
    }
    const textColor = optionalColor(raw.textColor, `rows[${index}].textColor`);
    const backgroundColor = optionalColor(raw.backgroundColor, `rows[${index}].backgroundColor`);
    const backgroundOpacity = optionalNumber(raw.backgroundOpacity, `rows[${index}].backgroundOpacity`, 0, 1);
    const fontSize = optionalFontSize(raw.fontSize, `rows[${index}].fontSize`);
    const fontWeight = optionalNumber(raw.fontWeight, `rows[${index}].fontWeight`, 100, 900);
    if (textColor instanceof Error) return textColor;
    if (backgroundColor instanceof Error) return backgroundColor;
    if (backgroundOpacity instanceof Error) return backgroundOpacity;
    if (fontSize instanceof Error) return fontSize;
    if (fontWeight instanceof Error) return fontWeight;
    rows.push({
      text: raw.text,
      ...(textColor === undefined ? {} : { textColor }),
      ...(backgroundColor === undefined ? {} : { backgroundColor }),
      ...(backgroundOpacity === undefined ? {} : { backgroundOpacity }),
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(fontWeight === undefined ? {} : { fontWeight }),
    });
  }
  return rows;
}

function parseStyle(value: unknown): EditableHookStylePatch | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return new Error('style must be an object');
  const fontFamily = optionalString(value.fontFamily, 'style.fontFamily');
  const fontSize = optionalFontSize(value.fontSize, 'style.fontSize');
  const fontWeight = optionalNumber(value.fontWeight, 'style.fontWeight', 100, 900);
  const textColor = optionalColor(value.textColor, 'style.textColor');
  const backgroundColor = optionalColor(value.backgroundColor, 'style.backgroundColor');
  const backgroundOpacity = optionalNumber(value.backgroundOpacity, 'style.backgroundOpacity', 0, 1);
  const cornerRadius = optionalNumber(value.cornerRadius, 'style.cornerRadius', 0, 10_000);
  const paddingX = optionalNumber(value.paddingX, 'style.paddingX', 0, 2_000);
  const paddingY = optionalNumber(value.paddingY, 'style.paddingY', 0, 2_000);
  if (fontFamily instanceof Error) return fontFamily;
  if (fontSize instanceof Error) return fontSize;
  if (fontWeight instanceof Error) return fontWeight;
  if (textColor instanceof Error) return textColor;
  if (backgroundColor instanceof Error) return backgroundColor;
  if (backgroundOpacity instanceof Error) return backgroundOpacity;
  if (cornerRadius instanceof Error) return cornerRadius;
  if (paddingX instanceof Error) return paddingX;
  if (paddingY instanceof Error) return paddingY;
  const textAlign = value.textAlign === undefined || value.textAlign === null
    ? undefined
    : value.textAlign;
  if (textAlign !== undefined && !['center', 'left', 'right'].includes(String(textAlign))) {
    return new Error('style.textAlign must be center, left, or right');
  }
  return {
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(fontWeight === undefined ? {} : { fontWeight }),
    ...(textColor === undefined ? {} : { textColor }),
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(backgroundOpacity === undefined ? {} : { backgroundOpacity }),
    ...(cornerRadius === undefined ? {} : { cornerRadius }),
    ...(paddingX === undefined ? {} : { paddingX }),
    ...(paddingY === undefined ? {} : { paddingY }),
    ...(textAlign === undefined ? {} : { textAlign: textAlign as EditableHookStylePatch['textAlign'] }),
  };
}

function parsePlacement(value: unknown): EditableHookPlacementPatch | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return new Error('placement must be an object');
  const x = optionalNumber(value.x, 'placement.x', -100_000, 100_000);
  const y = optionalNumber(value.y, 'placement.y', -100_000, 100_000);
  const width = optionalNumber(value.width, 'placement.width', 1, 100_000);
  const rowHeight = optionalNumber(value.rowHeight, 'placement.rowHeight', 1, 100_000);
  const gap = optionalNumber(value.gap, 'placement.gap', 0, 100_000);
  if (x instanceof Error) return x;
  if (y instanceof Error) return y;
  if (width instanceof Error) return width;
  if (rowHeight instanceof Error) return rowHeight;
  if (gap instanceof Error) return gap;
  return {
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(width === undefined ? {} : { width }),
    ...(rowHeight === undefined ? {} : { rowHeight }),
    ...(gap === undefined ? {} : { gap }),
  };
}

function requestObject(rawArgs: Record<string, unknown>): Record<string, unknown> | Error {
  if (rawArgs.requestJson === undefined) return rawArgs;
  if (typeof rawArgs.requestJson !== 'string' || rawArgs.requestJson.length > 50_000) {
    return new Error('requestJson must be a bounded JSON string');
  }
  try {
    const parsed = JSON.parse(rawArgs.requestJson) as unknown;
    return isRecord(parsed) ? parsed : new Error('requestJson must decode to an object');
  } catch {
    return new Error('requestJson is not valid JSON');
  }
}

function parseRequest(rawArgs: Record<string, unknown>): EditableHookRequest | Error {
  const args = requestObject(rawArgs);
  if (args instanceof Error) return args;
  if (args.action !== 'create' && args.action !== 'update') {
    return new Error('action must be create or update');
  }
  if (typeof args.hookId !== 'string' || !HOOK_ID_PATTERN.test(args.hookId)) {
    return new Error('hookId must start with hook- and contain only letters, numbers, _ or -');
  }
  const preset = args.preset === undefined || args.preset === null
    ? undefined
    : args.preset;
  if (preset !== undefined && !EDITABLE_HOOK_PRESETS.includes(preset as EditableHookPreset)) {
    return new Error(`preset must be one of: ${EDITABLE_HOOK_PRESETS.join(', ')}`);
  }
  const startTime = optionalNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  const duration = optionalNumber(args.duration, 'duration', Number.EPSILON, 60 * 60);
  const rows = parseRows(args.rows);
  const style = parseStyle(args.style);
  const placement = parsePlacement(args.placement);
  if (startTime instanceof Error) return startTime;
  if (duration instanceof Error) return duration;
  if (rows instanceof Error) return rows;
  if (style instanceof Error) return style;
  if (placement instanceof Error) return placement;
  if (args.action === 'create' && rows === undefined) {
    return new Error('rows are required when creating a hook');
  }
  return {
    action: args.action,
    hookId: args.hookId,
    ...(preset === undefined ? {} : { preset: preset as EditableHookPreset }),
    ...(startTime === undefined ? {} : { startTime }),
    ...(duration === undefined ? {} : { duration }),
    ...(rows === undefined ? {} : { rows }),
    ...(style === undefined ? {} : { style }),
    ...(placement === undefined ? {} : { placement }),
  };
}

function parsePixelBox(value: unknown, path: string): EditableHookTextBoxPatch | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return new Error(`${path} must be an object`);
  const x = optionalNumber(value.x, `${path}.x`, -100_000, 100_000);
  const y = optionalNumber(value.y, `${path}.y`, -100_000, 100_000);
  const width = optionalNumber(value.width, `${path}.width`, 1, 100_000);
  const height = optionalNumber(value.height, `${path}.height`, 1, 100_000);
  for (const parsed of [x, y, width, height]) if (parsed instanceof Error) return parsed;
  return {
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  } as EditableHookTextBoxPatch;
}

function parseTextEdits(value: unknown): EditableHookTextEdit[] | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HOOK_ROWS) {
    return new Error(`textEdits must contain between 1 and ${MAX_HOOK_ROWS} edits`);
  }
  const edits: EditableHookTextEdit[] = [];
  for (const [index, raw] of value.entries()) {
    const path = `textEdits[${index}]`;
    if (!isRecord(raw) || !Number.isInteger(raw.rowIndex) || Number(raw.rowIndex) < 0 || Number(raw.rowIndex) >= MAX_HOOK_ROWS) {
      return new Error(`${path}.rowIndex must be an integer between 0 and ${MAX_HOOK_ROWS - 1}`);
    }
    const text = optionalString(raw.text, `${path}.text`);
    const fontFamily = optionalString(raw.fontFamily, `${path}.fontFamily`);
    const fontSize = optionalFontSize(raw.fontSize, `${path}.fontSize`);
    const fontWeight = optionalNumber(raw.fontWeight, `${path}.fontWeight`, 100, 900);
    const fontStyle = optionalEnum(raw.fontStyle, `${path}.fontStyle`, ['normal', 'italic'] as const);
    const textColor = optionalColor(raw.textColor, `${path}.textColor`);
    const textAlign = optionalEnum(raw.textAlign, `${path}.textAlign`, ['center', 'left', 'right'] as const);
    const verticalAlign = optionalEnum(raw.verticalAlign, `${path}.verticalAlign`, ['top', 'middle', 'bottom'] as const);
    const lineHeight = optionalNumber(raw.lineHeight, `${path}.lineHeight`, 0.5, 3);
    const letterSpacing = optionalNumber(raw.letterSpacing, `${path}.letterSpacing`, -10, 50);
    const strokeEnabled = optionalBoolean(raw.strokeEnabled, `${path}.strokeEnabled`);
    const strokeColor = optionalColor(raw.strokeColor, `${path}.strokeColor`);
    const strokeWidth = optionalNumber(raw.strokeWidth, `${path}.strokeWidth`, 0.5, 20);
    const shadowEnabled = optionalBoolean(raw.shadowEnabled, `${path}.shadowEnabled`);
    const shadowColor = optionalColor(raw.shadowColor, `${path}.shadowColor`);
    const shadowOffsetX = optionalNumber(raw.shadowOffsetX, `${path}.shadowOffsetX`, -50, 50);
    const shadowOffsetY = optionalNumber(raw.shadowOffsetY, `${path}.shadowOffsetY`, -50, 50);
    const shadowBlur = optionalNumber(raw.shadowBlur, `${path}.shadowBlur`, 0, 50);
    const box = parsePixelBox(raw.box, `${path}.box`);
    const parsedValues = [
      text, fontFamily, fontSize, fontWeight, fontStyle, textColor, textAlign,
      verticalAlign, lineHeight, letterSpacing, strokeEnabled, strokeColor,
      strokeWidth, shadowEnabled, shadowColor, shadowOffsetX, shadowOffsetY,
      shadowBlur, box,
    ];
    const parseError = parsedValues.find((entry) => entry instanceof Error);
    if (parseError instanceof Error) return parseError;
    if (fontWeight !== undefined && !Number.isInteger(fontWeight)) {
      return new Error(`${path}.fontWeight must be an integer`);
    }
    const edit = {
      rowIndex: Number(raw.rowIndex),
      ...(text === undefined ? {} : { text }),
      ...(fontFamily === undefined ? {} : { fontFamily }),
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(fontWeight === undefined ? {} : { fontWeight }),
      ...(fontStyle === undefined ? {} : { fontStyle }),
      ...(textColor === undefined ? {} : { textColor }),
      ...(textAlign === undefined ? {} : { textAlign }),
      ...(verticalAlign === undefined ? {} : { verticalAlign }),
      ...(lineHeight === undefined ? {} : { lineHeight }),
      ...(letterSpacing === undefined ? {} : { letterSpacing }),
      ...(strokeEnabled === undefined ? {} : { strokeEnabled }),
      ...(strokeColor === undefined ? {} : { strokeColor }),
      ...(strokeWidth === undefined ? {} : { strokeWidth }),
      ...(shadowEnabled === undefined ? {} : { shadowEnabled }),
      ...(shadowColor === undefined ? {} : { shadowColor }),
      ...(shadowOffsetX === undefined ? {} : { shadowOffsetX }),
      ...(shadowOffsetY === undefined ? {} : { shadowOffsetY }),
      ...(shadowBlur === undefined ? {} : { shadowBlur }),
      ...(box === undefined ? {} : { box }),
    } as EditableHookTextEdit;
    if (Object.keys(edit).length === 1) return new Error(`${path} contains no text change`);
    edits.push(edit);
  }
  if (new Set(edits.map((edit) => edit.rowIndex)).size !== edits.length) {
    return new Error('textEdits rowIndex values must be unique');
  }
  return edits;
}

function parseBackgroundEdits(value: unknown): EditableHookBackgroundEdit[] | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HOOK_ROWS) {
    return new Error(`backgroundEdits must contain between 1 and ${MAX_HOOK_ROWS} edits`);
  }
  const edits: EditableHookBackgroundEdit[] = [];
  for (const [index, raw] of value.entries()) {
    const path = `backgroundEdits[${index}]`;
    if (!isRecord(raw) || !Number.isInteger(raw.rowIndex) || Number(raw.rowIndex) < 0 || Number(raw.rowIndex) >= MAX_HOOK_ROWS) {
      return new Error(`${path}.rowIndex must be an integer between 0 and ${MAX_HOOK_ROWS - 1}`);
    }
    const fillColor = optionalColor(raw.fillColor, `${path}.fillColor`);
    const fillOpacity = optionalNumber(raw.fillOpacity, `${path}.fillOpacity`, 0, 1);
    const centerX = optionalNumber(raw.centerX, `${path}.centerX`, -100_000, 100_000);
    const centerY = optionalNumber(raw.centerY, `${path}.centerY`, -100_000, 100_000);
    const width = optionalNumber(raw.width, `${path}.width`, 1, 100_000);
    const height = optionalNumber(raw.height, `${path}.height`, 1, 100_000);
    const cornerRadius = optionalNumber(raw.cornerRadius, `${path}.cornerRadius`, 0, 10_000);
    const strokeEnabled = optionalBoolean(raw.strokeEnabled, `${path}.strokeEnabled`);
    const strokeColor = optionalColor(raw.strokeColor, `${path}.strokeColor`);
    const strokeOpacity = optionalNumber(raw.strokeOpacity, `${path}.strokeOpacity`, 0, 1);
    const strokeWidth = optionalNumber(raw.strokeWidth, `${path}.strokeWidth`, 0, 10_000);
    const strokeAlignment = optionalEnum(
      raw.strokeAlignment,
      `${path}.strokeAlignment`,
      ['center', 'inside', 'outside'] as const,
    );
    const parsedValues = [
      fillColor, fillOpacity, centerX, centerY, width, height, cornerRadius,
      strokeEnabled, strokeColor, strokeOpacity, strokeWidth, strokeAlignment,
    ];
    const parseError = parsedValues.find((entry) => entry instanceof Error);
    if (parseError instanceof Error) return parseError;
    const edit = {
      rowIndex: Number(raw.rowIndex),
      ...(fillColor === undefined ? {} : { fillColor }),
      ...(fillOpacity === undefined ? {} : { fillOpacity }),
      ...(centerX === undefined ? {} : { centerX }),
      ...(centerY === undefined ? {} : { centerY }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(cornerRadius === undefined ? {} : { cornerRadius }),
      ...(strokeEnabled === undefined ? {} : { strokeEnabled }),
      ...(strokeColor === undefined ? {} : { strokeColor }),
      ...(strokeOpacity === undefined ? {} : { strokeOpacity }),
      ...(strokeWidth === undefined ? {} : { strokeWidth }),
      ...(strokeAlignment === undefined ? {} : { strokeAlignment }),
    } as EditableHookBackgroundEdit;
    if (Object.keys(edit).length === 1) return new Error(`${path} contains no background change`);
    edits.push(edit);
  }
  if (new Set(edits.map((edit) => edit.rowIndex)).size !== edits.length) {
    return new Error('backgroundEdits rowIndex values must be unique');
  }
  return edits;
}

function parseRefinementRequest(
  rawArgs: Record<string, unknown>,
): EditableHookRefinementRequest | Error {
  const args = requestObject(rawArgs);
  if (args instanceof Error) return args;
  if (typeof args.hookId !== 'string' || !HOOK_ID_PATTERN.test(args.hookId)) {
    return new Error('hookId must start with hook- and contain only letters, numbers, _ or -');
  }
  const textEdits = parseTextEdits(args.textEdits);
  const backgroundEdits = parseBackgroundEdits(args.backgroundEdits);
  if (textEdits instanceof Error) return textEdits;
  if (backgroundEdits instanceof Error) return backgroundEdits;
  if (textEdits === undefined && backgroundEdits === undefined) {
    return new Error('At least one textEdits or backgroundEdits entry is required');
  }
  return {
    hookId: args.hookId,
    ...(textEdits === undefined ? {} : { textEdits }),
    ...(backgroundEdits === undefined ? {} : { backgroundEdits }),
  };
}

function resolvePlacement(
  preset: EditableHookPreset | undefined,
  patch: EditableHookPlacementPatch | undefined,
  compositionWidth: number,
  compositionHeight: number,
): ResolvedPlacement {
  const relativePreset = PRESET_PLACEMENTS[preset ?? 'stacked-center'];
  return {
    x: relativePreset.x * compositionWidth,
    y: relativePreset.y * compositionHeight,
    width: relativePreset.width * compositionWidth,
    rowHeight: relativePreset.rowHeight * compositionHeight,
    gap: relativePreset.gap * compositionHeight,
    ...patch,
  };
}

function boxesForRows(
  placement: ResolvedPlacement,
  rowCount: number,
  width: number,
  height: number,
): Array<{ height: number; width: number; x: number; y: number }> | Error {
  if (placement.x + placement.width > width * 1.05) {
    return new Error('Hook placement extends beyond the right edge');
  }
  const finalBottom = placement.y
    + rowCount * placement.rowHeight
    + Math.max(0, rowCount - 1) * placement.gap;
  if (finalBottom > height * 1.05) return new Error('Hook placement extends beyond the bottom edge');
  return Array.from({ length: rowCount }, (_unused, index) => ({
    x: placement.x,
    y: placement.y + index * (placement.rowHeight + placement.gap),
    width: placement.width,
    height: placement.rowHeight,
  }));
}

function hookClips(store: TimelineStore, hookId: string): TimelineClip[] {
  const metadata = resolveEditableHookLayerMetadata(store.clips, store.tracks);
  return store.clips.filter((clip) => metadata.get(clip.id)?.id === hookId);
}

function collectExistingRows(store: TimelineStore, hookId: string): ExistingHookRow[] | Error {
  const metadata = resolveEditableHookLayerMetadata(store.clips, store.tracks);
  const rows = new Map<number, { backplateClip?: TimelineClip; textClip?: TimelineClip }>();
  for (const clip of store.clips) {
    const identity = metadata.get(clip.id);
    if (identity?.id !== hookId) continue;
    const row = rows.get(identity.rowIndex) ?? {};
    if (identity.role === 'text') {
      if (!clip.textProperties || row.textClip) {
        return new Error(`Hook ${hookId} has an invalid text row ${identity.rowIndex}`);
      }
      row.textClip = clip;
    } else {
      if (clip.motion?.shape?.primitive !== 'rectangle' || row.backplateClip) {
        return new Error(`Hook ${hookId} has an invalid background row ${identity.rowIndex}`);
      }
      row.backplateClip = clip;
    }
    rows.set(identity.rowIndex, row);
  }
  const indexes = [...rows.keys()].sort((left, right) => left - right);
  if (indexes.length === 0 || indexes.some((rowIndex, index) => rowIndex !== index)) {
    return new Error(`Hook ${hookId} is incomplete or not editable`);
  }
  const resolvedRows: ExistingHookRow[] = [];
  for (const index of indexes) {
    const row = rows.get(index)!;
    if (!row.textClip || !row.backplateClip) {
      return new Error(`Hook ${hookId} is incomplete or not editable`);
    }
    resolvedRows.push({ index, textClip: row.textClip, backplateClip: row.backplateClip });
  }
  return resolvedRows;
}

function persistHookRowIdentity(hookId: string, rows: readonly ExistingHookRow[]): void {
  for (const row of rows) {
    useTimelineStore.getState().updateClip(row.textClip.id, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'text', rowIndex: row.index },
    });
    useTimelineStore.getState().updateClip(row.backplateClip.id, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'background', rowIndex: row.index },
    });
  }
}

function tagCreatedHookRows(
  hookId: string,
  createdRows: Array<{ backplateClipId: string; textClipId: string }>,
  rows: EditableHookRowInput[],
): void {
  const store = useTimelineStore.getState();
  for (const [index, created] of createdRows.entries()) {
    store.updateClip(created.textClipId, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'text', rowIndex: index },
      name: `Hook ${index + 1}: ${rows[index]?.text ?? 'Text'}`,
    });
    store.updateClip(created.backplateClipId, {
      linkedGroupId: hookId,
      editableHook: { id: hookId, role: 'background', rowIndex: index },
      name: `Hook ${index + 1} Background`,
    });
  }
}

async function createHook(
  request: EditableHookRequest,
  store: TimelineStore,
): Promise<ToolResult> {
  if (hookClips(store, request.hookId).length > 0) {
    return failure(`Hook already exists: ${request.hookId}`);
  }
  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const rows = request.rows!;
  const placement = resolvePlacement(
    request.preset,
    request.placement,
    compositionWidth,
    compositionHeight,
  );
  const boxes = boxesForRows(placement, rows.length, compositionWidth, compositionHeight);
  if (boxes instanceof Error) return failure(boxes.message);
  const style = request.style ?? {};
  const defaultFontSize = Math.max(18, Math.min(120, placement.rowHeight * 0.55));
  const styleFontSize = resolveFontSize(style.fontSize);
  const paddingX = resolvePixelMeasure(style.paddingX);
  const paddingY = resolvePixelMeasure(style.paddingY);
  const cornerRadius = resolvePixelMeasure(style.cornerRadius);
  const result = await handleCreateEditableTitleStack({
    ...(request.startTime === undefined ? {} : { startTime: request.startTime }),
    duration: request.duration ?? 4,
    rows: rows.map((row, index) => ({
      text: row.text,
      name: `Hook ${index + 1}`,
      box: boxes[index],
      textStyle: {
        fontFamily: style.fontFamily ?? 'Arial',
        fontSize: resolveFontSize(row.fontSize) ?? styleFontSize ?? defaultFontSize,
        fontWeight: row.fontWeight ?? style.fontWeight ?? 800,
        color: row.textColor ?? style.textColor ?? '#ffffff',
        textAlign: style.textAlign ?? 'center',
        verticalAlign: 'middle',
      },
      backplate: {
        color: row.backgroundColor ?? style.backgroundColor ?? '#000000',
        opacity: row.backgroundOpacity ?? style.backgroundOpacity ?? 0.9,
        paddingX: paddingX ?? Math.max(12, compositionWidth * 0.0125),
        paddingY: paddingY ?? Math.max(6, compositionHeight * 0.0075),
        cornerRadius: cornerRadius ?? Math.max(8, compositionHeight * 0.011),
      },
    })),
  }, store);
  if (!result.success || !isRecord(result.data) || !Array.isArray(result.data.rows)) return result;
  const createdRows = result.data.rows as Array<{ backplateClipId: string; textClipId: string }>;
  tagCreatedHookRows(request.hookId, createdRows, rows);
  return {
    success: true,
    data: {
      action: 'created',
      hookId: request.hookId,
      preset: request.preset ?? 'stacked-center',
      startTime: request.startTime ?? store.playheadPosition,
      duration: request.duration ?? 4,
      rows: createdRows,
      stateRevisionAfter: getTimelineRevision(),
      detail: 'Editable text and native Motion backplates share this hookId for later updates.',
    },
  };
}

function currentTextBox(clip: TimelineClip): { height: number; width: number; x: number; y: number } {
  const props = clip.textProperties!;
  const composition = useMediaStore.getState().getActiveComposition();
  return {
    x: props.boxX ?? 0,
    y: props.boxY ?? 0,
    width: props.boxWidth ?? composition?.width ?? 1920,
    height: props.boxHeight ?? composition?.height ?? 1080,
  };
}

function currentPlatePadding(row: ExistingHookRow): { x: number; y: number } {
  const box = currentTextBox(row.textClip);
  const size = row.backplateClip.motion?.shape?.size;
  return {
    x: Math.max(0, ((size?.w ?? box.width) - box.width) / 2),
    y: Math.max(0, ((size?.h ?? box.height) - box.height) / 2),
  };
}

function validateTimingUpdate(
  rows: ExistingHookRow[],
  startTime: number,
  duration: number,
  store: TimelineStore,
): Error | null {
  const hookClipIds = new Set(rows.flatMap((row) => [row.textClip.id, row.backplateClip.id]));
  const endTime = startTime + duration;
  for (const row of rows) {
    for (const clip of [row.textClip, row.backplateClip]) {
      const track = store.tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) return new Error(`Hook track is locked: ${track.id}`);
      const collision = store.clips.find((candidate) => (
        candidate.trackId === clip.trackId
        && !hookClipIds.has(candidate.id)
        && candidate.startTime < endTime
        && candidate.startTime + candidate.duration > startTime
      ));
      if (collision) return new Error(`Hook timing would overlap clip ${collision.id}`);
    }
  }
  return null;
}

async function updateExistingRows(
  request: EditableHookRequest,
  rows: ExistingHookRow[],
): Promise<ToolResult> {
  const store = useTimelineStore.getState();
  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const nextStartTime = request.startTime ?? rows[0]!.textClip.startTime;
  const nextDuration = request.duration ?? rows[0]!.textClip.duration;
  const timingError = validateTimingUpdate(rows, nextStartTime, nextDuration, store);
  if (timingError) return failure(timingError.message);

  const layoutChanged = request.preset !== undefined || request.placement !== undefined;
  const boxes = layoutChanged
    ? boxesForRows(
        resolvePlacement(
          request.preset,
          request.placement,
          compositionWidth,
          compositionHeight,
        ),
        rows.length,
        compositionWidth,
        compositionHeight,
      )
    : rows.map((row) => currentTextBox(row.textClip));
  if (boxes instanceof Error) return failure(boxes.message);
  const style = request.style ?? {};

  for (const row of rows) {
    const rowPatch = request.rows?.[row.index];
    const textUpdates: Record<string, unknown> = { clipId: row.textClip.id };
    if (rowPatch?.text !== undefined) textUpdates.text = rowPatch.text;
    if (style.fontFamily !== undefined) textUpdates.fontFamily = style.fontFamily;
    if (rowPatch?.fontSize !== undefined || style.fontSize !== undefined) {
      textUpdates.fontSize = resolveFontSize(rowPatch?.fontSize ?? style.fontSize);
    }
    if (rowPatch?.fontWeight !== undefined || style.fontWeight !== undefined) {
      textUpdates.fontWeight = rowPatch?.fontWeight ?? style.fontWeight;
    }
    if (rowPatch?.textColor !== undefined || style.textColor !== undefined) {
      textUpdates.color = rowPatch?.textColor ?? style.textColor;
    }
    if (style.textAlign !== undefined) textUpdates.textAlign = style.textAlign;
    if (Object.keys(textUpdates).length > 1) {
      const textResult = await handleUpdateTextProperties(textUpdates, useTimelineStore.getState());
      if (!textResult.success) return textResult;
    }

    const box = boxes[row.index]!;
    if (layoutChanged) {
      const boxResult = await handleSetTextBox({
        clipId: row.textClip.id,
        enabled: true,
        ...box,
      }, useTimelineStore.getState());
      if (!boxResult.success) return boxResult;
    }

    const oldPadding = currentPlatePadding(row);
    const paddingX = resolvePixelMeasure(style.paddingX) ?? oldPadding.x;
    const paddingY = resolvePixelMeasure(style.paddingY) ?? oldPadding.y;
    if (
      layoutChanged
      || style.paddingX !== undefined
      || style.paddingY !== undefined
      || style.cornerRadius !== undefined
    ) {
      const shapeX = box.x + box.width / 2 - compositionWidth / 2;
      const shapeY = box.y + box.height / 2 - compositionHeight / 2;
      const updates = [
        { path: 'position.x', value: shapeX },
        { path: 'position.y', value: shapeY },
        { path: 'shape.size.w', value: box.width + paddingX * 2 },
        { path: 'shape.size.h', value: box.height + paddingY * 2 },
      ];
      if (style.cornerRadius !== undefined) {
        updates.push({
          path: 'shape.cornerRadius',
          value: resolvePixelMeasure(style.cornerRadius)!,
        });
      }
      const motionResult = await handleUpdateMotionProperties({
        clipId: row.backplateClip.id,
        updates,
      }, useTimelineStore.getState());
      if (!motionResult.success) return motionResult;
    }

    const backgroundColor = rowPatch?.backgroundColor ?? style.backgroundColor;
    const backgroundOpacity = rowPatch?.backgroundOpacity ?? style.backgroundOpacity;
    if (backgroundColor !== undefined || backgroundOpacity !== undefined) {
      const appearanceResult = await handleUpdateMotionAppearances({
        clipId: row.backplateClip.id,
        fill: {
          ...(backgroundColor === undefined ? {} : { color: backgroundColor }),
          ...(backgroundOpacity === undefined ? {} : { opacity: backgroundOpacity }),
        },
      }, useTimelineStore.getState());
      if (!appearanceResult.success) return appearanceResult;
    }
  }

  for (const row of rows) {
    const text = request.rows?.[row.index]?.text ?? row.textClip.textProperties?.text ?? 'Text';
    useTimelineStore.getState().updateClip(row.textClip.id, {
      startTime: nextStartTime,
      duration: nextDuration,
      outPoint: row.textClip.inPoint + nextDuration,
      name: `Hook ${row.index + 1}: ${text}`,
    });
    useTimelineStore.getState().updateClip(row.backplateClip.id, {
      startTime: nextStartTime,
      duration: nextDuration,
      outPoint: row.backplateClip.inPoint + nextDuration,
    });
  }

  return {
    success: true,
    data: {
      action: 'updated',
      hookId: request.hookId,
      startTime: nextStartTime,
      duration: nextDuration,
      rows: rows.map((row) => ({
        index: row.index,
        textClipId: row.textClip.id,
        backplateClipId: row.backplateClip.id,
      })),
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}

async function replaceHookRows(
  request: EditableHookRequest,
  existingRows: ExistingHookRow[],
): Promise<ToolResult> {
  const originalIds = existingRows.flatMap((row) => [row.textClip.id, row.backplateClip.id]);
  const replacementId = `${request.hookId}-replacement`;
  const createResult = await createHook({
    ...request,
    action: 'create',
    hookId: replacementId,
    startTime: request.startTime ?? existingRows[0]!.textClip.startTime,
    duration: request.duration ?? existingRows[0]!.textClip.duration,
  }, useTimelineStore.getState());
  if (!createResult.success) return createResult;

  const replacementClips = hookClips(useTimelineStore.getState(), replacementId);
  const deleteResult = useTimelineStore.getState().applyTimelineEditOperation({
    id: `replace-editable-hook:${request.hookId}`,
    type: 'delete-clips',
    clipIds: originalIds,
    includeLinked: false,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: replace editable hook rows',
  });
  if (!deleteResult.success) return failure('Could not replace the previous hook rows');
  for (const clip of replacementClips) {
    useTimelineStore.getState().updateClip(clip.id, {
      linkedGroupId: request.hookId,
      editableHook: clip.editableHook
        ? { ...clip.editableHook, id: request.hookId }
        : undefined,
    });
  }
  const finalRows = collectExistingRows(useTimelineStore.getState(), request.hookId);
  if (finalRows instanceof Error) return failure(finalRows.message);
  return {
    success: true,
    data: {
      action: 'replaced',
      hookId: request.hookId,
      rows: finalRows.map((row) => ({
        index: row.index,
        textClipId: row.textClip.id,
        backplateClipId: row.backplateClip.id,
      })),
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}

export async function handleManageEditableHook(
  rawArgs: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const request = parseRequest(rawArgs);
  if (request instanceof Error) return failure(request.message);
  if (request.action === 'create') return createHook(request, timelineStore);

  const existingRows = collectExistingRows(timelineStore, request.hookId);
  if (existingRows instanceof Error) return failure(existingRows.message);
  persistHookRowIdentity(request.hookId, existingRows);
  if (request.rows !== undefined && request.rows.length !== existingRows.length) {
    return replaceHookRows(request, existingRows);
  }
  return updateExistingRows(request, existingRows);
}

export async function handleRefineEditableHook(
  rawArgs: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const request = parseRefinementRequest(rawArgs);
  if (request instanceof Error) return failure(request.message);
  const rows = collectExistingRows(timelineStore, request.hookId);
  if (rows instanceof Error) return failure(rows.message);
  persistHookRowIdentity(request.hookId, rows);
  const composition = useMediaStore.getState().getActiveComposition();
  const compositionWidth = composition?.width ?? 1920;
  const compositionHeight = composition?.height ?? 1080;
  const targetedRows = new Set([
    ...(request.textEdits?.map((edit) => edit.rowIndex) ?? []),
    ...(request.backgroundEdits?.map((edit) => edit.rowIndex) ?? []),
  ]);
  for (const rowIndex of targetedRows) {
    const row = rows[rowIndex];
    if (!row) return failure(`Hook ${request.hookId} has no row ${rowIndex}`);
    for (const clip of [row.textClip, row.backplateClip]) {
      const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === clip.trackId);
      if (track?.locked) return failure(`Hook track is locked: ${track.id}`);
    }
  }
  for (const edit of request.textEdits ?? []) {
    if (edit.box?.width !== undefined && edit.box.width < 24) {
      return failure(`textEdits row ${edit.rowIndex} box width is below 24 pixels`);
    }
    if (edit.box?.height !== undefined && edit.box.height < 24) {
      return failure(`textEdits row ${edit.rowIndex} box height is below 24 pixels`);
    }
  }
  const pending: Array<{ label: string; run: () => Promise<ToolResult> }> = [];

  for (const edit of request.textEdits ?? []) {
    const row = rows[edit.rowIndex];
    if (!row) return failure(`Hook ${request.hookId} has no text row ${edit.rowIndex}`);
    const textArgs: Record<string, unknown> = { clipId: row.textClip.id };
    for (const key of [
      'text', 'fontFamily', 'fontStyle', 'fontWeight', 'textAlign', 'verticalAlign',
      'lineHeight', 'letterSpacing', 'strokeEnabled', 'strokeColor', 'strokeWidth',
      'shadowEnabled', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur',
    ] as const) {
      if (edit[key] !== undefined) textArgs[key] = edit[key];
    }
    if (edit.fontSize !== undefined) {
      textArgs.fontSize = resolveFontSize(edit.fontSize);
    }
    if (edit.textColor !== undefined) textArgs.color = edit.textColor;
    if (Object.keys(textArgs).length > 1) {
      pending.push({
        label: `text row ${edit.rowIndex}`,
        run: () => handleUpdateTextProperties(textArgs, useTimelineStore.getState()),
      });
    }
    const box = edit.box;
    if (box && Object.keys(box).length > 0) {
      pending.push({
        label: `text box row ${edit.rowIndex}`,
        run: () => handleSetTextBox({
          clipId: row.textClip.id,
          enabled: true,
          ...(box.x === undefined ? {} : { x: box.x }),
          ...(box.y === undefined ? {} : { y: box.y }),
          ...(box.width === undefined ? {} : { width: box.width }),
          ...(box.height === undefined ? {} : { height: box.height }),
        }, useTimelineStore.getState()),
      });
    }
  }

  for (const edit of request.backgroundEdits ?? []) {
    const row = rows[edit.rowIndex];
    if (!row) return failure(`Hook ${request.hookId} has no background row ${edit.rowIndex}`);
    const updates: Array<{ path: string; value: number }> = [];
    if (edit.centerX !== undefined) {
      updates.push({ path: 'position.x', value: edit.centerX - compositionWidth / 2 });
    }
    if (edit.centerY !== undefined) {
      updates.push({ path: 'position.y', value: edit.centerY - compositionHeight / 2 });
    }
    if (edit.width !== undefined) {
      updates.push({ path: 'shape.size.w', value: edit.width });
    }
    if (edit.height !== undefined) {
      updates.push({ path: 'shape.size.h', value: edit.height });
    }
    if (edit.cornerRadius !== undefined) {
      updates.push({
        path: 'shape.cornerRadius',
        value: resolvePixelMeasure(edit.cornerRadius)!,
      });
    }
    if (updates.length > 0) {
      pending.push({
        label: `background geometry row ${edit.rowIndex}`,
        run: () => handleUpdateMotionProperties({
          clipId: row.backplateClip.id,
          updates,
        }, useTimelineStore.getState()),
      });
    }
    const hasFill = edit.fillColor !== undefined || edit.fillOpacity !== undefined;
    const hasStroke = edit.strokeEnabled !== undefined
      || edit.strokeColor !== undefined
      || edit.strokeOpacity !== undefined
      || edit.strokeWidth !== undefined
      || edit.strokeAlignment !== undefined;
    if (hasFill || hasStroke) {
      pending.push({
        label: `background appearance row ${edit.rowIndex}`,
        run: () => handleUpdateMotionAppearances({
          clipId: row.backplateClip.id,
          ...(hasFill ? {
            fill: {
              ...(edit.fillColor === undefined ? {} : { color: edit.fillColor }),
              ...(edit.fillOpacity === undefined ? {} : { opacity: edit.fillOpacity }),
            },
          } : {}),
          ...(hasStroke ? {
            stroke: {
              ...(edit.strokeEnabled === undefined ? {} : { enabled: edit.strokeEnabled }),
              ...(edit.strokeColor === undefined ? {} : { color: edit.strokeColor }),
              ...(edit.strokeOpacity === undefined ? {} : { opacity: edit.strokeOpacity }),
              ...(edit.strokeWidth === undefined ? {} : { width: edit.strokeWidth }),
              ...(edit.strokeAlignment === undefined ? {} : { alignment: edit.strokeAlignment }),
            },
          } : {}),
        }, useTimelineStore.getState()),
      });
    }
  }

  for (const entry of pending) {
    const result = await entry.run();
    if (!result.success) {
      return failure(`${entry.label} failed: ${result.error ?? 'unknown error'}`);
    }
  }
  return {
    success: true,
    data: {
      action: 'refined',
      hookId: request.hookId,
      textRows: request.textEdits?.map((edit) => edit.rowIndex) ?? [],
      backgroundRows: request.backgroundEdits?.map((edit) => edit.rowIndex) ?? [],
      stateRevisionAfter: getTimelineRevision(),
    },
  };
}
