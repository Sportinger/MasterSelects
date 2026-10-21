import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { TIME_STACK_MIN_DECAY } from '../../effects/time/time-stack/settings';
import { matchesEffectRecipe } from './effectFamilyPresentation';

/**
 * A loop remains a loop in Image IR: one source atlas and one sampler for all instances.
 * Instance i reads `i x offset` seconds back and is blended with opacity `decay^i` (Decay 1 = all equal).
 */
function buildTimeStackGraph(withDecay: boolean): EffectOperatorGraph {
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
  node('history', 'image.sample-history');
  node('stack', 'image.sequence-blend'); node('output', 'image.output');
  edge('index', 'index', 'delay', 'a'); edge('offset', 'value', 'delay', 'b');
  edge('frame', 'image', 'history', 'current'); edge('uv', 'uv', 'history', 'uv'); edge('delay', 'value', 'history', 'delay');
  edge('history', 'image', 'stack', 'sample');
  if (withDecay) {
    // Decay clamped to TIME_STACK_MIN_DECAY..1 (pow(0, 0) is undefined on the GPU), then decay^index.
    node('decay', 'values.number', { value: 'decay' });
    node('decay-floor', 'values.number', {}, { value: TIME_STACK_MIN_DECAY }); node('decay-ceiling', 'values.number', {}, { value: 1 });
    node('decay-clamped', 'math.clamp.scalar'); node('opacity', 'math.power.scalar');
    edge('decay', 'value', 'decay-clamped', 'value'); edge('decay-floor', 'value', 'decay-clamped', 'min'); edge('decay-ceiling', 'value', 'decay-clamped', 'max');
    edge('decay-clamped', 'value', 'opacity', 'a'); edge('index', 'index', 'opacity', 'b');
  } else node('opacity', 'values.number', {}, { value: 1 });
  edge('opacity', 'value', 'stack', 'weight');
  edge('count', 'value', 'stack', 'count'); edge('mode', 'value', 'stack', 'mode'); edge('stack', 'image', 'output', 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: { frame: { x: 0, y: 0 }, uv: { x: 0, y: 220 }, offset: { x: 0, y: 440 }, index: { x: 0, y: 640 },
      delay: { x: 300, y: 400 }, history: { x: 600, y: 0 }, count: { x: 600, y: 260 }, mode: { x: 600, y: 460 },
      ...(withDecay ? { decay: { x: 0, y: 860 }, 'decay-floor': { x: 0, y: 1060 }, 'decay-ceiling': { x: 0, y: 1260 },
        'decay-clamped': { x: 300, y: 900 }, opacity: { x: 600, y: 700 } } : { opacity: { x: 600, y: 660 } }),
      stack: { x: 900, y: 0 }, output: { x: 1200, y: 0 } },
  };
}

export function createDefaultTimeStackGraph(): EffectOperatorGraph { return buildTimeStackGraph(true); }

/** The graph saved before Decay existed (every instance at full opacity). */
export function createLegacyTimeStackGraph(): EffectOperatorGraph { return buildTimeStackGraph(false); }

let legacy: EffectOperatorGraph | undefined;
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/**
 * An untouched saved graph from before Decay becomes the current graph; with Decay at its default 1
 * it renders the same image. Edited graphs stay as saved (Decay has no effect there; the inspector says so).
 */
export function upgradeTimeStackGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source); if (known) return known;
  legacy ??= createLegacyTimeStackGraph();
  const result = matchesEffectRecipe(source, legacy) ? createDefaultTimeStackGraph() : source;
  upgraded.set(source, result);
  return result;
}

/** Whether a (resolved) Time Stack graph reads the Decay parameter. */
export function timeStackGraphReadsDecay(graph: EffectOperatorGraph | undefined): boolean {
  return !graph || graph.nodes.some(node => node.bindings.value === 'decay');
}
