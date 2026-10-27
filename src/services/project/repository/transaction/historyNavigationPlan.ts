import type { EntityDTO, EntityKey } from '../contracts';

/**
 * Sources of revisions the editor records on its own: source hashing, late import/source-job results,
 * artifact bindings and the carry revision Undo/Redo writes. They stay durable revisions with their data,
 * but never form an Undo/Redo step, never cancel a running Undo/Redo and never replace the redo branch.
 */
const SYSTEM_REVISION_SOURCES: ReadonlySet<string> = new Set(['source-identity', 'background', 'artifact']);
export function isSystemRevisionSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && SYSTEM_REVISION_SOURCES.has(source);
}
/** Longest run of system revisions a plan looks through before it falls back to a plain parent/child step. */
export const MAX_SYSTEM_REVISION_WALK = 1024;

export interface RevisionStep { revisionId: string; parentRevisionId: string | null; source: string; keys: readonly EntityKey[]; }
/** Where an Undo/Redo lands and the current system values it carries onto that revision as one new system revision. */
export interface NavigationPlan {
  target: string;
  carry: ReadonlyMap<EntityKey, EntityDTO | null> | null;
  /** Redo preference to record for `target` (the user step an Undo took back). */
  redoChild: string | null;
  /** System revisions left out because they belong to the user step the navigation moves across. */
  dropped: number;
}
export interface NavigationGraph {
  step(revisionId: string): Promise<RevisionStep | null>;
  redoChild(revisionId: string): Promise<string | null>;
  current(key: EntityKey): EntityDTO | null;
}
interface SystemStack { anchor: RevisionStep | null; system: RevisionStep[]; }

/** The newest user revision at or below `revisionId` and the system revisions above it (oldest first); null when unreadable or too long. */
async function systemStackAt(graph: NavigationGraph, revisionId: string): Promise<SystemStack | null> {
  const system: RevisionStep[] = [];
  for (let id: string | null = revisionId; id;) {
    if (system.length >= MAX_SYSTEM_REVISION_WALK) return null;
    const step = await graph.step(id);
    if (!step) return id === revisionId ? null : { anchor: null, system: system.toReversed() };
    if (!isSystemRevisionSource(step.source)) return { anchor: step, system: system.toReversed() };
    system.push(step); id = step.parentRevisionId;
  }
  return { anchor: null, system: system.toReversed() };
}

/** Current values of the system revisions that stay valid next to `user`'s step; ones about the same entities go with that step. */
function carriedValues(graph: NavigationGraph, userKeys: readonly EntityKey[], system: readonly RevisionStep[]): { carry: Map<EntityKey, EntityDTO | null>; dropped: number } {
  const blocked = new Set(userKeys), kept: RevisionStep[] = [], carry = new Map<EntityKey, EntityDTO | null>();
  let dropped = 0;
  // E.g. verifying the media the undone step imported leaves together with that import.
  for (const step of system) {
    if (step.keys.some(key => blocked.has(key))) { dropped++; for (const key of step.keys) blocked.add(key); } else kept.push(step);
  }
  for (const step of kept) {
    if (step.keys.some(key => blocked.has(key))) { dropped++; continue; }
    for (const key of step.keys) carry.set(key, graph.current(key));
  }
  return { carry, dropped };
}

export async function planUndo(graph: NavigationGraph, current: string): Promise<NavigationPlan | null> {
  const stack = await systemStackAt(graph, current);
  if (!stack) {
    const parent = (await graph.step(current))?.parentRevisionId;
    return parent ? { target: parent, carry: null, redoChild: current, dropped: 0 } : null;
  }
  // System revisions alone are no undo step: nothing of the user's would be taken back.
  if (!stack.anchor?.parentRevisionId) return null;
  const { carry, dropped } = stack.system.length ? carriedValues(graph, stack.anchor.keys, stack.system) : { carry: null, dropped: 0 };
  return { target: stack.anchor.parentRevisionId, redoChild: stack.anchor.revisionId, carry, dropped };
}

/** Follows redo preferences from `start` through system revisions to the next user revision. */
async function nextUserRevision(graph: NavigationGraph, start: string, avoid: ReadonlySet<string>): Promise<RevisionStep | null> {
  for (let id: string | null = start, steps = 0; id && !avoid.has(id) && steps < MAX_SYSTEM_REVISION_WALK; steps++) {
    const step = await graph.step(id);
    if (!step) return null;
    if (!isSystemRevisionSource(step.source)) return step;
    id = await graph.redoChild(id);
  }
  return null;
}

export async function planRedo(graph: NavigationGraph, current: string): Promise<NavigationPlan | null> {
  const stack = await systemStackAt(graph, current);
  if (!stack) {
    const child = await graph.redoChild(current);
    return child ? { target: child, carry: null, redoChild: null, dropped: 0 } : null;
  }
  // Head first: a system revision recorded after an Undo keeps the undone step redoable from the level below it.
  const levels = stack.system.toReversed();
  if (stack.anchor) levels.push(stack.anchor);
  const onPath = new Set(levels.map(level => level.revisionId));
  for (let index = 0; index < levels.length; index++) {
    const child = await graph.redoChild(levels[index].revisionId);
    if (!child || onPath.has(child)) continue;
    const redone = await nextUserRevision(graph, child, onPath);
    if (!redone) continue;
    if (index === 0) return { target: redone.revisionId, carry: null, redoChild: null, dropped: 0 };
    const { carry, dropped } = carriedValues(graph, redone.keys, levels.slice(0, index).toReversed());
    return { target: redone.revisionId, carry, redoChild: null, dropped };
  }
  return null;
}
