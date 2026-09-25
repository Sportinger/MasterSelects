import type { NodeCanvasPlacement, NodeGraph } from '../../../../types/nodeGraph';
import { reconcileCanvasPlacement } from './nodeCanvasPlacement';
import { createNodeLayoutTransition, NODE_LAYOUT_DURATION, type NodeLayoutSnapshot } from './nodeLayoutTransition';
import { buildUpDuration } from './rendering/buildUpTiming';

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
  // Depth first, left to right: a group and all of its subgroups finish before
  // the next sibling to the right starts. Closing runs the exact reverse.
  const byLeft = (a: typeof changed[number], b: typeof changed[number]) => left(a) - left(b) || a.id.localeCompare(b.id);
  const changedIds = new Set(changed.map(group => group.id));
  const ordered: typeof changed = [];
  const visit = (group: typeof changed[number]) => {
    ordered.push(group);
    changed.filter(child => child.parentId === group.id).toSorted(byLeft).forEach(visit);
  };
  changed.filter(group => !group.parentId || !changedIds.has(group.parentId)).toSorted(byLeft).forEach(visit);
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

/**
 * Keyframed variant for the canvas worker: every fold step is emitted once, as
 * its end state, when its stagger starts. The worker eases positions between
 * keyframes, so React, scene building and structured cloning run per step
 * instead of per animation frame. Late steps shift later ones rather than stack.
 */
export function createNodeGroupFoldKeyframes(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot,
  placement?: NodeCanvasPlacement, project?: ProjectGroupStates) {
  const schedule = foldSchedule(before, target);
  if (!placement || !project || !schedule.steps.length) {
    const transition = createNodeLayoutTransition(before, target);
    let emitted = false;
    return { changed: transition.changed, done: (elapsed: number) => emitted && elapsed >= NODE_LAYOUT_DURATION, next(): NodeLayoutSnapshot | undefined {
      if (emitted) return undefined;
      emitted = true;
      return transition.end();
    } };
  }
  const steps = projectFoldSteps(before, target, placement, project, schedule);
  // Sequential build-up: each group finishes its node-by-node wave (or its move
  // into the proxy) before the next group starts, however long that takes.
  let started = 0, readyAt = 0, previous = before;
  return { changed: true,
    done: (elapsed: number) => started >= schedule.steps.length && elapsed >= readyAt,
    next(elapsed: number): NodeLayoutSnapshot | undefined {
      if (started >= schedule.steps.length || elapsed < readyAt) return undefined;
      const step = steps.next().value!;
      started++;
      const keyframe = createNodeLayoutTransition(previous, step.snapshot).end();
      const shown = new Set(previous.nodes.map(node => node.id));
      const added = keyframe.nodes.filter(node => !shown.has(node.id)).length;
      // Moves hand off halfway, like build-up waves: each group still glides fully.
      readyAt = elapsed + Math.max(NODE_LAYOUT_DURATION * 0.35, buildUpDuration(added));
      previous = step.snapshot;
      return keyframe;
    } };
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
