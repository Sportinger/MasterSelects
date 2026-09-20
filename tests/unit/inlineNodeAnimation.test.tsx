import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { useTimelineStore } from '../../src/stores/timeline';
import { withLegacyKeyframeNodes } from '../../src/services/nodeGraph/legacyKeyframeNodes';
import { buildClipNodeGraphDocument, cloneClipNodeGraph } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { focusKeyframeConnections } from '../../src/services/nodeGraph/keyframeNodeProjection';
import { connectKeyframeNode, extractKeyframeChannel, removeKeyframeNode } from '../../src/services/nodeGraph/keyframeNodeActions';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableProperty } from '../../src/services/faceCables/cableAnimation';
import { NodeAnimationBadge } from '../../src/components/panels/nodes/keyframes/NodeAnimationBadge';
import { useNodeWorkspaceNavigation } from '../../src/services/nodeGraph/nodeWorkspaceNavigation';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';

const initial = useTimelineStore.getState();
const state = () => useTimelineStore.getState();
const clip = () => state().clips[0];
const keys = () => state().clipKeyframes.get('clip')!;
const resolved = () => withLegacyKeyframeNodes(clip(), keys());
const graph = () => { const current = resolved(); return buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current); };
function extract() {
  const node = resolved().nodeGraph!.keyframeNodes![0];
  return extractKeyframeChannel('clip', node.id, node.channels[0].id, { x: -200, y: 0 });
}
beforeEach(() => {
  useTimelineStore.setState({ ...initial, isExporting: false, isPlaying: false, playheadPosition: 0,
    clips: [createMockClip({ id: 'clip', duration: 5, source: { type: 'video' } as ReturnType<typeof createMockClip>['source'] })],
    tracks: [createMockTrack({ id: 'video-1' })], clipKeyframes: new Map([['clip', [
      createMockKeyframe({ id: 'a', clipId: 'clip', property: 'scale.x', time: 0, value: 1 }),
      createMockKeyframe({ id: 'b', clipId: 'clip', property: 'scale.x', time: 5, value: 3 }),
    ]]]),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('animation attached to parameter nodes', () => {
  it('collapses twelve separate cable curves into one simulation badge with no animation ports or wires', () => {
    const cables = Array.from({ length: 12 }, () => defaultFaceCable());
    useTimelineStore.setState({ clips: [{ ...clip(), effects: [{ id: 'cables', type: 'face-cables', name: 'Cables', enabled: true,
      params: { settings: JSON.stringify(cables) } }] }], clipKeyframes: new Map([['clip', cables.map(cable =>
      createMockKeyframe({ clipId: 'clip', property: cableProperty('cables', cable.id, 'slack'), value: 2 }))]]) });
    const projected = graph();
    expect(projected.nodes.filter(node => node.animation)).toHaveLength(1);
    expect(projected.nodes.find(node => node.animation)?.animation?.channels).toHaveLength(12);
    expect(projected.nodes.find(node => node.animation)?.binding).toMatchObject({ operator: 'simulation.rope' });
    expect(projected.nodes.some(node => node.binding?.kind === 'keyframe-node')).toBe(false);
    expect(projected.edges.some(edge => edge.id.startsWith('animation:'))).toBe(false);
  });

  it('keeps independent previously saved keyframe nodes compact', () => {
    const current = resolved();
    const definitions = current.nodeGraph!.keyframeNodes!.map(({ presentation: _presentation, ...definition }) => definition);
    useTimelineStore.setState({ clips: [{ ...current, nodeGraph: { ...current.nodeGraph!, keyframeNodes: definitions } }] });
    expect(graph().nodes.some(node => node.binding?.kind === 'keyframe-node')).toBe(false);
    expect(graph().nodes.find(node => node.id === 'transform')?.animation?.channels).toHaveLength(1);
  });

  it('extracts one curve, preserves the original keys and round trips its presentation', () => {
    state().addKeyframe('clip', 'rotation.z', 20, 0);
    const before = keys();
    const id = extract();
    expect(keys()).toBe(before);
    expect(graph().nodes.filter(node => node.binding?.kind === 'keyframe-node')).toHaveLength(1);
    const stored = cloneClipNodeGraph(clip().nodeGraph)!;
    expect(JSON.parse(JSON.stringify(stored)).keyframeNodes.find((node: { id: string }) => node.id === id).presentation).toBe('node');
    expect(graph().nodes.find(node => node.id === 'transform')?.animation?.channels).toHaveLength(2);
  });

  it('shows only the selected shared animation connections and leaves processing edges intact', () => {
    const id = extract();
    const channel = clip().nodeGraph!.keyframeNodes!.find(node => node.id === id)!.channels[0];
    connectKeyframeNode('clip', id, 'scale.y', channel.id);
    const full = graph();
    const quiet = focusKeyframeConnections(full, []);
    expect(quiet.edges).toEqual(full.edges.filter(edge => !edge.id.startsWith('animation:')));
    expect(quiet.nodes.find(node => node.id === 'transform')!.inputs.some(port => port.metadata?.animationProperty)).toBe(false);
    expect(focusKeyframeConnections(full, [id]).edges).toEqual(full.edges);
    expect(focusKeyframeConnections(full, ['transform']).edges).toEqual(full.edges);
    expect(full.nodes.find(node => node.id === 'transform')!.inputs.filter(port => port.metadata?.animationProperty)).toHaveLength(2);
  });

  it('links an existing independent target only when explicitly requested, replacing its curve', () => {
    state().addKeyframe('clip', 'scale.y', 9, 0);
    const id = extract(), channel = clip().nodeGraph!.keyframeNodes!.find(node => node.id === id)!.channels[0];
    connectKeyframeNode('clip', id, 'scale.y', channel.id);
    expect(keys().filter(key => key.property === 'scale.y').map(key => key.value)).toEqual([1, 3]);
    expect(resolved().nodeGraph!.keyframeNodes).toHaveLength(1);
  });

  it('reattaches animation when a separate node is removed and restores extraction through undo', () => {
    const id = extract(), before = keys();
    const snapshot = createHistorySnapshot('Extracted animation', { getTimelineState: state });
    removeKeyframeNode('clip', id);
    expect(keys()).toBe(before);
    expect(graph().nodes.some(node => node.binding?.kind === 'keyframe-node')).toBe(false);
    expect(graph().nodes.find(node => node.id === 'transform')?.animation?.channels).toHaveLength(1);
    applyHistorySnapshot(snapshot, { getTimelineState: state, setTimelineState: patch => useTimelineStore.setState(patch as Partial<ReturnType<typeof state>>) });
    expect(graph().nodes.find(node => node.id === id)).toBeDefined();
  });

  it('keeps animation discoverable on a collapsed nested group', () => {
    const cable = defaultFaceCable();
    useTimelineStore.setState({ clips: [{ ...clip(), effects: [{ id: 'cables', type: 'face-cables', name: 'Cables', enabled: true,
      params: { settings: JSON.stringify([cable]) } }], nodeGraph: { version: 1, nodes: [], groups: { 'effect:cables/physics': { collapsed: true } } } }],
      clipKeyframes: new Map([['clip', [createMockKeyframe({ clipId: 'clip', property: cableProperty('cables', cable.id, 'slack'), value: 2 })]]]) });
    const projected = graph(), physics = projected.groups!.find(group => group.label === 'Cable physics')!;
    // Use the graph's real group id; the definition may choose a domain-specific id.
    useTimelineStore.setState({ clips: [{ ...clip(), nodeGraph: { ...clip().nodeGraph!, groups: { [physics.id]: { collapsed: true } } } }] });
    expect(graph().nodes.find(node => node.id === physics.proxyId)?.animation?.channels).toHaveLength(1);
  });

  it('navigates to the owning node without starting a card drag', () => {
    const node = graph().nodes.find(candidate => candidate.animation)!;
    const drag = vi.fn();
    const view = render(<div onPointerDown={drag}><NodeAnimationBadge node={node} top={80} /></div>);
    const button = view.getByRole('button', { name: 'Edit animation for Transform, 1 curve' });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(drag).not.toHaveBeenCalled();
    expect(useNodeWorkspaceNavigation.getState().request).toMatchObject({ clipId: 'clip', nodeId: 'transform', animation: true });
  });

  it('updates the mini curve on scrubbing, highlights changes and settles while stopped', () => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const node = graph().nodes.find(candidate => candidate.animation)!;
    const view = render(<NodeAnimationBadge node={node} top={80} />);
    const button = view.getByRole('button');
    expect(button.querySelector('strong')!.textContent).toBe('1');
    act(() => state().setPlayheadPosition(2.5));
    expect(button.querySelector('strong')!.textContent).toBe('2');
    expect(button).toHaveAttribute('data-changing', 'true');
    expect(button.querySelector('line')).toHaveAttribute('transform', 'translate(50 0)');
    act(() => vi.advanceTimersByTime(200));
    expect(button).toHaveAttribute('data-changing', 'false');
  });
});
