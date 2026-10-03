import { describe, expect, it, vi } from 'vitest';
import type { CompositionGraphState } from '../../src/types/compositionGraph';
import type { NodeGraph, NodeGraphNode } from '../../src/types/nodeGraph';
import { compositionNode } from '../../src/services/nodeGraph/composition/compositionGraphPrimitives';
import { embedWorkspaceGraph } from '../../src/services/nodeGraph/unified/embedWorkspaceGraph';
import { layoutWorkspaceExpansion } from '../../src/components/panels/nodes/unified/layoutWorkspaceExpansion';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { workspaceClipGroup } from '../../src/services/nodeGraph/unified/workspaceIds';
import { workspaceCanvasPlacement, saveWorkspacePlacement } from '../../src/components/panels/nodes/unified/workspaceCanvasPlacement';

const mocked = vi.hoisted(() => ({ state: {} as Record<string, unknown>, batch: vi.fn((_label: string, run: () => void) => run()) }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => mocked.state } }));
vi.mock('../../src/components/panels/nodes/unified/useClipDomainAdapter', () => ({ clipWorkspaceBatch: mocked.batch }));

describe('composition Arrange with an expanded clip', () => {
  it('writes only compact composition anchors in one batch, preserving local layout and full display extents', () => {
    let state: CompositionGraphState = { version: 1, layout: { nodes: {}, collapsed: { [workspaceClipGroup('c')]: false } } };
    const source: NodeGraphNode = { id: 'source', label: 'Source', kind: 'source', runtime: 'builtin',
      binding: { kind: 'clip-source' }, layout: { x: 0, y: 0 }, inputs: [], outputs: [] };
    const output: NodeGraphNode = { ...source, id: 'output', label: 'Output', kind: 'output',
      binding: { kind: 'clip-output' }, layout: { x: 1600, y: 800 } };
    const local: NodeGraph = { id: 'clip:c', owner: { kind: 'clip', id: 'c', name: 'Clip' }, nodes: [source, output], edges: [] };
    const projections = new Map([['c', { graph: local, placement: { nodes: { source: source.layout, output: output.layout }, groups: {} },
      bounds: { left: 0, top: 0, right: 1784, bottom: 1100 } }]]);
    const build = () => {
      const base: NodeGraph = { id: 'comp:main', owner: { kind: 'composition', id: 'main', name: 'Main' }, edges: [], nodes: [
        compositionNode(state, 'comp:clip:c', 'Clip', { kind: 'composition-clip', clipId: 'c' }, { x: 300, y: 80 }, [], []),
        compositionNode(state, 'comp:rule:r', 'Rule', { kind: 'composition-rule', ruleId: 'r' }, { x: 740, y: 400 }, [], []),
      ] };
      return layoutWorkspaceExpansion(embedWorkspaceGraph(base, projections), base);
    };
    const updateClip = vi.fn(), update = vi.fn((edit: (current: CompositionGraphState) => CompositionGraphState) => {
      state = edit(state); mocked.state.compositionGraph = state;
    });
    mocked.state = { compositionGraph: state, clips: [], tracks: [], updateClip, updateCompositionGraph: update };
    mocked.batch.mockClear();
    const graph = build(), before = workspaceCanvasPlacement(graph), localBefore = JSON.stringify(local);
    saveWorkspacePlacement(graph, before, before, 'Arrange effect nodes');
    expect(mocked.batch).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateClip).not.toHaveBeenCalled();
    expect(state.layout!.nodes).toEqual(graph.workspace!.defaultNodes);
    expect(state.layout!.collapsed).toEqual({ [workspaceClipGroup('c')]: false });
    expect(JSON.stringify(local)).toBe(localBefore);
    const displayed = build(), group = nodeGroupBounds(displayed, displayed.nodes).get(workspaceClipGroup('c'))!;
    const rule = displayed.nodes.find(node => node.id === 'comp:rule:r')!;
    expect(rule.layout.y).toBeGreaterThan(group.bottom);
    expect(displayed.nodes.map(node => node.layout)).toEqual(graph.nodes.map(node => node.layout));
  });
});
