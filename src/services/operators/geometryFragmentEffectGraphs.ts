import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorValue } from '../../types/operatorGraph';

export type EditableGeometryFragmentEffectType = 'contour-map' | 'crosshatch' | 'kilim' | 'vector-tiling' | 'embroidery' | 'outline' | 'bricks';
type Ref = { node: string; port: string };

class GraphBuilder {
  readonly nodes: BoundOperatorNode[] = []; readonly edges: OperatorEdge[] = []; readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, column: number, bindings: Record<string, string> = {}, constants?: Record<string, OperatorValue>): Ref {
    const row = this.nodes.filter(node => this.layout[node.id]?.x === column * 300).length;
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: column * 300, y: row * 180 };
    const port = operator === 'image.frame' || operator === 'image.sample' || operator === 'vector.combine.rgba' ? 'image'
      : operator === 'image.normalized-uv' ? 'uv' : operator === 'convert.vec4-to-rgb' ? 'rgb' : 'value';
    return { node: id, port };
  }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  literal(id: string, value: number) { return this.node(id, 'values.number', 0, {}, { value }); }
  unary(id: string, operator: string, value: Ref, column: number, input = 'value') { const out = this.node(id, operator, column); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref, column: number) { const out = this.node(id, operator, column); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  vec2(id: string, x: Ref, y: Ref, column: number) { const out = this.node(id, 'vector.combine.vec2', column); this.edge(x, out, 'x'); this.edge(y, out, 'y'); return out; }
}

function common(g: GraphBuilder, options: { tone: boolean; colors: 'both' | 'a' | 'none' }) {
  const frame = g.node('frame', 'image.frame', 0), uv = g.node('uv', 'image.normalized-uv', 0), resolution = g.node('resolution', 'image.resolution', 0);
  const zero = g.literal('zero', 0), one = g.literal('one', 1), clampMin = g.literal('clamp-min', .001), clampMax = g.literal('clamp-max', .999);
  const min2 = g.unary('clamp-min-vec2', 'convert.scalar-to-vec2', clampMin, 1), max2 = g.unary('clamp-max-vec2', 'convert.scalar-to-vec2', clampMax, 1);
  const clampedUv = g.node('clamped-uv', 'math.clamp.vec2', 2); g.edge(uv, clampedUv, 'value'); g.edge(min2, clampedUv, 'min'); g.edge(max2, clampedUv, 'max');
  const source = g.node('source', 'image.sample', 3); g.edge(frame, source, 'image'); g.edge(clampedUv, source, 'uv');
  const sourceColor = g.unary('source-color', 'vector.split.rgba', source, 4, 'image');
  const tone = options.tone ? g.unary('source-tone', 'color.luminance-rec709.image', source, 4, 'image') : undefined;
  const amount = g.node('amount', 'values.number', 0, { value: 'amount' });
  const colorA = options.colors !== 'none' ? g.unary('color-a-rgb', 'convert.vec4-to-rgb', g.node('color-a', 'values.color', 0, { value: 'colorA' }), 4) : undefined;
  const colorB = options.colors === 'both' ? g.unary('color-b-rgb', 'convert.vec4-to-rgb', g.node('color-b', 'values.color', 0, { value: 'colorB' }), 4) : undefined;
  return { frame, uv, resolution, zero, one, min2, max2, sourceColor, tone, amount, colorA, colorB };
}

function sampleAt(g: GraphBuilder, c: ReturnType<typeof common>, id: string, uv: Ref, column: number) {
  const clamped = g.node(`${id}-clamped-uv`, 'math.clamp.vec2', column); g.edge(uv, clamped, 'value'); g.edge(c.min2, clamped, 'min'); g.edge(c.max2, clamped, 'max');
  const sample = g.node(id, 'image.sample', column + 1); g.edge(c.frame, sample, 'image'); g.edge(clamped, sample, 'uv'); return sample;
}

function finish(g: GraphBuilder, sourceColor: Ref, styled: Ref, amount: Ref, alpha: Ref = { node: sourceColor.node, port: 'alpha' }) {
  const mixed = g.node('mixed', 'math.mix.rgb', 16); g.edge({ node: sourceColor.node, port: 'rgb' }, mixed, 'a'); g.edge(styled, mixed, 'b'); g.edge(amount, mixed, 't');
  const combined = g.node('combined', 'vector.combine.rgba', 17); g.edge(mixed, combined, 'rgb'); g.edge(alpha, combined, 'alpha');
  const output = g.node('output', 'image.output', 18); g.edge(combined, output, 'image');
}

function contourMap(g: GraphBuilder, c: ReturnType<typeof common>) {
  const scale = g.node('scale', 'values.number', 0, { value: 'scale' }), three = g.literal('three', 3), point35 = g.literal('point-35', .35);
  const levels = g.binary('levels', 'math.max.scalar', three, g.binary('scaled-levels', 'math.multiply.scalar', scale, point35, 5), 6);
  const toneLevels = g.binary('tone-levels', 'math.multiply.scalar', c.tone!, levels, 7);
  const denominator = g.binary('level-denominator', 'math.max.scalar', c.one, g.binary('levels-minus-one', 'math.subtract.scalar', levels, c.one, 7), 8);
  const quantized = g.binary('quantized', 'math.divide-ieee.scalar', g.unary('quantized-floor', 'math.floor.scalar', toneLevels, 8), denominator, 9);
  const band = g.node('band-color', 'math.mix.rgb', 10); g.edge(c.colorA!, band, 'a'); g.edge(c.colorB!, band, 'b'); g.edge(quantized, band, 't');
  const centered = g.binary('band-centered', 'math.subtract.scalar', g.unary('band-fraction', 'math.fract.scalar', toneLevels, 8), g.literal('half', .5), 9);
  const distance = g.unary('band-distance', 'math.abs.scalar', centered, 10), smooth = g.node('line-smooth', 'math.smoothstep.scalar', 11);
  g.edge(g.literal('line-low', .02), smooth, 'edge0'); g.edge(g.literal('line-high', .09), smooth, 'edge1'); g.edge(distance, smooth, 'value');
  const line = g.binary('line', 'math.subtract.scalar', c.one, smooth, 12);
  const brightness = g.binary('band-brightness', 'math.add.scalar', g.literal('brightness-base', .72),
    g.binary('line-gain', 'math.multiply.scalar', line, g.literal('brightness-gain', .28), 12), 13);
  const styled = g.node('styled', 'math.multiply.rgb-scalar', 14); g.edge(band, styled, 'a'); g.edge(brightness, styled, 'b'); finish(g, c.sourceColor, styled, c.amount);
}

function crosshatch(g: GraphBuilder, c: ReturnType<typeof common>) {
  const scale = g.node('scale', 'values.number', 0, { value: 'scale' }), safeScale = g.binary('safe-scale', 'math.max.scalar', scale, g.literal('minimum-scale', 2), 5);
  const pixel = (() => { const out = g.node('pattern-pixel', 'math.divide-ieee.vec2-scalar', 7); g.edge(g.binary('pixel', 'math.multiply.vec2', c.uv, c.resolution, 6), out, 'a'); g.edge(safeScale, out, 'b'); return out; })();
  const split = g.unary('pixel-components', 'vector.split.vec2', pixel, 8), x = { node: split.node, port: 'x' }, y = { node: split.node, port: 'y' };
  const line = (id: string, coordinate: Ref, low: number, high: number) => {
    const centered = g.binary(`${id}-centered`, 'math.subtract.scalar', g.unary(`${id}-fraction`, 'math.fract.scalar', coordinate, 9), g.literal(`${id}-half`, .5), 10);
    const smooth = g.node(`${id}-smooth`, 'math.smoothstep.scalar', 12); g.edge(g.literal(`${id}-low`, low), smooth, 'edge0');
    g.edge(g.literal(`${id}-high`, high), smooth, 'edge1'); g.edge(g.unary(`${id}-distance`, 'math.abs.scalar', centered, 11), smooth, 'value');
    return g.binary(id, 'math.subtract.scalar', c.one, smooth, 13);
  };
  const first = line('first', g.binary('first-coordinate', 'math.add.scalar', x, y, 9), .06, .15);
  const second = line('second', g.binary('second-coordinate', 'math.subtract.scalar', x, y, 9), .06, .15);
  const third = line('third', g.binary('third-coordinate', 'math.multiply.scalar', x, g.literal('third-half-scale', .5), 9), .05, .13);
  const gated = (id: string, value: Ref, threshold: number) => { const gate = g.node(`${id}-gate`, 'math.step.scalar', 12); g.edge(c.tone!, gate, 'edge'); g.edge(g.literal(`${id}-tone-limit`, threshold), gate, 'value'); return g.binary(id, 'math.multiply.scalar', value, gate, 14); };
  const hatch = g.binary('hatch', 'math.max.scalar', gated('first-gated', first, .82),
    g.binary('dark-hatch', 'math.max.scalar', gated('second-gated', second, .58), gated('third-gated', third, .32), 15), 15);
  const styled = g.node('styled', 'math.mix.rgb', 15); g.edge(c.colorB!, styled, 'a'); g.edge(c.colorA!, styled, 'b'); g.edge(hatch, styled, 't'); finish(g, c.sourceColor, styled, c.amount);
}

function kilim(g: GraphBuilder, c: ReturnType<typeof common>) {
  const scale = g.node('scale', 'values.number', 0, { value: 'scale' }), safeScale = g.binary('safe-scale', 'math.max.scalar', scale, g.literal('minimum-scale', 4), 5);
  const grid = (() => { const out = g.node('grid', 'math.divide-ieee.vec2-scalar', 7); g.edge(g.binary('pixel', 'math.multiply.vec2', c.uv, c.resolution, 6), out, 'a'); g.edge(safeScale, out, 'b'); return out; })();
  const cell = g.binary('cell', 'math.subtract.vec2', g.unary('grid-fraction', 'math.fract.vec2', grid, 8),
    g.unary('half-vec2', 'convert.scalar-to-vec2', g.literal('half', .5), 7), 9);
  const cellParts = g.unary('cell-components', 'vector.split.vec2', cell, 10), gridFloor = g.unary('grid-floor', 'math.floor.vec2', grid, 8);
  const gridParts = g.unary('grid-components', 'vector.split.vec2', gridFloor, 9);
  const absX = g.unary('cell-x-abs', 'math.abs.scalar', { node: cellParts.node, port: 'x' }, 11);
  const absY = g.unary('cell-y-abs', 'math.abs.scalar', { node: cellParts.node, port: 'y' }, 11);
  const diamondEdge = g.binary('diamond-edge', 'math.add.scalar', absX, absY, 12);
  const wave = g.unary('diamond-wave', 'math.sin.scalar', g.binary('row-phase', 'math.multiply.scalar', { node: gridParts.node, port: 'y' }, g.literal('row-frequency', 1.7), 10), 11);
  const diamondLimit = g.binary('diamond-limit', 'math.add.scalar', g.literal('diamond-base', .38),
    g.binary('diamond-wave-gain', 'math.multiply.scalar', g.literal('diamond-gain', .12), wave, 12), 13);
  const diamond = g.node('diamond', 'math.step.scalar', 14); g.edge(diamondEdge, diamond, 'edge'); g.edge(diamondLimit, diamond, 'value');
  const stripePhase = g.binary('stripe-phase', 'math.add.scalar',
    g.binary('stripe-x', 'math.multiply.scalar', { node: gridParts.node, port: 'x' }, g.literal('stripe-x-scale', .5), 11),
    g.binary('stripe-y', 'math.multiply.scalar', { node: gridParts.node, port: 'y' }, g.literal('stripe-y-scale', .25), 11), 12);
  const stripe = g.node('stripe', 'math.step.scalar', 14); g.edge(g.literal('stripe-edge', .5), stripe, 'edge'); g.edge(g.unary('stripe-fraction', 'math.fract.scalar', stripePhase, 13), stripe, 'value');
  const pattern = g.unary('textile-pattern', 'math.abs.scalar', g.binary('diamond-stripe', 'math.subtract.scalar', diamond, stripe, 15), 15);
  const textile = g.node('textile', 'math.mix.rgb', 15); g.edge(c.colorA!, textile, 'a'); g.edge(c.colorB!, textile, 'b'); g.edge(pattern, textile, 't');
  const brightness = g.binary('textile-brightness', 'math.add.scalar', g.literal('brightness-base', .6),
    g.binary('tone-gain', 'math.multiply.scalar', g.literal('brightness-gain', .4), c.tone!, 14), 15);
  const styled = g.node('styled', 'math.multiply.rgb-scalar', 15); g.edge(textile, styled, 'a'); g.edge(brightness, styled, 'b'); finish(g, c.sourceColor, styled, c.amount);
}

function vectorTiling(g: GraphBuilder, c: ReturnType<typeof common>) {
  const half = g.literal('half', .5), half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half, 4);
  // Keep conversion in WGSL so legacy `(angle * PI) / 180` rounding is retained.
  const angleDegrees = g.binary('angle-degrees', 'math.add.scalar', g.node('angle', 'values.number', 0, { value: 'angle' }), c.zero, 4);
  const angle = g.unary('angle-radians', 'convert.degrees-to-radians.scalar', angleDegrees, 5);
  const centered = g.binary('centered-uv', 'math.subtract.vec2', c.uv, half2, 5);
  const rotated = g.node('rotated', 'coordinates.rotate.vec2', 6); g.edge(centered, rotated, 'value'); g.edge(angle, rotated, 'angle');
  const geometryUv = g.binary('geometry-uv', 'math.add.vec2', rotated, half2, 7);
  const scale = g.node('scale', 'values.number', 0, { value: 'scale' }), safeScale = g.binary('safe-scale', 'math.max.scalar', scale, g.literal('minimum-scale', 3), 5);
  const safeScale2 = g.unary('safe-scale-vec2', 'convert.scalar-to-vec2', safeScale, 6), grid = g.binary('grid', 'math.divide-ieee.vec2', c.resolution, safeScale2, 7);
  const gridUv = g.binary('grid-uv', 'math.multiply.vec2', geometryUv, grid, 8), cell = g.binary('cell', 'math.subtract.vec2',
    g.unary('cell-fraction', 'math.fract.vec2', gridUv, 9), half2, 10);
  const centerCell = g.binary('center-cell', 'math.add.vec2', g.unary('cell-id', 'math.floor.vec2', gridUv, 9), half2, 10);
  const sampleUv = g.binary('sample-uv', 'math.divide-ieee.vec2', centerCell, grid, 11), centerSample = sampleAt(g, c, 'center-sample', sampleUv, 12);
  const centerTone = g.unary('center-tone', 'color.luminance-rec709.image', centerSample, 14, 'image');
  const parts = g.unary('cell-components', 'vector.split.vec2', cell, 11), x = { node: parts.node, port: 'x' }, y = { node: parts.node, port: 'y' };
  const wave = g.binary('wave-amplitude', 'math.multiply.scalar',
    g.unary('wave', 'math.sin.scalar', g.binary('wave-phase', 'math.multiply.scalar', x, g.literal('wave-frequency', 10), 12), 13),
    g.binary('inverse-tone', 'math.subtract.scalar', c.one, centerTone, 13), 14);
  const waveScaled = g.binary('wave-scaled', 'math.multiply.scalar', wave, g.literal('wave-scale', .18), 14);
  const distance = g.unary('engraving-distance', 'math.abs.scalar', g.binary('engraving-offset', 'math.subtract.scalar', y, waveScaled, 14), 15);
  const smooth = g.node('engraving-smooth', 'math.smoothstep.scalar', 15); g.edge(g.literal('engraving-low', .025), smooth, 'edge0');
  g.edge(g.literal('engraving-high', .09), smooth, 'edge1'); g.edge(distance, smooth, 'value');
  const engraving = g.binary('engraving', 'math.subtract.scalar', c.one, smooth, 15);
  const styled = g.node('styled', 'math.mix.rgb', 15); g.edge(c.colorB!, styled, 'a'); g.edge(c.colorA!, styled, 'b'); g.edge(engraving, styled, 't');
  finish(g, c.sourceColor, styled, c.amount);
}

function embroidery(g: GraphBuilder, c: ReturnType<typeof common>) {
  const scale = g.node('scale', 'values.number', 0, { value: 'scale' }), safeScale = g.binary('safe-scale', 'math.max.scalar', scale, g.literal('minimum-scale', 3), 5);
  const safeScale2 = g.unary('safe-scale-vec2', 'convert.scalar-to-vec2', safeScale, 6), grid = g.binary('grid', 'math.divide-ieee.vec2', c.resolution, safeScale2, 7);
  const cell = g.binary('cell', 'math.subtract.vec2', g.unary('cell-fraction', 'math.fract.vec2', g.binary('grid-uv', 'math.multiply.vec2', c.uv, grid, 8), 9),
    g.unary('half-vec2', 'convert.scalar-to-vec2', g.literal('half', .5), 8), 10);
  const parts = g.unary('cell-components', 'vector.split.vec2', cell, 11), x = { node: parts.node, port: 'x' }, y = { node: parts.node, port: 'y' };
  const time = g.node('time', 'image.timeline-time', 0), speed = g.node('speed', 'values.number', 0, { value: 'speed' });
  const spatial = g.binary('spatial-phase', 'math.multiply.scalar', x, g.literal('tau', 6.28318530718), 11);
  const temporal = g.binary('temporal-phase', 'math.multiply.scalar', g.binary('time-speed', 'math.multiply.scalar', time, speed, 10), g.literal('time-scale', 2), 11);
  const wave = g.binary('wave', 'math.multiply.scalar', g.unary('wave-sine', 'math.sin.scalar', g.binary('phase', 'math.add.scalar', spatial, temporal, 12), 13),
    g.literal('wave-scale', .16), 14);
  const distance = g.unary('thread-distance', 'math.abs.scalar', g.binary('thread-offset', 'math.subtract.scalar', y, wave, 14), 15);
  const smooth = g.node('thread-smooth', 'math.smoothstep.scalar', 15); g.edge(g.literal('thread-low', .04), smooth, 'edge0');
  g.edge(g.literal('thread-high', .12), smooth, 'edge1'); g.edge(distance, smooth, 'value');
  const thread = g.binary('thread', 'math.subtract.scalar', c.one, smooth, 15);
  const fiberBase = g.node('fiber-base', 'math.mix.rgb', 14); g.edge(c.colorA!, fiberBase, 'a'); g.edge({ node: c.sourceColor.node, port: 'rgb' }, fiberBase, 'b'); g.edge(g.literal('source-mix', .65), fiberBase, 't');
  const brightness = g.binary('fiber-brightness', 'math.add.scalar', g.literal('brightness-base', .72),
    g.binary('thread-gain', 'math.multiply.scalar', thread, g.literal('brightness-gain', .38), 14), 15);
  const styled = g.node('styled', 'math.multiply.rgb-scalar', 15); g.edge(fiberBase, styled, 'a'); g.edge(brightness, styled, 'b');
  finish(g, c.sourceColor, styled, c.amount);
}

function outline(g: GraphBuilder, c: ReturnType<typeof common>) {
  const one2 = g.unary('one-vec2', 'convert.scalar-to-vec2', c.one, 5), pixel = g.binary('pixel-size', 'math.divide-ieee.vec2', one2, c.resolution, 6);
  const parts = g.unary('pixel-components', 'vector.split.vec2', pixel, 7), px = { node: parts.node, port: 'x' }, py = { node: parts.node, port: 'y' };
  const horizontal = g.vec2('horizontal-offset', px, c.zero, 8), vertical = g.vec2('vertical-offset', c.zero, py, 8);
  const tone = (id: string, uv: Ref) => g.unary(`${id}-tone`, 'color.luminance-rec709.image', sampleAt(g, c, `${id}-sample`, uv, 10), 12, 'image');
  const right = tone('right', g.binary('right-uv', 'math.add.vec2', c.uv, horizontal, 9));
  const left = tone('left', g.binary('left-uv', 'math.subtract.vec2', c.uv, horizontal, 9));
  const down = tone('down', g.binary('down-uv', 'math.add.vec2', c.uv, vertical, 9));
  const up = tone('up', g.binary('up-uv', 'math.subtract.vec2', c.uv, vertical, 9));
  const gradient = g.vec2('gradient', g.binary('horizontal', 'math.subtract.scalar', right, left, 13), g.binary('vertical', 'math.subtract.scalar', down, up, 13), 14);
  const magnitude = g.unary('gradient-length', 'vector.length.vec2', gradient, 15);
  const time = g.node('time', 'image.timeline-time', 0), speed = g.node('speed', 'values.number', 0, { value: 'speed' });
  const pulse = g.binary('pulse', 'math.add.scalar', c.one, g.binary('pulse-gain', 'math.multiply.scalar', g.literal('pulse-scale', .25),
    g.unary('pulse-sine', 'math.sin.scalar', g.binary('time-speed', 'math.multiply.scalar', time, speed, 10), 11), 12), 13);
  const edgeInput = g.binary('edge-input', 'math.multiply.scalar', magnitude, pulse, 15), edge = g.node('edge', 'math.smoothstep.scalar', 15);
  g.edge(g.literal('edge-low', .04), edge, 'edge0'); g.edge(g.literal('edge-high', .24), edge, 'edge1'); g.edge(edgeInput, edge, 'value');
  const styled = g.node('styled', 'math.mix.rgb', 15); g.edge(c.colorB!, styled, 'a'); g.edge(c.colorA!, styled, 'b'); g.edge(edge, styled, 't');
  finish(g, c.sourceColor, styled, c.amount);
}

function bricks(g: GraphBuilder, c: ReturnType<typeof common>) {
  const scale = g.node('scale', 'values.number', 0, { value: 'scale' }), size = g.binary('brick-size', 'math.max.scalar', scale, g.literal('minimum-scale', 5), 5);
  const wide = g.binary('brick-width', 'math.multiply.scalar', size, g.literal('brick-aspect', 1.6), 6), brick = g.vec2('brick-vector', wide, size, 7);
  const gridBase = g.binary('grid-base', 'math.divide-ieee.vec2', g.binary('pixel', 'math.multiply.vec2', c.uv, c.resolution, 6), brick, 8);
  const baseParts = g.unary('grid-base-components', 'vector.split.vec2', gridBase, 9), baseX = { node: baseParts.node, port: 'x' }, baseY = { node: baseParts.node, port: 'y' };
  const shiftedX = g.binary('shifted-x', 'math.add.scalar', baseX, g.binary('row-offset', 'math.multiply.scalar',
    g.unary('row', 'math.floor.scalar', baseY, 10), g.literal('row-shift', .5), 11), 12);
  const grid = g.vec2('grid', shiftedX, baseY, 13), id = g.unary('brick-id', 'math.floor.vec2', grid, 14), local = g.unary('local', 'math.fract.vec2', grid, 14);
  const idParts = g.unary('brick-id-components', 'vector.split.vec2', id, 15), idX = { node: idParts.node, port: 'x' }, idY = { node: idParts.node, port: 'y' };
  const originalX = g.binary('original-cell-x', 'math.subtract.scalar', idX, g.binary('original-row-offset', 'math.multiply.scalar',
    g.unary('original-row', 'math.floor.scalar', idY, 10), g.literal('original-row-shift', .5), 11), 12);
  const originalCell = g.vec2('original-cell', originalX, idY, 13), half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', g.literal('half', .5), 12);
  const centerPixels = g.binary('center-pixels', 'math.multiply.vec2', g.binary('center-cell', 'math.add.vec2', originalCell, half2, 13), brick, 14);
  const sampleUv = g.binary('sample-uv', 'math.divide-ieee.vec2', centerPixels, c.resolution, 15), sampled = sampleAt(g, c, 'brick-sample', sampleUv, 12);
  const sampledColor = g.unary('brick-color', 'vector.split.rgba', sampled, 14, 'image'), height = g.unary('brick-tone', 'color.luminance-rec709.image', sampled, 14, 'image');
  const localParts = g.unary('local-components', 'vector.split.vec2', local, 15), lx = { node: localParts.node, port: 'x' }, ly = { node: localParts.node, port: 'y' };
  const edgeX = g.binary('edge-x', 'math.min.scalar', lx, g.binary('one-minus-x', 'math.subtract.scalar', c.one, lx, 14), 15);
  const edgeY = g.binary('edge-y', 'math.min.scalar', ly, g.binary('one-minus-y', 'math.subtract.scalar', c.one, ly, 14), 15);
  const bevel = g.binary('bevel', 'math.min.scalar', edgeX, edgeY, 15), bevelSmooth = g.node('bevel-smooth', 'math.smoothstep.scalar', 15);
  g.edge(c.zero, bevelSmooth, 'edge0'); g.edge(g.literal('bevel-width', .16), bevelSmooth, 'edge1'); g.edge(bevel, bevelSmooth, 'value');
  const lightBase = g.binary('light-base', 'math.add.scalar', g.literal('light-minimum', .58),
    g.binary('bevel-light', 'math.multiply.scalar', bevelSmooth, g.literal('bevel-gain', .52), 14), 15);
  const light = g.binary('light', 'math.add.scalar', lightBase, g.binary('height-light', 'math.multiply.scalar', height, g.literal('height-gain', .18), 14), 15);
  const time = g.node('time', 'image.timeline-time', 0), speed = g.node('speed', 'values.number', 0, { value: 'speed' });
  const phase = g.binary('pulse-phase', 'math.add.scalar', g.binary('time-speed', 'math.multiply.scalar', time, speed, 10),
    g.binary('hash-phase', 'math.multiply.scalar', g.unary('brick-hash', 'noise.hash2d.vec2', id, 11), g.literal('tau', 6.28318530718), 12), 13);
  const pulse = g.binary('pulse', 'math.add.scalar', c.one, g.binary('pulse-gain', 'math.multiply.scalar', g.literal('pulse-scale', .04),
    g.unary('pulse-sine', 'math.sin.scalar', phase, 14), 15), 15);
  const lit = g.node('lit-color', 'math.multiply.rgb-scalar', 15); g.edge({ node: sampledColor.node, port: 'rgb' }, lit, 'a'); g.edge(light, lit, 'b');
  const styled = g.node('styled', 'math.multiply.rgb-scalar', 15); g.edge(lit, styled, 'a'); g.edge(pulse, styled, 'b');
  finish(g, c.sourceColor, styled, c.amount, { node: sampledColor.node, port: 'alpha' });
}

export function createDefaultGeometryFragmentGraph(type: EditableGeometryFragmentEffectType): EffectOperatorGraph {
  const g = new GraphBuilder(), c = common(g, {
    tone: type === 'contour-map' || type === 'crosshatch' || type === 'kilim',
    colors: type === 'embroidery' ? 'a' : type === 'bricks' ? 'none' : 'both',
  });
  if (type === 'contour-map') contourMap(g, c);
  else if (type === 'crosshatch') crosshatch(g, c);
  else if (type === 'kilim') kilim(g, c);
  else if (type === 'vector-tiling') vectorTiling(g, c);
  else if (type === 'embroidery') embroidery(g, c);
  else if (type === 'outline') outline(g, c);
  else bricks(g, c);
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
