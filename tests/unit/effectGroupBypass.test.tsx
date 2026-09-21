import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument, createClipNodeGraphState } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { useUnifiedNodeActions } from '../../src/components/panels/nodes/useUnifiedNodeActions';
import type { FlockGraphActions } from '../../src/components/panels/nodes/flock/useFlockGraphActions';
import { NodeGraphGroups } from '../../src/components/panels/nodes/canvas/NodeGraphGroups';
import { NodeGraphNodeCard } from '../../src/components/panels/nodes/canvas/NodeGraphNodeCard';
import { NODE_BYPASS_HITBOX } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { useTimelineStore } from '../../src/stores/timeline';

afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });
const flock = {} as FlockGraphActions;
function setup(collapsed = false, enabled = true) {
  const clip = createMockClip({ id: 'clip', effects: [{ id: 'face', type: 'face-cables', name: 'Face Cables', enabled,
    params: { bakedData: 'preserve-bake' } }] });
  clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { 'effect:face': { collapsed } } };
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  const project = () => {
    const current = useTimelineStore.getState().clips[0];
    return buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current);
  };
  return { clip, graph: project(), project };
}

describe('effect group bypass', () => {
  it.each([false, true])('uses the canonical effect flag with collapsed=%s and stale UI state', collapsed => {
    const { clip, graph, project } = setup(collapsed);
    expect(graph.nodes.some(n => n.id === 'effect-face')).toBe(collapsed);
    const { result } = renderHook(() => useUnifiedNodeActions(clip, graph, null, flock));
    act(() => result.current.toggleBypass('effect-face'));
    expect(useTimelineStore.getState().clips[0].effects[0].enabled).toBe(false);
    expect(project().groups?.find(g => g.id === 'effect:face')).toMatchObject({ bypassed: true, bypassNodeId: 'effect-face', effectId: 'face', collapsed: true });
    expect(project().nodes.some(n => n.id === 'effect-face')).toBe(true);
    act(() => result.current.toggleBypass('effect-face'));
    expect(useTimelineStore.getState().clips[0].effects[0]).toEqual(clip.effects[0]);
    expect(project().groups?.find(g => g.id === 'effect:face')?.bypassed).toBe(false);
  });

  it.each(['locked', 'exporting'])('refuses changes while %s', reason => {
    const { clip, graph } = setup();
    useTimelineStore.setState(reason === 'locked'
      ? { tracks: [createMockTrack({ id: clip.trackId, locked: true })] } : { isExporting: true });
    const { result } = renderHook(() => useUnifiedNodeActions(clip, graph, null, flock));
    act(() => result.current.toggleBypass('effect-face'));
    expect(useTimelineStore.getState().clips[0].effects[0].enabled).toBe(true);
    expect(result.current.message).toContain('locked or exporting');
  });

  it('reflects inspector changes and preserves keyboard focus while clearing pointer focus', () => {
    const { graph, project } = setup();
    const toggle = vi.fn(), drag = vi.fn();
    const view = render(<NodeGraphGroups graph={graph} nodes={graph.nodes} onToggleNodeBypass={toggle} onStartDrag={drag} />);
    const button = view.getByRole('button', { name: 'Bypass Face Cables group' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    act(() => useTimelineStore.getState().setClipEffectEnabled('clip', 'face', false));
    expect(project().groups?.find(group => group.id === 'effect:face')?.collapsed).toBe(true);
    act(() => useTimelineStore.getState().updateClip('clip', { nodeGraph: {
      ...useTimelineStore.getState().clips[0].nodeGraph!, groups: { 'effect:face': { collapsed: false } },
    } }));
    const bypassed = project();
    view.rerender(<NodeGraphGroups graph={bypassed} nodes={bypassed.nodes} onToggleNodeBypass={toggle} onStartDrag={drag} />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(view.getByText('Bypassed')).toBeVisible();
    button.focus(); fireEvent.pointerDown(button); fireEvent.click(button, { detail: 1 });
    expect(button).not.toHaveFocus(); expect(drag).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledWith('effect-face');
    button.focus(); fireEvent.click(button, { detail: 0 });
    expect(button).toHaveFocus();
  });

  it('aligns the invisible canvas-mode button with the painted Byp label and keeps it out of node dragging', () => {
    const { graph } = setup(true), toggle = vi.fn(), drag = vi.fn();
    const node = graph.nodes.find(candidate => candidate.id === 'effect-face')!;
    const view = render(<NodeGraphNodeCard node={node} canvasRendered selectedNodeId={null} connectionDraft={null}
      onSelectNode={vi.fn()} onStartNodeDrag={drag} onNodePointerMove={vi.fn()} onFinishNodeDrag={vi.fn()}
      onStartConnectionDrag={vi.fn()} onDisconnectPortEdges={vi.fn()} onToggleNodeBypass={toggle} />);
    const button = view.getByRole('button', { name: 'Bypass Face Cables' });
    expect(button).toHaveStyle({ position: 'absolute', left: `${NODE_BYPASS_HITBOX.left}px`, top: `${NODE_BYPASS_HITBOX.top}px`,
      width: `${NODE_BYPASS_HITBOX.width}px`, height: `${NODE_BYPASS_HITBOX.height}px` });
    fireEvent.pointerDown(button); fireEvent.click(button, { detail: 1 });
    expect(toggle).toHaveBeenCalledExactlyOnceWith('effect-face');
    expect(drag).not.toHaveBeenCalled();
  });
});
