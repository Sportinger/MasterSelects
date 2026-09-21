import type { NodeCanvasPlacement, NodeGraph } from '../../../../types/nodeGraph';
import { reconcileCanvasPlacement } from './nodeCanvasPlacement';
import { createNodeLayoutTransition, NODE_LAYOUT_DURATION, type NodeLayoutSnapshot } from './nodeLayoutTransition';

const LEVEL_STAGGER = 140;
const SIBLING_STAGGER = 100;
export type ProjectGroupStates = (collapsed: Record<string, boolean>) => NodeGraph;

/** Reproject and lay out each fold exactly as an individual click, without writing
 * intermediate states to the project or creating extra undo steps. */
function foldSchedule(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot) {
  const old = new Map(before.graph.groups?.map(group => [group.id, group]));
  const next = new Map(target.graph.groups?.map(group => [group.id, group]));
  const groups = new Map(old);
  for (const [id, group] of next) if (!groups.has(id) || !group.collapsed) groups.set(id, group);
  const states = Object.fromEntries([...groups.keys()].map(id => [id, old.get(id)?.collapsed ?? true]));
  const changed = [...groups.values()].filter(group => states[group.id] !== (next.get(group.id)?.collapsed ?? true));
  if (changed.length < 2) return { states, steps: [] };
  const closing = changed.every(group => next.get(group.id)?.collapsed ?? true);
  const positions = new Map((closing ? before : target).nodes.map(node => [node.id, node.layout]));
  const depth = (id?: string): number => { const group = id ? groups.get(id) : undefined; return group ? 1 + depth(group.parentId) : 0; };
  const left = (group: typeof changed[number]) => Math.min(...group.nodeIds.map(id => positions.get(id)?.x ?? Infinity));
  const ordered = changed.toSorted((a, b) => depth(a.id) - depth(b.id) || left(a) - left(b) || a.id.localeCompare(b.id));
  if (closing) ordered.reverse();
  let at = 0;
  const steps = ordered.map((group, index) => {
    if (index) at += depth(group.id) === depth(ordered[index - 1].id) ? SIBLING_STAGGER : LEVEL_STAGGER;
    return { at, groupId: group.id, collapsed: next.get(group.id)?.collapsed ?? true };
  });
  return { states, steps };
}

function* projectFoldSteps(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot,
  placement: NodeCanvasPlacement, project: ProjectGroupStates, schedule = foldSchedule(before, target)) {
  const { states, steps } = schedule;
  let currentPlacement = placement;
  for (const [index, step] of steps.entries()) {
    states[step.groupId] = step.collapsed;
    if (index === steps.length - 1) { yield { ...step, snapshot: target }; continue; }
    const graph = project(states);
    currentPlacement = reconcileCanvasPlacement(graph, currentPlacement);
    const snapshot = {
      graph, nodes: graph.nodes.map(node => ({ ...node, layout: currentPlacement.nodes[node.id] })),
    };
    yield { ...step, snapshot };
  }
}

export function nodeGroupFoldSteps(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot,
  placement: NodeCanvasPlacement, project: ProjectGroupStates) {
  return [...projectFoldSteps(before, target, placement, project)];
}

export function createNodeGroupFoldSequence(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot,
  placement?: NodeCanvasPlacement, project?: ProjectGroupStates) {
  const schedule = foldSchedule(before, target);
  if (!placement || !project || !schedule.steps.length) return createNodeLayoutTransition(before, target);
  // Compute each hierarchy when its stagger starts, instead of blocking the
  // first frame on every intermediate layout of a deeply nested effect.
  const steps = projectFoldSteps(before, target, placement, project, schedule);
  const transitions: Array<{ at: number; transition: ReturnType<typeof createNodeLayoutTransition> }> = [];
  const duration = schedule.steps.at(-1)!.at + NODE_LAYOUT_DURATION;
  return { changed: true, duration, sample(progress: number): NodeLayoutSnapshot {
    if (progress >= 1) return target;
    const elapsed = Math.max(0, progress) * duration;
    while (transitions.length < schedule.steps.length && schedule.steps[transitions.length].at <= elapsed) {
      const step = steps.next().value!;
      const previous = transitions.at(-1);
      const start = previous ? previous.transition.sample((step.at - previous.at) / previous.transition.duration) : before;
      transitions.push({ at: step.at, transition: createNodeLayoutTransition(start, step.snapshot) });
    }
    const step = transitions.findLast(step => step.at <= elapsed)!;
    return step.transition.sample((elapsed - step.at) / step.transition.duration);
  } };
}
