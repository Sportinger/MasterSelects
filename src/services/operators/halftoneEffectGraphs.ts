import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { measureInReferenceFrame } from './patternReferenceFrame';

export type EditableHalftoneEffectType = 'halftone' | 'pattern-halftone';
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
}

/** Exact dot coverage (HALFTONE_DOT): a round dot covers `darkness` of its cell up to π/4, where neighbours touch;
 * beyond that the paper left at the cell corners shrinks like √(1 − darkness) until √½ closes it (within 1.3 %). */
export const HALFTONE_DOT = { touch: Math.PI / 4, inversePi: 1 / Math.PI, corner: Math.SQRT1_2, cornerReach: (Math.SQRT1_2 - .5) / Math.sqrt(1 - Math.PI / 4) } as const;

/** Where Halftone reads the picture inside a cell: four points a quarter cell from its centre (HALFTONE_TAPS). */
export const HALFTONE_TAPS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
/** Weight of the pixel's own light in its cell tone: it decides only where all four points are transparent. */
export const HALFTONE_OWN_WEIGHT = .05;

interface CellLightRefs { frame: Ref; resolution: Ref; center: Ref; radians: Ref; divided: Ref; safeScale: Ref; half2: Ref;
  minUv: Ref; maxUv: Ref; zero: Ref; ownRgb: Ref; ownAlpha: Ref }
/**
 * Cell Tone: the light of the picture at four points of the pixel's cell, averaged in linear light and weighted by
 * their alpha (a cut-out edge does not darken the dots), so every dot of a cell is one clean circle.
 */
function cellLight(g: Builder, r: CellLightRefs): Ref {
  const cellCenter = g.binary('cell-center', 'math.add.vec2', g.unary('cell-index', 'math.floor.vec2', r.divided), r.half2);
  const centerPixels = g.node('cell-center-pixels', 'math.multiply.vec2-scalar'); g.edge(cellCenter, centerPixels, 'a'); g.edge(r.safeScale, centerPixels, 'b');
  const backRadians = g.binary('back-radians', 'math.subtract.scalar', r.zero, r.radians);
  const turnedBack = g.node('cell-center-turned', 'coordinates.rotate.vec2'); g.edge(g.binary('cell-center-relative', 'math.subtract.vec2', centerPixels, r.center), turnedBack, 'value'); g.edge(backRadians, turnedBack, 'angle');
  const centerUv = g.binary('cell-center-uv', 'math.divide-ieee.vec2', g.binary('cell-center-frame', 'math.add.vec2', turnedBack, r.center), r.resolution);
  // A quarter cell along each screen direction, turned back into the frame and measured in UV.
  const reach = g.binary('tap-reach', 'math.multiply.scalar', r.safeScale, g.number('quarter', .25));
  const axis = (name: 'x' | 'y') => {
    const along = g.node(`tap-${name}-pixels`, 'vector.combine.vec2'); g.edge(name === 'x' ? reach : r.zero, along, 'x'); g.edge(name === 'x' ? r.zero : reach, along, 'y');
    const turned = g.node(`tap-${name}-turned`, 'coordinates.rotate.vec2'); g.edge(along, turned, 'value'); g.edge(backRadians, turned, 'angle');
    return g.binary(`tap-${name}`, 'math.divide-ieee.vec2', turned, r.resolution);
  };
  const stepX = axis('x'), stepY = axis('y');
  const weighted = (id: string, rgb: Ref, alpha: Ref) => {
    const linear = g.node(`${id}-linear`, 'color.srgb-to-linear.rgb', 'rgb'); g.edge(rgb, linear, 'rgb');
    const light = g.node(`${id}-light`, 'color.luminance-rec709.rgb'); g.edge(linear, light, 'rgb');
    return g.binary(`${id}-light-alpha`, 'math.multiply.scalar', light, alpha);
  };
  const ownWeight = g.number('own-weight', HALFTONE_OWN_WEIGHT), ownAlpha = g.unary('own-alpha', 'convert.alpha-to-scalar', r.ownAlpha, 'alpha');
  let lightSum = g.binary('own-light-weighted', 'math.multiply.scalar', weighted('own', r.ownRgb, ownAlpha), ownWeight);
  let alphaSum = g.binary('own-alpha-weighted', 'math.multiply.scalar', ownAlpha, ownWeight);
  const diagonal = g.binary('tap-diagonal', 'math.add.vec2', stepX, stepY), antiDiagonal = g.binary('tap-anti-diagonal', 'math.subtract.vec2', stepX, stepY);
  HALFTONE_TAPS.forEach(([x, y], index) => {
    const id = `tap-${index + 1}`;
    const offset = x * y > 0 ? diagonal : antiDiagonal;
    const position = g.binary(`${id}-uv`, x > 0 ? 'math.add.vec2' : 'math.subtract.vec2', centerUv, offset);
    const clamped = g.node(`${id}-clamped-uv`, 'math.clamp.vec2'); g.edge(position, clamped, 'value'); g.edge(r.minUv, clamped, 'min'); g.edge(r.maxUv, clamped, 'max');
    const sample = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(r.frame, sample, 'image'); g.edge(clamped, sample, 'uv');
    const split = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
    const alpha = g.unary(`${id}-alpha`, 'convert.alpha-to-scalar', { node: split.node, port: 'alpha' }, 'alpha');
    lightSum = g.binary(`${id}-light-sum`, 'math.add.scalar', lightSum, weighted(id, { node: split.node, port: 'rgb' }, alpha));
    alphaSum = g.binary(`${id}-alpha-sum`, 'math.add.scalar', alphaSum, alpha);
  });
  const coverage = g.binary('cell-alpha', 'math.max.scalar', alphaSum, g.number('alpha-floor', 1e-6));
  return g.binary('tone', 'math.divide-ieee.scalar', lightSum, coverage);
}

/**
 * Shared granular construction for the two catalog halftone shaders. The dot screen is turned by Angle around
 * the frame centre in pixels, so cells stay square on every frame shape, and its cells count pixels of a 1080p
 * frame (patternReferenceFrame.ts). Dot edges are smoothed over one output pixel at every Dot Size.
 */
export function createDefaultHalftoneGraph(type: EditableHalftoneEffectType): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), angle = g.node('angle', 'values.number', 'value', { value: 'angle' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), half = g.number('half', .5);
  // Screen: the pixel position turned around the frame centre, then cut into cells of Dot Size pixels.
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution);
  const center = g.node('frame-center', 'math.multiply.vec2-scalar'); g.edge(resolution, center, 'a'); g.edge(half, center, 'b');
  const centered = g.binary('centered-pixel', 'math.subtract.vec2', pixel, center);
  const radians = g.unary('angle-radians', 'convert.degrees-to-radians.scalar', angle), rotated = g.node('rotated-center', 'coordinates.rotate.vec2');
  g.edge(centered, rotated, 'value'); g.edge(radians, rotated, 'angle');
  const screenPixel = g.binary('screen-pixel', 'math.add.vec2', rotated, center);
  const safeScale = g.node('safe-scale', 'math.max.scalar'); g.edge(scale, safeScale, 'a'); g.edge(two, safeScale, 'b');
  const safeScale2 = g.unary('safe-scale-vec2', 'convert.scalar-to-vec2', safeScale), divided = g.binary('cell-divided', 'math.divide-ieee.vec2', screenPixel, safeScale2);
  const fract = g.unary('cell-fract', 'math.fract.vec2', divided), cell = g.binary('cell', 'math.subtract.vec2', fract, half2);
  // Half the edge, in cells: half a pixel of this frame, so a dot edge is one pixel soft at every size.
  const edgeWidth = g.binary('edge-width', 'math.divide-ieee.scalar', g.number('half-pixel', .5), safeScale);
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny);
  const maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almost), clamped = g.node('clamped-uv', 'math.clamp.vec2');
  g.edge(uv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clamped, sample, 'uv');
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
  const rgb = { node: split.node, port: 'rgb' };
  let mark: Ref;
  if (type === 'halftone') {
    const light = cellLight(g, { frame, resolution, center, radians, divided, safeScale, half2, minUv, maxUv, zero, ownRgb: rgb, ownAlpha: { node: split.node, port: 'alpha' } });
    const darkness = g.node('darkness', 'math.clamp.scalar'); g.edge(g.binary('inverse-tone', 'math.subtract.scalar', one, light), darkness, 'value');
    g.edge(zero, darkness, 'min'); g.edge(one, darkness, 'max');
    // Dot: the round dot that covers exactly that share of its cell (HALFTONE_DOT).
    const smallRadius = g.unary('dot-radius-small', 'math.sqrt.scalar', g.binary('dot-area', 'math.multiply.scalar', darkness, g.number('inverse-pi', HALFTONE_DOT.inversePi)));
    const paperLeft = g.unary('paper-root', 'math.sqrt.scalar', g.binary('paper-left', 'math.subtract.scalar', one, darkness));
    const largeRadius = g.binary('dot-radius-large', 'math.subtract.scalar', g.number('cell-corner', HALFTONE_DOT.corner),
      g.binary('paper-gap', 'math.multiply.scalar', paperLeft, g.number('corner-reach', HALFTONE_DOT.cornerReach)));
    const touching = g.node('dots-touch', 'compare.greater.scalar', 'condition'); g.edge(darkness, touching, 'a'); g.edge(g.number('touch-share', HALFTONE_DOT.touch), touching, 'b');
    const radius = g.node('radius', 'select.scalar'); g.edge(smallRadius, radius, 'falseValue'); g.edge(largeRadius, radius, 'trueValue'); g.edge(touching, radius, 'condition');
    // Pure white leaves no dot and pure black fills the cell: the radius moves by up to half an edge towards either end.
    const bias = g.binary('radius-bias', 'math.multiply.scalar', g.binary('darkness-signed', 'math.subtract.scalar', g.binary('darkness-twice', 'math.multiply.scalar', darkness, two), one), edgeWidth);
    const dotRadius = g.binary('dot-radius', 'math.add.scalar', radius, bias);
    const low = g.binary('edge-low', 'math.subtract.scalar', dotRadius, edgeWidth), high = g.binary('edge-high', 'math.add.scalar', dotRadius, edgeWidth);
    const distance = g.unary('distance', 'vector.length.vec2', cell), edge = g.node('edge', 'math.smoothstep.scalar');
    g.edge(low, edge, 'edge0'); g.edge(high, edge, 'edge1'); g.edge(distance, edge, 'value'); mark = g.binary('mark', 'math.subtract.scalar', one, edge);
  } else {
    const tone = g.node('tone', 'color.luminance-rec709.rgb'); g.edge(rgb, tone, 'rgb');
    const inverseTone = g.binary('inverse-tone', 'math.subtract.scalar', one, tone);
    const radiusScale = g.number('radius-scale', .72), radius = g.binary('radius', 'math.multiply.scalar', inverseTone, radiusScale);
    const cellSplit = g.node('cell-split', 'vector.split.vec2', 'x'); g.edge(cell, cellSplit, 'value');
    const absX = g.unary('abs-x', 'math.abs.scalar', { node: cellSplit.node, port: 'x' }), absY = g.unary('abs-y', 'math.abs.scalar', { node: cellSplit.node, port: 'y' });
    const circle = g.unary('circle-distance', 'vector.length.vec2', cell), diamond = g.binary('diamond-distance', 'math.add.scalar', absX, absY);
    const shape = g.node('shape', 'values.choice', 'value', { value: 'shape' }), pointFive = g.number('point-five', .5), onePointFive = g.number('one-point-five', 1.5);
    const aboveHalf = g.node('shape-above-half', 'compare.greater.scalar', 'condition'); g.edge(shape, aboveHalf, 'a'); g.edge(pointFive, aboveHalf, 'b');
    const belowOneHalf = g.node('shape-below-one-half', 'compare.greater.scalar', 'condition'); g.edge(onePointFive, belowOneHalf, 'a'); g.edge(shape, belowOneHalf, 'b');
    const diamondCondition = g.node('shape-diamond', 'logic.and.boolean', 'value'); g.edge(aboveHalf, diamondCondition, 'a'); g.edge(belowOneHalf, diamondCondition, 'b');
    const diamondSelect = g.node('diamond-select', 'select.scalar'); g.edge(circle, diamondSelect, 'falseValue'); g.edge(diamond, diamondSelect, 'trueValue'); g.edge(diamondCondition, diamondSelect, 'condition');
    const lineCondition = g.node('shape-line', 'compare.greater.scalar', 'condition'); g.edge(shape, lineCondition, 'a'); g.edge(onePointFive, lineCondition, 'b');
    const distance = g.node('distance', 'select.scalar'); g.edge(diamondSelect, distance, 'falseValue'); g.edge(absY, distance, 'trueValue'); g.edge(lineCondition, distance, 'condition');
    const low = g.binary('edge-low', 'math.subtract.scalar', radius, edgeWidth), high = g.binary('edge-high', 'math.add.scalar', radius, edgeWidth);
    const edge = g.node('edge', 'math.smoothstep.scalar'); g.edge(low, edge, 'edge0'); g.edge(high, edge, 'edge1'); g.edge(distance, edge, 'value');
    mark = g.binary('mark', 'math.subtract.scalar', one, edge);
  }
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value');
  const bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorB, bRgb, 'value');
  const ink = g.node('ink-color', 'math.mix.rgb'); g.edge(bRgb, ink, 'a'); g.edge(aRgb, ink, 'b'); g.edge(mark, ink, 't');
  const mixed = g.node('mixed-color', 'math.mix.rgb'); g.edge(rgb, mixed, 'a'); g.edge(ink, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  // Dot Size counts pixels of a 1080p frame (patternReferenceFrame.ts); the screen cells and the edge width read the measured size.
  return measureInReferenceFrame({ version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout }, 'safe-scale', { minimumPixels: 1 });
}
