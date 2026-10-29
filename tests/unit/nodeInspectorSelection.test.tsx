import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { useClipWorkspaceController } from '../../src/components/panels/nodes/unified/useClipWorkspaceController';
import { setNodeInspectorOpen, useNodeInspectorOpen, useNodeInspectorVisibility } from '../../src/components/panels/nodes/workspace/nodeInspectorVisibility';
import { requestNodeAnimation } from '../../src/services/nodeGraph/nodeWorkspaceNavigation';
import type { NodeGraphCanvasProps } from '../../src/components/panels/nodes/NodeGraphCanvas';

const initial = useTimelineStore.getState();
const isNodeInspectorOpen = (panelId: string) => renderHook(() => useNodeInspectorOpen(panelId)).result.current;

beforeEach(() => {
  localStorage.clear();
  useNodeInspectorVisibility.setState({ open: {} });
  useTimelineStore.setState({ clips: [createMockClip({ id: 'clip', source: { type: 'solid', naturalDuration: 5 },
    nodeGraph: { version: 1, nodes: [] } })], tracks: [createMockTrack({ id: 'video-1' })], layers: [],
    selectedClipIds: new Set(['clip']), primarySelectedClipId: 'clip', clipKeyframes: new Map(), isExporting: false });
});
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

describe('clip graph inspector sidebar', () => {
  it('stays closed while nodes are picked, follows the pick, and opens for the animation editor', () => {
    // An inline clip lane shares the sidebar of its Nodes panel ('nodes').
    const controller = renderHook(() => useClipWorkspaceController('clip', 'nodes:inline:clip', 'nodes'));
    const props = () => controller.result.current!.canvas.props as NodeGraphCanvasProps;
    const ids = props().graph.nodes.map(node => node.id);
    expect(ids.length).toBeGreaterThan(1);
    act(() => setNodeInspectorOpen('nodes', false));
    act(() => props().onSelectNode?.(ids[1]));
    act(() => props().onSelectNodes?.([ids[0], ids[1]]));
    act(() => props().onSelectNode?.(ids[0]));
    expect(isNodeInspectorOpen('nodes')).toBe(false);
    expect(props().selectedNodeId).toBe(ids[0]);

    const drawer = render(controller.result.current!.inspector);
    expect(screen.getByRole('button', { name: 'Show node inspector' })).toBeTruthy();
    drawer.unmount();

    act(() => requestNodeAnimation('clip', ids[1], false));
    expect(isNodeInspectorOpen('nodes')).toBe(false);
    act(() => requestNodeAnimation('clip', ids[1]));
    expect(isNodeInspectorOpen('nodes')).toBe(true);
  });
});
