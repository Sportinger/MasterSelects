import { describe, expect, it, vi } from 'vitest';
import { scenePreview } from '../../src/services/nodePreview/scenePreviews';
import { defaultSceneGraph } from '../../src/services/operators/sceneGraph';
import { createMockClip } from '../helpers/mockData';
import type { PreviewRequest } from '../../src/services/nodePreview/previewTypes';
import { sourcePreview } from '../../src/services/nodePreview/sourcePreview';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
vi.mock('../../src/services/nodePreview/sourcePreview', () => ({ sourcePreview: vi.fn(() => ({ label: 'Source' })) }));
vi.mock('../../src/services/nodePreview/NodePreviewTextureTap', () => ({ nodePreviewTextureTap: { request: vi.fn(() => ({ label: 'Scene' })) } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clips: [], clipKeyframes: new Map() }) } }));
const request = (id: string, operator: string): PreviewRequest => ({ key: id, revision: '1', clipId: 'clip', time: 1,
  width: 164, height: 92, interval: 100, priority: 0, node: { id, label: id, kind: 'effect', runtime: 'builtin', layout: { x: 0, y: 0 },
    inputs: [], outputs: [], binding: { kind: 'scene-operator', nodeId: id, operator } } });
const clip = () => createMockClip({ id: 'clip', nodeGraph: { version: 1, nodes: [], scene: defaultSceneGraph() } });

describe('3D node output viewers', () => {
  it('shows source texture, UVs, tint, plane, mesh and transformed geometry from their own stages', async () => {
    const value = clip(); value.nodeGraph!.scene!.params.material_red = 0.25;
    value.transform.position.x = 5;
    await scenePreview(request('texture', 'texture.image'), value, 1, 1);
    expect(sourcePreview).toHaveBeenCalled();
    expect(await scenePreview(request('uv', 'texture.uv'), value, 1, 1)).toMatchObject({ drawing: { kind: 'points', dimensions: 2, points: [0, 0, 1, 0, 1, 1, 0, 1] } });
    expect(await scenePreview(request('material', 'material.surface'), value, 1, 1)).toMatchObject({ drawing: { kind: 'material', color: [0.25, 1, 1], textured: true } });
    const mesh = await scenePreview(request('mesh', 'scene.mesh'), value, 1, 1);
    const transformed = await scenePreview(request('transform', 'scene.clip-transform'), value, 1, 1);
    expect(mesh.drawing?.kind).toBe('points'); expect(transformed.drawing?.kind).toBe('points');
    if (mesh.drawing?.kind === 'points' && transformed.drawing?.kind === 'points') expect(transformed.drawing.points[0] - mesh.drawing.points[0]).toBeCloseTo(5);
    await scenePreview(request('render', 'scene.render'), value, 1, 1);
    expect(nodePreviewTextureTap.request).toHaveBeenCalledWith('scene:clip', expect.anything());
  });
  it('does not show a fabricated mesh after disconnecting its geometry', async () => {
    const value = clip(); value.nodeGraph!.scene!.graph.edges = value.nodeGraph!.scene!.graph.edges.filter(edge => edge.input !== 'geometry');
    expect(await scenePreview(request('mesh', 'scene.mesh'), value, 1, 1)).toMatchObject({ status: 'missing', label: 'Object disconnected' });
  });
});
