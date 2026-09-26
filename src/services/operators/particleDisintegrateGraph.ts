import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM, graphInputNodes, operatorEnabled, readEffectGraph, validateEffectGraph, type OperatorParameters } from './effectGraph';
import { getEffectOperator } from './operatorRegistry';
import { isParticleDisintegrateOperator } from './particleDisintegrateOperators';

/** Existing effect parameters are the node storage, so presets and keyframes keep working unchanged. */
export function createDefaultParticleDisintegrateGraph(): EffectOperatorGraph {
  const specs = [
    ['frame', 'image.frame', 0, 80], ['particles', 'simulation.image-particles', 280, 80], ['release', 'simulation.particle-release', 580, 80],
    ['scatter', 'forces.scatter', 580, 470], ['wind', 'forces.wind-gusts', 580, 740], ['curl', 'forces.curl-noise', 580, 1060],
    ['gravity', 'forces.gravity', 580, 1290], ['motion', 'simulation.particle-motion', 900, 80], ['render', 'render.pixel-particles', 1180, 80],
  ] as const;
  const nodes: BoundOperatorNode[] = specs.map(([id, operator]) => ({ id, operator, operatorVersion: 1,
    bindings: Object.fromEntries(getEffectOperator(operator)!.parameters.map(param => [param.id, operator === 'forces.gravity' ? 'gravity' : param.id])) }));
  const connections = [
    ['frame', 'image', 'particles', 'image'], ['particles', 'particles', 'release', 'particles'], ['release', 'particles', 'motion', 'particles'],
    ['scatter', 'force', 'motion', 'forces'], ['wind', 'force', 'motion', 'forces'], ['curl', 'force', 'motion', 'forces'], ['gravity', 'force', 'motion', 'forces'],
    ['motion', 'particles', 'render', 'particles'],
  ];
  return { version: 1, schemaVersion: 1, domain: 'particles', nodes, layout: Object.fromEntries(specs.map(([id, , x, y]) => [id, { x, y }])),
    edges: connections.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
    groups: [{ id: 'forces', label: 'Forces', color: '#7fa768', nodeIds: ['scatter', 'wind', 'curl', 'gravity', 'motion'] }] };
}

export function validateParticleDisintegrateGraph(graph: EffectOperatorGraph, allowIncomplete = false): string[] {
  const errors = validateEffectGraph(graph, allowIncomplete);
  if (graph.domain !== 'particles' || graph.nodes.some(node => !isParticleDisintegrateOperator(node.operator))) errors.push('Unsupported Pixel Particle Disintegrate operator graph.');
  if (graph.nodes.filter(node => node.operator === 'simulation.image-particles').length > 1) errors.push('The graph supports one Image to Particles node.');
  return errors;
}

export function particleDisintegrateOperatorGraph(params: OperatorParameters): EffectOperatorGraph {
  const graph = readEffectGraph(params[EFFECT_GRAPH_PARAM], createDefaultParticleDisintegrateGraph);
  const errors = validateParticleDisintegrateGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  return graph;
}

export interface ParticleDisintegratePlan {
  /** The render node is muted or the particle chain is not connected: the input image is shown unchanged. */
  passthrough: boolean;
  /** Flat renderer parameters resolved from the connected nodes. */
  params: Record<string, unknown>;
}

/** Forces that are muted or disconnected contribute nothing. */
const NO_FORCES = { spread: 0, depth: 0, spin: 0, directionX: 0, directionY: 0, gustStrength: 0, curlStrength: 0, turbulence: 0, gravity: 0 };
const ADDITIVE = new Set(Object.keys(NO_FORCES));
let defaultGraph: EffectOperatorGraph | undefined;

/** Compiles the connected graph into the flat parameters of the existing particle renderer. */
export function compileParticleDisintegrateGraph(graph: EffectOperatorGraph | undefined, params: OperatorParameters): ParticleDisintegratePlan {
  graph ??= defaultGraph ??= createDefaultParticleDisintegrateGraph();
  const value = (node: BoundOperatorNode, id: string): OperatorValue => {
    const spec = getEffectOperator(node.operator)?.parameters.find(param => param.id === id);
    const binding = node.bindings[id];
    return (typeof binding === 'string' ? params[binding] as OperatorValue | undefined : node.constants?.[id]) ?? spec?.default ?? 0;
  };
  const resolved: Record<string, unknown> = { ...params };
  const copy = (node: BoundOperatorNode) => {
    for (const spec of getEffectOperator(node.operator)?.parameters ?? []) {
      const key = node.operator === 'forces.gravity' ? 'gravity' : spec.id, next = value(node, spec.id);
      resolved[key] = ADDITIVE.has(key) ? Number(resolved[key]) + Number(next) : next;
    }
  };
  const render = graph.nodes.find(node => node.operator === 'render.pixel-particles');
  if (!render || !operatorEnabled(render, params)) return { passthrough: true, params };
  // Walk the particle chain from the render node back to its source.
  const chain: BoundOperatorNode[] = [];
  for (let node = graphInputNodes(graph, render.id, 'particles')[0]; node; node = graphInputNodes(graph, node.id, 'particles')[0]) {
    if (chain.includes(node)) break;
    chain.push(node);
  }
  const source = chain.at(-1);
  if (source?.operator !== 'simulation.image-particles' || graphInputNodes(graph, source.id, 'image')[0]?.operator !== 'image.frame') return { passthrough: true, params };
  copy(render); copy(source);
  const release = chain.find(node => node.operator === 'simulation.particle-release' && operatorEnabled(node, params));
  if (release) copy(release); else resolved.progress = 0;
  Object.assign(resolved, NO_FORCES);
  for (const motion of chain.filter(node => node.operator === 'simulation.particle-motion' && operatorEnabled(node, params))) {
    for (const force of graphInputNodes(graph, motion.id, 'forces')) if (operatorEnabled(force, params)) copy(force);
  }
  return { passthrough: false, params: resolved };
}
