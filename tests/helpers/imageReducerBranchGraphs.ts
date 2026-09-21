import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../src/types/operatorGraph';

type VisitOrder = 'root-first' | 'scope-first';
const n = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const e = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${to}-${input}`, from, output, to, input });
const base = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} });

export function createSequenceReducerBranchGraph(order: VisitOrder = 'root-first', nested = true): EffectOperatorGraph {
  const nodes = [n('frame', 'image.frame'), n('half', 'values.number', .5), n('source', 'math.multiply.image-scalar'),
    n('root-x', 'values.number', .25), n('root-y', 'values.number', .75), n('root-uv', 'vector.combine.vec2'), n('root-sample', 'image.sample'),
    n('source-luma', 'color.luminance-rec709.image'), n('four', 'values.number', 4), n('root-zeroed', 'math.multiply.scalar'),
    n('count-stable', 'math.add.scalar'), n('index', 'image.sequence-index'), n('zero', 'values.number', 0), n('one', 'values.number', 1),
    n('threshold', 'values.number', .5), n('outer-threshold', 'values.number', .25), n('condition', 'compare.greater.scalar'),
    n('outer-condition', 'compare.greater.scalar'), n('uv-low', 'vector.combine.vec2'), n('uv-high', 'vector.combine.vec2'),
    n('sample-low', 'image.sample'), n('sample-high', 'image.sample'), n('branch', 'control.select.image'), n('weight', 'values.number', 1),
    n('outer-branch', 'control.select.image'),
    n('reduce', 'image.sequence-reduce'), n('denominator', 'math.add.scalar'), n('denominator-vector', 'convert.scalar-to-vec4'),
    n('average', 'math.divide-ieee.vec4'), n('image', 'convert.vec4-to-image'), n('output', 'image.output')];
  const edges = [e('frame', 'image', 'source', 'a'), e('half', 'value', 'source', 'b'), e('root-x', 'value', 'root-uv', 'x'),
    e('root-y', 'value', 'root-uv', 'y'), e('source', 'value', 'root-sample', 'image'), e('root-uv', 'value', 'root-sample', 'uv'),
    e('root-sample', 'image', 'source-luma', 'image'),
    e('source-luma', 'value', 'root-zeroed', 'a'), e('zero', 'value', 'root-zeroed', 'b'), e('root-zeroed', 'value', 'count-stable', 'a'),
    e('four', 'value', 'count-stable', 'b'), e('index', 't', 'condition', 'a'),
    e('threshold', 'value', 'condition', 'b'), e('index', 't', 'uv-low', 'x'), e('zero', 'value', 'uv-low', 'y'),
    e('index', 't', 'uv-high', 'x'), e('one', 'value', 'uv-high', 'y'), e('source', 'value', 'sample-low', 'image'),
    e('uv-low', 'value', 'sample-low', 'uv'), e('source', 'value', 'sample-high', 'image'), e('uv-high', 'value', 'sample-high', 'uv'),
    e('condition', 'condition', 'branch', 'condition'), e('sample-low', 'image', 'branch', 'falseValue'), e('sample-high', 'image', 'branch', 'trueValue'),
    e('index', 't', 'outer-condition', 'a'), e('outer-threshold', 'value', 'outer-condition', 'b'),
    e('outer-condition', 'condition', 'outer-branch', 'condition'), e('sample-low', 'image', 'outer-branch', 'falseValue'), e('branch', 'image', 'outer-branch', 'trueValue'),
    e(nested ? 'outer-branch' : 'branch', 'image', 'reduce', 'sample'), e('weight', 'value', 'reduce', 'weight'),
    e(order === 'root-first' ? 'count-stable' : 'four', 'value', 'reduce', 'count'), e('reduce', 'sum', 'average', 'a'),
    e('reduce', 'weightSum', 'denominator-vector', 'value'), e('denominator-vector', 'value', 'average', 'b'),
    e('average', 'value', 'image', 'value'), e('image', 'image', 'output', 'image')];
  if (order === 'scope-first') {
    edges.splice(edges.findIndex(edge => edge.to === 'denominator-vector'), 1,
      e('reduce', 'weightSum', 'denominator', 'a'), e('root-zeroed', 'value', 'denominator', 'b'), e('denominator', 'value', 'denominator-vector', 'value'));
  }
  return base(nodes, edges);
}

export function createKernelReducerBranchGraph(kind: 'grid' | 'rect', order: VisitOrder = 'root-first'): EffectOperatorGraph {
  const reducer = kind === 'grid' ? 'image.kernel-grid-reduce' : 'image.kernel-rect-reduce';
  const nodes = [n('frame', 'image.frame'), n('half', 'values.number', .5), n('source', 'math.multiply.image-scalar'),
    n('root-x', 'values.number', .25), n('root-y', 'values.number', .75), n('root-uv', 'vector.combine.vec2'), n('root-sample', 'image.sample'),
    n('source-luma', 'color.luminance-rec709.image'), n('one', 'values.number', 1), n('two', 'values.number', 2), n('four', 'values.number', 4),
    n('root-zeroed', 'math.multiply.scalar'), n('bound-from-source', 'math.add.scalar'),
    n('index', 'image.kernel-index'), n('split', 'vector.split.vec2'), n('zero', 'values.number', 0), n('tenth', 'values.number', .1),
    n('center', 'values.number', .5), n('shift', 'values.number', .2), n('x-scaled', 'math.multiply.scalar'), n('y-scaled', 'math.multiply.scalar'),
    n('x-base', 'math.add.scalar'), n('y-base', 'math.add.scalar'), n('x-shifted', 'math.add.scalar'), n('uv-low', 'vector.combine.vec2'),
    n('uv-high', 'vector.combine.vec2'), n('condition', 'compare.greater.scalar'), n('sample-low', 'image.sample'), n('sample-high', 'image.sample'),
    n('branch', 'control.select.image'), n('weight', 'values.number', 1), n('reduce', reducer), n('denominator', 'math.add.scalar'),
    n('denominator-vector', 'convert.scalar-to-vec4'), n('average', 'math.divide-ieee.vec4'), n('image', 'convert.vec4-to-image'), n('output', 'image.output')];
  const edges = [e('frame', 'image', 'source', 'a'), e('half', 'value', 'source', 'b'), e('root-x', 'value', 'root-uv', 'x'),
    e('root-y', 'value', 'root-uv', 'y'), e('source', 'value', 'root-sample', 'image'), e('root-uv', 'value', 'root-sample', 'uv'),
    e('root-sample', 'image', 'source-luma', 'image'),
    e('source-luma', 'value', 'root-zeroed', 'a'), e('zero', 'value', 'root-zeroed', 'b'), e('root-zeroed', 'value', 'bound-from-source', 'a'),
    e(kind === 'grid' ? 'one' : 'two', 'value', 'bound-from-source', 'b'),
    e('index', 'value', 'split', 'value'), e('split', 'x', 'x-scaled', 'a'), e('tenth', 'value', 'x-scaled', 'b'),
    e('split', 'y', 'y-scaled', 'a'), e('tenth', 'value', 'y-scaled', 'b'), e('x-scaled', 'value', 'x-base', 'a'), e('center', 'value', 'x-base', 'b'),
    e('y-scaled', 'value', 'y-base', 'a'), e('center', 'value', 'y-base', 'b'), e('x-base', 'value', 'x-shifted', 'a'), e('shift', 'value', 'x-shifted', 'b'),
    e('split', 'x', 'condition', 'a'), e('zero', 'value', 'condition', 'b'), e('x-base', 'value', 'uv-low', 'x'), e('y-base', 'value', 'uv-low', 'y'),
    e('x-shifted', 'value', 'uv-high', 'x'), e('y-base', 'value', 'uv-high', 'y'), e('source', 'value', 'sample-low', 'image'),
    e('uv-low', 'value', 'sample-low', 'uv'), e('source', 'value', 'sample-high', 'image'), e('uv-high', 'value', 'sample-high', 'uv'),
    e('condition', 'condition', 'branch', 'condition'), e('sample-low', 'image', 'branch', 'falseValue'), e('sample-high', 'image', 'branch', 'trueValue'),
    e('branch', 'image', 'reduce', 'sample'), e('weight', 'value', 'reduce', 'weight'), e('reduce', 'sum', 'average', 'a'),
    e('reduce', 'weightSum', 'denominator-vector', 'value'), e('denominator-vector', 'value', 'average', 'b'), e('average', 'value', 'image', 'value'),
    e('image', 'image', 'output', 'image')];
  if (kind === 'grid') edges.push(e(order === 'root-first' ? 'bound-from-source' : 'one', 'value', 'reduce', 'extent'));
  else edges.push(e(order === 'root-first' ? 'bound-from-source' : 'two', 'value', 'reduce', 'width'), e('two', 'value', 'reduce', 'height'));
  if (order === 'scope-first') edges.splice(edges.findIndex(edge => edge.to === 'denominator-vector'), 1,
    e('reduce', 'weightSum', 'denominator', 'a'), e('root-zeroed', 'value', 'denominator', 'b'), e('denominator', 'value', 'denominator-vector', 'value'));
  return base(nodes, edges);
}

export function createIllegalRootReducerIndexGraph(kind: 'sequence' | 'kernel'): EffectOperatorGraph {
  const index = kind === 'sequence' ? n('index', 'image.sequence-index') : n('index', 'image.kernel-index');
  return base([n('frame', 'image.frame'), n('output', 'image.output'), index], [e('frame', 'image', 'output', 'image')]);
}

export function createRootPureImageSelectGraph(selected = true): EffectOperatorGraph {
  return base([n('frame', 'image.frame'), { ...n('condition', 'values.boolean'), constants: { value: selected } },
    n('select', 'control.select.image'), n('output', 'image.output')], [e('condition', 'value', 'select', 'condition'),
    e('frame', 'image', 'select', 'falseValue'), e('frame', 'image', 'select', 'trueValue'), e('select', 'image', 'output', 'image')]);
}

export function createNestedReducerGraph(): EffectOperatorGraph {
  const graph = createSequenceReducerBranchGraph();
  graph.nodes.push(n('kernel-index', 'image.kernel-index'), n('kernel-sample', 'image.sample'), n('extent', 'values.number', 1),
    n('kernel', 'image.kernel-grid-reduce'), n('kernel-image', 'convert.vec4-to-image'));
  graph.edges.push(e('source', 'value', 'kernel-sample', 'image'), e('uv-low', 'value', 'kernel-sample', 'uv'),
    e('kernel-sample', 'image', 'kernel', 'sample'), e('weight', 'value', 'kernel', 'weight'), e('extent', 'value', 'kernel', 'extent'),
    e('kernel', 'sum', 'kernel-image', 'value'));
  const branchEdge = graph.edges.find(edge => edge.to === 'branch' && edge.input === 'falseValue')!;
  branchEdge.from = 'kernel-image'; branchEdge.output = 'image';
  return graph;
}
