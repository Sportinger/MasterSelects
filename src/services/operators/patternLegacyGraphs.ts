import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM } from './effectGraph';
import { createLegacyHalftoneGraph } from './legacyHalftoneGraph';
import { createEarlierRisoGraph } from './risoEffectGraphs';
import { hasEarlierRisoParams } from './risoPrintEffectGraph';
import { createDefaultDitherGraph } from './ditherEffectGraphs';
import { hasEarlierDitheringParams } from './ditheringEffectGraph';
import { createEarlierPaperPrintGraph, hasEarlierPaperPrintParams } from './paperPrintEffectGraph';

/**
 * Print looks rebuilt in the 2026-10-22 print review. Saved effects keep the look they were made with:
 * - a saved graph (every project saved since effect graphs exist stores one) stays as saved;
 * - an effect that carries only parameters is old data and gets the graph it rendered with in 3.2.7
 *   (sizes in output pixels, no 1080p measure):
 *   - Riso, Riso Glow, Dithering and Paper Print gained a parameter (Dot Size, Levels, Texture), and new
 *     effects store every default, so one without it is old wherever it comes from (pinEarlierPrintGraph);
 *   - Halftone and Pattern Halftone gained none: a graph-less one from a project file (saved before effect
 *     graphs existed) or a custom Look entry without a stored graph is old (earlierPrintGraph), while a
 *     graph-less one in the running editor is new and renders the current recipe.
 */
const PRINT_LOOKS = new Set(['halftone', 'pattern-halftone', 'riso', 'riso-glow', 'dither', 'paper-print']);

export function isReviewedPrintLook(type: string): boolean { return PRINT_LOOKS.has(type); }

/** The 3.2.7 graph of a print look (undefined for other types). */
export function earlierPrintGraph(type: string): EffectOperatorGraph | undefined {
  if (type === 'halftone' || type === 'pattern-halftone') return createLegacyHalftoneGraph(type);
  if (type === 'riso' || type === 'riso-glow') return createEarlierRisoGraph(type);
  if (type === 'dither') return createDefaultDitherGraph('dither');
  if (type === 'paper-print') return createEarlierPaperPrintGraph();
  return undefined;
}

/** True when the parameters of a graph-less instance predate the parameter its current recipe added. */
export function predatesPrintRecipe(type: string, params: Record<string, unknown>): boolean {
  return (type === 'riso' || type === 'riso-glow') ? hasEarlierRisoParams(params)
    : type === 'dither' ? hasEarlierDitheringParams(params)
      : type === 'paper-print' ? hasEarlierPaperPrintParams(params) : false;
}

/** Every persisted entry (project load and save, nested compositions, presets, Look checks): a graph-less print look
 * whose parameters predate its recipe gets its 3.2.7 graph. */
export function pinEarlierPrintGraph(effect: Effect): Effect {
  if (effect.operatorGraph || effect.params[EFFECT_GRAPH_PARAM] !== undefined || !predatesPrintRecipe(effect.type, effect.params)) return effect;
  const graph = earlierPrintGraph(effect.type);
  return graph ? { ...effect, operatorGraph: graph } : effect;
}
