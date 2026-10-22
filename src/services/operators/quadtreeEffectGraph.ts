import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorValue } from '../../types/operatorGraph';
import { CELL_REFERENCE_HEIGHT } from './cellGridRecipes';

interface Ref { node: string; port: string }

/** Canonical Quadtree Zoom graph. Only the bounded six-level partition (five legacy loads plus a 4 x 4 grid test)
 * is scoped; center sampling, border styling, mixing, and source alpha stay ordinary shared IR.
 * Minimum Cell counts pixels of a 1080p frame (Cell Size folder), so preview quality, 4K and
 * export show the same cells. A tile takes its centre's colour weighted by the centre's alpha, so
 * a transparent centre (cut-out edge, inset frame) keeps the pixel's own colour instead of black. */
export function createDefaultQuadtreeGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [], layout: EffectOperatorGraph['layout'] = {};
  const n = (id: string, operator: string, column: number, bindings: Record<string, string> = {}, constants?: Record<string, OperatorValue>): Ref => {
    const row = nodes.filter(node => layout[node.id]?.x === column * 300).length;
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    layout[id] = { x: column * 300, y: row * 170 };
    const port = operator === 'image.frame' || operator === 'image.load-pixel-clamped' || operator === 'vector.combine.rgba' ? 'image'
      : operator === 'image.normalized-uv' ? 'uv' : operator === 'vector.split.rgba' ? 'rgb'
        : operator === 'image.quadtree-partition' ? 'origin' : 'value';
    return { node: id, port };
  };
  const e = (from: Ref, to: Ref, input: string) => edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input });
  const binary = (id: string, operator: string, a: Ref, b: Ref, column: number) => { const out = n(id, operator, column); e(a, out, 'a'); e(b, out, 'b'); return out; };
  const unary = (id: string, operator: string, value: Ref, column: number, input = 'value') => { const out = n(id, operator, column); e(value, out, input); return out; };
  const frame = n('frame', 'image.frame', 0), uv = n('uv', 'image.normalized-uv', 0), resolution = n('resolution', 'image.resolution', 0);
  const time = n('time', 'image.timeline-time', 0), scale = n('scale', 'values.number', 0, { value: 'scale' });
  const threshold = n('threshold', 'values.number', 0, { value: 'threshold' }), speed = n('speed', 'values.number', 0, { value: 'speed' });
  const amountValue = n('amount', 'values.number', 0, { value: 'amount' }), half = n('half', 'values.number', 0, {}, { value: .5 });
  const zero = n('zero', 'values.number', 0, {}, { value: 0 }), one = n('one', 'values.number', 0, {}, { value: 1 });
  const referenceHeight = n('reference-height', 'values.number', 0, {}, { value: CELL_REFERENCE_HEIGHT });
  const pointEightTwo = n('tile-shade', 'values.number', 0, {}, { value: .82 });
  const pointOneEight = n('edge-lift', 'values.number', 0, {}, { value: .18 });
  const pixel = unary('pixel', 'math.floor.vec2', binary('pixel-unfloored', 'math.multiply.vec2', uv, resolution, 1), 2);
  // Minimum Cell in rendered pixels: 1080p pixels times the shorter frame side over 1080.
  const pixelScale = binary('pixel-scale', 'math.divide-ieee.scalar', unary('short-side', 'vector.reduce-min.vec2', resolution, 1), referenceHeight, 2);
  const minimumPixels = binary('minimum-px', 'math.multiply.scalar', scale, pixelScale, 3);
  const amount = n('amount-clamped', 'math.clamp.scalar', 1); e(amountValue, amount, 'value'); e(zero, amount, 'min'); e(one, amount, 'max');
  const partition = n('partition', 'image.quadtree-partition', 4);
  e(frame, partition, 'image'); e(minimumPixels, partition, 'scale'); e(threshold, partition, 'threshold'); e(time, partition, 'time'); e(speed, partition, 'speed');
  const size: Ref = { node: partition.node, port: 'size' };
  const halfSize = unary('half-size', 'math.floor.scalar', binary('half-size-product', 'math.multiply.scalar', size, half, 4), 5);
  const halfVector = unary('half-vector', 'convert.scalar-to-vec2', halfSize, 5);
  const center = binary('center', 'math.add.vec2', partition, halfVector, 6);
  const sampled = n('center-sample', 'image.load-pixel-clamped', 7); e(frame, sampled, 'image'); e(center, sampled, 'pixel');
  const original = n('original-sample', 'image.load-pixel-clamped', 7); e(frame, original, 'image'); e(pixel, original, 'pixel');
  const local = binary('local', 'math.subtract.vec2', pixel, partition, 4);
  const edgeDistance = unary('edge-distance', 'vector.reduce-min.vec2', local, 5);
  const border = n('border', 'math.step.scalar', 6); e(half, border, 'edge'); e(edgeDistance, border, 'value');
  const inverseBorder = binary('inverse-border', 'math.subtract.scalar', one, border, 7);
  const style = binary('style', 'math.add.scalar', pointEightTwo,
    binary('border-gain', 'math.multiply.scalar', pointOneEight, inverseBorder, 8), 9);
  const sampledColor = unary('sampled-color', 'vector.split.rgba', sampled, 8, 'image');
  const originalColor = unary('original-color', 'vector.split.rgba', original, 8, 'image');
  // The centre's colour where the centre is opaque, the pixel's own where it is transparent.
  const cellColor = n('cell-color', 'math.mix.rgb', 9); e(originalColor, cellColor, 'a'); e(sampledColor, cellColor, 'b');
  e(unary('center-alpha', 'convert.alpha-to-scalar', { node: sampledColor.node, port: 'alpha' }, 9, 'alpha'), cellColor, 't');
  const styled = n('styled', 'math.multiply.rgb-scalar', 10); e(cellColor, styled, 'a'); e(style, styled, 'b');
  const mixed = n('mixed', 'math.mix.rgb', 11); e(originalColor, mixed, 'a'); e(styled, mixed, 'b'); e(amount, mixed, 't');
  const combined = n('combined', 'vector.combine.rgba', 12); e(mixed, combined, 'rgb'); e({ node: originalColor.node, port: 'alpha' }, combined, 'alpha');
  const output = n('output', 'image.output', 13); e(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'compute-image', nodes: nodes.map(node => ({ ...node })), edges: edges.map(edge => ({ ...edge })), layout: { ...layout } };
}
