import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { HOLO_BANDS_X, HOLO_BANDS_Y, HOLO_EDGE_REACH } from '../../effects/analog/holoLimits';

/**
 * Holo recipe (see docs/Features/Effects-Analog.md).
 * - Bands: phase = 12 u + 19 v + 2 x Speed x time + 4 x brightness; the interference
 *   0.5 + 0.5 sin(phase + 3 sin(0.37 phase)) sweeps diagonally and bends with the picture's tones.
 *   Stripes blends from an even Spectrum A/B tint (0) to the full bands (1).
 * - Edge sheen: brightness differences across ±HOLO_EDGE_REACH of the frame height (the same at
 *   every resolution) light the spectrum up along outlines.
 * - Foil: screen(colour x 0.8, spectrum x (0.25 + 0.75 x edge)) stays inside [0, 1], so Amount mixes
 *   linearly from the source (0) to the full foil (1).
 * - Alpha: the pixel's own colour is read at its texel centre and keeps its alpha; the edge reads
 *   weigh brightness by coverage, so cut-out silhouettes get an outline.
 */
function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5);
  g.split2('uv-split', ['uv', 'uv']);
  g.split2('resolution-split', ['resolution', 'value']);
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('stripes', 'stripes', 'zero', 'one');
  g.bound('speed', 'speed');
  g.add('color-a-rgb', 'convert.vec4-to-rgb', { value: g.bound('color-a', 'colorA', 'values.color') });
  g.add('color-b-rgb', 'convert.vec4-to-rgb', { value: g.bound('color-b', 'colorB', 'values.color') });
}

/** Brightness times coverage of a straight read at `uv`. */
function coveredBrightness(g: AnalogRecipeBuilder, id: string, uv: GraphPort) {
  g.add(`${id}-sample`, 'image.sample', { image: ['frame', 'image'], uv });
  g.add(`${id}-split`, 'vector.split.rgba', { image: [`${id}-sample`, 'image'] });
  const luma = g.add(`${id}-luma`, 'color.luminance-rec709.rgb', { rgb: [`${id}-split`, 'rgb'] });
  return g.mul(`${id}-covered`, luma, g.add(`${id}-alpha`, 'convert.alpha-to-scalar', { alpha: [`${id}-split`, 'alpha'] }));
}

/** Outline strength in [0, 1] (`edge`): brightness differences across ±HOLO_EDGE_REACH of the frame height. */
function edges(g: AnalogRecipeBuilder) {
  const dy = g.number('edge-reach', HOLO_EDGE_REACH);
  const dx = g.mul('edge-reach-x', dy, g.div('edge-aspect', ['resolution-split', 'y'], ['resolution-split', 'x']));
  const read = (id: string, x: GraphPort, y: GraphPort) => coveredBrightness(g, id, g.add2(`${id}-uv`, ['uv', 'uv'], g.vec2(`${id}-offset`, x, y)));
  const minusX = g.sub('edge-minus-x', 'zero', dx), minusY = g.sub('edge-minus-y', 'zero', dy);
  const horizontal = g.fn('edge-horizontal', 'abs', g.sub('edge-dx', read('edge-right', dx, 'zero'), read('edge-left', minusX, 'zero')));
  const vertical = g.fn('edge-vertical', 'abs', g.sub('edge-dy', read('edge-down', 'zero', dy), read('edge-up', 'zero', minusY)));
  g.clamp('edge', g.mul('edge-gain', g.plus('edge-sum', horizontal, vertical), g.number('edge-gain-scale', 2.5)), 'zero', 'one');
}

/** Spectrum colour of the interference bands (`spectrum`). */
function bands(g: AnalogRecipeBuilder, luma: GraphPort) {
  const position = g.plus('band-position', g.mul('band-x', ['uv-split', 'x'], g.number('band-x-count', HOLO_BANDS_X)),
    g.mul('band-y', ['uv-split', 'y'], g.number('band-y-count', HOLO_BANDS_Y)));
  const drift = g.mul('band-drift', g.mul('band-time', 'time', 'speed'), g.number('band-drift-rate', 2));
  const tone = g.mul('band-tone', luma, g.number('band-tone-bend', 4));
  const phase = g.plus('band-phase', g.plus('band-moving', position, drift), tone);
  const warp = g.mul('band-warp', g.fn('band-warp-sin', 'sin', g.mul('band-warp-angle', phase, g.number('band-warp-rate', .37))), g.number('band-warp-depth', 3));
  const interference = g.plus('band-interference', 'half', g.mul('band-wave', 'half', g.fn('band-sin', 'sin', g.plus('band-angle', phase, warp))));
  const band = g.mix('band', 'half', interference, 'stripes-clamped');
  g.mixRgb('spectrum', ['color-a-rgb', 'rgb'], ['color-b-rgb', 'rgb'], band);
}

export function createDefaultHoloGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g);
  g.add('pixel-sample', 'image.sample', { image: ['frame', 'image'], uv: ['uv', 'uv'] });
  g.add('pixel-split', 'vector.split.rgba', { image: ['pixel-sample', 'image'] });
  const rgb: GraphPort = ['pixel-split', 'rgb'];
  const luma = g.add('pixel-luma', 'color.luminance-rec709.rgb', { rgb });
  edges(g); bands(g, luma);
  // Foil = screen(base, sheen) = base + sheen (1 - base): bounded, so Amount reads as strength.
  const sheen = g.scaleRgb('foil-sheen', 'spectrum', g.plus('foil-light', g.number('foil-light-base', .25), g.mul('foil-light-edge', 'edge', g.number('foil-light-edge-scale', .75))));
  const base = g.scaleRgb('foil-base', rgb, g.number('foil-base-scale', .8));
  const headroom = g.binary('foil-headroom', 'math.subtract.rgb', g.rgbConstant('one-rgb', 'one'), base);
  const foil = g.addRgb('foil', base, g.mulRgb('foil-screen', sheen, headroom));
  const mixed = g.mixRgb('finish-rgb', rgb, foil, 'amount-clamped');
  g.add('finish', 'vector.combine.rgba', { rgb: mixed, alpha: ['pixel-split', 'alpha'] });
  g.add('output', 'image.output', { image: ['finish', 'image'] });
  return g.graph(10);
}
