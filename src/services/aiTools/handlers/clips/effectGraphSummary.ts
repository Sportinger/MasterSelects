import { colorEffectGraphState, type ColorEffectGraphState } from '../../../operators/colorEffectGraphState';
import type { Effect } from '../../../../types';

/** What getClipDetails reports instead of a full effect graph (several KB of nodes, cables and layout). */
export interface EffectGraphSummary {
  readonly nodes: number;
  readonly edges: number;
  /** Color effects only: 'recipe' (current color math), 'original' (saved before the 2026-10 rebuild) or 'edited'. */
  readonly state?: ColorEffectGraphState;
  readonly incomplete?: string;
  readonly read: 'getOperatorGraph';
}

/** Replaces each effect's operator graph by a summary; getOperatorGraph returns the full graph. */
export function summarizeClipEffectGraphs(effects: readonly Effect[]): Array<Effect | (Omit<Effect, 'operatorGraph'> & { operatorGraph: EffectGraphSummary })> {
  return effects.map((effect) => {
    const graph = effect.operatorGraph;
    if (!graph) return effect;
    const state = colorEffectGraphState(effect.type, graph);
    const summary: EffectGraphSummary = {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      ...(state ? { state } : {}),
      ...(typeof graph.incomplete === 'string' ? { incomplete: graph.incomplete } : {}),
      read: 'getOperatorGraph',
    };
    return { ...effect, operatorGraph: summary };
  });
}
