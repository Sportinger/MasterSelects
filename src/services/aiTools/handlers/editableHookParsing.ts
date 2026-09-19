import type { TimelineClip } from '../../../types/timeline';
import type { ToolResult } from '../types';
import {
  parseEditableHookMotion,
  type EditableHookMotionSpec,
} from './editableHookMotion';

export const EDITABLE_HOOK_PRESETS = [
  'top-banner',
  'stacked-center',
  'center-card',
  'lower-third',
  'bottom-banner',
] as const;

export type EditableHookPreset = typeof EDITABLE_HOOK_PRESETS[number];

export interface EditableHookRowInput {
  backgroundColor?: string;
  backgroundOpacity?: number;
  fontSize?: number;
  fontWeight?: number;
  text: string;
  textColor?: string;
}

export interface EditableHookStylePatch {
  backgroundColor?: string;
  backgroundOpacity?: number;
  cornerRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  paddingX?: number;
  paddingY?: number;
  textAlign?: 'center';
  textColor?: string;
}

export interface EditableHookPlacementPatch {
  gap?: number;
  rowHeight?: number;
  width?: number;
  x?: number;
  y?: number;
}

export interface EditableHookRequest {
  action: 'create' | 'update';
  duration?: number;
  hookId: string;
  motion?: EditableHookMotionSpec;
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

export interface EditableHookTextEdit {
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
  textAlign?: 'center';
  textColor?: string;
  verticalAlign?: 'middle';
}

export interface EditableHookBackgroundEdit {
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

export interface EditableHookRefinementRequest {
  backgroundEdits?: EditableHookBackgroundEdit[];
  hookId: string;
  textEdits?: EditableHookTextEdit[];
}

export interface ResolvedPlacement {
  gap: number;
  rowHeight: number;
  width: number;
  x: number;
  y: number;
}

export interface ExistingHookRow {
  backplateClip: TimelineClip;
  index: number;
  textClip: TimelineClip;
}

const HOOK_ID_PATTERN = /^hook-[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const MAX_HOOK_ROWS = 4;

export const PRESET_PLACEMENTS: Record<EditableHookPreset, ResolvedPlacement> = {
  'top-banner': { x: 0.08, y: 0.06, width: 0.84, rowHeight: 0.085, gap: 0 },
  'stacked-center': { x: 0.12, y: 0.18, width: 0.76, rowHeight: 0.1, gap: 0 },
  'center-card': { x: 0.14, y: 0.36, width: 0.72, rowHeight: 0.12, gap: 0 },
  'lower-third': { x: 0.06, y: 0.66, width: 0.72, rowHeight: 0.09, gap: 0 },
  'bottom-banner': { x: 0.08, y: 0.76, width: 0.84, rowHeight: 0.09, gap: 0 },
};

export function failure(error: string): ToolResult {
  return { success: false, error };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function resolveFontSize(value: number | undefined): number | undefined {
  return value;
}

export function resolvePixelMeasure(value: number | undefined): number | undefined {
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
  const fontFamily = typeof value.fontFamily === 'string' && value.fontFamily.trim()
    ? value.fontFamily.trim()
    : undefined;
  const fontSize = optionalFontSize(value.fontSize, 'style.fontSize');
  const fontWeight = optionalNumber(value.fontWeight, 'style.fontWeight', 100, 900);
  const textColor = optionalColor(value.textColor, 'style.textColor');
  const backgroundColor = optionalColor(value.backgroundColor, 'style.backgroundColor');
  const backgroundOpacity = optionalNumber(value.backgroundOpacity, 'style.backgroundOpacity', 0, 1);
  const cornerRadius = optionalNumber(value.cornerRadius, 'style.cornerRadius', 0, 10_000);
  const paddingX = optionalNumber(value.paddingX, 'style.paddingX', 0, 2_000);
  const paddingY = optionalNumber(value.paddingY, 'style.paddingY', 0, 2_000);
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
  if (textAlign !== undefined && textAlign !== 'center') {
    return new Error('style.textAlign must be center');
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

export function parseRequest(rawArgs: Record<string, unknown>): EditableHookRequest | Error {
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
  const motion = parseEditableHookMotion(args.motion, duration instanceof Error ? 4 : duration ?? 4);
  if (startTime instanceof Error) return startTime;
  if (duration instanceof Error) return duration;
  if (rows instanceof Error) return rows;
  if (style instanceof Error) return style;
  if (placement instanceof Error) return placement;
  if (motion instanceof Error) return motion;
  if (args.action === 'create' && rows === undefined) {
    return new Error('rows are required when creating a hook');
  }
  if (args.action === 'update' && motion !== undefined) {
    return new Error('motion can only be authored when creating a hook');
  }
  return {
    action: args.action,
    hookId: args.hookId,
    ...(preset === undefined ? {} : { preset: preset as EditableHookPreset }),
    ...(startTime === undefined ? {} : { startTime }),
    ...(duration === undefined ? {} : { duration }),
    ...(motion === undefined ? {} : { motion }),
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
    const textAlign = optionalEnum(raw.textAlign, `${path}.textAlign`, ['center'] as const);
    const verticalAlign = optionalEnum(raw.verticalAlign, `${path}.verticalAlign`, ['middle'] as const);
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

export function parseRefinementRequest(
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
