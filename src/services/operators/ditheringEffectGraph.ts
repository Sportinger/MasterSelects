import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { measureInReferenceFrame } from './patternReferenceFrame';
import { prefilterCellTaps } from './patternCellFilter';

type Ref = { node: string; port: string };
class Builder {
  nodes: BoundOperatorNode[] = []; edges: OperatorEdge[] = []; layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 11) * 300, y: Math.floor(this.nodes.length / 11) * 220 }; return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  clamp(id: string, operator: string, value: Ref, min: Ref, max: Ref) {
    const out = this.node(id, operator); this.edge(value, out, 'value'); this.edge(min, out, 'min'); this.edge(max, out, 'max'); return out;
  }
}

/** Where Dithering reads a cell's colour: four points on the cell's diagonals, a quarter cell from its centre (DITHER_TAPS).
 * With bilinear reads this is the exact average of cells of 2 and 4 pixels; a one-pixel cell reads its own pixel. */
export const DITHER_TAPS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
/** Smallest level span in linear light the share divides by (a span of 0 only occurs at white, where the share is 0). */
export const DITHER_SPAN_FLOOR = 1e-6;
/** At or below this summed alpha, all four reading points count as transparent and the pixel's own colour is used
 * (an 8-bit alpha above 0 is at least 1/255). */
export const DITHER_ALPHA_FLOOR = .001;

/**
 * A Dithering saved without a node graph before Levels existed (its params lack `levels`; new effects store every
 * default): it keeps the earlier recipe it was saved with (createDefaultDitherGraph('dither') in ditherEffectGraphs.ts),
 * whose Bayer threshold steps every pixel's own colour to four levels.
 */
export function hasEarlierDitheringParams(params: Record<string, unknown>): boolean {
  return params.levels === undefined;
}

/**
 * Dithering: the frame cut into cells of Pixel Size whole pixels (1080p pixels, patternReferenceFrame.ts). Every cell
 * is read as one colour, averaged in linear light and weighted by alpha, and each channel is stepped to Levels steps
 * (equal sRGB steps) by the canonical 4 × 4 Bayer threshold of its cell. The share of the upper step is measured in
 * linear light, so from a distance the pattern has the picture's brightness: black stays black, white stays white.
 */
export function createDefaultDitheringGraph(): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const levels = g.node('levels', 'values.number', 'value', { value: 'levels' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), half = g.number('half', .5), quarter = g.number('quarter', .25);
  // Pixel Grid: cells of Pixel Size whole output pixels, their index and centre.
  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution);
  const safeScale = g.binary('safe-scale', 'math.max.scalar', scale, one);
  const cells = g.binary('cells', 'math.divide-ieee.vec2', pixel, g.unary('cell-size-vec2', 'convert.scalar-to-vec2', safeScale));
  const centerCells = g.binary('cell-center', 'math.add.vec2', g.unary('cell-index', 'math.floor.vec2', cells), g.unary('half-vec2', 'convert.scalar-to-vec2', half));
  const centerPixels = g.node('cell-center-pixels', 'math.multiply.vec2-scalar'); g.edge(centerCells, centerPixels, 'a'); g.edge(safeScale, centerPixels, 'b');
  // Cell Colour reads a quarter cell from the centre, but never past the cell's own pixels: a one-pixel cell reads its pixel.
  const reach = g.binary('tap-reach', 'math.min.scalar', g.binary('tap-reach-quarter', 'math.multiply.scalar', safeScale, quarter),
    g.binary('tap-reach-inside', 'math.multiply.scalar', g.binary('cell-size-less-one', 'math.subtract.scalar', safeScale, one), half));
  // Cell Colour: four reads around the centre, in linear light and weighted by alpha; the pixel's own colour if all are transparent.
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', g.number('tiny', .001)), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', g.number('almost-one', .999));
  const ownSample = g.node('sample', 'image.sample', 'image'); g.edge(frame, ownSample, 'image'); g.edge(g.clamp('clamped-uv', 'math.clamp.vec2', uv, minUv, maxUv), ownSample, 'uv');
  const own = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(ownSample, own, 'image');
  const ownRgb = { node: own.node, port: 'rgb' }, ownAlpha = { node: own.node, port: 'alpha' };
  const diagonal = g.unary('tap-diagonal', 'convert.scalar-to-vec2', reach);
  const antiDiagonal = g.node('tap-anti-diagonal', 'vector.combine.vec2'); g.edge(reach, antiDiagonal, 'x'); g.edge(g.binary('tap-reach-up', 'math.subtract.scalar', zero, reach), antiDiagonal, 'y');
  let lightSum: Ref | undefined, alphaSum: Ref | undefined;
  DITHER_TAPS.forEach(([x, y], index) => {
    const id = `tap-${index + 1}`, offset = x * y > 0 ? diagonal : antiDiagonal;
    const at = g.binary(`${id}-pixels`, x > 0 ? 'math.add.vec2' : 'math.subtract.vec2', centerPixels, offset);
    const sample = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(frame, sample, 'image');
    g.edge(g.clamp(`${id}-clamped-uv`, 'math.clamp.vec2', g.binary(`${id}-uv`, 'math.divide-ieee.vec2', at, resolution), minUv, maxUv), sample, 'uv');
    const split = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
    const alpha = g.unary(`${id}-alpha`, 'convert.alpha-to-scalar', { node: split.node, port: 'alpha' }, 'alpha');
    const linear = g.node(`${id}-linear`, 'color.srgb-to-linear.rgb', 'rgb'); g.edge({ node: split.node, port: 'rgb' }, linear, 'rgb');
    const weighted = g.node(`${id}-weighted`, 'math.multiply.rgb-scalar', 'value'); g.edge(linear, weighted, 'a'); g.edge(alpha, weighted, 'b');
    lightSum = lightSum ? g.binary(`${id}-light-sum`, 'math.add.rgb', lightSum, weighted) : weighted;
    alphaSum = alphaSum ? g.binary(`${id}-alpha-sum`, 'math.add.scalar', alphaSum, alpha) : alpha;
  });
  const alphaFloor = g.number('alpha-floor', DITHER_ALPHA_FLOOR);
  const average = g.node('cell-average', 'math.divide-ieee.rgb-scalar'); g.edge(lightSum!, average, 'a'); g.edge(g.binary('cell-alpha', 'math.max.scalar', alphaSum!, alphaFloor), average, 'b');
  const noReads = g.node('no-reads', 'math.step.scalar'); g.edge(alphaSum!, noReads, 'edge'); g.edge(alphaFloor, noReads, 'value');
  const ownLinear = g.node('own-linear', 'color.srgb-to-linear.rgb', 'rgb'); g.edge(ownRgb, ownLinear, 'rgb');
  const picked = g.node('cell-picked', 'math.mix.rgb'); g.edge(average, picked, 'a'); g.edge(ownLinear, picked, 'b'); g.edge(noReads, picked, 't');
  const cellLight = g.clamp('cell-light', 'math.clamp.rgb-scalar', picked, zero, one);
  // Levels: the cell's colour between two of Levels equal sRGB steps, and the share of the upper one in linear light.
  const levelsClamped = g.binary('levels-clamped', 'math.max.scalar', levels, two);
  const steps = g.binary('steps', 'math.subtract.scalar', levelsClamped, one);
  const encoded = g.node('cell-srgb', 'color.linear-to-srgb.rgb', 'rgb'); g.edge(cellLight, encoded, 'rgb');
  const position = g.node('level-position', 'math.multiply.rgb-scalar'); g.edge(encoded, position, 'a'); g.edge(steps, position, 'b');
  const lowerIndex = g.unary('level-lower', 'math.floor.rgb', position);
  const lower = g.node('step-lower', 'math.divide-ieee.rgb-scalar'); g.edge(lowerIndex, lower, 'a'); g.edge(steps, lower, 'b');
  const oneRgb = g.node('one-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(one, oneRgb, 'value');
  const upperRaw = g.node('step-upper-raw', 'math.divide-ieee.rgb-scalar'); g.edge(g.binary('level-upper', 'math.add.rgb', lowerIndex, oneRgb), upperRaw, 'a'); g.edge(steps, upperRaw, 'b');
  const upper = g.clamp('step-upper', 'math.clamp.rgb-scalar', upperRaw, zero, one);
  const lowerLinear = g.node('step-lower-linear', 'color.srgb-to-linear.rgb', 'rgb'); g.edge(lower, lowerLinear, 'rgb');
  const upperLinear = g.node('step-upper-linear', 'color.srgb-to-linear.rgb', 'rgb'); g.edge(upper, upperLinear, 'rgb');
  const spanFloor = g.node('span-floor', 'convert.scalar-to-rgb', 'rgb'); g.edge(g.number('span-floor-value', DITHER_SPAN_FLOOR), spanFloor, 'value');
  const span = g.binary('step-span', 'math.max.rgb', g.binary('step-span-raw', 'math.subtract.rgb', upperLinear, lowerLinear), spanFloor);
  const share = g.binary('share', 'math.divide-ieee.rgb', g.binary('above-lower', 'math.subtract.rgb', cellLight, lowerLinear), span);
  // Dither: the cell's Bayer threshold lifts a channel to the upper step where its share reaches it.
  const threshold = g.unary('threshold', 'pattern.bayer4.vec2', cells);
  const thresholdRgb = g.node('threshold-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(threshold, thresholdRgb, 'value');
  const stepUp = g.unary('step-up', 'math.floor.rgb', g.binary('share-raised', 'math.add.rgb', share, thresholdRgb));
  const indexed = g.node('dithered-raw', 'math.divide-ieee.rgb-scalar'); g.edge(g.binary('level-index', 'math.add.rgb', lowerIndex, stepUp), indexed, 'a'); g.edge(steps, indexed, 'b');
  const dithered = g.clamp('dithered', 'math.clamp.rgb-scalar', indexed, zero, one);
  // Mix: the dithered colour over the pixel's own colour by Amount, with the pixel's own alpha.
  const mixed = g.node('mixed-color', 'math.mix.rgb'); g.edge(ownRgb, mixed, 'a'); g.edge(dithered, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge(ownAlpha, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  // Pixel Size counts pixels of a 1080p frame, in whole output pixels (a 1.5-pixel Bayer cell would beat into a plaid).
  // The Cell Colour reads take the picture averaged over half a cell: each cell shows its whole colour and moves smoothly (patternCellFilter.ts).
  return prefilterCellTaps(measureInReferenceFrame({ version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout }, 'safe-scale',
    { minimumPixels: 1, wholePixels: true }), 'safe-scale-pixels');
}
