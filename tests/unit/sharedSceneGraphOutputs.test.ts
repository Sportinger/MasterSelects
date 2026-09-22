import { describe, expect, it } from 'vitest';
import { defaultSplatGraph } from '../../src/services/operators/splatGraph';
import { expandSceneOperatorGraph } from '../../src/engine/scene/sceneGraphRuntime';
import { projectSceneGraphClip, sceneOutputTarget } from '../../src/services/nodeGraph/sceneGraphOutputs';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { synchronizeSharedSceneGraphs } from '../../src/stores/timeline/sharedSceneGraphSynchronization';
import { createHistoryTimelineEditState } from '../../src/stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../src/stores/timeline/historyTimelineRestoreState';
import type { TimelineClip } from '../../src/types/timeline';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { SceneSplatLayer } from '../../src/engine/scene/types';
import type { SharedSceneGraph } from '../../src/types/sharedSceneGraph';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';

const definition = defaultSplatGraph(true);
const document: SharedSceneGraph = { id: 'graph', name: 'Scan', sourceClipId: 'scan', startTime: 2,
  effect: { id: 'effect', name: 'Splats', type: 'splat-exploration', enabled: true, params: definition.params, operatorGraph: definition.graph },
  outputs: { mesh: ['mesh'], particles: ['particles'] }, keyframes: [],
};
function clip(id: string, nodeIds?: string[]): TimelineClip {
  return { id, trackId: id, name: id, startTime: 2, duration: 10, inPoint: 0, outPoint: 10,
    file: new File([], 'scan.splat'), source: { type: 'gaussian-splat', mediaFileId: 'asset' },
    transform: DEFAULT_TRANSFORM, effects: [], sceneGraphOutput: { graphId: 'graph', label: id, nodeIds } };
}
function state(): TimelineStore {
  return { clips: [clip('scan'), clip('mesh', ['mesh']), clip('particles', ['particles'])], tracks: [],
    sharedSceneGraphs: { graph: document }, clipKeyframes: new Map() } as unknown as TimelineStore;
}

describe('shared scene outputs', () => {
  it('partitions rendering without copying the source or dropping full-resolution splats', () => {
    const layer = { kind: 'splat', worldMatrix: new Float32Array(16), gaussianSplatRuntimeKey: 'one-upload' } as SceneSplatLayer;
    const main = expandSceneOperatorGraph(layer, definition, { exclude: ['mesh', 'particles'] }) as SceneSplatLayer[];
    const mesh = expandSceneOperatorGraph(layer, definition, { include: ['mesh'] }) as SceneSplatLayer[];
    const particles = expandSceneOperatorGraph(layer, definition, { include: ['particles'] }) as SceneSplatLayer[];
    expect([...main, ...mesh, ...particles].map(l => l.splatGraphBranch!.outputNodeId).toSorted()).toEqual(['mesh', 'particles', 'rays', 'surface']);
    expect(main[0].splatGraphBranch!.budget).toBe(0);
    expect(mesh[0].gaussianSplatRuntimeKey).toBe(main[0].gaussianSplatRuntimeKey);
    expect(expandSceneOperatorGraph(layer, undefined, { include: [] })).toEqual([]);
  });
  it('projects both editors onto the identical canonical graph', () => {
    const a = projectSceneGraphClip(clip('scan'), { graph: document });
    const b = projectSceneGraphClip(clip('mesh', ['mesh']), { graph: document });
    expect(a.effects[0]).toBe(b.effects[0]);
    const graph = buildEffectOperatorGraph(a, document.effect);
    const target = sceneOutputTarget(a, graph, graph.nodes.find(n => n.id === 'mesh')!);
    expect(target?.nodeIds).toEqual(['mesh']);
    expect(clip('mesh').effects).toEqual([]);
  });
  it('moves the family once, while trims and output moves leave the shared clock unchanged', () => {
    const s = state();
    const moved = synchronizeSharedSceneGraphs(s, { clips: s.clips.map(c => c.id === 'scan' ? { ...c, startTime: 5 } : c) });
    expect(moved.clips?.map(c => c.startTime)).toEqual([5, 5, 5]);
    expect(moved.sharedSceneGraphs?.graph.startTime).toBe(5);
    const trim = synchronizeSharedSceneGraphs(s, { clips: s.clips.map(c => c.id === 'mesh' ? { ...c, startTime: 3, duration: 9, inPoint: 1 } : c) });
    expect(trim.sharedSceneGraphs).toBeUndefined();
    expect(trim.clips?.[0].startTime).toBe(2);
  });
  it('survives source-output deletion and releases deleted output assignments', () => {
    const s = state();
    const deleted = synchronizeSharedSceneGraphs(s, { clips: s.clips.filter(c => c.id !== 'scan') });
    expect(deleted.sharedSceneGraphs ?? s.sharedSceneGraphs).toHaveProperty('graph.effect');
    const noMesh = synchronizeSharedSceneGraphs(s, { clips: s.clips.filter(c => c.id !== 'mesh') });
    expect(noMesh.sharedSceneGraphs?.graph.outputs).toEqual({ particles: ['particles'] });
  });
  it('round trips graph ownership and endpoint references through history JSON', () => {
    const s = state();
    const snapshot = createHistoryTimelineEditState({ id: 'snapshot', label: 'Output', timestamp: 0,
      clips: s.clips, tracks: [], selectedClipIds: [], zoom: 50, scrollX: 0, sharedSceneGraphs: s.sharedSceneGraphs });
    const restored = createHistoryTimelineRestoreState(JSON.parse(JSON.stringify(snapshot)), {}).state;
    expect(restored.sharedSceneGraphs).toEqual(s.sharedSceneGraphs);
    expect(restored.clips[1].sceneGraphOutput).toEqual(s.clips[1].sceneGraphOutput);
    expect(restored.clips.every(c => !c.effects.length)).toBe(true);
  });
});
