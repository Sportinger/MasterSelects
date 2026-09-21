import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableSceneLayout, encodeCableScene } from '../../src/services/faceCables/cableSceneData';
import { compileCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { effectOperatorCompileParams } from '../../src/services/operators/effectGraphOwner';
import { connectSourceArtifact } from '../../src/services/operators/sourceArtifactConnections';
import { sourceArtifactPorts } from '../../src/services/nodeGraph/sourceArtifactPorts';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphDocument';
import { useTimelineStore } from '../../src/stores/timeline';
import { landmarkRuntime } from '../../src/services/landmarkTracking/landmarkRuntime';
import type { TimelineClip } from '../../src/types';

vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: vi.fn(), setGeneratingRamPreview: vi.fn(), clearCompositeCache: vi.fn() } }));
const savedDepth = () => {
  const cables = [defaultFaceCable()], depthGrid = { width: 3, height: 3 };
  return encodeCableScene({ version: 2, cables, depthGrid, fps: 1, frames: 1, duration: 1, triangles: [0, 1, 2], outline: [0, 1, 2], data: new Float32Array(cableSceneLayout(cables, depthGrid).stride) });
};
const current = () => useTimelineStore.getState().clips.find(c => c.id === 'artifact-clip')!;
const graph = (clip: TimelineClip, expandAll = false) => buildUnifiedClipGraph(buildClipNodeGraphDocument(clip, undefined, { faceTrackingAvailable: true }), clip, [clip], [], undefined, expandAll);
beforeEach(() => {
  const clip = createMockClip({ id: 'artifact-clip', source: { type: 'video', mediaFileId: 'artifact-source' }, effects: [
    { id: 'cables', type: 'face-cables', name: 'Face Cables', enabled: true, params: { sceneData: savedDepth(), scene3D: true } },
  ] });
  useTimelineStore.setState({ clips: [clip], tracks: [], isExporting: false });
  landmarkRuntime.setSeries({ clipId: 'face:artifact-clip', sourceId: 'artifact-source', version: 1, createdAt: 0, sampleInterval: 1,
    faceTracking: { sourceStart: 0, sourceEnd: 1, detectedFrames: 1, contours: [] }, frames: [] });
});
describe('video source artifact connections', () => {
  it('exposes available typed outputs and marks missing tracking independently from saved depth', () => {
    const ports = sourceArtifactPorts(current(), false);
    expect(ports.find(p => p.id === 'face-landmarks')?.metadata?.available).toBe(false);
    expect(ports.find(p => p.id === 'scene-depth:cables')?.metadata).toMatchObject({ available: true, contract: { formats: ['calibrated-depth'] } });
  });
  it('persists references without copying data and projects wires directly from Video Source', () => {
    const before = current().effects[0].params.sceneData;
    connectSourceArtifact(current().id, { kind: 'face-landmarks' }, { effectId: 'cables', nodeId: 'smoothing', portId: 'landmarks' });
    connectSourceArtifact(current().id, { kind: 'scene-depth', effectId: 'cables' }, { effectId: 'cables', nodeId: 'depth-mesh', portId: 'depth' });
    expect(current().effects[0].params.sceneData).toBe(before);
    const plan = compileCableOperatorGraph(effectOperatorCompileParams(current().effects[0]));
    expect(plan.useSavedDepth).toBe(true);
    expect(plan.graph.nodes.filter(n => n.operator.startsWith('source.'))).toHaveLength(2);
    const projected = graph(current(), true);
    expect(projected.nodes.some(n => n.operatorId?.startsWith('source.'))).toBe(false);
    expect(projected.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'source', fromPortId: 'face-landmarks', toPortId: 'landmarks' }));
    expect(projected.edges).toContainEqual(expect.objectContaining({ fromNodeId: 'source', fromPortId: 'scene-depth:cables', toPortId: 'depth' }));
    const restored = JSON.parse(JSON.stringify(current()));
    expect(graph(restored, true).edges).toEqual(projected.edges);
  });
  it('retains source links and writable endpoints when the effect or its nested group is collapsed', () => {
    connectSourceArtifact(current().id, { kind: 'face-landmarks' }, { effectId: 'cables', nodeId: 'smoothing', portId: 'landmarks' });
    const clip = current();
    clip.nodeGraph = { version: 1, nodes: [], groups: { 'effect:cables': { collapsed: true } } };
    const collapsed = graph(clip), edge = collapsed.edges.find(e => e.fromPortId === 'face-landmarks')!;
    expect(edge.toNodeId).toBe('effect-cables');
    expect(collapsed.nodes.find(n => n.id === edge.toNodeId)!.inputs.find(p => p.id === edge.toPortId)!.metadata?.artifactTarget)
      .toEqual({ effectId: 'cables', nodeId: 'smoothing', portId: 'landmarks' });
    clip.nodeGraph.groups = { 'effect:cables': { collapsed: false }, 'effect:cables/tracking': { collapsed: true } };
    const nested = graph(clip), boundary = nested.edges.find(e => e.fromPortId === 'face-landmarks')!;
    expect(nested.nodes.find(n => n.id === boundary.toNodeId)!.inputs.find(p => p.id === boundary.toPortId)!.metadata?.groupEndpoint?.portId).toBe('landmarks');
  });
  it('rejects unavailable, incompatible and foreign depth artifacts without changing the graph', () => {
    const before = JSON.stringify(current());
    expect(() => connectSourceArtifact(current().id, { kind: 'scene-depth', effectId: 'missing' }, { effectId: 'cables', nodeId: 'depth-mesh', portId: 'depth' })).toThrow('Bake scene depth');
    expect(() => connectSourceArtifact(current().id, { kind: 'scene-depth', effectId: 'cables' }, { effectId: 'elsewhere', nodeId: 'depth-mesh', portId: 'depth' })).toThrow('another cable bake');
    expect(() => connectSourceArtifact(current().id, { kind: 'face-landmarks' }, { effectId: 'cables', nodeId: 'depth-mesh', portId: 'depth' })).toThrow('No supported variant preserves the connected signal types');
    expect(JSON.stringify(current())).toBe(before);
  });
});
