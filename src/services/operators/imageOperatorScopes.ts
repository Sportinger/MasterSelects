import type { BoundOperatorNode, OperatorEdge } from '../../types/operatorGraph';
import type { ImagePlanInstruction } from './imageOperatorPlanTypes';

export interface ImageScopeValue { node: BoundOperatorNode; output: string }

const PURE_PREFIXES = ['values.', 'math.', 'vector.', 'convert.', 'coordinates.', 'optics.', 'compare.', 'logic.', 'color.'];
const PURE_INTRINSICS = new Set(['image.normalized-uv', 'image.resolution', 'image.timeline-time', 'pattern.bayer4.vec2', 'noise.hash2d.vec2']);
const CONTEXT_LEAVES = new Set(['image.kernel-index', 'image.sequence-index']);

const isPure = (operator: string) => PURE_INTRINSICS.has(operator) || PURE_PREFIXES.some(prefix => operator.startsWith(prefix));
const isEligiblePure = (node: BoundOperatorNode) => !node.bypassed && isPure(node.operator);
const eagerInputs = (node: BoundOperatorNode) => node.bypassed ? new Set<string>() : node.operator === 'image.sample' ? new Set(['uv'])
  : node.operator === 'control.select.image' || node.operator === 'control.select.scalar' ? new Set(['condition'])
    : isEligiblePure(node) ? undefined : new Set<string>();
const inputEdges = (node: BoundOperatorNode, incoming: ReadonlyMap<string, readonly OperatorEdge[]>) =>
  [...incoming.values()].flatMap(edges => edges[0]?.to === node.id ? [edges[0]] : []);

/** True when evaluating a lexical scope may reach the primary image input.
 * Lazy branch bodies live in child scopes; resource-only leaves deliberately do not count. */
export function imageScopeReadsPrimaryInput(instructions: readonly ImagePlanInstruction[], scope: number,
  seen = new Set<number>()): boolean {
  if (seen.has(scope)) return false;
  seen.add(scope);
  return instructions.some(item => item.scope === scope && (item.operation === 'input'
    || ((item.operation === 'select-image' || item.operation === 'select-lazy-scalar')
      && item.inputs.slice(1).some(child => imageScopeReadsPrimaryInput(instructions, child, seen)))));
}

export function hasUpstreamImageDerivative(current: BoundOperatorNode, edges: readonly OperatorEdge[],
  nodes: ReadonlyMap<string, BoundOperatorNode>, seen = new Set<string>()): boolean {
  if (current.operator.startsWith('image.derivative.')) return true;
  if (seen.has(current.id)) return false;
  seen.add(current.id);
  return edges.some(edge => edge.to === current.id && hasUpstreamImageDerivative(nodes.get(edge.from)!, edges, nodes, seen));
}

/** Values guaranteed to be evaluated by either branch and safe to place in their lexical dominator. */
export function commonPureImageBranchValues(
  branches: readonly ImageScopeValue[],
  nodes: ReadonlyMap<string, BoundOperatorNode>,
  incoming: ReadonlyMap<string, readonly OperatorEdge[]>,
): ImageScopeValue[] {
  const pureMemo = new Map<string, boolean>();
  const hasPureClosure = ({ node, output }: ImageScopeValue): boolean => {
    const key = `${node.id}:${output}`, known = pureMemo.get(key);
    if (known !== undefined) return known;
    if (CONTEXT_LEAVES.has(node.operator)) return true;
    if (!isEligiblePure(node)) return false;
    pureMemo.set(key, false);
    const valid = inputEdges(node, incoming).every(edge => {
      const source = nodes.get(edge.from);
      return !!edge && !!source && hasPureClosure({ node: source, output: edge.output });
    });
    pureMemo.set(key, valid);
    return valid;
  };
  const dependencies = ({ node, output }: ImageScopeValue, seen = new Set<string>(), ordered: ImageScopeValue[] = []): ImageScopeValue[] => {
    const key = `${node.id}:${output}`;
    if (seen.has(key)) return ordered;
    seen.add(key);
    const allowed = eagerInputs(node);
    for (const edge of inputEdges(node, incoming)) {
      if (allowed && !allowed.has(edge.input)) continue;
      const source = nodes.get(edge.from);
      if (source) dependencies({ node: source, output: edge.output }, seen, ordered);
    }
    if (isEligiblePure(node) && hasPureClosure({ node, output })) ordered.push({ node, output });
    return ordered;
  };
  const ordered = dependencies(branches[0]), common = new Set(dependencies(branches[1]).map(value => `${value.node.id}:${value.output}`));
  return ordered.filter(value => common.has(`${value.node.id}:${value.output}`));
}
