import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableMotionHalftoneEffectType = 'glitch-grid' | 'scatter-mosaic' | 'drift-lines';
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

/** Shared granular construction for the animated grid-based halftone effects. */
export function createDefaultMotionHalftoneGraph(type: EditableMotionHalftoneEffectType): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv'), resolution = g.node('resolution', 'image.resolution');
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const speed = g.node('speed', 'values.number', 'value', { value: 'speed' }), time = g.node('time', 'image.timeline-time');
  const zero = g.number('zero', 0), half = g.number('half', .5), two = g.number('two', 2), three = g.number('three', 3);
  const safeMinimum = type === 'scatter-mosaic' ? three : two, safeScale = g.node('safe-scale', 'math.max.scalar'); g.edge(scale, safeScale, 'a'); g.edge(safeMinimum, safeScale, 'b');
  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution), scale2 = g.unary('scale-vec2', 'convert.scalar-to-vec2', safeScale);
  const cells = g.binary('cells', 'math.divide-ieee.vec2', pixel, scale2), cell = g.unary('cell', 'math.floor.vec2', cells);
  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed);
  let sampleUv: Ref;
  if (type === 'glitch-grid') {
    const eight = g.number('eight', 8), tickBase = g.binary('tick-base', 'math.multiply.scalar', timeSpeed, eight), tick = g.unary('tick', 'math.floor.scalar', tickBase);
    const tick2 = g.unary('tick-vec2', 'convert.scalar-to-vec2', tick), cellTick = g.binary('cell-tick', 'math.add.vec2', cell, tick2);
    const jumpHash = g.unary('jump-hash', 'noise.hash2d.vec2', cellTick), centered = g.binary('centered-hash', 'math.subtract.scalar', jumpHash, half);
    const jump = g.binary('jump', 'math.multiply.scalar', centered, amount), cellSplit = g.node('cell-split', 'vector.split.vec2', 'x'); g.edge(cell, cellSplit, 'value');
    const bandTick = g.node('band-tick', 'vector.combine.vec2'); g.edge({ node: cellSplit.node, port: 'y' }, bandTick, 'x'); g.edge(tick, bandTick, 'y');
    const enabledHash = g.unary('enabled-hash', 'noise.hash2d.vec2', bandTick), threshold = g.number('threshold', .82), enabled = g.node('enabled', 'math.step.scalar');
    g.edge(threshold, enabled, 'edge'); g.edge(enabledHash, enabled, 'value');
    const enabledJump = g.binary('enabled-jump', 'math.multiply.scalar', jump, enabled), shift = g.binary('shift', 'math.multiply.scalar', enabledJump, g.number('shift-scale', .12));
    const offset = g.node('offset', 'vector.combine.vec2'); g.edge(shift, offset, 'x'); g.edge(zero, offset, 'y'); sampleUv = g.binary('sample-uv', 'math.add.vec2', uv, offset);
  } else if (type === 'scatter-mosaic') {
    const hashX = g.unary('hash-x', 'noise.hash2d.vec2', cell), seventeen2 = g.unary('seventeen-vec2', 'convert.scalar-to-vec2', g.number('seventeen', 17));
    const shiftedCell = g.binary('shifted-cell', 'math.add.vec2', cell, seventeen2), hashY = g.unary('hash-y', 'noise.hash2d.vec2', shiftedCell);
    const hashes = g.node('hashes', 'vector.combine.vec2'); g.edge(hashX, hashes, 'x'); g.edge(hashY, hashes, 'y');
    const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), jitter = g.binary('jitter', 'math.subtract.vec2', hashes, half2);
    const tau = g.number('tau', Math.PI * 2), hashPhase = g.binary('hash-phase', 'math.multiply.scalar', hashX, tau);
    const driftPhase = g.binary('drift-phase', 'math.add.scalar', timeSpeed, hashPhase), drift = g.unary('drift', 'math.sin.scalar', driftPhase);
    const jitterAmount = g.node('jitter-amount', 'math.multiply.vec2-scalar'); g.edge(jitter, jitterAmount, 'a'); g.edge(amount, jitterAmount, 'b');
    const jitterDrift = g.node('jitter-drift', 'math.multiply.vec2-scalar'); g.edge(jitterAmount, jitterDrift, 'a'); g.edge(drift, jitterDrift, 'b');
    const center = g.binary('cell-center', 'math.add.vec2', cell, half2), displaced = g.binary('displaced-cell', 'math.add.vec2', center, jitterDrift);
    const gridPosition = g.node('grid-position', 'math.multiply.vec2-scalar'); g.edge(displaced, gridPosition, 'a'); g.edge(safeScale, gridPosition, 'b');
    sampleUv = g.binary('sample-uv', 'math.divide-ieee.vec2', gridPosition, resolution);
  } else {
    const uvSplit = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, uvSplit, 'value'); const resolutionSplit = g.node('resolution-split', 'vector.split.vec2', 'x'); g.edge(resolution, resolutionSplit, 'value');
    const yPixel = g.binary('y-pixel', 'math.multiply.scalar', { node: uvSplit.node, port: 'y' }, { node: resolutionSplit.node, port: 'y' });
    const rowBase = g.binary('row-base', 'math.divide-ieee.scalar', yPixel, safeScale), row = g.unary('row', 'math.floor.scalar', rowBase);
    const rowPhase = g.binary('row-phase', 'math.multiply.scalar', row, g.number('row-rate', .71)), timePhase = g.binary('time-phase', 'math.multiply.scalar', timeSpeed, two);
    const phase = g.binary('shift-phase', 'math.add.scalar', rowPhase, timePhase), sine = g.unary('shift-sine', 'math.sin.scalar', phase);
    const waveAmount = g.binary('shift-amount', 'math.multiply.scalar', sine, amount), shift = g.binary('shift', 'math.multiply.scalar', waveAmount, g.number('shift-scale', .06));
    const offset = g.node('offset', 'vector.combine.vec2'); g.edge(shift, offset, 'x'); g.edge(zero, offset, 'y'); sampleUv = g.binary('sample-uv', 'math.add.vec2', uv, offset);
  }
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almost);
  const clamped = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(sampleUv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
  const sampled = g.node('sample', 'image.sample', 'image'); g.edge(frame, sampled, 'image'); g.edge(clamped, sampled, 'uv');
  let outputImage = sampled;
  if (type === 'drift-lines') {
    const uvSplit = g.node('line-uv-split', 'vector.split.vec2', 'x'); g.edge(uv, uvSplit, 'value'); const resolutionSplit = g.node('line-resolution-split', 'vector.split.vec2', 'x'); g.edge(resolution, resolutionSplit, 'value');
    const yPixel = g.binary('line-y-pixel', 'math.multiply.scalar', { node: uvSplit.node, port: 'y' }, { node: resolutionSplit.node, port: 'y' });
    const piPhase = g.binary('line-pi', 'math.multiply.scalar', yPixel, g.number('pi', Math.PI)), phase = g.binary('line-phase', 'math.divide-ieee.scalar', piPhase, safeScale);
    const line = g.binary('line', 'math.add.scalar', g.number('line-base', .82), g.binary('line-wave', 'math.multiply.scalar', g.unary('line-sine', 'math.sin.scalar', phase), g.number('line-range', .18)));
    const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sampled, split, 'image'); const darkened = g.node('darkened', 'math.multiply.rgb-scalar'); g.edge({ node: split.node, port: 'rgb' }, darkened, 'a'); g.edge(line, darkened, 'b');
    const combined = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(darkened, combined, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combined, 'alpha'); outputImage = combined;
  }
  const output = g.node('output', 'image.output', ''); g.edge(outputImage, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
