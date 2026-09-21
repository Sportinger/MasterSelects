import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorValue } from '../../types/operatorGraph';

interface Ref { node: string; port: string }

class GraphBuilder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};

  node(id: string, operator: string, column: number, constants?: Record<string, OperatorValue>, bindings: Record<string, string> = {}): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    const row = this.nodes.filter(item => this.layout[item.id]?.x === column * 300).length;
    this.layout[id] = { x: column * 300, y: row * 180 };
    const port = operator === 'image.frame' || operator === 'image.load-pixel-clamped' || operator === 'vector.combine.rgba' ? 'image'
      : operator === 'image.normalized-uv' ? 'uv' : operator === 'image.resolution' ? 'value'
        : operator === 'geometry.voronoi-seeds' || operator === 'geometry.jump-flood' ? 'field'
          : operator === 'vector.split.rgba' ? 'rgb' : operator === 'convert.scalar-to-rgb' ? 'rgb'
            : operator.startsWith('compare.') ? 'condition' : 'value';
    return { node: id, port };
  }

  connect(from: Ref, to: Ref, input: string) {
    this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input });
  }

  literal(id: string, value: number) { return this.node(id, 'values.number', 0, { value }); }
  unary(id: string, operator: string, value: Ref, column: number, input = 'value') {
    const result = this.node(id, operator, column); this.connect(value, result, input); return result;
  }
  binary(id: string, operator: string, a: Ref, b: Ref, column: number) {
    const result = this.node(id, operator, column); this.connect(a, result, 'a'); this.connect(b, result, 'b'); return result;
  }
  vec2(id: string, x: Ref, y: Ref, column: number) {
    const result = this.node(id, 'vector.combine.vec2', column); this.connect(x, result, 'x'); this.connect(y, result, 'y'); return result;
  }
}

/** Canonical staged Voronoi graph. Seed generation and jump flooding remain
 * specialized pass boundaries; every resolve operation is an explicit shared node. */
export function createDefaultVoronoiGraph(): EffectOperatorGraph {
  const g = new GraphBuilder();
  const frame = g.node('frame', 'image.frame', 0), uv = g.node('uv', 'image.normalized-uv', 0);
  const resolution = g.node('resolution', 'image.resolution', 0);
  const zero = g.literal('zero', 0), one = g.literal('one', 1), half = g.literal('half', .5);
  const pointEightTwo = g.literal('point-eight-two', .82), pointOneEight = g.literal('point-one-eight', .18);
  const amount = g.node('amount', 'values.number', 0, undefined, { value: 'amount' });
  const seeds = g.node('seeds', 'geometry.voronoi-seeds', 1, undefined, { scale: 'scale', speed: 'speed' });
  const field = g.node('jump-flood', 'geometry.jump-flood', 2); g.connect(seeds, field, 'field');

  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution, 1);
  const rightOffset = g.vec2('right-offset', one, zero, 1), downOffset = g.vec2('down-offset', zero, one, 1);
  const rightPixel = g.binary('right-pixel', 'math.add.vec2', pixel, rightOffset, 2);
  const downPixel = g.binary('down-pixel', 'math.add.vec2', pixel, downOffset, 2);
  const read = (id: string, coordinate: Ref) => {
    const result = g.node(id, 'field.read-nearest-seed', 3); g.connect(field, result, 'field'); g.connect(coordinate, result, 'pixel'); return result;
  };
  const currentRecord = read('current-seed', pixel), rightRecord = read('right-seed', rightPixel), downRecord = read('down-seed', downPixel);
  const split = (id: string, record: Ref) => g.unary(id, 'vector.split.vec4', record, 4);
  const current = split('current-components', currentRecord), right = split('right-components', rightRecord), down = split('down-components', downRecord);
  const component = (value: Ref, port: string): Ref => ({ node: value.node, port });
  const currentX = component(current, 'x'), currentY = component(current, 'y'), currentValid = component(current, 'z');
  const currentXY = g.vec2('current-seed-pixel', currentX, currentY, 5);
  const valid = g.node('valid', 'compare.greater.scalar', 5); g.connect(currentValid, valid, 'a'); g.connect(zero, valid, 'b');
  const sourcePixel = g.node('source-pixel', 'select.vec2', 6); g.connect(pixel, sourcePixel, 'falseValue');
  g.connect(currentXY, sourcePixel, 'trueValue'); g.connect(valid, sourcePixel, 'condition');

  const absoluteDifference = (id: string, a: Ref, b: Ref) => g.unary(`${id}-abs`, 'math.abs.scalar', g.binary(`${id}-difference`, 'math.subtract.scalar', a, b, 5), 6);
  const rightDx = absoluteDifference('right-x', currentX, component(right, 'x'));
  const rightDy = absoluteDifference('right-y', currentY, component(right, 'y'));
  const downDx = absoluteDifference('down-x', currentX, component(down, 'x'));
  const downDy = absoluteDifference('down-y', currentY, component(down, 'y'));
  const rightDistance = g.binary('right-distance', 'math.max.scalar', rightDx, rightDy, 7);
  const downDistance = g.binary('down-distance', 'math.max.scalar', downDx, downDy, 7);
  const neighborDistance = g.binary('neighbor-distance', 'math.max.scalar', rightDistance, downDistance, 8);
  const borderCondition = g.node('border-condition', 'compare.greater.scalar', 8);
  g.connect(neighborDistance, borderCondition, 'a'); g.connect(half, borderCondition, 'b');
  const border = g.node('border', 'select.scalar', 9); g.connect(zero, border, 'falseValue');
  g.connect(one, border, 'trueValue'); g.connect(borderCondition, border, 'condition');

  const sampled = g.node('nearest-sample', 'image.load-pixel-clamped', 7); g.connect(frame, sampled, 'image'); g.connect(sourcePixel, sampled, 'pixel');
  const original = g.node('original-sample', 'image.load-pixel-clamped', 7); g.connect(frame, original, 'image'); g.connect(pixel, original, 'pixel');
  const sampledSplit = g.unary('nearest-color', 'vector.split.rgba', sampled, 8, 'image');
  const originalSplit = g.unary('original-color', 'vector.split.rgba', original, 8, 'image');
  const scaleDelta = g.binary('border-scale-delta', 'math.multiply.scalar', pointOneEight, border, 9);
  const styleScale = g.binary('style-scale', 'math.add.scalar', pointEightTwo, scaleDelta, 10);
  const styled = g.node('styled', 'math.multiply.rgb-scalar', 10); g.connect(component(sampledSplit, 'rgb'), styled, 'a'); g.connect(styleScale, styled, 'b');
  const mixed = g.node('mixed', 'math.mix.rgb', 11); g.connect(component(originalSplit, 'rgb'), mixed, 'a');
  g.connect(styled, mixed, 'b'); g.connect(amount, mixed, 't');
  const combined = g.node('combined', 'vector.combine.rgba', 12); g.connect(mixed, combined, 'rgb');
  g.connect(component(originalSplit, 'alpha'), combined, 'alpha');
  const output = g.node('output', 'image.output', 13); g.connect(combined, output, 'image');

  return { version: 1, schemaVersion: 1, domain: 'compute-image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
