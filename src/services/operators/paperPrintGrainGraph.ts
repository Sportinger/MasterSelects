import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { measureInReferenceFrame } from './patternReferenceFrame';

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
  mix(id: string, operator: string, a: Ref, b: Ref, t: Ref) {
    const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); this.edge(t, out, 't'); return out;
  }
  fractal(id: string, position: Ref, octaves: number, roughness: number) {
    const out = this.node(id, 'noise.fractal2d.vec2'); this.edge(position, out, 'value');
    this.edge(this.number(`${id}-octaves`, octaves), out, 'octaves'); this.edge(this.number(`${id}-roughness`, roughness), out, 'roughness'); return out;
  }
}

/** The grain: Fractal Noise of two octaves, its cells Grain Size pixels of a 1080p frame (one cell = one grain), turned
 * by `turn` radians against the pixel grid. */
export const PAPER_PRINT_GRAIN = { octaves: 2, roughness: .5, turn: .5 } as const;
/**
 * The Even Out curve: 1 / (1 + e^−(linear·x + cubic·x³)) with x = noise − 0.5. It is the measured distribution of that
 * two-octave noise (within 0.2 %), so the grain threshold is spread evenly over 0..1: a share of ink c covers exactly
 * c of an area, and the print keeps the picture's brightness.
 */
export const PAPER_PRINT_EVEN = { linear: 13.46, cubic: 67.7 } as const;
/** How fast the evened threshold changes across one grain at a contour (measured mean, about 1.8 per grain): the ink
 * edge is that much divided by the grain in output pixels, one output pixel soft. */
export const PAPER_PRINT_EDGE = 1.8;
/** Smallest brightness gap between Paper and Ink the ink share divides by (equal brightness cannot carry a picture). */
export const PAPER_PRINT_SPAN_FLOOR = 1e-4;
/** Smallest edge width in threshold units: at a share of 0 or 1 the edge is hard, so paper stays clean and ink solid. */
export const PAPER_PRINT_EDGE_FLOOR = 1e-6;
/**
 * The paper's surface (Texture): Fractal Noise of three octaves with bumps of `size` pixels of a 1080p frame, moved by
 * `offset` so it never repeats the grain. At Texture 1 its valleys lift the grain's threshold by up to `salt` × their
 * depth below the middle, so the ink misses them (white specks in solid ink, about 8 % of it; mid-tones print up to
 * that much lighter), and it shades the whole print by ±`fibre` × its height (light in linear light).
 */
export const PAPER_PRINT_TEXTURE = { size: 3, octaves: 3, roughness: .5, offset: [37.17, 11.83], salt: 2, fibre: .2 } as const;

/**
 * Paper Print: the picture printed with one ink on paper by a stochastic grain, like a mezzotint or a grain photogravure.
 * Every pixel's brightness, in linear light, becomes the share of ink it needs between Paper and Ink; a smooth grain
 * (Fractal Noise, evened out to a uniform threshold) decides where the ink lands, with an edge one output pixel soft.
 * Over an area the ink covers exactly that share, so the print keeps the picture's tones; pure white stays clean
 * paper and pure black solid ink. Texture adds the paper's surface: fine bumps whose valleys the ink misses.
 * Grain Size counts pixels of a 1080p frame (patternReferenceFrame.ts).
 */
export function createDefaultPaperPrintGraph(): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const texture = g.node('texture', 'values.number', 'value', { value: 'texture' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const zero = g.number('zero', 0), one = g.number('one', 1), half = g.number('half', .5), two = g.number('two', 2);

  // Grain: the frame in grains of Grain Size output pixels (below 1 renders 1, renderMin), a smooth noise there, evened out to a threshold spread over 0..1.
  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution);
  const grainSize = g.binary('scale-clamped', 'math.max.scalar', scale, one);
  // The grain is turned against the pixel grid, so pixels read every part of its cells (an upright grain of whole pixels
  // would read the same few spots of each cell and miss its even spread).
  const turned = g.node('grain-turned', 'coordinates.rotate.vec2'); g.edge(pixel, turned, 'value'); g.edge(g.number('grain-turn', PAPER_PRINT_GRAIN.turn), turned, 'angle');
  const grainPosition = g.node('grain-position', 'math.divide-ieee.vec2-scalar'); g.edge(turned, grainPosition, 'a'); g.edge(grainSize, grainPosition, 'b');
  const noise = g.fractal('grain-noise', grainPosition, PAPER_PRINT_GRAIN.octaves, PAPER_PRINT_GRAIN.roughness);
  const centred = g.binary('grain-centred', 'math.subtract.scalar', noise, half);
  const cube = g.binary('grain-cube', 'math.multiply.scalar', g.binary('grain-square', 'math.multiply.scalar', centred, centred), centred);
  const spread = g.binary('even-spread', 'math.add.scalar', g.binary('even-linear', 'math.multiply.scalar', centred, g.number('even-linear-gain', PAPER_PRINT_EVEN.linear)),
    g.binary('even-cubic', 'math.multiply.scalar', cube, g.number('even-cubic-gain', PAPER_PRINT_EVEN.cubic)));
  const falloff = g.unary('even-falloff', 'math.exp.scalar', g.binary('even-negated', 'math.subtract.scalar', zero, spread));
  const threshold = g.binary('threshold', 'math.divide-ieee.scalar', one, g.binary('even-denominator', 'math.add.scalar', one, falloff));

  // Ink Share: how much ink each pixel needs so that ink and paper together have its brightness, in linear light.
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', g.number('tiny', .001)), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', g.number('almost-one', .999));
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(g.clamp('clamped-uv', 'math.clamp.vec2', uv, minUv, maxUv), sample, 'uv');
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
  const ownRgb = { node: split.node, port: 'rgb' }, ownAlpha = { node: split.node, port: 'alpha' };
  const linear = (id: string, rgb: Ref) => { const out = g.node(id, 'color.srgb-to-linear.rgb', 'rgb'); g.edge(rgb, out, 'rgb'); return out; };
  const light = (id: string, rgb: Ref) => { const out = g.node(id, 'color.luminance-rec709.rgb'); g.edge(rgb, out, 'rgb'); return out; };
  const inkRgb = g.node('ink-rgb', 'convert.vec4-to-rgb', 'rgb'), paperRgb = g.node('paper-rgb', 'convert.vec4-to-rgb', 'rgb');
  g.edge(colorA, inkRgb, 'value'); g.edge(colorB, paperRgb, 'value');
  const inkLinear = linear('ink-linear', inkRgb), paperLinear = linear('paper-linear', paperRgb);
  const pictureLight = light('picture-light', linear('picture-linear', ownRgb));
  const inkLight = light('ink-light', inkLinear), paperLight = light('paper-light', paperLinear);
  const span = g.binary('light-span', 'math.subtract.scalar', paperLight, inkLight), spanFloor = g.number('span-floor', PAPER_PRINT_SPAN_FLOOR);
  const safeSpan = g.node('safe-span', 'select.scalar');
  g.edge(g.binary('span-below', 'math.min.scalar', span, g.binary('span-floor-negative', 'math.subtract.scalar', zero, spanFloor)), safeSpan, 'falseValue');
  g.edge(g.binary('span-above', 'math.max.scalar', span, spanFloor), safeSpan, 'trueValue');
  const brighter = g.node('paper-brighter', 'compare.greater.scalar', 'condition'); g.edge(span, brighter, 'a'); g.edge(zero, brighter, 'b'); g.edge(brighter, safeSpan, 'condition');
  const share = g.clamp('ink-share', 'math.clamp.scalar',
    g.binary('ink-share-raw', 'math.divide-ieee.scalar', g.binary('light-missing', 'math.subtract.scalar', paperLight, pictureLight), safeSpan), zero, one);

  // Paper Surface (Texture): the paper's bumps; its valleys keep the ink away, and its height shades the print.
  const textureSize = g.number('texture-size', PAPER_PRINT_TEXTURE.size);
  const textureOffset = g.node('texture-offset', 'vector.combine.vec2');
  g.edge(g.number('texture-offset-x', PAPER_PRINT_TEXTURE.offset[0]), textureOffset, 'x'); g.edge(g.number('texture-offset-y', PAPER_PRINT_TEXTURE.offset[1]), textureOffset, 'y');
  const texturePosition = g.node('texture-position', 'math.divide-ieee.vec2-scalar'); g.edge(pixel, texturePosition, 'a'); g.edge(textureSize, texturePosition, 'b');
  const surface = g.fractal('surface-noise', g.binary('texture-shifted', 'math.add.vec2', texturePosition, textureOffset), PAPER_PRINT_TEXTURE.octaves, PAPER_PRINT_TEXTURE.roughness);
  const surfaceCentred = g.binary('surface-centred', 'math.subtract.scalar', surface, half);
  const valley = g.binary('valley-depth', 'math.max.scalar', g.binary('surface-below', 'math.subtract.scalar', zero, surfaceCentred), zero);
  // Texture below 0 renders 0 (renderMin; the card says so).
  const textureAmount = g.binary('texture-clamped', 'math.max.scalar', texture, zero);
  const valleyLift = g.binary('valley-lift', 'math.multiply.scalar', g.binary('valley-salt', 'math.multiply.scalar', valley, g.number('salt-gain', PAPER_PRINT_TEXTURE.salt)), textureAmount);
  const shade = g.binary('surface-shade', 'math.add.scalar', one,
    g.binary('surface-shading', 'math.multiply.scalar', g.binary('surface-fibre', 'math.multiply.scalar', surfaceCentred, g.number('fibre-gain', 2 * PAPER_PRINT_TEXTURE.fibre)), textureAmount));

  // Print: ink where the share is above the grain's threshold (lifted in the paper's valleys), with an edge one output
  // pixel soft that turns hard at a share of 0 and 1, so white stays clean paper and black solid ink.
  // The valleys fade out with the ink's share (× (1 − share)): deep ink stays solid instead of showing white specks.
  const fadedLift = g.binary('valley-lift-faded', 'math.multiply.scalar', valleyLift, g.binary('valley-ink-left', 'math.subtract.scalar', one, share));
  const lifted = g.binary('threshold-lifted', 'math.add.scalar', threshold, fadedLift);
  const edgeWidth = g.binary('edge-width', 'math.divide-ieee.scalar', g.number('edge-slope', PAPER_PRINT_EDGE), grainSize);
  const room = g.binary('edge-room', 'math.multiply.scalar', g.binary('share-nearest-end', 'math.min.scalar', share, g.binary('share-rest', 'math.subtract.scalar', one, share)), two);
  const width = g.binary('edge-fitted', 'math.max.scalar', g.binary('edge-inside', 'math.min.scalar', edgeWidth, room), g.number('edge-floor', PAPER_PRINT_EDGE_FLOOR));
  const above = g.binary('share-above', 'math.divide-ieee.scalar', g.binary('share-over-threshold', 'math.subtract.scalar', share, lifted), width);
  const coverage = g.clamp('ink-coverage', 'math.clamp.scalar', g.binary('ink-centred', 'math.add.scalar', above, half), zero, one);
  // Ink on paper in linear light, shaded by the paper's surface.
  const printedLinear = g.mix('printed-linear', 'math.mix.rgb', paperLinear, inkLinear, coverage);
  const shaded = g.node('printed-shaded', 'math.multiply.rgb-scalar'); g.edge(printedLinear, shaded, 'a'); g.edge(shade, shaded, 'b');
  const printed = g.node('printed', 'color.linear-to-srgb.rgb', 'rgb'); g.edge(g.clamp('printed-clamped', 'math.clamp.rgb-scalar', shaded, zero, one), printed, 'rgb');

  // Mix: the print over the picture by Amount, with the picture's own alpha.
  const mixed = g.mix('mixed', 'math.mix.rgb', ownRgb, printed, amount);
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge(ownAlpha, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  // Grain Size and the paper's blotches count pixels of a 1080p frame; a grain is never smaller than one output pixel.
  const graph = measureInReferenceFrame({ version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout }, 'scale-clamped', { minimumPixels: 1 });
  return measureInReferenceFrame(graph, 'texture-size');
}
