import { resolveAsciiRamp } from '../_shared/asciiRamps';
import { planGlyphAtlas } from '../_shared/glyphAtlas';
import type { EffectCategory, EffectDefinition, EffectParam } from '../types';
import glyphInclude from '../_shared/glyph.wgsl?raw';
import familyShader from './shader.wgsl?raw';
import { FEEDBACK_PARAMETERS } from '../_shared/feedbackParameters';

interface GlyphEffectOptions {
  id: string;
  name: string;
  entryPoint: string;
  animated?: boolean;
  feedback?: boolean;
  variant?: number;
  defaultRamp?: string;
  defaultCellSize?: number;
  params?: Record<string, EffectParam>;
  category?: EffectCategory;
}

const FONT_OPTIONS = [
  { value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', label: 'Monospace' },
  { value: 'Georgia, serif', label: 'Serif' },
  { value: 'system-ui, sans-serif', label: 'Sans Serif' },
];

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

export function createGlyphEffect(options: GlyphEffectOptions): EffectDefinition {
  const defaultRamp = options.defaultRamp ?? 'standard';
  const defaultCellSize = options.defaultCellSize ?? 14;
  const rawParams: Record<string, EffectParam> = {
    cellSize: { type: 'number', label: 'Cell Size', default: defaultCellSize, min: 4, max: 72, step: 1, animatable: true, group: 'Grid' },
    amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
    rampPreset: {
      type: 'select', label: 'Ramp', default: defaultRamp, group: 'Glyphs',
      options: ['standard', 'detailed', 'blocks', 'binary', 'numeric', 'symbols'].map((value) => ({ value, label: value })),
    },
    customRamp: { type: 'text', label: 'Custom Ramp', default: '', group: 'Glyphs' },
    fontFamily: { type: 'select', label: 'Font', default: FONT_OPTIONS[0].value, options: FONT_OPTIONS, group: 'Glyphs' },
    fontWeight: { type: 'number', label: 'Weight', default: 600, min: 200, max: 900, step: 100, group: 'Glyphs' },
    invert: { type: 'boolean', label: 'Invert Ramp', default: false, group: 'Style' },
    colorMode: {
      type: 'select', label: 'Color Source', default: 'source', group: 'Color',
      options: [{ value: 'source', label: 'Source' }, { value: 'duotone', label: 'Duotone' }],
    },
    colorA: { type: 'color', label: 'Dark', default: '#081018', group: 'Color' },
    colorB: { type: 'color', label: 'Light', default: '#e8fff5', group: 'Color' },
    ...(options.animated ? {
      speed: { type: 'number' as const, label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Motion' },
    } : {}),
    ...(options.feedback ? {
      ...FEEDBACK_PARAMETERS,
      reset: { type: 'boolean' as const, label: 'Reset Trail', default: false, group: 'Motion' },
    } : {}),
    ...options.params,
  };
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
    uniformSize: 80,
    params,
    usesFeedback: options.feedback,
    requiresContinuousRender: options.animated || options.feedback,
    glyphAtlas: (values) => ({
      fontFamily: String(values.fontFamily ?? FONT_OPTIONS[0].value),
      fontWeight: numeric(values.fontWeight, 600),
      charset: rampFor(values),
      cellSize: 64,
    }),
    packUniforms: (values, width, height, timelineTimeSeconds = 0) => {
      const ramp = rampFor(values);
      const atlas = planGlyphAtlas({
        fontFamily: String(values.fontFamily ?? FONT_OPTIONS[0].value),
        fontWeight: numeric(values.fontWeight, 600),
        charset: ramp,
        cellSize: 64,
      });
      const colorA = parseColor(values.colorA, '#081018');
      const colorB = parseColor(values.colorB, '#e8fff5');
      return new Float32Array([
        width, height,
        numeric(values.cellSize, defaultCellSize),
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
      ]);
    },
  };
}
