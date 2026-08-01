import { beforeEach, describe, expect, it } from 'vitest';
import { useHistoryStore } from '../index';

const snapshot = (label: string, timestamp: number) => ({
  label, timestamp, timeline: {}, media: {}, dock: {}, flashboard: {}, export: {},
}) as any;
const hydrate = (nodes: Array<{ id: string; parentId: string | null; snapshot: any }>, activeNodeId: string) =>
  useHistoryStore.getState().hydrateFromProject({ schemaVersion: 2, nodes, activeNodeId, lastVisitedChildByNodeId: {}, eventLog: [] });

describe('history snapshot tree', () => {
  beforeEach(() => useHistoryStore.getState().clearHistory());

  it('preserves the old future as a sibling when capturing after undo', () => {
    hydrate([{ id: 'a', parentId: null, snapshot: snapshot('a', 1) }, { id: 'b', parentId: 'a', snapshot: snapshot('b', 2) }, { id: 'c', parentId: 'b', snapshot: snapshot('c', 3) }], 'c');
    useHistoryStore.getState().undo(); useHistoryStore.getState().undo();
    useHistoryStore.getState().captureSnapshot('fork');
    const state = useHistoryStore.getState();
    expect(Object.keys(state.nodes)).toHaveLength(4);
    expect(state.nodes.c.parentId).toBe('b');
    expect(state.nodes[state.activeNodeId!].parentId).toBe('a');
  });

  it('captures below a jumped-to node without losing the previous tip', () => {
    hydrate([{ id: 'a', parentId: null, snapshot: snapshot('a', 1) }, { id: 'b', parentId: 'a', snapshot: snapshot('b', 2) }, { id: 'c', parentId: 'b', snapshot: snapshot('c', 3) }], 'c');
    useHistoryStore.getState().restoreEntry({ id: 'a', nodeId: 'a', kind: 'undoable', label: 'a', timestamp: 1 });
    useHistoryStore.getState().captureSnapshot('fork');
    expect(useHistoryStore.getState().nodes.c).toBeDefined();
    expect(useHistoryStore.getState().nodes[useHistoryStore.getState().activeNodeId!].parentId).toBe('a');
  });

  it('undo after a jump follows the jumped-to ancestry', () => {
    hydrate([{ id: 'a', parentId: null, snapshot: snapshot('a', 1) }, { id: 'b', parentId: 'a', snapshot: snapshot('b', 2) }, { id: 'c', parentId: 'b', snapshot: snapshot('c', 3) }], 'c');
    useHistoryStore.getState().restoreEntry({ id: 'b', nodeId: 'b', kind: 'undoable', label: 'b', timestamp: 2 });
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().activeNodeId).toBe('a');
    useHistoryStore.getState().redo();
    expect(useHistoryStore.getState().activeNodeId).toBe('b');
  });

  it('migrates a v1 trunk and branch into one tree', () => {
    useHistoryStore.getState().hydrateFromProject({ schemaVersion: 1, undoStack: [snapshot('a', 1)], currentSnapshot: snapshot('b', 2), redoStack: [snapshot('c', 3)], branches: [{ id: 'old', label: 'old', createdAt: 4, baseUndoStack: [snapshot('a', 1)], baseSnapshot: snapshot('b', 2), snapshots: [snapshot('d', 4)] }], eventLog: [] });
    const state = useHistoryStore.getState();
    expect(state.activeNodeId).not.toBeNull();
    expect(Object.keys(state.nodes)).toHaveLength(4);
    expect(Object.values(state.nodes).filter((node) => node.parentId === state.activeNodeId)).toHaveLength(2);
  });

  it('prunes leaves but never the active path', () => {
    const nodes = Array.from({ length: 151 }, (_, index) => ({ id: `n${index}`, parentId: index ? `n${index - 1}` : null, snapshot: snapshot(`n${index}`, index) }));
    hydrate(nodes, 'n150');
    useHistoryStore.setState({ maxHistoryNodes: 150 });
    useHistoryStore.getState().captureSnapshot('next');
    const state = useHistoryStore.getState();
    expect(Object.keys(state.nodes).length).toBeLessThanOrEqual(150);
    expect(state.activeNodeId).not.toBeNull();
  });
});
