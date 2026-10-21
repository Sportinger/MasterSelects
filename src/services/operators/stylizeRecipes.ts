import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createEarlierGrainGraph, createEarlierScanlinesGraph, createEarlierVignetteGraph } from './contextualEffectGraphs';
// The earlier Sharpen recipe still lives with the blur graphs it was built next to.
import { createDefaultSharpenGraph as createEarlierSharpenGraph } from './blurEffectGraphs';
import { createDefaultEdgeDetectGraph, createEarlierEdgeDetectGraph } from './edgeDetectEffectGraph';
import { createDefaultGlowGraph } from './glowBloomEffectGraph';
import { createRingGlowGraph } from './glowEffectGraph';
import { isRingGlowGraph } from './glowGraphUpgrade';
import { createDefaultGrainGraph } from './grainEffectGraph';
import { createDefaultScanlinesGraph } from './scanlinesEffectGraph';
import { createDefaultSharpenGraph } from './sharpenEffectGraph';
import { createDefaultVignetteGraph } from './vignetteEffectGraph';
import { createDefaultPointwiseEffectGraph, createEarlierPointwiseEffectGraph, type EditablePointwiseEffectType } from './pointwiseEffectGraphs';

/**
 * Stylize recipes rebuilt on 2026-10-21 (Glow, Film Grain, Sharpen, Vignette, Scanlines, Edge
 * Detect, Threshold, Posterize). New effects carry the current recipe graph from the start.
 * Saved projects keep the graph they were saved with, so their look does not change on load; an
 * effect saved before effect graphs existed (no graph at all) gets the earlier recipe it rendered.
 * The inspector recognizes an untouched earlier recipe and offers the current one. Threshold and
 * Posterize at Softness 0 are the earlier math exactly, so their untouched earlier graphs simply
 * read as the current recipe.
 */
export type StylizeRecipeEffectType = 'glow' | 'grain' | 'sharpen' | 'vignette' | 'scanlines' | 'edge-detect' | EditablePointwiseEffectType;

const CURRENT: Record<StylizeRecipeEffectType, () => EffectOperatorGraph> = {
  glow: createDefaultGlowGraph, grain: createDefaultGrainGraph, sharpen: createDefaultSharpenGraph,
  vignette: createDefaultVignetteGraph, scanlines: createDefaultScanlinesGraph, 'edge-detect': createDefaultEdgeDetectGraph,
  threshold: () => createDefaultPointwiseEffectGraph('threshold'), posterize: () => createDefaultPointwiseEffectGraph('posterize'),
};
const EARLIER: Record<StylizeRecipeEffectType, () => EffectOperatorGraph> = {
  glow: createRingGlowGraph, grain: createEarlierGrainGraph, sharpen: createEarlierSharpenGraph,
  vignette: createEarlierVignetteGraph, scanlines: createEarlierScanlinesGraph, 'edge-detect': createEarlierEdgeDetectGraph,
  threshold: () => createEarlierPointwiseEffectGraph('threshold'), posterize: () => createEarlierPointwiseEffectGraph('posterize'),
};

export const STYLIZE_RECIPE_EFFECT_TYPES: ReadonlySet<string> = new Set(Object.keys(CURRENT));
const isRecipeType = (type: string): type is StylizeRecipeEffectType => STYLIZE_RECIPE_EFFECT_TYPES.has(type);

/** The current recipe graph of a rebuilt stylize effect (undefined for other effect types). */
export function createStylizeRecipeGraph(type: string): EffectOperatorGraph | undefined {
  return isRecipeType(type) ? CURRENT[type]() : undefined;
}

/** The recipe a graphless stylize effect in a project file rendered (undefined when it is the current one). */
export function createEarlierStylizeGraph(type: string): EffectOperatorGraph | undefined {
  return isRecipeType(type) && type !== 'threshold' && type !== 'posterize' ? EARLIER[type]() : undefined;
}

const recognizer = (create: () => EffectOperatorGraph) => {
  let recipe: EffectOperatorGraph | undefined;
  const known = new WeakMap<EffectOperatorGraph, boolean>();
  return (graph: EffectOperatorGraph | undefined): boolean => {
    if (!graph || graph.incomplete) return false;
    const cached = known.get(graph); if (cached !== undefined) return cached;
    recipe ??= create();
    const result = matchesEffectRecipe(graph, recipe);
    known.set(graph, result);
    return result;
  };
};

const earlierRecognizers: Partial<Record<StylizeRecipeEffectType, (graph: EffectOperatorGraph | undefined) => boolean>> = {
  glow: isRingGlowGraph, grain: recognizer(EARLIER.grain), sharpen: recognizer(EARLIER.sharpen), vignette: recognizer(EARLIER.vignette),
  scanlines: recognizer(EARLIER.scanlines), 'edge-detect': recognizer(EARLIER['edge-detect']),
  threshold: recognizer(EARLIER.threshold), posterize: recognizer(EARLIER.posterize),
};

/** True when `graph` is an untouched earlier recipe of this stylize effect (any presentation). */
export function isEarlierStylizeGraph(type: string, graph: EffectOperatorGraph | undefined): boolean {
  return isRecipeType(type) && !!earlierRecognizers[type]?.(graph);
}

/** Presentation of a stylize graph: an untouched earlier recipe keeps its own folder plan (`<type>-earlier`). */
export function stylizePresentation(type: string, graph: EffectOperatorGraph): { key: string; createDefault: () => EffectOperatorGraph } | undefined {
  return isRecipeType(type) && isEarlierStylizeGraph(type, graph) ? { key: `${type}-earlier`, createDefault: EARLIER[type] } : undefined;
}

/** Untouched earlier Threshold/Posterize graphs read as the current recipe (identical at Softness 0). */
export function upgradePointwiseStylizeGraph(type: string, graph: EffectOperatorGraph): EffectOperatorGraph {
  if ((type !== 'threshold' && type !== 'posterize') || graph.groups?.some(group => group.bypassed)) return graph;
  return isEarlierStylizeGraph(type, graph) ? CURRENT[type]() : graph;
}

export interface StylizeRecipeUpdate {
  /** One plain sentence for the inspector. */
  message: string;
  label: string;
  /** Values the current recipe reads differently; set together with the new graph. */
  resetParams?: Record<string, number>;
}

/** What the inspector says about an untouched earlier recipe, and the values an update resets. */
export const STYLIZE_RECIPE_UPDATES: Partial<Record<StylizeRecipeEffectType, StylizeRecipeUpdate>> = {
  glow: { message: 'This Glow was saved with the earlier ring version and keeps that look; Color has no effect on it.',
    label: 'Use the new Glow (resets its values)', resetParams: { amount: 1, threshold: 0.6, softness: 0.5, radius: 40 } },
  grain: { message: 'This Film Grain was saved with the earlier noise and keeps that look; Color has no effect on it.', label: 'Use the new Film Grain' },
  sharpen: { message: 'This Sharpen was saved with the earlier version, which can draw bright and dark halos.', label: 'Use the new Sharpen' },
  vignette: { message: 'This Vignette was saved with the earlier version; Roundness worked differently there.',
    label: 'Use the new Vignette (resets its shape)', resetParams: { size: 0.5, softness: 0.5, roundness: 1 } },
  scanlines: { message: 'This Scanlines was saved with the earlier version, which can flicker when lines get very dense.', label: 'Use the new Scanlines' },
  'edge-detect': { message: 'This Edge Detect was saved with the earlier version; Width and Color have no effect on it.', label: 'Use the new Edge Detect' },
};
