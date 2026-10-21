import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { recognizeOperatorCompositions } from './recognizeOperatorCompositions';
import { createDefaultBulgeGraph, createDefaultTwirlGraph, createDefaultWaveGraph } from './uvDistortRecipes';

export type EditableUvDistortEffectType = 'wave' | 'twirl' | 'bulge' | 'kaleidoscope';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const finish = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) });
const sampleTail = (): BoundOperatorNode[] => [node('sample', 'image.sample'), node('output', 'image.output')];
const sampleEdges = (uvNode: string): OperatorEdge[] => [edge('frame', 'image', 'sample', 'image'), edge(uvNode, 'value', 'sample', 'uv'), edge('sample', 'image', 'output', 'image')];

function kaleidoscopeGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), number('half', .5), node('half-vec2', 'convert.scalar-to-vec2'), node('centered', 'math.subtract.vec2'), node('centered-components', 'vector.split.vec2'), node('base-angle', 'math.atan2.scalar'), node('rotation', 'values.number', { value: 'rotation' }), node('angle', 'math.add.scalar'), node('radius', 'vector.length.vec2'), number('tau', Math.PI * 2), node('segments', 'values.number', { value: 'segments' }), node('segment-angle', 'math.divide-ieee.scalar'), node('segment-progress', 'math.divide-ieee.scalar'), node('segment-fract', 'math.fract.scalar'), node('fold-angle', 'math.multiply.scalar'), node('half-segment', 'math.multiply.scalar'), node('past-half', 'compare.greater.scalar'), node('reflected-angle', 'math.subtract.scalar'), node('selected-angle', 'select.scalar'), node('direction', 'vector.unit-direction.scalar'), node('radial', 'math.multiply.vec2-scalar'), node('final-uv', 'math.add.vec2'), ...sampleTail()];
  const edges = [edge('half', 'value', 'half-vec2', 'value'), edge('uv', 'uv', 'centered', 'a'), edge('half-vec2', 'value', 'centered', 'b'), edge('centered', 'value', 'centered-components', 'value'), edge('centered-components', 'y', 'base-angle', 'y'), edge('centered-components', 'x', 'base-angle', 'x'), edge('base-angle', 'value', 'angle', 'a'), edge('rotation', 'value', 'angle', 'b'), edge('centered', 'value', 'radius', 'value'), edge('tau', 'value', 'segment-angle', 'a'), edge('segments', 'value', 'segment-angle', 'b'), edge('angle', 'value', 'segment-progress', 'a'), edge('segment-angle', 'value', 'segment-progress', 'b'), edge('segment-progress', 'value', 'segment-fract', 'value'), edge('segment-fract', 'value', 'fold-angle', 'a'), edge('segment-angle', 'value', 'fold-angle', 'b'), edge('segment-angle', 'value', 'half-segment', 'a'), edge('half', 'value', 'half-segment', 'b'), edge('fold-angle', 'value', 'past-half', 'a'), edge('half-segment', 'value', 'past-half', 'b'), edge('segment-angle', 'value', 'reflected-angle', 'a'), edge('fold-angle', 'value', 'reflected-angle', 'b'), edge('fold-angle', 'value', 'selected-angle', 'falseValue'), edge('reflected-angle', 'value', 'selected-angle', 'trueValue'), edge('past-half', 'condition', 'selected-angle', 'condition'), edge('selected-angle', 'value', 'direction', 'angle'), edge('direction', 'value', 'radial', 'a'), edge('radius', 'value', 'radial', 'b'), edge('radial', 'value', 'final-uv', 'a'), edge('half-vec2', 'value', 'final-uv', 'b'), ...sampleEdges('final-uv')];
  return finish(nodes, edges);
}

export function createDefaultUvDistortGraph(type: EditableUvDistortEffectType): EffectOperatorGraph {
  if (type !== 'kaleidoscope') return type === 'wave' ? createDefaultWaveGraph() : type === 'twirl' ? createDefaultTwirlGraph() : createDefaultBulgeGraph();
  return recognizeOperatorCompositions(kaleidoscopeGraph());
}
