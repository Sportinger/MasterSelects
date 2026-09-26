import type { getCategoriesWithEffects } from '../../../../effects';
import type { OperatorDefinition } from '../../../../types/operatorGraph';
import { collapseOperatorFamilies, groupOperatorMenu, menuFamilyKey, NODE_CATEGORIES, type NodeCategoryId } from '../../../../services/operators/operatorTaxonomy';
import { catalogText } from '../../../../services/nodeGraph/catalogText';
import { CONTROL_OPERATORS } from '../../../../services/parameterSources/controlOperators';
import type { NodeMenuEntry } from './NodeMenuTree';

export interface GraphTarget { effectId: string; effectName: string; operators: readonly OperatorDefinition[]; onAdd: (operatorId: string) => void }

export interface NodeContextMenuSources {
  clipStages: {
    canAddVisual: boolean; canAddKeyframes: boolean;
    onAddAI: () => void; onAddKeyframes: () => void; onAddStage: (stage: 'transform' | 'mask' | 'color') => void;
  };
  effects: { groups: ReturnType<typeof getCategoriesWithEffects>; onAdd: (effectType: string) => void };
  /**
   * Graphs that can receive nodes, in priority order: the effect under the pointer
   * or selection first, then the clip's graphs by kind (existing or created on use).
   * The menu lists every node of every graph; each goes to the first graph accepting it.
   */
  graphs: { owners: readonly GraphTarget[] };
  controls?: { disabled: boolean; onAdd: (operatorId: string) => void };
}

const describe = (id: string, fallback?: string) => {
  const text = catalogText(id);
  return { title: text.description ?? fallback, keywords: `${text.description ?? fallback ?? ''} ${text.tags.join(' ')}` };
};

/** Clip-level nodes (stages, controls) sit in the same categories as graph nodes. */
const CLIP_STAGE_CATEGORY: Record<string, NodeCategoryId> = { ai: 'inputs', keyframes: 'values', transform: 'coordinates', mask: 'color', color: 'color' };
const controlCategory = (id: string): NodeCategoryId => id.startsWith('math.') || id === 'control.remap' ? 'math' : 'values';

/** Nodes or node groups of the given graphs by category; clip-level items join their categories. */
function layerMenu(owners: readonly GraphTarget[], id: string, label: string, groups: boolean,
  clipItems: ReadonlyMap<NodeCategoryId, NodeMenuEntry[]> = new Map()): NodeMenuEntry {
  // One entry per family across all graphs; the first graph offering it receives the node.
  const routed = new Map<string, GraphTarget>();
  const operators: OperatorDefinition[] = [];
  for (const owner of owners) for (const operator of collapseOperatorFamilies(owner.operators.filter(candidate => Boolean(candidate.composition) === groups))) {
    const key = `${menuFamilyKey(operator)}|${operator.label}`;
    if (routed.has(key)) continue;
    routed.set(key, owner); routed.set(operator.id, owner); operators.push(operator);
  }
  const categories = groupOperatorMenu(operators, { advanced: true });
  const children = NODE_CATEGORIES.flatMap((category): NodeMenuEntry[] => {
    const local = clipItems.get(category.id) ?? [];
    const found = categories.find(group => group.id === category.id);
    const graphEntries: NodeMenuEntry[] = (found?.entries ?? []).map(operator => {
      const owner = routed.get(operator.id)!, text = describe(operator.id, operator.description);
      return { kind: 'item' as const, id: `${id}:${operator.id}`, label: operator.label,
        title: `${text.title ?? operator.label}\nAdds to ${owner.effectName}.`,
        keywords: `${operator.id} ${label} ${category.label} ${owner.effectName} ${text.keywords}`, onSelect: () => owner.onAdd(operator.id) };
    });
    if (!local.length && !graphEntries.length) return [];
    return [{ kind: 'submenu', id: `${id}:${category.id}`, label: category.label, children: [...local, ...graphEntries] }];
  });
  return { kind: 'submenu', id, label, disabled: !children.length, children,
    title: children.length ? undefined : `This clip cannot hold ${label.toLowerCase()}` };
}

/** Right-clicked cable: every node and node group of its graph, placed between the cable's ends. */
export function buildCableInsertEntries(graph: GraphTarget): NodeMenuEntry[] {
  return [layerMenu([graph], 'cable-nodes', 'Nodes', false), layerMenu([graph], 'cable-node-groups', 'Node Groups', true)]
    .filter(entry => entry.kind !== 'submenu' || !entry.disabled);
}

/**
 * Everything the workspace can add, in three menus: Nodes and Node Groups by
 * category, then Effects by look. Graph nodes go into the effect under the
 * pointer, or into a chosen effect graph of the clip.
 */
export function buildNodeContextMenuEntries(sources: NodeContextMenuSources): NodeMenuEntry[] {
  const { clipStages: stages, effects, graphs, controls } = sources;
  const clipItems = new Map<NodeCategoryId, NodeMenuEntry[]>();
  const addClipItem = (category: NodeCategoryId, entry: NodeMenuEntry) => clipItems.set(category, [...(clipItems.get(category) ?? []), entry]);
  const stage = (id: string, label: string, disabled: boolean, onSelect: () => void) =>
    addClipItem(CLIP_STAGE_CATEGORY[id], { kind: 'item', id: `stage:${id}`, label, disabled, onSelect, ...describe(`builtin:${id}`) });
  stage('ai', 'AI', false, stages.onAddAI);
  stage('keyframes', 'Keyframes', !stages.canAddKeyframes, stages.onAddKeyframes);
  stage('transform', 'Transform', !stages.canAddVisual, () => stages.onAddStage('transform'));
  stage('mask', 'Mask', !stages.canAddVisual, () => stages.onAddStage('mask'));
  stage('color', 'Color Grade', !stages.canAddVisual, () => stages.onAddStage('color'));
  if (controls) for (const operator of CONTROL_OPERATORS) {
    const text = describe(`control:${operator.id}`, operator.description);
    addClipItem(controlCategory(operator.id), { kind: 'item', id: `control:${operator.id}`, label: `${operator.label} (Control)`, title: text.title,
      disabled: controls.disabled, keywords: `control parameter source ${text.keywords}`, onSelect: () => controls.onAdd(operator.id) });
  }

  return [
    layerMenu(graphs.owners, 'nodes', 'Nodes', false, clipItems),
    layerMenu(graphs.owners, 'node-groups', 'Node Groups', true),
    { kind: 'submenu', id: 'effects', label: 'Effects', children: effects.groups.map(group => ({
      kind: 'submenu' as const, id: `effects:${group.group}`, label: group.category,
      children: group.effects.map(effect => {
        const text = describe(`effect:${effect.id}`);
        return { kind: 'item' as const, id: `effect:${effect.id}`, label: effect.name, title: text.title,
          keywords: `${effect.id} ${group.category} ${text.keywords}`, onSelect: () => effects.onAdd(effect.id) };
      }),
    })) },
  ];
}
