import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultContrastGraph } from './colorEffectGraphs';
import { getOperatorComposition } from './operatorCompositionRegistry';
import { effectRecipeFingerprint } from './recipeFingerprint';

/**
 * Fingerprint (recipeFingerprint.ts) of the Contrast recipe of the 2026-10 rebuild, which ran the
 * S-curve family below Amount 1 too (createFormerContrastGraph). Frozen: never update it when the
 * current recipe or its helpers change.
 */
export const FORMER_CONTRAST_FINGERPRINT = '173cd1faa98e02';
const CONTRAST_CURVE = 'color.contrast-curve.rgb';
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
let current: string | undefined;

/**
 * A stored graph packs the Contrast Curve block (a project that is loaded and saved again does, and so
 * does a Nodes-tab edit), and its instance lists only the members the block had then (curve…, input). Loading expands it with today's block, whose new fade nodes would get
 * `<instance>--<id>` ids. Mapping them to their own ids gives the graph the recipe's node ids again,
 * so an untouched packed save is recognised. Undefined when nothing is missing or an id is taken.
 */
function withCurrentBlockIds(source: EffectOperatorGraph): EffectOperatorGraph | undefined {
  const body = getOperatorComposition(CONTRAST_CURVE)?.composition?.graph.nodes.map(node => node.id) ?? [];
  const taken = new Set(source.nodes.map(node => node.id));
  let changed = false;
  const nodes = source.nodes.map(node => {
    const nodeIds = node.operator === CONTRAST_CURVE ? node.composition?.nodeIds : undefined;
    if (!nodeIds) return node;
    const missing = body.filter(id => !(id in nodeIds));
    if (!missing.length || missing.some(id => taken.has(id))) return node;
    changed = true;
    return { ...node, composition: { ...node.composition!, nodeIds: { ...nodeIds, ...Object.fromEntries(missing.map(id => [id, id])) } } };
  });
  return changed ? { ...source, nodes } : undefined;
}

/**
 * Bug fix: the Contrast recipe of the 2026-10 rebuild ran the S-curve family below Amount 1 too, an
 * inverse S whose slope at black and white is infinite, so 8-bit shadow noise became colour blotches
 * (Amount 0.3 turned one code value into about 40). A saved graph that is exactly that recipe, plain
 * or packed (when a project is loaded and saved again, or by a Nodes-tab edit), gets the current one
 * with the saved card positions and the user's own folders. It is identical from Amount 1 up and
 * fades toward mid-grey below it. Edited graphs keep what their author built (a packed save expands with
 * today's block, so only edits inside the block keep the former curve), and so do incomplete graphs
 * and graphs with a bypassed folder (the fingerprint ignores folders).
 */
export function flattenContrastGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  const known = upgraded.get(source); if (known) return known;
  if (source.incomplete || source.groups?.some(group => group.bypassed)) { upgraded.set(source, source); return source; }
  current ??= effectRecipeFingerprint(createDefaultContrastGraph());
  const packed = withCurrentBlockIds(source);
  const former = effectRecipeFingerprint(source) === FORMER_CONTRAST_FINGERPRINT
    || (packed !== undefined && effectRecipeFingerprint(packed) === current);
  const result = former ? withSavedArrangement(createDefaultContrastGraph(), source) : source;
  upgraded.set(source, result); upgraded.set(result, result);
  return result;
}

/**
 * The upgraded graph keeps where the user put the cards: every node both graphs share keeps its saved
 * position, and the block's members move with a packed block card. The user's own folders stay too;
 * the editor's stage folders (`organized-…`) are rebuilt for the current recipe, which has a new stage.
 */
function withSavedArrangement(fresh: EffectOperatorGraph, saved: EffectOperatorGraph): EffectOperatorGraph {
  const layout = { ...fresh.layout };
  for (const id of Object.keys(layout)) if (saved.layout[id]) layout[id] = { ...saved.layout[id] };
  const instance = saved.nodes.find(node => node.operator === CONTRAST_CURVE && node.composition);
  const first = getOperatorComposition(CONTRAST_CURVE)?.composition?.graph.nodes[0]?.id;
  const at = instance && saved.layout[instance.id], from = first && fresh.layout[first];
  if (at && from) {
    const dx = at.x - from.x, dy = at.y - from.y;
    for (const id of getOperatorComposition(CONTRAST_CURVE)!.composition!.graph.nodes.map(node => node.id)) {
      if (fresh.layout[id] && !saved.layout[id]) layout[id] = { x: fresh.layout[id].x + dx, y: fresh.layout[id].y + dy };
    }
  }
  const ids = new Set(fresh.nodes.map(node => node.id));
  const own = saved.groups?.filter(group => !group.composition) ?? [];
  // A user folder stops the stage folders (effectFamilyPresentation), so the editor's ones stay with it.
  const groups = own.some(group => !group.id.startsWith('organized-'))
    ? own.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => ids.has(id)) })).filter(group => group.nodeIds.length)
    : [];
  return { ...fresh, layout, ...(groups.length ? { groups: [...(fresh.groups ?? []), ...groups] } : {}) };
}
