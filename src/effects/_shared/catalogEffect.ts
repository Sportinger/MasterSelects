import type {
  EffectCategory,
  EffectDefinition,
  EffectParam,
  EffectPreset,
} from '../types';
import { colorToRgba } from './catalogColor';

type Primitive = number | boolean | string;

export interface CatalogEffectOptions {
  id: string;
  name: string;
  category: EffectCategory;
  shader: string;
  entryPoint: string;
  params?: Record<string, EffectParam>;
  /** The look moves with the timeline (Speed). Every catalog look renders through its node graph, which reads
   * the timeline time (image.timeline-time): it holds still while paused, so it never re-renders on the wall clock. */
  animated?: boolean;
  variantMap?: Record<string, number>;
  /** Shared base parameters this effect never reads, with the reason tools return; kept hidden so saved values still load. */
  retired?: Record<string, string>;
  /** Notes for values the recipe clamps or cannot show (see FullscreenEffectDefinition.paramWarnings). */
  paramWarnings?: (params: Record<string, number | boolean | string>, width?: number, height?: number) => string[];
  /** Why the effect is still experimental (FullscreenEffectDefinition.experimental). */
  experimental?: string;
  /** Named starting points picked in the effect card (EffectPreset). */
  presets?: readonly EffectPreset[];
  /** Scale counts pixels of a 1080p frame and renders at least one output pixel (patternReferenceFrame.ts):
   * the floor its recipe clamps Scale to first. A frame too small for one pixel gets a card note. */
  scaleFloor?: number;
  /** Parameter ids the card shows last, in this order (Halftone: Ink, Paper, then Amount). */
  cardEnd?: readonly string[];
  /** A number parameter of the look's own that the shader twin reads from the variant slot (Dithering's Levels). */
  variantParam?: string;
  /** A number parameter of the look's own that the shader twin reads from the Angle slot, for a look without Angle
   * (Riso Glow's Glow). */
  angleSlotParam?: string;
}
/** Runtime-only distance a keyframed Speed has travelled (EffectParam.integratedAs); never stored. */
export const CATALOG_SPEED_TRAVEL = 'speedTravel';

const BASE_PARAMS: Record<string, EffectParam> = {
  scale: {
    type: 'number', label: 'Scale', default: 14, min: 2, max: 80, step: 1,
    animatable: true, group: 'Pattern',
  },
  amount: {
    // 'Mix', not 'Style': the card's Style menu switches the look itself.
    type: 'number', label: 'Amount', default: 0.75, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Mix',
  },
  angle: {
    type: 'number', label: 'Angle', default: 0, min: -180, max: 180, step: 1,
    animatable: true, group: 'Pattern',
  },
  colorA: { type: 'color', label: 'Ink', default: '#111827', group: 'Color' },
  colorB: { type: 'color', label: 'Paper', default: '#f8fafc', group: 'Color' },
};

type BaseParam = 'scale' | 'angle' | 'colorA' | 'colorB';

/** A shared base parameter with a look's own additions (a unit, a reported render limit). */
export function catalogBaseParam(key: BaseParam | 'amount', overrides: Partial<EffectParam>): EffectParam {
  return { ...BASE_PARAMS[key], ...overrides } as EffectParam;
}

const BASE_PARAM_NAMES: Record<BaseParam, string> = { scale: 'scale', angle: 'angle', colorA: 'ink color', colorB: 'paper color' };

/**
 * `retired` entries for shared base parameters a look's recipe never reads: the card hides them,
 * tools say the value is ignored, and saved values still load (a style switch keeps them).
 * tests/unit/effectControlsRead.test.ts fails when a shown control is not read.
 */
export function ignoredBaseParams(name: string, keys: readonly BaseParam[]): Record<string, string> {
  return Object.fromEntries(keys.map(key => [key, `${name} has no ${BASE_PARAM_NAMES[key]}; the value is ignored.`]));
}

/** The note for a Scale (in 1080p pixels) that is thinner than one pixel of a small frame: it renders one pixel. */
export function thinScaleNotes(label: string, floor: number, params: Record<string, Primitive>, width = 1920, height = 1080,
  options: { belowFloor?: boolean } = {}): string[] {
  const raw = typeof params.scale === 'number' && Number.isFinite(params.scale) ? params.scale : floor;
  const scale = Math.max(raw, floor), format = (value: number) => Number(value.toPrecision(4));
  // The graph's clamp (`safe-scale`) lifts a smaller value (keyframe overshoot, tool calls, node drivers) to the floor:
  // say so, unless the parameter's renderMin already reports it (paramRangeNotes).
  const below = options.belowFloor !== false && raw < floor ? [`${label} ${format(raw)} px is below the rendered minimum (${format(floor)} px) and renders as ${format(floor)} px.`] : [];
  const shortSide = Math.min(width, height);
  if (!(shortSide > 0) || scale * shortSide / 1080 >= 1) return below;
  return [...below, `${label} ${format(scale)} px is thinner than one pixel on this ${width}×${height} frame; it renders 1 pixel.`];
}

function numberParam(params: Record<string, Primitive>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createCatalogEffect(options: CatalogEffectOptions): EffectDefinition {
  const merged = Object.entries({ ...BASE_PARAMS, ...options.params }), end = options.cardEnd ?? [];
  const params = Object.fromEntries(
    [...merged.filter(([name]) => !end.includes(name)), ...end.flatMap(name => merged.filter(([key]) => key === name))].map(([name, param]) => {
      const animatable = param.type === 'number' && param.animatable === undefined ? { ...param, animatable: true } : param;
      return [name, options.retired?.[name] ? { ...animatable, deprecated: options.retired[name] } : animatable];
    }),
  );
  if (options.animated && !params.speed) {
    params.speed = {
      type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05,
      animatable: true, group: 'Motion',
    };
  }
  // A keyframed Speed moves by the distance it has travelled (the area under its curve), not Speed × time,
  // so a ramp never makes the pattern jump: the graph compiler lowers Time × Speed to that distance.
  if (options.animated && params.speed?.type === 'number' && !params.speed.deprecated) {
    params.speed = { ...params.speed, integratedAs: CATALOG_SPEED_TRAVEL };
  }

  return {
    id: options.id,
    name: options.name,
    category: options.category,
    shader: options.shader,
    entryPoint: options.entryPoint,
    uniformSize: 64,
    params,
    // Timeline clock: the picture moves with the playhead and holds still while paused (no continuous rendering).
    requiresContinuousRender: false,
    ...(options.animated ? { timelineAnimated: true } : {}),
    ...(options.presets ? { presets: options.presets } : {}),
    ...(options.paramWarnings || options.scaleFloor !== undefined ? { paramWarnings: (values: Record<string, Primitive>, width?: number, height?: number) => [
      ...(options.paramWarnings?.(values, width, height) ?? []),
      ...(options.scaleFloor !== undefined && !params.scale?.deprecated ? thinScaleNotes(params.scale?.label ?? 'Scale', options.scaleFloor, values, width, height,
        { belowFloor: !(params.scale?.type === 'number' && params.scale.renderMin !== undefined) }) : []),
    ] } : {}),
    ...(options.experimental ? { experimental: options.experimental } : {}),
    packUniforms: (values, width, height, timelineTimeSeconds = 0) => {
      const colorA = colorToRgba(values.colorA, '#111827');
      const colorB = colorToRgba(values.colorB, '#f8fafc');
      const variantValue = options.variantParam
        ? numberParam(values, options.variantParam, Number(params[options.variantParam]?.default ?? 0))
        : values.variant ?? values.kernel ?? values.shape ?? '';
      const variant = typeof variantValue === 'number'
        ? variantValue
        : options.variantMap?.[String(variantValue)] ?? 0;
      return new Float32Array([
        width, height,
        numberParam(values, 'scale', 14),
        numberParam(values, 'amount', 0.75),
        options.angleSlotParam
          ? numberParam(values, options.angleSlotParam, Number(params[options.angleSlotParam]?.default ?? 0))
          : numberParam(values, 'angle', 0),
        timelineTimeSeconds,
        numberParam(values, 'speed', 0),
        variant,
        ...colorA,
        ...colorB,
      ]);
    },
  };
}
