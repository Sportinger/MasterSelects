import { COLOR_RECIPE_EFFECT_TYPES, type EditableColorEffectType } from '../../services/operators/colorEffectGraphs';
import { migratePersistedEffectOperatorGraph } from '../../services/operators/effectGraphOwner';
import { createLegacyColorEffectGraph } from '../../services/operators/legacyColorEffectGraphs';
import { Logger } from '../../services/logger';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { EffectType } from '../../types/effects';
import { getDefaultParams } from '../index';
import type { LookDefinition, LookStackEntry } from './types';

const log = Logger.create('LookEntryGraph');

/**
 * The graph an applied Look entry needs: its saved graph, or for a custom Look saved before the
 * 2026-10 color rebuild the original color math, so an old Look keeps its look.
 */
export function lookEntryOperatorGraph(look: Pick<LookDefinition, 'builtIn' | 'schemaVersion'>, entry: LookStackEntry): EffectOperatorGraph | undefined {
  if (entry.operatorGraph) return structuredClone(entry.operatorGraph);
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
 * A stored Look graph comes from localStorage and may be corrupt or refer to operators that no
 * longer exist. It passes the same validation as a project-file graph before it can enter runtime
 * state; a rejected graph is reported here and in the log instead of failing at render time.
 */
export function checkedLookEntryOperatorGraph(look: Pick<LookDefinition, 'name' | 'builtIn' | 'schemaVersion'>, entry: LookStackEntry): CheckedLookEntryGraph {
  // Only stored graphs come from outside; the original color graphs are built here.
  if (!entry.operatorGraph) { const graph = lookEntryOperatorGraph(look, entry); return graph ? { graph } : {}; }
  let checked = checkedEntries.get(entry);
  if (!checked) { checked = checkStoredLookEntryGraph(look.name, entry, entry.operatorGraph); checkedEntries.set(entry, checked); }
  return checked.graph ? { graph: structuredClone(checked.graph) } : checked;
}
/** One check (and one log line) per stored entry; thumbnails ask on every redraw. */
const checkedEntries = new WeakMap<LookStackEntry, CheckedLookEntryGraph>();

function checkStoredLookEntryGraph(lookName: string, entry: LookStackEntry, graph: EffectOperatorGraph): CheckedLookEntryGraph {
  try {
    const checked = migratePersistedEffectOperatorGraph({
      id: 'look-entry', name: entry.effectId, type: entry.effectId as EffectType, enabled: entry.enabled,
      params: { ...getDefaultParams(entry.effectId), ...entry.params }, operatorGraph: structuredClone(graph),
    });
    return { graph: checked.operatorGraph };
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const problem = `Look "${lookName}": the saved ${entry.effectId} graph cannot be used (${cause instanceof Error ? cause.message : String(cause)}); it renders the current ${entry.effectId} instead.`;
    log.warn(problem);
    return { problem };
  }
}
