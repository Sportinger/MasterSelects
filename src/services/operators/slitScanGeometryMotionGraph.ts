import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { temporalGraphQueries } from './temporalDemandGraph';

/** A separately requested numeric output, retaining the base sampler's UV/clock. */
export function slitScanGeometryMotionGraph(graph: EffectOperatorGraph, samplerId: string): EffectOperatorGraph {
  const query = temporalGraphQueries(graph).find(item => item.id === samplerId);
  if (!query) throw new Error('The geometry base sampler is unavailable.');
  const output = graph.nodes.filter(node => node.operator === 'image.output');
  if (output.length !== 1) throw new Error('Geometry motion requires one graph output.');
  const id = '__slit_geometry_motion';
  if (graph.nodes.some(node => node.id.startsWith(id))) throw new Error('Geometry motion node identity collides.');
  return { ...graph, nodes: [...graph.nodes,
    { id: `${id}_interval`, operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 / 30 } },
    { id, operator: 'image.source-motion', operatorVersion: 1, bindings: { lookback: 'delay', timeFactor: 'timeFactor' },
      constants: { denseInverseSearch: true, stabilize: true, required: true } },
  ], edges: [...graph.edges.filter(edge => edge.to !== output[0].id),
    { ...query.uv, id: `${id}:uv`, to: id }, { ...query.delay, id: `${id}:delay`, to: id },
    { id: `${id}:interval`, from: `${id}_interval`, output: 'value', to: id, input: 'interval' },
    { id: `${id}:output`, from: id, output: 'image', to: output[0].id, input: 'image' },
  ] };
}
