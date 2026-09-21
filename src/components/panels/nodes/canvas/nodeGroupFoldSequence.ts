import type { NodeCanvasPlacement, NodeGraph } from '../../../../types/nodeGraph';
import { reconcileCanvasPlacement } from './nodeCanvasPlacement';
import { createNodeLayoutTransition, type NodeLayoutSnapshot } from './nodeLayoutTransition';

const LEVEL_STAGGER = 140;
const SIBLING_STAGGER = 100;
export type ProjectGroupStates = (collapsed: Record<string, boolean>) => NodeGraph;

/** Reproject and lay out each fold exactly as an individual click, without writing
 * intermediate states to the project or creating extra undo steps. */
export function nodeGroupFoldSteps(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot,
  placement: NodeCanvasPlacement, project: ProjectGroupStates) {
  const old = new Map(before.graph.groups?.map(group => [group.id, group]));
  const next = new Map(target.graph.groups?.map(group => [group.id, group]));
  const groups = new Map(old);
  for (const [id, group] of next) if (!groups.has(id) || !group.collapsed) groups.set(id, group);
  const states = Object.fromEntries([...groups.keys()].map(id => [id, old.get(id)?.collapsed ?? true]));
  const changed = [...groups.values()].filter(group => states[group.id] !== (next.get(group.id)?.collapsed ?? true));
  if (changed.length < 2) return [];
  const closing = changed.every(group => next.get(group.id)?.collapsed ?? true);
  const positions = new Map((closing ? before : target).nodes.map(node => [node.id, node.layout]));
  const depth = (id?: string): number => { const group = id ? groups.get(id) : undefined; return group ? 1 + depth(group.parentId) : 0; };
  const left = (group: typeof changed[number]) => Math.min(...group.nodeIds.map(id => positions.get(id)?.x ?? Infinity));
  const ordered = changed.toSorted((a, b) => depth(a.id) - depth(b.id) || left(a) - left(b) || a.id.localeCompare(b.id));
  if (closing) ordered.reverse();
  let at = 0, currentPlacement = placement;
  return ordered.map((group, index) => {
    if (index) at += depth(group.id) === depth(ordered[index - 1].id) ? SIBLING_STAGGER : LEVEL_STAGGER;
    states[group.id] = next.get(group.id)?.collapsed ?? true;
    const graph = project(states);
    currentPlacement = reconcileCanvasPlacement(graph, currentPlacement);
    const snapshot = index === ordered.length - 1 ? target : {
      graph, nodes: graph.nodes.map(node => ({ ...node, layout: currentPlacement.nodes[node.id] })),
    };
    return { at, groupId: group.id, snapshot };
  });
}

export function createNodeGroupFoldSequence(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot,
  placement?: NodeCanvasPlacement, project?: ProjectGroupStates) {
  const steps = placement && project ? nodeGroupFoldSteps(before, target, placement, project) : [];
  if (!steps.length) return createNodeLayoutTransition(before, target);
  const transitions: Array<{ at: number; transition: ReturnType<typeof createNodeLayoutTransition> }> = [];
  for (const step of steps) {
    const previous = transitions.at(-1);
    const start = previous ? previous.transition.sample((step.at - previous.at) / previous.transition.duration) : before;
    transitions.push({ at: step.at, transition: createNodeLayoutTransition(start, step.snapshot) });
  }
  const last = transitions.at(-1)!, duration = last.at + last.transition.duration;
  return { changed: true, duration, sample(progress: number): NodeLayoutSnapshot {
    if (progress >= 1) return target;
    const elapsed = Math.max(0, progress) * duration;
    const step = transitions.findLast(step => step.at <= elapsed)!;
    return step.transition.sample((elapsed - step.at) / step.transition.duration);
  } };
}
