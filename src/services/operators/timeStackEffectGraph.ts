import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** A loop remains a loop in Image IR: one source atlas and one sampler for all instances. */
export function createDefaultTimeStackGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [];
  const edges: OperatorEdge[] = [];
  const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']) => {
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
  };
  const edge = (from: string, output: string, to: string, input: string) => edges.push({ id: `${to}:${input}`, from, output, to, input });
  node('frame', 'image.frame'); node('uv', 'image.normalized-uv');
  node('count', 'values.integer', { value: 'count' });
  node('offset', 'values.number', { value: 'offset' });
  node('mode', 'values.choice', { value: 'blendMode' });
  node('index', 'image.sequence-index'); node('delay', 'math.multiply.scalar');
  node('history', 'image.sample-history'); node('opacity', 'values.number', {}, { value: 1 });
  node('stack', 'image.sequence-blend'); node('output', 'image.output');
  edge('index', 'index', 'delay', 'a'); edge('offset', 'value', 'delay', 'b');
  edge('frame', 'image', 'history', 'current'); edge('uv', 'uv', 'history', 'uv'); edge('delay', 'value', 'history', 'delay');
  edge('history', 'image', 'stack', 'sample'); edge('opacity', 'value', 'stack', 'weight');
  edge('count', 'value', 'stack', 'count'); edge('mode', 'value', 'stack', 'mode'); edge('stack', 'image', 'output', 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: { frame: { x: 0, y: 0 }, uv: { x: 0, y: 220 }, offset: { x: 0, y: 440 }, index: { x: 0, y: 640 },
      delay: { x: 300, y: 400 }, history: { x: 600, y: 0 }, count: { x: 600, y: 260 }, mode: { x: 600, y: 460 },
      opacity: { x: 600, y: 660 }, stack: { x: 900, y: 0 }, output: { x: 1200, y: 0 } },
  };
}
