import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { Effect } from '../../types/effects';
import { validateEffectGraph } from './effectGraph';

/** Reject corrupt wiring, but save incomplete work and resume after repair. */
export function prepareEditableOperatorGraph(graph: EffectOperatorGraph, compile: () => unknown) {
  const structural = validateEffectGraph(graph, true);
  if (structural.length) throw new Error(structural[0]);
  delete graph.incomplete;
  const issues = validateEffectGraph(graph);
  if (issues.length) { graph.incomplete = issues[0]; return; }
  try { compile(); }
  catch (error) { graph.incomplete = error instanceof Error ? error.message : String(error); }
}

const reasons = new Map<string, string | undefined>();
export function operatorGraphPauseReason(effect: Pick<Effect, 'params'>): string | undefined {
  const saved = effect.params.operatorGraph;
  if (typeof saved !== 'string' || !saved) return;
  if (reasons.has(saved)) return reasons.get(saved);
  let reason: string | undefined;
  try { const graph = JSON.parse(saved); if (typeof graph.incomplete === 'string') reason = graph.incomplete; }
  catch { return; } // Existing graph readers report malformed project data.
  if (reasons.size >= 128) reasons.delete(reasons.keys().next().value!);
  reasons.set(saved, reason); return reason;
}

/** Transient render state only; the user's enable toggle remains unchanged. */
export function pauseIncompleteOperatorEffects(effects: Effect[]): Effect[] {
  return effects.map(effect => effect.enabled && operatorGraphPauseReason(effect) ? { ...effect, enabled: false } : effect);
}
