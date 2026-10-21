import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { premultipliedSourceCache, type GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { FILM_PRISM_GRAIN_SIZE_RANGE, FILM_PRISM_REACH, FILM_PRISM_SPECTRUM, FILM_PRISM_GRAIN_FPS, FILM_PRISM_GRAIN_CYCLE } from '../../effects/analog/filmPrismLimits';

/**
 * Film Prism recipe (see docs/Features/Effects-Analog.md).
 * - Fringe: the picture is read at seven positions spread along the dispersion direction and each
 *   read adds to red, green and blue with its spectrum weight (FILM_PRISM_SPECTRUM), so edges
 *   break into a smooth red-to-blue rainbow instead of three hard copies. Each read moves by a fixed
 *   per-pixel offset within its seventh of the spread, so wide fringes dither instead of stepping. Lens: the reads scale
 *   about the frame centre by up to ±Fringe x FILM_PRISM_REACH (stronger towards the corners).
 *   Prism: the reads shift along Angle (degrees, counter-clockwise from the right) by up to
 *   ±Fringe x FILM_PRISM_REACH of the frame height, the same everywhere. Fringe 0 reads once.
 * - Grain: two octaves of smooth value noise, cells of Grain Size px at 1080 lines (scaled with
 *   the frame height) and about half of that, a new pattern FILM_PRISM_GRAIN_FPS x Grain Speed times per second (Grain Speed 0
 *   freezes it), strongest in the mid-tones, added equally to all channels.
 * - Alpha: the reads come from a premultiplied cache; each channel keeps its own coverage, so the
 *   fringe may spread past a cut-out's edge.
 */
function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('three', 3); g.number('coverage-floor', 1e-6);
  g.split2('resolution-split', ['resolution', 'value']);
  g.splat2('half-vec2', 'half');
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('grain', 'grain', 'zero', 'one');
  g.clampedParam('grain-size', 'grainSize', g.number('grain-size-min', FILM_PRISM_GRAIN_SIZE_RANGE[0]), g.number('grain-size-max', FILM_PRISM_GRAIN_SIZE_RANGE[1]));
  g.bound('angle', 'angle'); g.bound('speed', 'speed');
  g.bound('mode', 'mode', 'values.choice');
}

/** Read position of spectrum tap `t` in [-1, 1]. */
function tapUv(g: AnalogRecipeBuilder, index: number, t: number): string {
  // Each tap moves by a per-pixel offset within its share of the spread (stratified jitter), so a wide
  // fringe dissolves into fine dither instead of seven stepped copies.
  const tap = g.plus(`fringe-tap${index}-position`, g.number(`fringe-tap${index}-t`, t), 'fringe-jitter');
  // Lens: scale about the centre by 1 + t * reach.
  const scale = g.plus(`fringe-tap${index}-scale`, 'one', g.mul(`fringe-tap${index}-reach`, tap, 'fringe-reach'));
  const lens = g.add2(`fringe-tap${index}-lens`, g.scale2(`fringe-tap${index}-lens-offset`, 'fringe-centred', scale), 'half-vec2');
  // Prism: shift along the direction by t * reach (frame heights).
  const prism = g.add2(`fringe-tap${index}-prism`, ['uv', 'uv'], g.scale2(`fringe-tap${index}-prism-offset`, 'fringe-direction', g.mul(`fringe-tap${index}-shift`, tap, 'fringe-reach')));
  return g.add(`fringe-tap${index}-uv`, 'select.vec2', { condition: ['fringe-is-prism', 'condition'], falseValue: lens, trueValue: prism });
}

/** Spectrum-weighted premultiplied sums: `fringe-red`, `fringe-green`, `fringe-blue` (vec of colour, alpha). */
function fringe(g: AnalogRecipeBuilder, cache: string) {
  g.mul('fringe-reach', 'amount-clamped', g.number('fringe-reach-scale', FILM_PRISM_REACH));
  g.sub2('fringe-centred', ['uv', 'uv'], 'half-vec2');
  const pixel = g.unary('fringe-pixel', 'math.floor.vec2', g.mul2('fringe-pixel-position', ['uv', 'uv'], ['resolution', 'value']));
  const spacing = 2 / (FILM_PRISM_SPECTRUM.length - 1);
  g.mul('fringe-jitter', g.sub('fringe-jitter-centred', g.hash('fringe-jitter-roll', pixel), 'half'), g.number('fringe-tap-spacing', spacing));
  g.add('fringe-is-prism', 'compare.greater.scalar', { a: 'mode', b: 'half' });
  // Direction in UV for a shift of one frame height along Angle (y points down in UV).
  const radians = g.unary('fringe-radians', 'convert.degrees-to-radians.scalar', 'angle');
  const aspect = g.div('fringe-aspect', ['resolution-split', 'y'], ['resolution-split', 'x']);
  g.vec2('fringe-direction', g.mul('fringe-direction-x', g.fn('fringe-cos', 'cos', radians), aspect),
    g.sub('fringe-direction-y', 'zero', g.fn('fringe-sin', 'sin', radians)));
  const sums: Record<'red' | 'green' | 'blue', { colour: GraphPort; alpha: GraphPort } | undefined> = { red: undefined, green: undefined, blue: undefined };
  FILM_PRISM_SPECTRUM.forEach(([t, weights], index) => {
    const sample = g.add(`fringe-tap${index}-sample`, 'image.sample', { image: [cache, 'image'], uv: tapUv(g, index, t) });
    g.add(`fringe-tap${index}-split`, 'vector.split.rgba', { image: [sample, 'image'] });
    g.add(`fringe-tap${index}-vector`, 'convert.rgb-to-vec3', { rgb: [`fringe-tap${index}-split`, 'rgb'] });
    g.add(`fringe-tap${index}-components`, 'vector.split.vec3', { value: `fringe-tap${index}-vector` });
    const alpha = g.add(`fringe-tap${index}-alpha`, 'convert.alpha-to-scalar', { alpha: [`fringe-tap${index}-split`, 'alpha'] });
    (['red', 'green', 'blue'] as const).forEach((channel, c) => {
      const weight = weights[c];
      if (weight === 0) return;
      const w = g.number(`fringe-tap${index}-${channel}-weight`, weight);
      const colour = g.mul(`fringe-tap${index}-${channel}`, [`fringe-tap${index}-components`, 'xyz'[c]], w);
      const coverage = g.mul(`fringe-tap${index}-${channel}-alpha`, alpha, w);
      const previous = sums[channel];
      sums[channel] = previous ? { colour: g.plus(`fringe-${channel}-sum${index}`, previous.colour, colour), alpha: g.plus(`fringe-${channel}-alpha-sum${index}`, previous.alpha, coverage) }
        : { colour, alpha: coverage };
    });
  });
  return sums as Record<'red' | 'green' | 'blue', { colour: GraphPort; alpha: GraphPort }>;
}

/** One octave of smooth value noise in [0, 1] over `cell` (grain cells), keyed by the grain frame. */
function valueNoise(g: AnalogRecipeBuilder, id: string, cell: GraphPort, frameOffset: GraphPort): string {
  // Fold the cell index into [0, 509): small exact keys at any resolution.
  const folded = g.unary(`${id}-fold-fract`, 'math.fract.vec2', g.binary(`${id}-fold-scaled`, 'math.divide-ieee.vec2-scalar', g.unary(`${id}-cell-floor`, 'math.floor.vec2', cell), 'grain-wrap'));
  const base = g.add2(`${id}-base`, g.mul2(`${id}-wrapped`, folded, 'grain-wrap-vec2'), frameOffset);
  const [fx, fy] = g.split2(`${id}-fraction`, g.unary(`${id}-fraction-value`, 'math.fract.vec2', cell));
  const fade = (fade: string, f: GraphPort) => g.mul(fade, g.mul(`${fade}-squared`, f, f), g.sub(`${fade}-shape`, 'three', g.mul(`${fade}-double`, 'two', f)));
  const ux = fade(`${id}-fade-x`, fx), uy = fade(`${id}-fade-y`, fy);
  const corner = (key: string, x: GraphPort, y: GraphPort) => g.hash(`${id}-${key}`, g.add2(`${id}-${key}-cell`, base, g.vec2(`${id}-${key}-offset`, x, y)));
  const top = g.mix(`${id}-top`, corner('h00', 'zero', 'zero'), corner('h10', 'one', 'zero'), ux);
  const bottom = g.mix(`${id}-bottom`, corner('h01', 'zero', 'one'), corner('h11', 'one', 'one'), ux);
  return g.mix(`${id}-value`, top, bottom, uy);
}

/** Grain in [-1, 1]: two octaves of value noise (cells of Grain Size and about half of it). */
function grainNoise(g: AnalogRecipeBuilder) {
  const cellPx = g.mul('grain-cell-px', 'grain-size-clamped', g.div('grain-frame-scale', ['resolution-split', 'y'], g.number('grain-reference-height', 1080)));
  const cell = g.binary('grain-cell', 'math.divide-ieee.vec2-scalar', g.mul2('grain-pixel', ['uv', 'uv'], ['resolution', 'value']), cellPx);
  // New pattern FILM_PRISM_GRAIN_FPS x speed times a second; the frame key cycles to keep hash keys small.
  const step = g.fn('grain-step', 'floor', g.mul('grain-clock', g.mul('grain-time', 'time', 'speed'), g.number('grain-fps', FILM_PRISM_GRAIN_FPS)));
  const cycle = g.number('grain-cycle', FILM_PRISM_GRAIN_CYCLE);
  const frame = g.sub('grain-frame', step, g.mul('grain-cycles', g.fn('grain-cycle-count', 'floor', g.div('grain-cycle-position', step, cycle)), cycle));
  const offset = g.vec2('grain-frame-offset', g.mul('grain-frame-x', frame, g.number('grain-frame-x-salt', 3.17)), g.mul('grain-frame-y', frame, g.number('grain-frame-y-salt', 1.93)));
  g.number('grain-wrap', 509); g.splat2('grain-wrap-vec2', 'grain-wrap');
  const coarse = valueNoise(g, 'grain-coarse', cell, offset);
  const fineCell = g.add2('grain-fine-cell', g.scale2('grain-fine-scaled', cell, g.number('grain-fine-ratio', 2.03)), g.splat2('grain-fine-shift', g.number('grain-fine-salt', 17.1)));
  const fine = valueNoise(g, 'grain-fine', fineCell, offset);
  const blend = g.plus('grain-blend', g.mul('grain-coarse-share', coarse, g.number('grain-coarse-weight', .6)), g.mul('grain-fine-share', fine, g.number('grain-fine-weight', .4)));
  // The blend of two octaves clusters around 0.5; 2.5 x (blend - 0.5) spans about [-1, 1].
  return g.mul('grain-noise', g.sub('grain-centred', blend, 'half'), g.number('grain-spread', 2.5));
}

export function createDefaultFilmPrismGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g);
  const cache = premultipliedSourceCache(g);
  const sums = fringe(g, cache);
  const coverage = g.max('finish-alpha', g.max('finish-alpha-rg', sums.red.alpha, sums.green.alpha), sums.blue.alpha);
  const safe = g.max('finish-safe-alpha', coverage, 'coverage-floor');
  const straight = g.add('finish-straight', 'math.divide-ieee.rgb-scalar', { a: g.rgb3('finish-premultiplied', sums.red.colour, sums.green.colour, sums.blue.colour), b: safe });
  // Grain: strongest in the mid-tones (4 l (1 - l) + 0.25), up to ±0.12 at Grain 1.
  const luma = g.clamp('grain-luma', g.add('grain-luma-raw', 'color.luminance-rec709.rgb', { rgb: straight }), 'zero', 'one');
  const midtones = g.plus('grain-midtones', g.mul('grain-midtone-curve', g.mul('grain-midtone-l', luma, g.sub('grain-midtone-inverse', 'one', luma)), g.number('grain-midtone-scale', 4)), g.number('grain-floor', .25));
  const amplitude = g.mul('grain-amplitude', g.mul('grain-strength', 'grain-clamped', g.number('grain-scale', .12)), midtones);
  const grain = g.rgbConstant('grain-rgb', g.mul('grain-offset', grainNoise(g), amplitude));
  const rgb = g.add('finish-rgb', 'math.clamp.rgb-scalar', { value: g.addRgb('finish-grained', straight, grain), min: 'zero', max: 'one' });
  const alpha = g.unary('finish-alpha-value', 'convert.scalar-to-alpha', coverage);
  g.add('finish', 'vector.combine.rgba', { rgb, alpha: [alpha, 'alpha'] });
  g.add('output', 'image.output', { image: ['finish', 'image'] });
  return g.graph(10);
}
