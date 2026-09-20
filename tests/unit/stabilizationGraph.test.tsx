import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import type { Keyframe, TimelineClip } from '../../src/types';
import { buildClipNodeGraphDocument, cloneClipNodeGraph, reconcileClipNodeGraphState } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { withLegacyKeyframeNodes } from '../../src/services/nodeGraph/legacyKeyframeNodes';
import { focusKeyframeConnections } from '../../src/services/nodeGraph/keyframeNodeProjection';
import { STABILIZATION_CURVES_NODE, STABILIZATION_GROUP, STABILIZATION_SOLVE_NODE } from '../../src/services/nodeGraph/stabilizationGraphProjection';
import { stabilizationCurveSignature, stabilizationInputSignature, stabilizationStatus } from '../../src/services/landmarkTracking/stabilizationProvenance';
import { canConnectPortReferences, createPortReference, isNodeBypassable } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { useUnifiedNodeActions } from '../../src/components/panels/nodes/useUnifiedNodeActions';
import type { FlockGraphActions } from '../../src/components/panels/nodes/flock/useFlockGraphActions';
import { useTimelineStore } from '../../src/stores/timeline';
import { createHistoryTimelineEditState, findHistoryStateBoundaryViolations } from '../../src/stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../src/stores/timeline/historyTimelineRestoreState';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });
const clip = () => createMockClip({ id: 'stable', name: 'Tracked clip', trackId: 'video', source: { type: 'video', mediaFileId: 'media' }, effects: [] });
const keys = (): Keyframe[] => (['position.x', 'position.y', 'rotation.z'] as const).flatMap(property => [0, 1].map(time =>
  createMockKeyframe({ id: `face-stabilize:${property}:${time}`, clipId: 'stable', property, time, value: time + 2 })));
const graphFor = (value: TimelineClip, curves = keys()) => {
  const resolved = withLegacyKeyframeNodes(value, curves);
  return { clip: resolved, graph: buildUnifiedClipGraph(buildClipNodeGraphDocument(resolved), resolved, [resolved], curves) };
};
function recorded(value = clip(), curves = keys()) {
  value.nodeGraph = { version: 1, nodes: [], stabilization: { bake: {
    version: 1, target: 'lips', lockCenter: true, smoothing: 0.25, sourceId: 'media', trackingCreatedAt: 100,
    bakedAt: 200, frameRate: 30, sampleCount: 2, detectedSamples: 2,
    inputSignature: stabilizationInputSignature(value, curves), curveSignature: stabilizationCurveSignature(curves),
  } } };
  return value;
}

describe('stabilization bake in the node graph', () => {
  it('shows an existing bake as landmarks → solve → real curves → clip transform without changing data', () => {
    const original = clip(), curves = keys(), before = JSON.stringify([original, curves]);
    const { graph } = graphFor(original, curves);
    expect(graph.nodes.map(node => node.id)).toEqual(expect.arrayContaining([STABILIZATION_SOLVE_NODE, STABILIZATION_CURVES_NODE, 'transform']));
    expect(graph.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'source', fromPortId: 'face-landmarks', toNodeId: STABILIZATION_SOLVE_NODE, readOnly: true }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ fromNodeId: STABILIZATION_SOLVE_NODE, toNodeId: STABILIZATION_CURVES_NODE }));
    expect(graph.edges.filter(edge => edge.fromNodeId === STABILIZATION_CURVES_NODE)).toHaveLength(3);
    expect(graph.edges.filter(edge => edge.fromNodeId === STABILIZATION_CURVES_NODE).every(edge => edge.toNodeId === 'transform')).toBe(true);
    const baked = graph.nodes.find(node => node.id === STABILIZATION_CURVES_NODE)!;
    expect(baked.animation?.channels.map(channel => channel.property).toSorted()).toEqual(['position.x', 'position.y', 'rotation.z']);
    expect(graph.nodes.find(node => node.id === STABILIZATION_SOLVE_NODE)?.label).toBe('Face / lip stabilization');
    expect(baked.params?.status).toBe('Baked · settings not recorded');
    expect(JSON.stringify([original, curves])).toBe(before);
    expect(focusKeyframeConnections(graph, []).edges.filter(edge => edge.readOnly)).toHaveLength(5);
  });

  it.each([false, true])('routes baked curves to the actual 3D transform with scene collapsed=%s', collapsed => {
    const value = clip();
    value.is3D = true;
    value.nodeGraph = { version: 1, nodes: [], groups: { scene3d: { collapsed } } };
    const { graph } = graphFor(value);
    const output = graph.edges.find(edge => edge.fromNodeId === STABILIZATION_CURVES_NODE)!;
    const owner = graph.nodes.find(node => node.id === output.toNodeId)!;
    expect(collapsed ? owner.id : owner.operatorId).toBe(collapsed ? 'scene3d' : 'scene.clip-transform');
    for (const edge of graph.edges) {
      expect(graph.nodes.find(node => node.id === edge.fromNodeId)?.outputs.some(port => port.id === edge.fromPortId)).toBe(true);
      expect(graph.nodes.find(node => node.id === edge.toNodeId)?.inputs.some(port => port.id === edge.toPortId)).toBe(true);
    }
  });

  it('keeps an animated transform visible when all keyframe definitions were already saved', () => {
    const value = graphFor(clip()).clip;
    value.nodeGraph!.forcedBuiltIns = [];
    expect(graphFor(value).graph.nodes.some(node => node.id === 'transform')).toBe(true);
  });

  it('collapses the stabilization area without losing its real input, curve outputs or bypass', () => {
    const value = recorded();
    value.nodeGraph!.groups = { [STABILIZATION_GROUP]: { collapsed: true, position: { x: 50, y: -250 } } };
    const { graph } = graphFor(value);
    const group = graph.groups!.find(candidate => candidate.id === STABILIZATION_GROUP)!;
    expect(group.collapsed).toBe(true);
    expect(group.bypassNodeId).toBe(STABILIZATION_GROUP);
    const node = graph.nodes.find(candidate => candidate.id === STABILIZATION_GROUP)!;
    expect(node.animation?.channels).toHaveLength(3);
    expect(node.layout).toEqual({ x: 50, y: -250 });
    expect(isNodeBypassable(node)).toBe(true);
    expect(graph.nodes.some(candidate => candidate.id === STABILIZATION_SOLVE_NODE)).toBe(false);
    expect(graph.edges.filter(edge => edge.readOnly)).toHaveLength(4);
    expect(graph.edges.filter(edge => edge.fromNodeId === STABILIZATION_GROUP)).toHaveLength(3);
    for (const edge of graph.edges) {
      expect(graph.nodes.find(candidate => candidate.id === edge.fromNodeId)?.outputs.some(port => port.id === edge.fromPortId)).toBe(true);
      expect(graph.nodes.find(candidate => candidate.id === edge.toNodeId)?.inputs.some(port => port.id === edge.toPortId)).toBe(true);
    }
  });

  it('does not invent a stabilization bake for ordinary manual animation', () => {
    const manual = keys().map(key => ({ ...key, id: `manual:${key.id}` }));
    expect(graphFor(clip(), manual).graph.nodes.some(node => node.binding?.kind === 'clip-stabilization')).toBe(false);
  });

  it('retains provenance and node positions through graph edits, JSON storage and cloning', () => {
    const value = recorded();
    value.nodeGraph!.groups = { [STABILIZATION_GROUP]: { position: { x: 0, y: 0 } } };
    value.nodeGraph!.stabilization!.layouts = { solve: { x: 23, y: -200 }, keyframes: { x: 380, y: -200 } };
    const cloned = cloneClipNodeGraph(value.nodeGraph)!;
    expect(cloned.stabilization).toEqual(value.nodeGraph!.stabilization);
    expect(cloned.stabilization).not.toBe(value.nodeGraph!.stabilization);
    const restored = { ...value, nodeGraph: JSON.parse(JSON.stringify(cloned)) };
    restored.nodeGraph = reconcileClipNodeGraphState(restored, undefined, restored.nodeGraph);
    expect(restored.nodeGraph.stabilization).toEqual(cloned.stabilization);
    const { graph } = graphFor(restored);
    expect(graph.nodes.find(node => node.id === STABILIZATION_SOLVE_NODE)?.layout).toEqual({ x: 23, y: -200 });
    expect(graph.nodes.find(node => node.id === STABILIZATION_SOLVE_NODE)?.label).toBe('Lip stabilization');
  });

  it('distinguishes saved curves, edits, changed inputs, retracking and removal', () => {
    const value = recorded(), curves = keys();
    expect(stabilizationStatus(value, curves, 100)).toBe('Baked');
    expect(stabilizationStatus(value, curves.map((key, index) => index ? key : { ...key, value: 99 }))).toBe('Baked curves edited');
    expect(stabilizationStatus({ ...value, speed: 2 }, curves)).toBe('Rebake needed');
    expect(stabilizationStatus(value, curves, 101)).toBe('Rebake needed');
    expect(stabilizationStatus(value, [])).toBe('Baked keys removed');
    expect(graphFor(value, []).graph.nodes.find(node => node.id === STABILIZATION_CURVES_NODE)?.params?.status).toBe('Baked keys removed');
    // Clip and key IDs change when duplicating; identical curves retain their provenance.
    expect(stabilizationCurveSignature(curves.map(key => ({ ...key, clipId: 'copy', id: `copy:${key.id}` })))).toBe(stabilizationCurveSignature(curves));
  });

  it('protects recorded dependencies and connects bypass to the real clip state', () => {
    const value = recorded(), curves = keys();
    useTimelineStore.setState({ clips: [value], tracks: [createMockTrack({ id: 'video' })], clipKeyframes: new Map([[value.id, curves]]), isExporting: false });
    const { clip: resolved, graph } = graphFor(value, curves);
    const base = { moveNode: vi.fn(), deleteNode: vi.fn(), toggleBypass: vi.fn(), connectPorts: vi.fn(), disconnectEdge: vi.fn() };
    const hook = renderHook(() => useUnifiedNodeActions(resolved, graph, base, {} as FlockGraphActions));
    const node = graph.nodes.find(node => node.id === STABILIZATION_SOLVE_NODE)!;
    expect(isNodeBypassable(node)).toBe(true);
    expect(canConnectPortReferences(createPortReference('other', { ...node.inputs[0], direction: 'output', metadata: {} }), createPortReference(node.id, node.inputs[0]))).toBe(false);
    act(() => hook.result.current.disconnectEdge(graph.edges.find(edge => edge.readOnly)!.id));
    expect(base.disconnectEdge).not.toHaveBeenCalled();
    act(() => hook.result.current.toggleBypass(node.id));
    expect(useTimelineStore.getState().clips[0].videoInspectorSections?.stabilization).toBe(false);
    expect(useTimelineStore.getState().clipKeyframes.get(value.id)).toEqual(curves);
    act(() => hook.result.current.toggleBypass(node.id));
    expect(useTimelineStore.getState().clips[0].videoInspectorSections?.stabilization).toBe(true);
    act(() => hook.result.current.moveNode(node.id, { x: 10, y: 20 }));
    expect(useTimelineStore.getState().clips[0].nodeGraph?.stabilization?.layouts?.solve).toEqual({
      x: 10 - node.groupOffset!.x, y: 20 - node.groupOffset!.y,
    });
    act(() => useTimelineStore.setState({ tracks: [createMockTrack({ id: 'video', locked: true })] }));
    act(() => hook.result.current.toggleBypass(node.id));
    expect(hook.result.current.message).toContain('locked');
    expect(useTimelineStore.getState().clips[0].videoInspectorSections?.stabilization).toBe(true);
  });

  it('round-trips bake provenance and bypass through history, including scene nodes named texture', () => {
    const value = recorded();
    value.videoInspectorSections = { stabilization: false };
    value.nodeGraph!.scene = { version: 1, graph: { nodes: [], edges: [], layout: { texture: { x: 12, y: 34 } } } } as NonNullable<TimelineClip['nodeGraph']>['scene'];
    const history = createHistoryTimelineEditState({ id: 'stabilization-test', label: 'Stabilization', timestamp: 0,
      clips: [value], tracks: [], selectedClipIds: new Set<string>(), duration: 5, zoom: 1, scrollX: 0, clipKeyframes: new Map([[value.id, keys()]]) });
    const restored = createHistoryTimelineRestoreState(history, { clips: [value] });
    expect(restored.state.clips[0].videoInspectorSections?.stabilization).toBe(false);
    expect(restored.state.clips[0].nodeGraph?.stabilization).toEqual(value.nodeGraph!.stabilization);
    expect(findHistoryStateBoundaryViolations({ texture: { x: 12, y: 34 } })).not.toHaveLength(0);
    expect(findHistoryStateBoundaryViolations({ nodeGraph: { scene: { graph: { layout: { texture: { x: 1, y: 2, videoElement: {} } } } } } })).not.toHaveLength(0);
  });
});
