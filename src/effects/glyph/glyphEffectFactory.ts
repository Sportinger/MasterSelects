// The shared glyph-mosaic engine: every Text & Glyph look (plus Stitch Poster and Contour Type) is one
// call of createGlyphEffect. The runtime is the editable graph in
// src/services/operators/asciiEffectGraph.ts (createDefaultGlyphGraph); shader.wgsl is its WGSL twin.
// Cell geometry and the Speed clock: glyphGrid.ts.
import { ASCII_RAMP_LABELS, ASCII_RAMP_PRESETS, asciiRampWarnings, resolveAsciiRamp, type AsciiRampPreset } from '../_shared/asciiRamps';
import { planGlyphAtlas } from '../_shared/glyphAtlas';
import type { EffectCategory, EffectDefinition, EffectParam, EffectPreset } from '../types';
import glyphInclude from '../_shared/glyph.wgsl?raw';
import familyShader from './shader.wgsl?raw';
import { FEEDBACK_PARAMETERS } from '../_shared/feedbackParameters';
import { GLYPH_FONT_OPTIONS } from '../_shared/glyphFonts';
import { GLYPH_MIN_CELL_PIXELS, GLYPH_NO_TRAVEL, GLYPH_SPEED_TRAVEL, glyphCellPixels, glyphCellWarnings } from './glyphGrid';

/** Background of new instances: how much of the picture fills the cells behind the characters. */
export const GLYPH_DEFAULT_BACKGROUND = 0.3;

/** Shared colour controls a look can ignore because it draws in its own palette. */
export type GlyphColorControl = 'colorMode' | 'colorA' | 'colorB';
const COLOR_CONTROL_LABELS: Record<GlyphColorControl, string> = { colorMode: 'Color Source', colorA: 'Dark', colorB: 'Light' };

export interface GlyphEffectOptions {
  id: string;
  name: string;
  entryPoint: string;
  animated?: boolean;
  feedback?: boolean;
  variant?: number;
  defaultRamp?: string;
  defaultCellSize?: number;
  /** Background of new instances (0 = the look's own dark ground, 1 = the picture fills each cell). */
  defaultBackground?: number;
  /** Shared colour controls this look never reads: hidden in the card, kept in saved projects. */
  ignoresColors?: readonly GlyphColorControl[];
  params?: Record<string, EffectParam>;
  presets?: readonly EffectPreset[];
  category?: EffectCategory;
}

const FONT_OPTIONS = GLYPH_FONT_OPTIONS;

function parseColor(value: unknown, fallback: string): [number, number, number, number] {
  const hex = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The font weight an atlas is drawn with: the nearest of the nine CSS weights, so no value builds an atlas of its own. */
export function atlasWeight(value: unknown): number {
  return Math.min(900, Math.max(100, Math.round(numeric(value, 600) / 100) * 100));
}

export function createGlyphEffect(options: GlyphEffectOptions): EffectDefinition {
  const defaultRamp = options.defaultRamp ?? 'standard';
  const defaultCellSize = options.defaultCellSize ?? 14;
  const moving = Boolean(options.animated || options.feedback);
  const rawParams: Record<string, EffectParam> = {
    cellSize: {
      type: 'number', label: 'Cell Size', default: defaultCellSize, min: 4, max: 72, step: 1, animatable: true, group: 'Grid',
      unit: ' px', renderMin: GLYPH_MIN_CELL_PIXELS,
    },
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
    // New instances keep part of the picture behind the characters; instances saved before it existed
    // render the dark ground (0). A node setup saved before it existed does not read it (graphOnly).
    background: {
      type: 'number', label: 'Background', default: options.defaultBackground ?? GLYPH_DEFAULT_BACKGROUND, legacyDefault: 0,
      min: 0, max: 1, step: 0.01, animatable: true, group: 'Style', renderMin: 0, renderMax: 1, graphOnly: true,
    },
    rampPreset: {
      type: 'select', label: 'Ramp', default: defaultRamp, group: 'Glyphs',
      options: (Object.keys(ASCII_RAMP_PRESETS) as AsciiRampPreset[]).map((value) => ({ value, label: ASCII_RAMP_LABELS[value] })),
    },
    customRamp: { type: 'text', label: 'Custom Ramp', default: '', group: 'Glyphs' },
    fontFamily: { type: 'select', label: 'Font', default: FONT_OPTIONS[0].value, options: FONT_OPTIONS, group: 'Glyphs' },
    // Not keyframeable: every weight is its own glyph atlas (atlasWeight keeps them to the nine font weights).
    fontWeight: { type: 'number', label: 'Weight', default: 600, min: 200, max: 900, step: 100, group: 'Glyphs', animatable: false },
    invert: { type: 'boolean', label: 'Invert Ramp', default: false, group: 'Style' },
    colorMode: {
      type: 'select', label: 'Color Source', default: 'source', group: 'Color',
      options: [{ value: 'source', label: 'Source' }, { value: 'duotone', label: 'Duotone' }],
    },
    colorA: { type: 'color', label: 'Dark', default: '#081018', group: 'Color' },
    colorB: { type: 'color', label: 'Light', default: '#e8fff5', group: 'Color' },
    ...(options.animated ? {
      // Keyframeable: a keyed ramp moves by the distance travelled (integratedAs), not Speed × time.
      speed: {
        type: 'number' as const, label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Motion',
        integratedAs: GLYPH_SPEED_TRAVEL,
      },
    } : {}),
    ...(options.feedback ? {
      ...FEEDBACK_PARAMETERS,
      reset: { type: 'boolean' as const, label: 'Reset Trail', default: false, group: 'Motion' },
    } : {}),
    ...options.params,
  };
  for (const key of options.ignoresColors ?? []) {
    rawParams[key] = { ...rawParams[key], deprecated: `${options.name} draws in its own colours: ${COLOR_CONTROL_LABELS[key]} is ignored.` };
  }
  const params = Object.fromEntries(
    Object.entries(rawParams).map(([name, param]) => [
      name,
      param.type === 'number' && param.animatable === undefined
        ? { ...param, animatable: true }
        : param,
    ]),
  );

  const rampFor = (values: Record<string, number | boolean | string>) => (
    resolveAsciiRamp(String(values.rampPreset ?? defaultRamp), String(values.customRamp ?? ''))
  );

  return {
    id: options.id,
    name: options.name,
    category: options.category ?? 'glyph',
    shader: `${glyphInclude}\n${familyShader}`,
    entryPoint: options.entryPoint,
    uniformSize: 96,
    params,
    usesFeedback: options.feedback,
    // Timeline clock: the looks move with the playhead and hold still while paused, so a paused
    // frame is never re-rendered; the docs still show them as loops.
    requiresContinuousRender: false,
    ...(moving ? { timelineAnimated: true } : {}),
    paramWarnings: (values, width, height) => [
      ...glyphCellWarnings(values, width, height, defaultCellSize),
      ...asciiRampWarnings(values.rampPreset ?? defaultRamp, values.customRamp),
    ],
    ...(options.presets ? { presets: options.presets } : {}),
    glyphAtlas: (values) => ({
      fontFamily: String(values.fontFamily ?? FONT_OPTIONS[0].value),
      fontWeight: atlasWeight(values.fontWeight),
      charset: rampFor(values),
      cellSize: 64,
    }),
    packUniforms: (values, width, height, timelineTimeSeconds = 0) => {
      const ramp = rampFor(values);
      const atlas = planGlyphAtlas({
        fontFamily: String(values.fontFamily ?? FONT_OPTIONS[0].value),
        fontWeight: atlasWeight(values.fontWeight),
        charset: ramp,
        cellSize: 64,
      });
      const colorA = parseColor(values.colorA, '#081018');
      const colorB = parseColor(values.colorB, '#e8fff5');
      return new Float32Array([
        width, height,
        glyphCellPixels(numeric(values.cellSize, defaultCellSize), width, height),
        numeric(values.amount, 1),
        Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0,
        numeric(values.speed, 0),
        atlas.glyphs.length,
        atlas.columns,
        atlas.rows,
        options.variant ?? 0,
        values.invert === true ? 1 : 0,
        values.colorMode === 'duotone' ? 1 : 0,
        ...colorA,
        ...colorB,
        Math.min(Math.max(numeric(values.background, 0), 0), 1),
        numeric(values[GLYPH_SPEED_TRAVEL], GLYPH_NO_TRAVEL),
        0, 0,
      ]);
    },
  };
}
