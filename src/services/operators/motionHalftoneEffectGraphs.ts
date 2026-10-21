import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { DRIFT_LINES_REFERENCE_HEIGHT } from '../../effects/halftone/driftLines';

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
  if (type === 'drift-lines') return createDriftLinesGraph();
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
    throw new Error(`No motion halftone graph for ${type}.`);
  }
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almost);
  const clamped = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(sampleUv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
  const sampled = g.node('sample', 'image.sample', 'image'); g.edge(frame, sampled, 'image'); g.edge(clamped, sampled, 'uv');
  const outputImage = sampled;
  const output = g.node('output', 'image.output', ''); g.edge(outputImage, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}

/**
 * Drift Lines: bands of Scale pixels of a 1080p frame (shorter side, at least one output pixel) running
 * at Angle (degrees, counter-clockwise on screen), each shifted along its own direction by a sine of its
 * band index and the timeline time, then shaded into lines. At Angle 0 on a 1080p frame it is the
 * original horizontal recipe; bands count from the top edge as before.
 */
function createDriftLinesGraph(): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv'), resolution = g.node('resolution', 'image.resolution');
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const speed = g.node('speed', 'values.number', 'value', { value: 'speed' }), angle = g.node('angle', 'values.number', 'value', { value: 'angle' }), time = g.node('time', 'image.timeline-time');
  const zero = g.number('zero', 0), half = g.number('half', .5), one = g.number('one', 1), two = g.number('two', 2);
  // Scale below 2 renders as 2 (renderMin; paramRangeNotes reports it through this node's id).
  const scaleClamped = g.binary('scale-clamped', 'math.max.scalar', scale, two);
  const shortSide = g.unary('short-side', 'vector.reduce-min.vec2', resolution), frameScale = g.binary('frame-scale', 'math.divide-ieee.scalar', shortSide, g.number('reference-height', DRIFT_LINES_REFERENCE_HEIGHT));
  const rowHeight = g.binary('row-height', 'math.max.scalar', g.binary('row-pixels', 'math.multiply.scalar', scaleClamped, frameScale), one);
  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution), center = g.node('center', 'math.multiply.vec2-scalar'); g.edge(resolution, center, 'a'); g.edge(half, center, 'b');
  const radians = g.binary('radians', 'math.multiply.scalar', angle, g.number('degrees-to-radians', Math.PI / 180));
  const turned = g.node('turned', 'coordinates.rotate.vec2'); g.edge(g.binary('relative', 'math.subtract.vec2', pixel, center), turned, 'value'); g.edge(radians, turned, 'angle');
  const turnedSplit = g.node('turned-split', 'vector.split.vec2', 'x'); g.edge(turned, turnedSplit, 'value'); const centerSplit = g.node('center-split', 'vector.split.vec2', 'x'); g.edge(center, centerSplit, 'value');
  const across = g.binary('across', 'math.add.scalar', { node: turnedSplit.node, port: 'y' }, { node: centerSplit.node, port: 'y' });
  const row = g.unary('row', 'math.floor.scalar', g.binary('row-base', 'math.divide-ieee.scalar', across, rowHeight));
  const timePhase = g.binary('time-phase', 'math.multiply.scalar', g.binary('time-speed', 'math.multiply.scalar', time, speed), two);
  const phase = g.binary('shift-phase', 'math.add.scalar', g.binary('row-phase', 'math.multiply.scalar', row, g.number('row-rate', .71)), timePhase);
  const resolutionSplit = g.node('resolution-split', 'vector.split.vec2', 'x'); g.edge(resolution, resolutionSplit, 'value');
  const reach = g.binary('shift-reach', 'math.multiply.scalar', { node: resolutionSplit.node, port: 'x' }, g.number('shift-scale', .06));
  const shift = g.binary('shift', 'math.multiply.scalar', g.binary('shift-amount', 'math.multiply.scalar', g.unary('shift-sine', 'math.sin.scalar', phase), amount), reach);
  const along = g.node('along', 'vector.combine.vec2'); g.edge(shift, along, 'x'); g.edge(zero, along, 'y');
  const offset = g.node('offset', 'coordinates.rotate.vec2'); g.edge(along, offset, 'value'); g.edge(g.binary('back-radians', 'math.subtract.scalar', zero, radians), offset, 'angle');
  const sampleUv = g.binary('sample-uv', 'math.add.vec2', uv, g.binary('offset-uv', 'math.divide-ieee.vec2', offset, resolution));
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', g.number('tiny', .001)), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', g.number('almost-one', .999));
  const clamped = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(sampleUv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
  const sampled = g.node('sample', 'image.sample', 'image'); g.edge(frame, sampled, 'image'); g.edge(clamped, sampled, 'uv');
  const linePhase = g.binary('line-phase', 'math.divide-ieee.scalar', g.binary('line-pi', 'math.multiply.scalar', across, g.number('pi', Math.PI)), rowHeight);
  const line = g.binary('line', 'math.add.scalar', g.number('line-base', .82), g.binary('line-wave', 'math.multiply.scalar', g.unary('line-sine', 'math.sin.scalar', linePhase), g.number('line-range', .18)));
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sampled, split, 'image');
  const darkened = g.node('darkened', 'math.multiply.rgb-scalar'); g.edge({ node: split.node, port: 'rgb' }, darkened, 'a'); g.edge(line, darkened, 'b');
  const combined = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(darkened, combined, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combined, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
