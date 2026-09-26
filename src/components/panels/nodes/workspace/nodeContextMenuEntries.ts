import type { getCategoriesWithEffects } from '../../../../effects';
import type { OperatorDefinition } from '../../../../types/operatorGraph';
import { groupOperatorMenu, NODE_CATEGORIES, type NodeCategoryId } from '../../../../services/operators/operatorTaxonomy';
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
  /** Effect graphs of the clip; the one under the pointer or selection is the direct target. */
  graphs: { effects: readonly GraphTarget[]; targetEffectId?: string; advanced: boolean };
  controls?: { disabled: boolean; onAdd: (operatorId: string) => void };
}

const describe = (id: string, fallback?: string) => {
  const text = catalogText(id);
  return { title: text.description ?? fallback, keywords: `${text.description ?? fallback ?? ''} ${text.tags.join(' ')}` };
};

/** Clip-level nodes (stages, controls) sit in the same categories as graph nodes. */
const CLIP_STAGE_CATEGORY: Record<string, NodeCategoryId> = { ai: 'inputs', keyframes: 'values', transform: 'coordinates', mask: 'color', color: 'color' };
const controlCategory = (id: string): NodeCategoryId => id.startsWith('math.') || id === 'control.remap' ? 'math' : 'values';

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

  const target = graphs.effects.find(graph => graph.effectId === graphs.targetEffectId);
  const layerMenu = (id: string, label: string, groups: boolean, withClipItems: boolean): NodeMenuEntry => {
    const perGraph = graphs.effects.map(graph => ({ graph, categories: groupOperatorMenu(
      graph.operators.filter(operator => Boolean(operator.composition) === groups), { advanced: graphs.advanced }) }));
    const items = (graph: GraphTarget, entries: readonly OperatorDefinition[], category: string): NodeMenuEntry[] => entries.map(operator => {
      const text = describe(operator.id, operator.description);
      return { kind: 'item' as const, id: `${id}:${graph.effectId}:${operator.id}`, label: operator.label, title: text.title,
        keywords: `${operator.id} ${label} ${category} ${graph.effectName} ${text.keywords}`, onSelect: () => graph.onAdd(operator.id) };
    });
    const children = NODE_CATEGORIES.flatMap((category): NodeMenuEntry[] => {
      const local = withClipItems ? clipItems.get(category.id) ?? [] : [];
      const graphEntries: NodeMenuEntry[] = target
        ? (() => { const found = perGraph.find(entry => entry.graph === target)?.categories.find(group => group.id === category.id);
          return found ? [...(local.length ? [{ kind: 'heading' as const, id: `${id}:${category.id}:into`, label: `Into ${target.effectName}` }] : []),
            ...items(target, found.entries, category.label)] : []; })()
        // Without a target, each effect graph that offers this category is its own submenu.
        : perGraph.flatMap(({ graph, categories }) => {
          const found = categories.find(group => group.id === category.id);
          return found ? [{ kind: 'submenu' as const, id: `${id}:${category.id}:${graph.effectId}`, label: `Into ${graph.effectName}`,
            children: items(graph, found.entries, category.label) }] : [];
        });
      if (!local.length && !graphEntries.length) return [];
      return [{ kind: 'submenu', id: `${id}:${category.id}`, label: category.label, children: [...local, ...graphEntries] }];
    });
    return { kind: 'submenu', id, label, disabled: !children.length, children,
      title: children.length ? (target ? `Graph ${label.toLowerCase()} go into ${target.effectName}` : undefined)
        : target ? `${target.effectName} has no ${label.toLowerCase()} to add` : `Add an effect first; its graph accepts ${label.toLowerCase()}` };
  };

  return [
    layerMenu('nodes', 'Nodes', false, true),
    layerMenu('node-groups', 'Node Groups', true, false),
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
