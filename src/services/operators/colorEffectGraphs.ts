import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { EffectParam } from '../../effects/types';
import { BRIGHTNESS_AMOUNT_PARAM, CONTRAST_AMOUNT_PARAM, SATURATION_AMOUNT_PARAM } from '../../effects/color/sharedColorAmountParams';
import { EXPOSURE_PARAMS, LEVELS_PARAMS, TEMPERATURE_PARAMS, VIBRANCE_PARAMS } from '../../effects/color/remainingColorParams';
import { BlurGraphBuilder as GraphBuilder, type GraphPort } from './blurGraphBuilder';

export type EditableColorEffectType = 'brightness' | 'contrast' | 'saturation' | 'exposure' | 'levels' | 'hue-shift' | 'temperature' | 'vibrance';
/**
 * Color effects whose look exists only as a graph recipe (2026-10 rebuild): every renderer, the worker
 * software/export path included, runs the graph instead of a hand-written shortcut of the old math.
 */
export const COLOR_RECIPE_EFFECT_TYPES: ReadonlySet<string> = new Set<EditableColorEffectType>(
  ['brightness', 'contrast', 'saturation', 'exposure', 'levels', 'hue-shift', 'temperature', 'vibrance']);

/**
 * Tuning of the color recipes (2026-10 rebuild). Tone curves work on the encoded 0..1 signal and
 * keep black and white fixed; light (Exposure, Temperature) is changed in linear light.
 */
export const COLOR_RECIPE = Object.freeze({
  /** Brightness multiplies each channel's odds x/(1-x) by 2^(stops * amount). */
  brightnessStops: 2.5,
  /** Contrast below this slope renders as this slope (0 itself is a flat grey). */
  contrastMinimumSlope: 0.01,
  /** Contrast keeps inputs this far inside 0..1 so 0^0 never occurs. */
  contrastEdge: 1e-6,
  /** Temperature: stops of red gain (and inverse blue gain) per unit. */
  temperatureStops: 0.6,
  /** Tint: stops of green loss per unit; red and blue gain half of it. */
  tintStops: 0.5,
  /** Vibrance: hue (turns, HSV) and width of the protected skin tones, and how much they are spared. */
  skinHue: 0.07, skinWidth: 0.05, skinProtection: 0.7,
  /**
   * Vibrance: skin is also lit and not neon. Protection fades in over these HSV values (dark warm
   * stage floors are not skin) and out over these saturations (strongly saturated orange light).
   */
  skinLitValue: [0.15, 0.35] as const, skinVividSaturation: [0.6, 0.8] as const,
  /** Levels treats input ranges narrower than this as this wide (a hard threshold). */
  levelsMinimumRange: 1e-4,
  /** Saturation limit: chroma below this counts as neutral. */
  gamutEpsilon: 1e-6,
});

const range = (param: EffectParam): [number, number] => {
  if (param.renderMin === undefined || param.renderMax === undefined) throw new Error(`${param.label} has no render range.`);
  return [param.renderMin, param.renderMax];
};

/** frame → split → … → combine (RGB from `rgb`, original alpha) → output. */
function begin(): GraphBuilder {
  const g = new GraphBuilder();
  g.add('frame', 'image.frame');
  g.add('split', 'vector.split.rgba', { image: ['frame', 'image'] });
  return g;
}
function finish(g: GraphBuilder, rgb: GraphPort): EffectOperatorGraph {
  g.add('combine', 'vector.combine.rgba', { rgb, alpha: ['split', 'alpha'] });
  g.add('output', 'image.output', { image: ['combine', 'image'] });
  return g.graph(6);
}
/** Scalar node → RGB splat (`<node>-rgb`, output port `rgb`). */
const rgbOf = (g: GraphBuilder, node: string): GraphPort => [g.add(`${node}-rgb`, 'convert.scalar-to-rgb', { value: node }), 'rgb'];
/** A bound parameter clamped to its declared render range. */
function boundParameter(g: GraphBuilder, id: string, param: EffectParam): string {
  const [min, max] = range(param);
  g.bound(id, id);
  return g.add(`${id}-clamped`, 'math.clamp.scalar', { value: id, min: g.number(`${id}-render-min`, min), max: g.number(`${id}-render-max`, max) });
}
/** Encoded RGB limited to 0..1 (prefix keeps several limits apart). */
function clampRgb(g: GraphBuilder, id: string, value: GraphPort, low = 0, high = 1): string {
  return g.add(id, 'math.clamp.rgb-scalar', { value, min: g.number(`${id}-low`, low), max: g.number(`${id}-high`, high) });
}

/**
 * Hue-preserving saturation: mix Rec.709 luma and RGB by `amount`, but never further than the
 * point where the first channel reaches 0 or 1, so strong settings neither clip nor turn hues.
 * Expects 0..1 RGB and amount >= 0. Node ids start with `gamut-` (one shared composition).
 */
export function gamutSafeSaturation(g: GraphBuilder, input: GraphPort, amount: GraphPort): string {
  const one = g.number('gamut-one', 1), zero = g.number('gamut-zero', 0), epsilon = g.number('gamut-epsilon', COLOR_RECIPE.gamutEpsilon);
  const luma = g.add('gamut-luma', 'color.luminance-rec709.rgb', { rgb: input });
  const lumaRgb: GraphPort = [g.add('gamut-luma-rgb', 'convert.scalar-to-rgb', { value: luma }), 'rgb'];
  const chroma = g.binary('gamut-chroma', 'math.subtract.rgb', input, lumaRgb);
  const up = g.binary('gamut-chroma-up', 'math.max.scalar', g.add('gamut-chroma-max', 'vector.reduce-max.rgb', { rgb: chroma }), epsilon);
  const down = g.binary('gamut-chroma-down', 'math.max.scalar',
    g.binary('gamut-chroma-negated', 'math.subtract.scalar', zero, g.add('gamut-chroma-min', 'vector.reduce-min.rgb', { rgb: chroma })), epsilon);
  const limit = g.binary('gamut-limit', 'math.min.scalar',
    g.binary('gamut-limit-up', 'math.divide-ieee.scalar', g.binary('gamut-headroom', 'math.subtract.scalar', one, luma), up),
    g.binary('gamut-limit-down', 'math.divide-ieee.scalar', luma, down));
  const safe = g.binary('gamut-amount', 'math.min.scalar', amount, limit);
  return g.add('gamut-mix', 'math.mix.rgb', { a: lumaRgb, b: input, t: safe });
}

/** Lifts or lowers mid-tones; 0 and 1 stay put: y = x·m / (x·m + 1 − x), m = 2^(2.5 · amount). */
export function createDefaultBrightnessGraph(): EffectOperatorGraph {
  const g = begin();
  const amount = boundParameter(g, 'amount', BRIGHTNESS_AMOUNT_PARAM);
  const gain = g.unary('curve-gain', 'math.exp2.scalar',
    g.binary('curve-stops', 'math.multiply.scalar', amount, g.number('curve-stops-per-amount', COLOR_RECIPE.brightnessStops)));
  const input = clampRgb(g, 'input', ['split', 'rgb']);
  const lifted = g.binary('curve-lifted', 'math.multiply.rgb-scalar', input, gain);
  const rest = g.binary('curve-rest', 'math.subtract.rgb', rgbOf(g, g.number('curve-one', 1)), input);
  const curve = g.binary('curve', 'math.divide-ieee.rgb', lifted, g.binary('curve-total', 'math.add.rgb', lifted, rest));
  return finish(g, curve);
}

/** S-curve around mid-grey with slope `amount` there; 0 and 1 stay put: y = x^a / (x^a + (1 − x)^a). */
export function createDefaultContrastGraph(): EffectOperatorGraph {
  const g = begin();
  const amount = boundParameter(g, 'amount', CONTRAST_AMOUNT_PARAM);
  const slope = rgbOf(g, g.binary('curve-slope', 'math.max.scalar', amount, g.number('curve-minimum-slope', COLOR_RECIPE.contrastMinimumSlope)));
  const input = clampRgb(g, 'input', ['split', 'rgb'], COLOR_RECIPE.contrastEdge, 1 - COLOR_RECIPE.contrastEdge);
  const shadows = g.binary('curve-shadows', 'math.power.rgb', input, slope);
  const highlights = g.binary('curve-highlights', 'math.power.rgb',
    g.binary('curve-inverse', 'math.subtract.rgb', rgbOf(g, g.number('curve-one', 1)), input), slope);
  const curve = g.binary('curve', 'math.divide-ieee.rgb', shadows, g.binary('curve-total', 'math.add.rgb', shadows, highlights));
  return finish(g, curve);
}

export function createDefaultSaturationGraph(): EffectOperatorGraph {
  const g = begin();
  const amount = boundParameter(g, 'amount', SATURATION_AMOUNT_PARAM);
  return finish(g, gamutSafeSaturation(g, clampRgb(g, 'input', ['split', 'rgb']), amount));
}

/** Boosts muted colours more than vivid ones and spares lit skin tones; never clips. */
export function createDefaultVibranceGraph(): EffectOperatorGraph {
  const g = begin();
  const amount = boundParameter(g, 'amount', VIBRANCE_PARAMS.amount);
  const input = clampRgb(g, 'input', ['split', 'rgb']);
  const one = g.number('weight-one', 1), half = g.number('skin-half', 0.5);
  const hsv = g.add('measure-hsv-split', 'vector.split.vec3', { value: g.add('measure-hsv', 'convert.rgb-to-hsv', { rgb: input }) });
  const muted = g.binary('weight-muted', 'math.subtract.scalar', one, [hsv, 'y']);
  const offset = g.binary('skin-offset', 'math.add.scalar', g.binary('skin-hue-offset', 'math.subtract.scalar', [hsv, 'x'], g.number('skin-hue', COLOR_RECIPE.skinHue)), half);
  const distance = g.unary('skin-distance', 'math.abs.scalar', g.binary('skin-signed', 'math.subtract.scalar', g.unary('skin-wrapped', 'math.fract.scalar', offset), half));
  const hueMatch = g.add('skin-match', 'math.gaussian.scalar', { value: distance, sigma: g.number('skin-width', COLOR_RECIPE.skinWidth) });
  const [dark, lit] = COLOR_RECIPE.skinLitValue, [pale, vivid] = COLOR_RECIPE.skinVividSaturation;
  const litWeight = g.add('skin-lit', 'math.smoothstep.scalar', { edge0: g.number('skin-dark-value', dark), edge1: g.number('skin-lit-value', lit), value: [hsv, 'z'] });
  const vividWeight = g.add('skin-vivid', 'math.smoothstep.scalar', { edge0: g.number('skin-pale-saturation', pale), edge1: g.number('skin-vivid-saturation', vivid), value: [hsv, 'y'] });
  const band = g.binary('skin-band', 'math.multiply.scalar', litWeight, g.binary('skin-not-vivid', 'math.subtract.scalar', one, vividWeight));
  const match = g.binary('skin-weighted', 'math.multiply.scalar', hueMatch, band);
  const spared = g.binary('skin-kept', 'math.subtract.scalar', one, g.binary('skin-spared', 'math.multiply.scalar', match, g.number('skin-protection', COLOR_RECIPE.skinProtection)));
  const boost = g.binary('weight-boost', 'math.multiply.scalar', amount, g.binary('weight', 'math.multiply.scalar', muted, spared));
  const saturation = g.binary('weight-saturation', 'math.max.scalar', g.binary('weight-amount', 'math.add.scalar', one, boost), g.number('weight-zero', 0));
  return finish(g, gamutSafeSaturation(g, input, saturation));
}

/** Camera stops in linear light, then the display-referred Offset and Gamma of the original effect. */
export function createDefaultExposureGraph(): EffectOperatorGraph {
  const g = begin();
  const gain = g.unary('light-gain', 'math.exp2.scalar', boundParameter(g, 'exposure', EXPOSURE_PARAMS.exposure));
  const linear: GraphPort = [g.add('light-linear', 'color.srgb-to-linear.rgb', { rgb: ['split', 'rgb'] }), 'rgb'];
  const encoded: GraphPort = [g.add('light-encoded', 'color.linear-to-srgb.rgb', { rgb: g.binary('light-exposed', 'math.multiply.rgb-scalar', linear, gain) }), 'rgb'];
  g.bound('offset', 'offset');
  const lifted = g.binary('tone-offset', 'math.add.rgb', encoded, rgbOf(g, 'offset'));
  const positive = g.binary('tone-positive', 'math.max.rgb', lifted, rgbOf(g, g.number('tone-zero', 0)));
  const inverse = rgbOf(g, g.unary('tone-inverse-gamma', 'math.reciprocal.scalar', boundParameter(g, 'gamma', EXPOSURE_PARAMS.gamma)));
  return finish(g, clampRgb(g, 'clamp', g.binary('tone-gamma', 'math.power.rgb', positive, inverse)));
}

/** Input black/white remap (equal points become a hard per-channel threshold, swapped points a negative), gamma, output range. */
export function createDefaultLevelsGraph(): EffectOperatorGraph {
  const g = begin();
  const zero = g.number('range-zero', 0);
  const bound = (id: string) => rgbOf(g, g.bound(id, id));
  const blackRgb = bound('inputBlack');
  g.bound('inputWhite', 'inputWhite');
  const raw = g.binary('range', 'math.subtract.scalar', 'inputWhite', 'inputBlack');
  const width = g.binary('range-width', 'math.max.scalar', g.unary('range-size', 'math.abs.scalar', raw), g.number('range-minimum', COLOR_RECIPE.levelsMinimumRange));
  const safe = g.add('range-safe', 'select.scalar', { condition: [g.binary('range-swapped', 'compare.greater.scalar', zero, raw), 'condition'],
    falseValue: width, trueValue: g.binary('range-negated', 'math.subtract.scalar', zero, width) });
  const normalized = g.binary('remap', 'math.divide-ieee.rgb', g.binary('remap-black', 'math.subtract.rgb', ['split', 'rgb'], blackRgb), rgbOf(g, safe));
  const inverse = rgbOf(g, g.unary('gamma-inverse', 'math.reciprocal.scalar', boundParameter(g, 'gamma', LEVELS_PARAMS.gamma)));
  const curved = g.binary('gamma-curve', 'math.power.rgb', clampRgb(g, 'remap-clamp', normalized), inverse);
  const output = g.add('output-range', 'math.mix-components.rgb', { a: bound('outputBlack'), b: bound('outputWhite'), t: curved });
  return finish(g, clampRgb(g, 'clamp', output));
}

/** Rotates hue in OkLCh, so lightness and chroma stay and an animated rotation does not pump brightness. */
export function createDefaultHueShiftGraph(): EffectOperatorGraph {
  const g = begin();
  const lch = g.add('hue-lch-split', 'vector.split.vec3', { value: g.add('hue-lch', 'convert.rgb-to-oklch', { rgb: ['split', 'rgb'] }) });
  const turned = g.unary('hue-wrap', 'math.fract.scalar', g.binary('hue-add', 'math.add.scalar', [lch, 'z'], g.bound('shift', 'shift')));
  const combined = g.add('hue-lch-combine', 'vector.combine.vec3', { x: [lch, 'x'], y: [lch, 'y'], z: turned });
  return finish(g, clampRgb(g, 'clamp', [g.add('hue-rgb', 'convert.oklch-to-rgb', { value: combined }), 'rgb']));
}

/** White balance: luminance-neutral channel gains in linear light, so blacks stay black. */
export function createDefaultTemperatureGraph(): EffectOperatorGraph {
  const g = begin();
  const temperature = boundParameter(g, 'temperature', TEMPERATURE_PARAMS.temperature);
  const tint = boundParameter(g, 'tint', TEMPERATURE_PARAMS.tint);
  const warmth = g.binary('gain-warmth', 'math.multiply.scalar', temperature, g.number('gain-temperature-stops', COLOR_RECIPE.temperatureStops));
  const magenta = g.binary('gain-magenta', 'math.multiply.scalar', tint, g.number('gain-tint-half-stops', COLOR_RECIPE.tintStops / 2));
  const green = g.binary('gain-green-stops', 'math.multiply.scalar', tint, g.number('gain-tint-stops', -COLOR_RECIPE.tintStops));
  const gains = g.add('gain-vector', 'vector.combine.vec3', {
    x: g.unary('gain-red', 'math.exp2.scalar', g.binary('gain-red-stops', 'math.add.scalar', warmth, magenta)),
    y: g.unary('gain-green', 'math.exp2.scalar', green),
    z: g.unary('gain-blue', 'math.exp2.scalar', g.binary('gain-blue-stops', 'math.subtract.scalar', magenta, warmth)) });
  const gainsRgb: GraphPort = [g.add('gain-rgb', 'convert.vec3-to-rgb', { value: gains }), 'rgb'];
  const neutral = g.binary('gain-balanced', 'math.divide-ieee.rgb-scalar', gainsRgb, g.add('gain-luma', 'color.luminance-rec709.rgb', { rgb: gainsRgb }));
  const linear: GraphPort = [g.add('light-linear', 'color.srgb-to-linear.rgb', { rgb: ['split', 'rgb'] }), 'rgb'];
  const balanced: GraphPort = [g.add('light-encoded', 'color.linear-to-srgb.rgb', { rgb: g.binary('light-balanced', 'math.multiply.rgb', linear, neutral) }), 'rgb'];
  return finish(g, clampRgb(g, 'clamp', balanced));
}

export function createDefaultColorEffectGraph(type: EditableColorEffectType): EffectOperatorGraph {
  return type === 'brightness' ? createDefaultBrightnessGraph()
    : type === 'contrast' ? createDefaultContrastGraph() : type === 'saturation' ? createDefaultSaturationGraph()
      : type === 'exposure' ? createDefaultExposureGraph() : type === 'levels' ? createDefaultLevelsGraph()
        : type === 'hue-shift' ? createDefaultHueShiftGraph() : type === 'temperature' ? createDefaultTemperatureGraph()
          : createDefaultVibranceGraph();
}
