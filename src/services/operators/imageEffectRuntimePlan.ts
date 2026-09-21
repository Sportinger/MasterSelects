import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { getEffect } from '../../effects';
import { EFFECT_GRAPH_PARAM } from './effectGraph';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from './effectGraphOwner';
import { compileImageOperatorGraph, compileImageOperatorPreview, type ImageOperatorPlan, type ImageOperatorPreviewTarget } from './imageOperatorGraph';
import { bindImageOperatorValues, validateImageOperatorValues } from './imageOperatorValueBindings';

type ImageEffect = { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph };
interface PreparedImageEffect {
  graph: EffectOperatorGraph;
  plan?: ImageOperatorPlan;
}
interface CachedImageEffect {
  definition: ReturnType<typeof getEffect>;
  parameterSignature: string;
  prepared: PreparedImageEffect;
  uniformsOnly: boolean;
  previews: Map<string, { parameterSignature: string; plan?: ImageOperatorPlan; error?: unknown }>;
}

// Content keys cover cloned/keyframed effects and in-place edits. The bounded cache
// retains no GPU objects, source frames or render-time state and is reset by HMR.
const plans = new Map<string, CachedImageEffect>();
const graphEntries = new WeakMap<EffectOperatorGraph, CachedImageEffect>();
const MAX_PLANS = 32;
const signature = (value: unknown) => JSON.stringify(value, (_key, item) =>
  typeof item === 'number' && (!Number.isFinite(item) || Object.is(item, -0))
    ? { imageParameterNumber: Object.is(item, -0) ? '-0' : String(item) } : item);

/** Prepare once per graph revision; animated values only refill uniform slots. */
export function prepareImageEffect(effect: ImageEffect): PreparedImageEffect {
  const key = signature([effect.type, effect.operatorGraph ?? effect.params[EFFECT_GRAPH_PARAM] ?? null]);
  const definition = getEffect(effect.type);
  const params = effectOperatorParams(effect);
  const parameterSignature = signature(params);
  const cached = plans.get(key);
  if (cached && cached.definition === definition) {
    plans.delete(key); plans.set(key, cached);
    if (cached.parameterSignature === parameterSignature) return cached.prepared;
    if (cached.uniformsOnly && cached.prepared.plan) {
      const context = effectOperatorCompileContext(effect);
      validateImageOperatorValues(cached.prepared.graph, params, context);
      const prepared = { graph: cached.prepared.graph, plan: bindImageOperatorValues(cached.prepared.plan, params, context) };
      cached.parameterSignature = parameterSignature;
      cached.prepared = prepared;
      return prepared;
    }
  }
  // Normalize a revision snapshot: editor recognition caches use object identity,
  // whereas render callers may also supply a mutated or deserialized graph.
  const graph = effectOperatorGraph({ ...effect,
    operatorGraph: effect.operatorGraph ? structuredClone(effect.operatorGraph) : undefined });
  const plan = graph.incomplete ? undefined : compileImageOperatorGraph(graph, params, effectOperatorCompileContext(effect));
  const prepared = { graph, plan };
  // Atlas/byte-resource metadata can depend on params, not just uniform values.
  const uniformsOnly = !graph.nodes.some(node => node.operator === 'glyph.atlas' || node.operator === 'source.memory-window');
  plans.delete(key);
  const entry = { definition, parameterSignature, prepared, uniformsOnly, previews: new Map() };
  plans.set(key, entry);
  graphEntries.set(graph, entry);
  if (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value!);
  return prepared;
}

/** Preview targets share the owner's validated revision and cache unsupported
 * scopes too, so a hidden reducer input cannot retry compilation every frame. */
export function prepareImageEffectPreview(effect: ImageEffect, target: ImageOperatorPreviewTarget): ImageOperatorPlan {
  const { graph } = prepareImageEffect(effect);
  const entry = graphEntries.get(graph)!;
  const key = JSON.stringify(target), found = entry.previews.get(key);
  if (found?.parameterSignature === entry.parameterSignature) {
    if (!found.plan) throw found.error;
    return found.plan;
  }
  const params = effectOperatorParams(effect), context = effectOperatorCompileContext(effect);
  try {
    const plan = found?.plan && entry.uniformsOnly ? bindImageOperatorValues(found.plan, params, context)
      : compileImageOperatorPreview(graph, params, target, context);
    entry.previews.delete(key);
    entry.previews.set(key, { parameterSignature: entry.parameterSignature, plan });
    if (entry.previews.size > 64) entry.previews.delete(entry.previews.keys().next().value!);
    return plan;
  } catch (error) {
    entry.previews.set(key, { parameterSignature: entry.parameterSignature, error });
    if (entry.previews.size > 64) entry.previews.delete(entry.previews.keys().next().value!);
    throw error;
  }
}
