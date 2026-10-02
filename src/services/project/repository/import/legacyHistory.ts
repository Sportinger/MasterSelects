import type { JsonValue } from '../contracts';
import { domainJson } from '../domains/jsonBoundary';

export interface LegacyHistoryProvenance { sourceId: string; sourcePath: string; sourceDigest?: string; }
export interface LegacyHistoryNode {
  id: string;
  originalId: string | null;
  parentId: string | null;
  snapshot: JsonValue;
  sourcePointer: string;
  compositionContext: string | null;
  navigation: 'evidenced' | 'ambiguous' | 'invalid';
  issues: string[];
}
export interface LegacyHistoryImport {
  schemaVersion: 1 | 2;
  provenance: LegacyHistoryProvenance;
  original: JsonValue;
  nodes: LegacyHistoryNode[];
  roots: string[];
  activeNodeId: string | null;
  preferredChildren: Record<string, string>;
  issues: string[];
}
const record = (value: JsonValue | undefined): Record<string, JsonValue> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Raw reader only. No lifecycle hydration, limits, pruning, mutation, or inferred active comp. */
export function importRawLegacyHistory(input: unknown, provenance: LegacyHistoryProvenance): LegacyHistoryImport {
  const original = domainJson(input);
  const raw = record(original);
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new TypeError('Unsupported legacy history schema');
  const result: LegacyHistoryImport = { schemaVersion: raw.schemaVersion, provenance: { ...provenance }, original, nodes: [], roots: [], activeNodeId: null, preferredChildren: {}, issues: [] };
  const add = (id: string, originalId: string | null, parentId: string | null, snapshot: JsonValue, sourcePointer: string): LegacyHistoryNode => {
    const data = record(snapshot);
    // Legacy StateSnapshot has no activeCompositionId. Current project context is not evidence.
    const explicit = data.activeCompositionId;
    const compositionContext = typeof explicit === 'string' && explicit.length > 0 ? explicit : null;
    const node: LegacyHistoryNode = { id, originalId, parentId, snapshot, sourcePointer, compositionContext, navigation: compositionContext ? 'evidenced' : 'ambiguous', issues: compositionContext ? [] : ['missing-historical-composition-context'] };
    if (!Object.keys(data).length) { node.navigation = 'invalid'; node.issues.push('snapshot-is-not-an-object'); }
    result.nodes.push(node); return node;
  };
  if (raw.schemaVersion === 2) {
    if (!Array.isArray(raw.nodes)) throw new TypeError('Legacy v2 history nodes are missing');
    const occurrences = new Map<string, number>();
    raw.nodes.forEach((value, index) => {
      const data = record(value);
      const originalId = typeof data.id === 'string' ? data.id : null;
      const count = originalId ? occurrences.get(originalId) ?? 0 : 0;
      if (originalId) occurrences.set(originalId, count + 1);
      const id = originalId && count === 0 ? originalId : `legacy-v2-invalid/${index}`;
      const parentId = data.parentId === null ? null : typeof data.parentId === 'string' ? data.parentId : null;
      const node = add(id, originalId, parentId, data.snapshot ?? null, `/nodes/${index}/snapshot`);
      if (!originalId || count > 0) { node.navigation = 'invalid'; node.issues.push(count > 0 ? 'duplicate-node-id' : 'missing-node-id'); }
      if (data.parentId !== null && typeof data.parentId !== 'string') { node.navigation = 'invalid'; node.issues.push('invalid-parent-id'); }
    });
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    for (const node of result.nodes) {
      if (node.parentId !== null && !byId.has(node.parentId)) { node.navigation = 'invalid'; node.issues.push('missing-parent'); }
      const path = new Set<string>(); let cursor: LegacyHistoryNode | undefined = node;
      while (cursor) {
        if (path.has(cursor.id)) { node.navigation = 'invalid'; node.issues.push('cyclic-parent-chain'); break; }
        path.add(cursor.id); cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
      }
    }
    result.activeNodeId = typeof raw.activeNodeId === 'string' && byId.has(raw.activeNodeId) ? raw.activeNodeId : null;
    if (raw.activeNodeId !== null && result.activeNodeId === null) result.issues.push('missing-active-node');
    for (const [parentId, childId] of Object.entries(record(raw.lastVisitedChildByNodeId))) {
      if (typeof childId === 'string' && byId.get(childId)?.parentId === parentId) result.preferredChildren[parentId] = childId;
      else result.issues.push(`invalid-redo-preference:${parentId}`);
    }
  } else {
    // v1 stack order and branch ancestry are retained as evidence, not promoted to invented parents.
    const collection = (values: JsonValue | undefined, pointer: string) => {
      if (Array.isArray(values)) values.forEach((snapshot, index) => add(`legacy-v1${pointer}/${index}`, null, null, snapshot, `${pointer}/${index}`));
      else if (values !== undefined) result.issues.push(`invalid-legacy-stack:${pointer}`);
    };
    collection(raw.undoStack, '/undoStack'); collection(raw.redoStack, '/redoStack');
    if (raw.currentSnapshot !== null && raw.currentSnapshot !== undefined) {
      const node = add('legacy-v1/current', null, null, raw.currentSnapshot, '/currentSnapshot');
      result.activeNodeId = node.id;
    }
    if (Array.isArray(raw.branches)) raw.branches.forEach((branchValue, branchIndex) => {
      const branch = record(branchValue), pointer = `/branches/${branchIndex}`;
      if (branch.baseSnapshot !== null && branch.baseSnapshot !== undefined) add(`legacy-v1${pointer}/base`, null, null, branch.baseSnapshot, `${pointer}/baseSnapshot`);
      collection(branch.baseUndoStack, `${pointer}/baseUndoStack`); collection(branch.snapshots, `${pointer}/snapshots`);
    });
    for (const node of result.nodes) {
      node.navigation = node.navigation === 'invalid' ? 'invalid' : 'ambiguous';
      node.issues.push('legacy-v1-parentage-unproven');
    }
    result.issues.push('legacy-v1-branch-parentage-not-inferred');
  }
  result.roots = result.nodes.filter((node) => node.parentId === null).map((node) => node.id);
  return result;
}
