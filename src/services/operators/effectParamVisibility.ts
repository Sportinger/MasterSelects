import { getEffect } from '../../effects';
import type { EffectParam } from '../../effects/types';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { effectOperatorGraph, isImageGraphEffectType } from './effectGraphOwner';

/** The parts of an effect instance that decide which of its parameters still act. */
export interface EffectParamOwner { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }

const boundByGraph = new WeakMap<EffectOperatorGraph, ReadonlySet<string>>();
const conditional = (definition: EffectParam) => !!definition.deprecated || !!definition.graphOnly;

/** Parameters the instance's effective image graph reads; undefined when no graph decides it. */
export function graphBoundParameters(effect: EffectParamOwner): ReadonlySet<string> | undefined {
  if (!isImageGraphEffectType(effect.type)) return undefined;
  let graph: EffectOperatorGraph;
  try { graph = effectOperatorGraph(effect, { inspectionOnly: true }); } catch { return undefined; }
  let bound = boundByGraph.get(graph);
  if (!bound) {
    bound = new Set(graph.nodes.flatMap(node => [...Object.values(node.bindings).flatMap(binding =>
      typeof binding === 'string' ? [binding] : Array.isArray(binding) ? [binding[0]] : [binding.yaw, binding.pitch]),
    ...node.enabled ? [node.enabled] : []]));
    boundByGraph.set(graph, bound);
  }
  return bound;
}

/**
 * The instance's parameter definitions with `hidden` decided by its graph: a retired
 * (`deprecated`) parameter that an edited saved graph still reads is shown again, and a
 * `graphOnly` parameter that the graph does not read is hidden.
 */
export function effectParamDefinitions(effect: EffectParamOwner): Record<string, EffectParam> {
  const definitions = getEffect(effect.type)?.params ?? {};
  if (!Object.values(definitions).some(conditional)) return definitions;
  const bound = graphBoundParameters(effect);
  if (!bound) return definitions;
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, !conditional(definition) ? definition
    : definition.deprecated ? { ...definition, hidden: !bound.has(name) } : { ...definition, hidden: definition.hidden || !bound.has(name) }]));
}

/** Tool warnings for parameters that are accepted but do nothing on this instance. */
export function unusedParamWarnings(effect: EffectParamOwner, names: readonly string[]): string[] {
  const definitions = getEffect(effect.type)?.params ?? {};
  const bound = names.some(name => definitions[name] && conditional(definitions[name])) ? graphBoundParameters(effect) : undefined;
  return names.flatMap(name => {
    const definition = definitions[name];
    if (!definition || !conditional(definition) || bound?.has(name)) return [];
    if (definition.deprecated) return [`${name}: ${definition.deprecated}`];
    return bound ? [`${name}: this effect's edited graph does not read it, so it has no effect.`] : [];
  });
}
