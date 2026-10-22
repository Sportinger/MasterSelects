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
import { capPosterizeRampWidth, createDefaultPointwiseEffectGraph, createEarlierPointwiseEffectGraph, type EditablePointwiseEffectType } from './pointwiseEffectGraphs';
import { GLOW_DEFAULTS } from '../../effects/stylize/glow/glowBloom';

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

/** True for the stylize effects whose earlier recipe renders differently from the current one. */
export const hasEarlierStylizeRecipe = (type: string) => isRecipeType(type) && type !== 'threshold' && type !== 'posterize';

/** The recipe a graphless stylize effect in a project file rendered (undefined when it is the current one). */
export function createEarlierStylizeGraph(type: string): EffectOperatorGraph | undefined {
  return hasEarlierStylizeRecipe(type) ? EARLIER[type as StylizeRecipeEffectType]() : undefined;
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

const currentRecognizers = Object.fromEntries(Object.entries(CURRENT).map(([type, create]) => [type, recognizer(create)])) as Record<StylizeRecipeEffectType, (graph: EffectOperatorGraph | undefined) => boolean>;

/** True when `graph` is the untouched current recipe of this stylize effect (any presentation). */
export function isCurrentStylizeGraph(type: string, graph: EffectOperatorGraph | undefined): boolean {
  return isRecipeType(type) && currentRecognizers[type](graph);
}

/**
 * Values a new instance starts with where they differ from the parameter defaults. The defaults
 * stay what saved effects without the value mean (Posterize saved before Brightness Only existed
 * steps each channel); a new Posterize steps the brightness, so skies keep their hue.
 */
const NEW_INSTANCE_PARAMS: Partial<Record<StylizeRecipeEffectType, Record<string, number | boolean>>> = { posterize: { brightnessOnly: true } };
export const stylizeNewInstanceParams = (type: string): Record<string, number | boolean> => (isRecipeType(type) && NEW_INSTANCE_PARAMS[type]) || {};

/** True when `graph` is an untouched earlier recipe of this stylize effect (any presentation). */
export function isEarlierStylizeGraph(type: string, graph: EffectOperatorGraph | undefined): boolean {
  return isRecipeType(type) && !!earlierRecognizers[type]?.(graph);
}

/** Presentation of a stylize graph: an untouched earlier recipe keeps its own folder plan (`<type>-earlier`). */
export function stylizePresentation(type: string, graph: EffectOperatorGraph): { key: string; createDefault: () => EffectOperatorGraph } | undefined {
  return isRecipeType(type) && isEarlierStylizeGraph(type, graph) ? { key: `${type}-earlier`, createDefault: EARLIER[type] } : undefined;
}

/** Untouched earlier Threshold/Posterize graphs read as the current recipe (identical at Softness 0); Posterize ramps are capped at one step. */
export function upgradePointwiseStylizeGraph(type: string, graph: EffectOperatorGraph): EffectOperatorGraph {
  if (type !== 'threshold' && type !== 'posterize') return graph;
  if (!graph.groups?.some(group => group.bypassed) && isEarlierStylizeGraph(type, graph)) return CURRENT[type]();
  // Posterize saved with the unlimited ramp: cap it at one step (a bug fix only above Softness 1).
  return type === 'posterize' ? capPosterizeRampWidth(graph) : graph;
}

export interface StylizeRecipeUpdate {
  /** One plain sentence for the inspector. */
  message: string;
  label: string;
  /** Values the current recipe reads differently; set together with the new graph (their keyframes are removed). */
  resetParams?: Record<string, number>;
  /** Tool-result note: how the earlier recipe reads the values (the current recipe's limit notes do not apply to it). */
  toolNote: string;
}

const RUNS_EARLIER = 'runs the earlier version saved with its project (before 2026-10-21)';
/** What the inspector says about an untouched earlier recipe, and the values an update resets. */
export const STYLIZE_RECIPE_UPDATES: Partial<Record<StylizeRecipeEffectType, StylizeRecipeUpdate>> = {
  glow: { message: 'This Glow was saved with the earlier ring version and keeps that look; Color has no effect on it.',
    label: 'Use the new Glow (resets its values)', resetParams: { ...GLOW_DEFAULTS },
    toolNote: `This Glow ${RUNS_EARLIER}: rings of samples, Radius in steps of about 10 px per ring, Rings and Samples/Ring apply, Color has no effect.` },
  grain: { message: 'This Film Grain was saved with the earlier noise and keeps that look; Color has no effect on it.', label: 'Use the new Film Grain',
    toolNote: `This Film Grain ${RUNS_EARLIER}: per-pixel noise, Size and Speed act as they did then (Speed up to 5), Color has no effect.` },
  sharpen: { message: 'This Sharpen was saved with the earlier version, which can draw bright and dark halos.', label: 'Use the new Sharpen',
    toolNote: `This Sharpen ${RUNS_EARLIER}: a fixed 7x7 unsharp mask without halo limit; strong values draw bright and dark outlines.` },
  vignette: { message: 'This Vignette was saved with the earlier version; Roundness worked differently there.',
    label: 'Use the new Vignette (resets its shape)', resetParams: { size: 0.5, softness: 0.5, roundness: 1 },
    toolNote: `This Vignette ${RUNS_EARLIER}: an ellipse that follows the frame; Roundness stretches it vertically (0.5-2 was the range) and is not limited to 0-1.` },
  scanlines: { message: 'This Scanlines was saved with the earlier version, which can flicker when lines get very dense.', label: 'Use the new Scanlines',
    toolNote: `This Scanlines ${RUNS_EARLIER}: Opacity is used as set (above 1 darkens further) and dense lines are not faded, so they can flicker.` },
  'edge-detect': { message: 'This Edge Detect was saved with the earlier version; Width and Color have no effect on it.', label: 'Use the new Edge Detect',
    toolNote: `This Edge Detect ${RUNS_EARLIER}: a one-pixel Sobel at render resolution with opaque output; Width and Color have no effect.` },
};

/** Tool note for an instance that runs an untouched earlier stylize recipe; undefined otherwise. */
export function earlierStylizeRecipeNote(type: string, graph: EffectOperatorGraph | undefined): string | undefined {
  return isEarlierStylizeGraph(type, graph) ? STYLIZE_RECIPE_UPDATES[type as StylizeRecipeEffectType]?.toolNote : undefined;
}
