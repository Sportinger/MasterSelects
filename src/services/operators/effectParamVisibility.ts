import { getDefaultParams, getEffect } from '../../effects';
import type { EffectParam } from '../../effects/types';
import { FEEDBACK_HISTORY_LOOP_KEY } from '../../effects/_shared/feedbackParameters';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { effectOperatorGraph, isImageGraphEffectType } from './effectGraphOwner';
import { isCurrentStylizeGraph, isEarlierStylizeGraph, STYLIZE_RECIPE_EFFECT_TYPES } from './stylizeRecipes';
import { Logger } from '../logger';
import { PATTERN_REFERENCE_HEIGHT } from './patternReferenceFrame';

const log = Logger.create('EffectParamVisibility');

/** The parts of an effect instance that decide which of its parameters still act. */
export interface EffectParamOwner { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }

const boundByGraph = new WeakMap<EffectOperatorGraph, ReadonlySet<string>>();
const conditional = (definition: EffectParam) => !!definition.deprecated || !!definition.graphOnly;
const FEEDBACK_CONTROLS = [FEEDBACK_HISTORY_LOOP_KEY, 'reset'];

/** Parameters the instance's effective image graph reads; undefined when no graph decides it. */
export function graphBoundParameters(effect: EffectParamOwner): ReadonlySet<string> | undefined {
  if (!isImageGraphEffectType(effect.type)) return undefined;
  let graph: EffectOperatorGraph;
  try { graph = effectOperatorGraph(effect, { inspectionOnly: true }); } catch { return undefined; }
  let bound = boundByGraph.get(graph);
  if (!bound) {
    bound = new Set(graph.nodes.flatMap(node => [...Object.values(node.bindings).flatMap(binding =>
      typeof binding === 'string' ? [binding] : Array.isArray(binding) ? [binding[0]] : [binding.yaw, binding.pitch]),
    ...node.enabled ? [node.enabled] : [],
    // The feedback controls act through the frame history the runtime keeps for this node.
    ...node.operator === 'image.frame-history' ? FEEDBACK_CONTROLS : []]));
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

/**
 * The effect's own notes on values it clamps, ignores or cannot show (`paramWarnings`), judged on
 * the recipe this instance runs. The notes describe a rebuilt stylize effect's current recipe: an
 * instance on an untouched earlier recipe gets none (its inspector card and tool results name the
 * earlier version instead, see `earlierStylizeRecipeNote`), and an edited graph gets them as one
 * hedged note, because its own nodes decide what happens to those values. A note function that
 * throws is logged and reported, never dropped silently.
 */
const measuredTypes = new Map<string, boolean>();
const measures = (graph: EffectOperatorGraph | undefined) => graph?.nodes.some(node => node.id === 'frame-scale') ?? false;
function graphOf(effect: EffectParamOwner): EffectOperatorGraph | undefined {
  try { return effectOperatorGraph(effect, { inspectionOnly: true }); } catch { return undefined; }
}

/**
 * True when the effect's current recipe measures its pattern sizes in 1080p pixels
 * (`measureInReferenceFrame`) but this instance's graph does not: an earlier saved graph (Halftone,
 * Riso, Dithering, Paper Print from 3.2.7 ...) draws them in output pixels, so its size notes must be
 * judged on a 1080-pixel frame, where a 1080p pixel is one output pixel.
 */
function runsUnmeasuredGraph(effect: EffectParamOwner): boolean {
  if (!isImageGraphEffectType(effect.type)) return false;
  let current = measuredTypes.get(effect.type);
  if (current === undefined) {
    current = measures(graphOf({ type: effect.type, params: getDefaultParams(effect.type) }));
    measuredTypes.set(effect.type, current);
  }
  return current && !measures(graphOf(effect));
}

export function effectDefinitionNotes(effect: EffectParamOwner, width: number, height: number): string[] {
  const definition = getEffect(effect.type);
  if (!definition || !('paramWarnings' in definition) || !definition.paramWarnings) return [];
  const recipe = STYLIZE_RECIPE_EFFECT_TYPES.has(effect.type);
  if (recipe && isEarlierStylizeGraph(effect.type, effect.operatorGraph)) return [];
  if (runsUnmeasuredGraph(effect)) width = height = PATTERN_REFERENCE_HEIGHT;
  let notes: string[];
  try { notes = definition.paramWarnings(effect.params as Record<string, number | boolean | string>, width, height); } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn(`${definition.name}: its value notes could not be computed`, error);
    return [`${definition.name}: its value notes could not be computed (${reason}).`];
  }
  if (!notes.length || !recipe) return notes;
  let graph: EffectOperatorGraph | undefined;
  try { graph = effectOperatorGraph(effect, { inspectionOnly: true }); } catch { graph = undefined; }
  if (isCurrentStylizeGraph(effect.type, graph)) return notes;
  return [`This ${definition.name} runs an edited graph, so its own nodes decide how these values act; the standard recipe would say: ${notes.join(' ')}`];
}
