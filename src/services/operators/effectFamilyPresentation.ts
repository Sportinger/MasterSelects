import type { BoundOperatorNode, EffectOperatorGraph, OperatorGroup } from '../../types/operatorGraph';
import { expandOperatorCompositions, sameCompositionNode } from './operatorComposition';
import { effectPresentationPlan, legacyEffectPresentationPlans, type EffectPresentationPlan } from './effectPresentationPlans';

const originals = new Map<string, EffectOperatorGraph>();
const cache = new WeakMap<EffectOperatorGraph, Map<string, EffectOperatorGraph>>();
/** A constant value node: recipe matching treats duplicated copies of it as one. */
export const literal = (node: BoundOperatorNode) => node.operator.startsWith('values.') && !!node.constants && !Object.keys(node.bindings).length;
export const literalKey = (node: BoundOperatorNode) => JSON.stringify([node.operator, node.operatorVersion ?? 1, node.constants, node.enabled, node.bypassed]);

/** Matching allows only duplicated immutable leaves introduced by exact composition extraction.
 * Presentation (layout, folders, packed compositions) is ignored; node fields and wiring must match. */
export function matchesEffectRecipe(source: EffectOperatorGraph, original: EffectOperatorGraph): boolean {
  let actual: EffectOperatorGraph;
  // A graph whose packed compositions no longer expand cannot equal the recipe.
  // Recognition must answer "no", not abort a project load; the effect's own
  // validation reports the actual problem.
  try { actual = expandOperatorCompositions(source); } catch { return false; }
  const expectedNodes = original.nodes.filter(node => !literal(node)), actualNodes = actual.nodes.filter(node => !literal(node));
  if (expectedNodes.length !== actualNodes.length || expectedNodes.some(node => !actualNodes.some(value => value.id === node.id && sameCompositionNode(value, node)))) return false;
  const expectedLiterals = new Set(original.nodes.filter(literal).map(literalKey));
  if (actual.nodes.filter(literal).some(node => !expectedLiterals.has(literalKey(node)))) return false;
  const signature = (graph: EffectOperatorGraph) => {
    const names = new Map(graph.nodes.map(node => [node.id, literal(node) ? literalKey(node) : node.id]));
    return graph.edges.map(edge => JSON.stringify([names.get(edge.from), edge.output, names.get(edge.to), edge.input])).toSorted();
  };
  return JSON.stringify(signature(actual)) === JSON.stringify(signature(original));
}

/** Do not draw a cyclic folder pipeline around an acyclic graph with interleaved branches. */
function readableGroups(graph: EffectOperatorGraph, proposed: OperatorGroup[]): OperatorGroup[] {
  let groups = proposed;
  for (;;) {
    const owner = new Map(groups.flatMap(group => group.nodeIds.map(id => [id, group.id] as const)));
    const targets = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      const from = owner.get(edge.from) ?? edge.from, to = owner.get(edge.to) ?? edge.to;
      if (from === to) continue;
      const set = targets.get(from) ?? new Set(); set.add(to); targets.set(from, set);
    }
    const done = new Set<string>(), stack: string[] = [];
    const visit = (id: string): string[] | undefined => {
      if (stack.includes(id)) return stack.slice(stack.indexOf(id));
      if (done.has(id)) return;
      stack.push(id);
      for (const target of targets.get(id) ?? []) { const cycle = visit(target); if (cycle) return cycle; }
      stack.pop(); done.add(id);
    };
    let cycle: string[] | undefined;
    for (const id of targets.keys()) { cycle = visit(id); if (cycle) break; }
    if (!cycle) return groups;
    const split = groups.filter(group => cycle!.includes(group.id)).toSorted((a, b) => a.nodeIds.length - b.nodeIds.length)[0];
    if (!split) return groups;
    groups = groups.filter(group => group !== split);
  }
}

/** An earlier recipe of the same effect (e.g. the original color graphs) with its own presentation. */
export interface EarlierEffectRecipe { key: string; createDefault: () => EffectOperatorGraph; plan: EffectPresentationPlan }

/** The untouched recipe gets a one-time readable layout. Saved edits, folder boundaries and ungrouping win. */
export function organizeEffectFamilyGraph(source: EffectOperatorGraph, composed: EffectOperatorGraph, type: string,
  createDefault: () => EffectOperatorGraph, earlier?: EarlierEffectRecipe): EffectOperatorGraph {
  const current = effectPresentationPlan(type);
  // The current recipe first, then earlier recipes that saved effects may still run (each with its
  // own folders): the caller's (the original color graphs) and the effect's legacy plans (analog).
  const candidates: Array<{ key: string; create: () => EffectOperatorGraph; plan: EffectPresentationPlan }> = [
    ...(current ? [{ key: type, create: createDefault, plan: current }] : []),
    ...(earlier ? [{ key: `${type}|${earlier.key}`, create: earlier.createDefault, plan: earlier.plan }] : []),
    ...legacyEffectPresentationPlans(type).map((entry, index) => ({ key: `${type}:legacy-${index}`, ...entry }))];
  if (!candidates.length || source.effectPresentationRules || source.incomplete || source.groups?.some(group => !group.composition)) return composed;
  const cached = cache.get(source)?.get(type); if (cached) return cached;
  const recipeOf = (key: string, create: () => EffectOperatorGraph) => {
    let original = originals.get(key);
    if (!original) { original = create(); originals.set(key, original); }
    return original;
  };
  const match = candidates.find(candidate => matchesEffectRecipe(source, recipeOf(candidate.key, candidate.create)));
  if (!match) return composed;
  const plan = match.plan, original = recipeOf(match.key, match.create);
  const originalNodes = new Map(original.nodes.map(node => [node.id, node]));
  const labels = { controls: 'Parameters', constants: 'Constants', sources: 'Coordinates & Resources', ...plan.labels };
  const members = new Map<string, string[]>();
  for (const node of composed.nodes) {
    if (['image.frame', 'image.output'].includes(node.operator) || node.id === 'split' && type !== 'mirror' && type !== 'glitch'
      || node.id === 'rgba' && type === 'invert') continue;
    let stage: string;
    if (node.operator.startsWith('values.')) stage = literal(node) ? 'constants' : 'controls';
    else if (['image.normalized-uv', 'image.resolution', 'image.timeline-time', 'image.kernel-index', 'image.sequence-index', 'glyph.atlas', 'glyph.text-atlas', 'image.frame-history'].includes(node.operator)) stage = 'sources';
    else if (node.composition) {
      const leaves = Object.values(node.composition.nodeIds).flatMap(id => originalNodes.get(id) ?? []);
      // Prefer computational leaves: captured/shared literal placement must not determine the stage.
      const leaf = leaves.find(value => !value.operator.startsWith('values.')) ?? leaves[0];
      const sharedStages: Record<string, string> = {
        'glyph.cell-grid': 'grid', 'glyph.tone-index': 'index', 'glyph.atlas-alpha': 'atlas', 'feedback.decay-max-rgba': 'feedback',
        'color.soft-bright-pass': 'bright', 'color.sobel-magnitude': 'gradient', 'sampling.bounded-count': 'count',
        // Glow normalizes inside each prefilter pass; its stage follows the owning pass, not the final resolve.
        // Glow and the multi-pass blurs normalize inside each pass; the stage follows the owning pass.
        'sampling.normalize-rgba': type === 'sharpen-earlier' ? 'average' : ['glow', 'glow-earlier', 'sharpen', 'box-blur', 'gaussian-blur', 'motion-blur', 'radial-blur', 'zoom-blur', 'pixelate', 'blockify', 'block-mosaic', 'acuarela', 'edge-detect'].includes(type) ? '' : 'finish',
        // Contrast's block starts with its Steepness/Flatten split, which alone would file it under Parameters.
        'color.contrast-curve.rgb': 'curve',
        'sampling.texel-offset.vec2': 'sampling', 'sampling.gaussian-weight.vec2': 'weight', 'coordinates.centered-scale.vec2': 'sampling',
      };
      const shared = sharedStages[node.operator];
      stage = shared && plan.labels[shared] ? shared : leaf ? plan.stage(leaf) : plan.stage(node);
    } else stage = plan.stage(node);
    members.set(stage, [...(members.get(stage) ?? []), node.id]);
  }
  const groups: OperatorGroup[] = [...members].filter(([, nodeIds]) => nodeIds.length > 1).map(([stage, nodeIds]) => ({
    id: `organized-${type}-${stage}`, label: labels[stage as keyof typeof labels] ?? stage,
    color: '#6b99bd', nodeIds, collapsedByDefault: true,
  }));
  const graph: EffectOperatorGraph = { ...composed, effectPresentationRules: 1, groups: [...(composed.groups ?? []), ...readableGroups(composed, groups)] };
  const byType = cache.get(source) ?? new Map(); byType.set(type, graph); cache.set(source, byType);
  return graph;
}
