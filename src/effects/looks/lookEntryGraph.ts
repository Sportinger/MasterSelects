import { COLOR_RECIPE_EFFECT_TYPES, type EditableColorEffectType } from '../../services/operators/colorEffectGraphs';
import { migratePersistedEffectOperatorGraph } from '../../services/operators/effectGraphOwner';
import { createLegacyColorEffectGraph } from '../../services/operators/legacyColorEffectGraphs';
import { createEarlierStylizeGraph } from '../../services/operators/stylizeRecipes';
import { lookEntryOriginalGraph, lookEntryRecipeOnlyParams } from './lookStackEffects';
import { withLegacyLookParams } from './legacyLookParams';
import { EFFECT_GRAPH_PARAM } from '../../services/operators/effectGraph';
import { watercolourOnlyParams } from '../../services/operators/acuarelaIdentity';
import { Logger } from '../../services/logger';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { EffectType } from '../../types/effects';
import { getDefaultParams } from '../index';
import type { LookDefinition, LookStackEntry } from './types';

const log = Logger.create('LookEntryGraph');

/**
 * The graph an applied Look entry needs: its saved graph, the earlier recipe of a stylize effect
 * saved with it (`recipe: 'earlier'`, before 2026-10-21), the original graph of an analog effect
 * in a custom Look saved before its 2026-10 rebuild, or for a custom Look saved before the
 * 2026-10 color rebuild the original color math, so an old Look keeps its look.
 */
export function lookEntryOperatorGraph(look: Pick<LookDefinition, 'builtIn' | 'schemaVersion'>, entry: LookStackEntry): EffectOperatorGraph | undefined {
  if (entry.operatorGraph) return structuredClone(entry.operatorGraph);
  if (entry.recipe === 'earlier') return createEarlierStylizeGraph(entry.effectId);
  // A custom Look entry saved before its analog effect's 2026-10 rebuild keeps the original graph.
  const analog = lookEntryOriginalGraph(look, entry);
  if (analog) return analog;
  if (look.builtIn || look.schemaVersion || !COLOR_RECIPE_EFFECT_TYPES.has(entry.effectId)) return undefined;
  return createLegacyColorEffectGraph(entry.effectId as EditableColorEffectType);
}

export interface CheckedLookEntryGraph {
  /** The validated graph, or undefined when the entry renders the effect's current recipe. */
  readonly graph?: EffectOperatorGraph;
  /** Why a stored graph was rejected (the entry then renders the current recipe). */
  readonly problem?: string;
}

/**
 * The values an applied Look entry sets: its saved values, for a custom Look plus the values that
 * keep the look of effects that gained controls or a new recipe since (legacyLookParams.ts). A
 * graph carried in the values (the smoke Acuarela of an old Look) is not one of them: it becomes
 * the effect's operatorGraph (checkedLookEntryOperatorGraph), as on project load.
 */
export function lookEntryParams(look: Pick<LookDefinition, 'builtIn'>, entry: LookStackEntry): LookStackEntry['params'] {
  const params = withCarriedGraph(look, entry);
  if (params[EFFECT_GRAPH_PARAM] === undefined) return params;
  return Object.fromEntries(Object.entries(params).filter(([id]) => id !== EFFECT_GRAPH_PARAM));
}

const withCarriedGraph = (look: Pick<LookDefinition, 'builtIn'>, entry: LookStackEntry) =>
  look.builtIn ? entry.params : withLegacyLookParams(entry.effectId, entry.params);

/**
 * Default parameters an applied entry leaves out because its graph never reads them: an analog
 * entry pinned to its original graph, an Acuarela on the smoke recipe (no watercolour values).
 */
export function lookEntryOmittedParams(look: Pick<LookDefinition, 'builtIn'>, entry: LookStackEntry, graph: EffectOperatorGraph | undefined): string[] {
  return [...lookEntryRecipeOnlyParams(look, entry), ...(graph ? watercolourOnlyParams({ type: entry.effectId, params: {}, operatorGraph: graph }) : [])];
}

/**
 * A stored Look graph comes from localStorage and may be corrupt or refer to operators that no
 * longer exist. It passes the same validation as a project-file graph before it can enter runtime
 * state; a rejected graph is reported here and in the log instead of failing at render time. A
 * graph carried in the entry's values (older Looks) is moved and checked the same way.
 */
export function checkedLookEntryOperatorGraph(look: Pick<LookDefinition, 'name' | 'builtIn' | 'schemaVersion'>, entry: LookStackEntry): CheckedLookEntryGraph {
  const params = withCarriedGraph(look, entry), carried = typeof params[EFFECT_GRAPH_PARAM] === 'string';
  // Only stored graphs come from outside; the earlier and original recipes are built here.
  if (!entry.operatorGraph && !carried) { const graph = lookEntryOperatorGraph(look, entry); return graph ? { graph } : {}; }
  let checked = checkedEntries.get(entry);
  if (!checked) { checked = checkStoredLookEntryGraph(look.name, { ...entry, params }, entry.operatorGraph); checkedEntries.set(entry, checked); }
  return checked.graph ? { graph: structuredClone(checked.graph) } : checked;
}
/** One check (and one log line) per stored entry; thumbnails ask on every redraw. */
const checkedEntries = new WeakMap<LookStackEntry, CheckedLookEntryGraph>();

function checkStoredLookEntryGraph(lookName: string, entry: LookStackEntry, graph: EffectOperatorGraph | undefined): CheckedLookEntryGraph {
  try {
    const checked = migratePersistedEffectOperatorGraph({
      id: 'look-entry', name: entry.effectId, type: entry.effectId as EffectType, enabled: entry.enabled,
      params: { ...getDefaultParams(entry.effectId), ...entry.params }, ...(graph ? { operatorGraph: structuredClone(graph) } : {}),
    });
    return { graph: checked.operatorGraph };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const problem = `Look "${lookName}": the saved ${entry.effectId} graph cannot be used (${cause instanceof Error ? cause.message : String(cause)}); it renders the current ${entry.effectId} instead.`;
    log.warn(problem);
    return { problem };
  }
}
