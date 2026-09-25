import { resolveImageOperatorChoice, type ImageOperatorCompileContext } from './imageOperatorChoice';
import type { EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Fold only proven identity filters. Upstream motion/mask resources then become
 * unreachable. The persisted graph and parameters are never changed. */
function shortcuts(graph: EffectOperatorGraph, params: Record<string, unknown>, context: ImageOperatorCompileContext = {}) {
  const filters = graph.nodes.filter(node => node.operator === 'image.directional-smooth' || node.operator === 'image.mask-overlay' || node.operator === 'select.scalar' || node.operator === 'control.select.image' || node.operator === 'math.mix.scalar');
  if (!filters.length) return new Map<string, OperatorEdge>();
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const inputs = new Map(graph.edges.map(edge => [`${edge.to}:${edge.input}`, edge]));
  const memo = new Map<string, number | boolean | undefined>(), active = new Set<string>();
  const value = (id: string, port: string): number | boolean | undefined => {
    const key = `${id}:${port}`;
    if (memo.has(key)) return memo.get(key);
    if (active.has(key)) return undefined;
    active.add(key);
    const node = nodes.get(id);
    let result: number | boolean | undefined;
    if (node && port === 'value') {
      const binding = node.bindings.value;
      const raw = typeof binding === 'string' ? params[binding] : node.constants?.value;
      if (node.operator === 'values.number') result = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
      if (node.operator === 'values.choice' && context.parameterSchema) result = resolveImageOperatorChoice(binding, params, context);
      if (node.operator === 'values.boolean') result = typeof raw === 'boolean' ? raw : undefined;
      if (node.operator === 'math.clamp.scalar') {
        const v = input(id, 'value'), min = input(id, 'min'), max = input(id, 'max');
        if (typeof v === 'number' && typeof min === 'number' && typeof max === 'number') result = Math.max(min, Math.min(max, v));
      }
      if (node.operator === 'select.scalar') {
        const condition = input(id, 'condition');
        if (typeof condition === 'boolean') result = input(id, condition ? 'trueValue' : 'falseValue');
      }
    }
    if (node?.operator === 'compare.greater.scalar' && port === 'condition') {
      const a = input(id, 'a'), b = input(id, 'b');
      if (typeof a === 'number' && typeof b === 'number') result = a > b;
    }
    active.delete(key); memo.set(key, result); return result;
  };
  const input = (id: string, port: string): number | boolean | undefined => {
    const edge = inputs.get(`${id}:${port}`);
    return edge ? value(edge.from, edge.output) : undefined;
  };
  const nonpositive = (id: string, port: string) => { const v = input(id, port); return typeof v === 'number' && v <= 0; };
  const result = new Map<string, OperatorEdge>();
  for (const node of filters) {
    if (node.operator === 'math.mix.scalar') {
      const t = input(node.id, 't');
      const branch = t === 0 || t === 1 ? inputs.get(`${node.id}:${t === 0 ? 'a' : 'b'}`) : undefined;
      if (branch) result.set(node.id, branch);
      continue;
    }
    if (node.operator === 'select.scalar' || node.operator === 'control.select.image') {
      const condition = input(node.id, 'condition');
      const branch = typeof condition === 'boolean' ? inputs.get(`${node.id}:${condition ? 'trueValue' : 'falseValue'}`) : undefined;
      if (branch) result.set(node.id, branch);
      continue;
    }
    const bypass = node.operator === 'image.directional-smooth'
      ? nonpositive(node.id, 'radius') || nonpositive(node.id, 'mask')
      : node.operator === 'image.mask-overlay' && (nonpositive(node.id, 'mask') || nonpositive(node.id, 'opacity'));
    const source = inputs.get(`${node.id}:image`);
    if (bypass && source) result.set(node.id, source);
  }
  return result;
}

/** History samplers ignore a connected motion field unless their Motion
 * compensation selects it; the unused analysis then becomes unreachable. */
function inactiveMotionEdges(graph: EffectOperatorGraph, params: Record<string, unknown>) {
  const inactive = new Set<string>();
  for (const node of graph.nodes) {
    if (node.operator !== 'image.sample-history') continue;
    const binding = node.bindings.motionCompensation;
    const mode = typeof binding === 'string' ? params[binding] : node.constants?.motionCompensation;
    if (mode === 'motion') continue;
    for (const edge of graph.edges) if (edge.to === node.id && edge.input === 'motion') inactive.add(edge.id);
  }
  return inactive;
}

/** Parameter changes that cross zero/overlay gates must rebuild the pass plan;
 * other slider changes can continue to update uniforms only. */
export function imageFilterShortcutKey(graph: EffectOperatorGraph, params: Record<string, unknown>, context: ImageOperatorCompileContext = {}) {
  return [...[...shortcuts(graph, params, context)].map(([id, edge]) => `${id}:${edge.from}:${edge.output}`),
    ...[...inactiveMotionEdges(graph, params)].map(id => `motion-off:${id}`)].join('|');
}

export function bypassIdentityImageFilters(graph: EffectOperatorGraph, params: Record<string, unknown>, context: ImageOperatorCompileContext = {}): EffectOperatorGraph {
  const inactive = inactiveMotionEdges(graph, params);
  if (inactive.size) graph = { ...graph, edges: graph.edges.filter(edge => !inactive.has(edge.id)) };
  const bypass = shortcuts(graph, params, context);
  if (!bypass.size) return graph;
  return { ...graph, edges: graph.edges.map(edge => {
    let from = edge.from, output = edge.output;
    const seen = new Set<string>();
    while (bypass.has(from) && !seen.has(from)) {
      seen.add(from); const source = bypass.get(from)!; from = source.from; output = source.output;
    }
    return from === edge.from && output === edge.output ? edge : { ...edge, from, output };
  }) };
}
