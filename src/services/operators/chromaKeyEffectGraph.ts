import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };

class GraphBuilder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];

  node(id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    return { node: id, port: operator === 'image.frame' || operator === 'vector.combine.rgba' || operator === 'convert.vec4-to-image' ? 'image' : operator === 'vector.split.rgba' ? 'rgb' : operator.startsWith('compare.') ? 'condition' : operator.startsWith('logic.') ? 'value' : operator === 'values.choice' ? 'value' : operator === 'values.number' ? 'value' : operator === 'vector.combine.vec2' ? 'value' : operator === 'vector.combine.vec3' ? 'value' : operator === 'convert.vec3-to-rgb' ? 'rgb' : 'value' };
  }

  edge(from: Ref, to: Ref, input: string): void {
    this.edges.push({ id: `${from.node}-${from.port}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input });
  }

  number(id: string, value: number): Ref { return this.node(id, 'values.number', {}, { value }); }
  binary(id: string, operator: string, a: Ref, b: Ref): Ref { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  select(id: string, condition: Ref, falseValue: Ref, trueValue: Ref): Ref {
    const out = this.node(id, 'select.scalar'); this.edge(falseValue, out, 'falseValue'); this.edge(trueValue, out, 'trueValue'); this.edge(condition, out, 'condition'); return out;
  }
}

export function createDefaultChromaKeyGraph(): EffectOperatorGraph {
  const g = new GraphBuilder();
  const frame = g.node('frame', 'image.frame'), split = g.node('source-color', 'vector.split.rgba'); g.edge(frame, split, 'image');
  const rgb = { node: split.node, port: 'rgb' };
  const sourceValue = g.node('source-value', 'convert.image-to-vec4'); g.edge(frame, sourceValue, 'image');
  const sourceComponents = g.node('source-components', 'vector.split.vec4'); g.edge(sourceValue, sourceComponents, 'value');
  const alpha = { node: sourceComponents.node, port: 'w' };
  const rgbVector = g.node('source-rgb-vector', 'convert.rgb-to-vec3'); g.edge(rgb, rgbVector, 'rgb');
  const channels = g.node('source-channels', 'vector.split.vec3'); g.edge(rgbVector, channels, 'value');
  const r = { node: channels.node, port: 'x' }, green = { node: channels.node, port: 'y' }, b = { node: channels.node, port: 'z' };
  const zero = g.number('zero', 0), half = g.number('half', .5), one = g.number('one', 1), choiceHalf = g.number('choice-half', .5), choiceOneHalf = g.number('choice-one-half', 1.5);
  const keyChoice = g.node('key-color', 'values.choice', { value: 'keyColor' });
  const aboveHalf = g.binary('key-above-half', 'compare.greater.scalar', keyChoice, choiceHalf);
  const belowOneHalf = g.binary('key-below-one-half', 'compare.greater.scalar', choiceOneHalf, keyChoice);
  const isBlue = g.binary('key-is-blue', 'logic.and.boolean', aboveHalf, belowOneHalf);
  const keyR = zero, keyG = g.select('key-green', isBlue, one, zero), keyB = g.select('key-blue', isBlue, zero, one);

  const ycbcr = (id: string, red: Ref, grn: Ref, blue: Ref) => {
    const yr = g.binary(`${id}-y-r`, 'math.multiply.scalar', g.number(`${id}-rec601-r`, .299), red);
    const yg = g.binary(`${id}-y-g`, 'math.multiply.scalar', g.number(`${id}-rec601-g`, .587), grn);
    const yrg = g.binary(`${id}-y-rg`, 'math.add.scalar', yr, yg);
    const yb = g.binary(`${id}-y-b`, 'math.multiply.scalar', g.number(`${id}-rec601-b`, .114), blue);
    const y = g.binary(`${id}-y`, 'math.add.scalar', yrg, yb);
    const cb = g.binary(`${id}-cb`, 'math.multiply.scalar', g.number(`${id}-cb-scale`, .564), g.binary(`${id}-blue-minus-y`, 'math.subtract.scalar', blue, y));
    const cr = g.binary(`${id}-cr`, 'math.multiply.scalar', g.number(`${id}-cr-scale`, .713), g.binary(`${id}-red-minus-y`, 'math.subtract.scalar', red, y));
    return { cb, cr };
  };
  const sourceYcbcr = ycbcr('source', r, green, b), keyYcbcr = ycbcr('key', keyR, keyG, keyB);
  const chromaDelta = g.node('chroma-delta', 'vector.combine.vec2');
  g.edge(g.binary('cb-delta', 'math.subtract.scalar', sourceYcbcr.cb, keyYcbcr.cb), chromaDelta, 'x');
  g.edge(g.binary('cr-delta', 'math.subtract.scalar', sourceYcbcr.cr, keyYcbcr.cr), chromaDelta, 'y');
  const distance = g.node('chroma-distance', 'vector.length.vec2'); g.edge(chromaDelta, distance, 'value');
  const tolerance = g.node('tolerance', 'values.number', { value: 'tolerance' });
  const softness = g.node('softness', 'values.number', { value: 'softness' });
  const outerTolerance = g.binary('outer-tolerance', 'math.add.scalar', tolerance, softness);
  const matte = g.node('matte', 'math.smoothstep.scalar'); g.edge(tolerance, matte, 'edge0'); g.edge(outerTolerance, matte, 'edge1'); g.edge(distance, matte, 'value');

  const suppression = g.node('spill-suppression', 'values.number', { value: 'spillSuppression' });
  const suppressionEnabled = g.binary('suppression-enabled', 'compare.greater.scalar', suppression, zero);
  const greenDominant = g.binary('green-dominant', 'logic.and.boolean',
    g.binary('green-over-red', 'compare.greater.scalar', keyG, keyR), g.binary('green-over-blue', 'compare.greater.scalar', keyG, keyB));
  const blueDominant = g.binary('blue-dominant', 'logic.and.boolean',
    g.binary('blue-over-red', 'compare.greater.scalar', keyB, keyR), g.binary('blue-over-green', 'compare.greater.scalar', keyB, keyG));
  const useGreenSpill = g.binary('use-green-spill', 'logic.and.boolean', suppressionEnabled, greenDominant);
  const useBlueSpill = g.binary('use-blue-spill', 'logic.and.boolean', suppressionEnabled, blueDominant);
  const greenExcess = g.binary('green-excess', 'math.subtract.scalar', green, g.binary('red-blue-max', 'math.max.scalar', r, b));
  const greenSpill = g.binary('green-spill', 'math.multiply.scalar', g.binary('positive-green-spill', 'math.max.scalar', zero, greenExcess), suppression);
  const blueExcess = g.binary('blue-excess', 'math.subtract.scalar', b, g.binary('red-green-max', 'math.max.scalar', r, green));
  const blueSpill = g.binary('blue-spill', 'math.multiply.scalar', g.binary('positive-blue-spill', 'math.max.scalar', zero, blueExcess), suppression);
  const greenHalf = g.binary('green-spill-half', 'math.multiply.scalar', greenSpill, half);
  const blueHalf = g.binary('blue-spill-half', 'math.multiply.scalar', blueSpill, half);
  const chooseChannel = (id: string, original: Ref, greenValue: Ref, blueValue: Ref) =>
    g.select(`${id}-blue-select`, useBlueSpill, g.select(`${id}-green-select`, useGreenSpill, original, greenValue), blueValue);
  const finalR = chooseChannel('red', r, g.binary('red-green-spill', 'math.add.scalar', r, greenHalf), g.binary('red-blue-spill', 'math.add.scalar', r, blueHalf));
  const finalG = chooseChannel('green', green, g.binary('green-spill-reduced', 'math.subtract.scalar', green, greenSpill), g.binary('green-blue-spill', 'math.add.scalar', green, blueHalf));
  const finalB = chooseChannel('blue', b, g.binary('blue-green-spill', 'math.add.scalar', b, greenHalf), g.binary('blue-spill-reduced', 'math.subtract.scalar', b, blueSpill));
  const finalAlpha = g.binary('final-alpha', 'math.multiply.scalar', alpha, matte);
  const finalValue = g.node('final-value', 'vector.combine.vec4'); g.edge(finalR, finalValue, 'x'); g.edge(finalG, finalValue, 'y'); g.edge(finalB, finalValue, 'z'); g.edge(finalAlpha, finalValue, 'w');
  const result = g.node('result', 'convert.vec4-to-image'); g.edge(finalValue, result, 'value');
  const output = g.node('output', 'image.output'); g.edge(result, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges,
    layout: Object.fromEntries(g.nodes.map((item, index) => [item.id, { x: (index % 10) * 340, y: Math.floor(index / 10) * 360 }])) };
}
