import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bakeFaceCables } from '../../src/services/faceCables/bakeFaceCables';
import { decodeCableScene, encodeCableScene } from '../../src/services/faceCables/cableSceneData';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { defaultCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';

const env = vi.hoisted(() => ({ timeline: {} as any, media: {} as any, series: {} as any,
  read: vi.fn(), close: vi.fn(), update: vi.fn(), startBatch: vi.fn(() => ({ opened: true })), endBatch: vi.fn() }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => env.timeline } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => env.media } }));
vi.mock('../../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => env } }));
vi.mock('../../src/stores/timeline/exclusiveMutationLease', () => ({ assertExclusiveTimelineMutationAllowed: vi.fn() }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: vi.fn() } }));
vi.mock('../../src/services/landmarkTracking/landmarkRuntime', () => ({ landmarkRuntime: { getSeries: () => env.series } }));
vi.mock('../../src/services/faceCables/cableDepthReader', () => ({ openCableDepthReader: async () => ({ read: env.read, close: env.close }) }));

beforeEach(() => {
  vi.clearAllMocks();
  const face = Array.from({ length: 478 }, (_, i) => ({ x: 0.5 + Math.cos(i) * 0.2, y: 0.5 + Math.sin(i) * 0.2, z: Math.cos(i) * 0.1 }));
  env.series = { sourceId: 'source', sampleInterval: 1, faceTracking: { sourceStart: 0, sourceEnd: 2 }, frames: [{ time: 0, duration: 2, faces: [face] }] };
  const clip = { id: 'clip', trackId: 'video', duration: 0.2, startTime: 0, inPoint: 0, outPoint: 0.2, speed: 1,
    source: { type: 'video', mediaFileId: 'source' }, transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [{ id: 'effect', type: 'face-cables', enabled: true, params: { scene3D: true, sceneDepth: true, sceneData: 'previous' } }] };
  const comp = { width: 100, height: 100, frameRate: 5 };
  env.media = { files: [{ id: 'source', width: 100, height: 100 }], activeCompositionId: 'comp', getActiveComposition: () => comp };
  env.timeline = { clips: [clip], tracks: [{ id: 'video' }], clipKeyframes: new Map(), getClipKeyframes: () => [], updateClip: env.update, invalidateCache: vi.fn() };
  env.read.mockResolvedValue({ width: 3, height: 3, values: new Float32Array([0, 1, 2, 1, 2, 3, 2, 3, 4]), milliseconds: 1 });
});
const bake = (signal = new AbortController().signal) => bakeFaceCables('clip', 'effect', [defaultFaceCable()], signal, vi.fn());
describe('scene depth bake transaction', () => {
  it('executes connected source artifacts without depth inference and preserves saved calibration', async () => {
    env.timeline.clips[0].effects[0].params.sceneDepthStrength = 1.4;
    await bake();
    env.timeline.clips[0] = { ...env.timeline.clips[0], ...env.update.mock.calls[0][1] };
    const graph = defaultCableOperatorGraph();
    graph.nodes.push({ id: 'cached-face', operator: 'source.face-landmarks', bindings: {} }, { id: 'cached-depth', operator: 'source.saved-depth', bindings: {} });
    graph.edges = graph.edges.map(e => e.to === 'smoothing' ? { ...e, from: 'cached-face' } : e.to === 'depth-mesh' ? { ...e, from: 'cached-depth' } : e);
    const params = env.timeline.clips[0].effects[0].params;
    params.operatorGraph = JSON.stringify(graph); params.sceneDepthStrength = 0.5;
    env.read.mockClear(); env.update.mockClear();
    await bake();
    expect(env.read).not.toHaveBeenCalled(); expect(env.update).toHaveBeenCalledOnce();
    const saved = decodeCableScene(env.update.mock.calls[0][1].effects[0].params.sceneData)!;
    expect(JSON.parse(saved.depthBinding!).strength).toBe(1.4);
    env.timeline.clips[0].inPoint = 0.01; env.update.mockClear();
    await expect(bake()).rejects.toThrow(/changed|no longer matches/);
    expect(env.update).not.toHaveBeenCalled(); expect(env.read).not.toHaveBeenCalled();
  });
  it('commits a complete portable hybrid scene in one history batch and closes its decoder', async () => {
    env.timeline.clips[0].effects[0].params.surfaceSubdivisions = 2;
    env.timeline.clips[0].effects[0].params.surfaceBlendWidth = 0.12;
    await bake();
    expect(env.update).toHaveBeenCalledOnce(); expect(env.startBatch).toHaveBeenCalledOnce(); expect(env.endBatch).toHaveBeenCalledOnce();
    const saved = env.update.mock.calls[0][1];
    expect(saved.is3D).toBe(true);
    expect(decodeCableScene(saved.effects[0].params.sceneData)).toMatchObject({ version: 2, frames: 2, depthGrid: { width: 49, height: 49 } });
    expect(decodeCableScene(saved.effects[0].params.sceneData)?.surface).toEqual({ face: true, blendWidth: 0.12, subdivisions: 2 });
    expect(JSON.parse(saved.effects[0].params.operatorGraph).nodes.some((n: { operator: string }) => n.operator === 'geometry.merge-surface')).toBe(true);
    expect(env.read.mock.calls.map(c => c[0])).toEqual([0, 0.199999]); expect(env.close).toHaveBeenCalledOnce();
  });
  it.each(['cancel', 'inference failure', 'clip changed'])('keeps the previous bake on %s and always closes its decoder', async reason => {
    const controller = new AbortController(), depth = await env.read(); env.read.mockClear();
    env.read.mockImplementationOnce(async () => {
      if (reason === 'cancel') { controller.abort(); controller.signal.throwIfAborted(); }
      if (reason === 'inference failure') throw new Error('Inference failed');
      env.timeline.clips = [{ ...env.timeline.clips[0], duration: 0.1 }];
      return depth;
    });
    await expect(bake(controller.signal)).rejects.toThrow();
    expect(env.update).not.toHaveBeenCalled(); expect(env.startBatch).not.toHaveBeenCalled();
    expect(env.timeline.clips[0].effects[0].params.sceneData).toBe('previous'); expect(env.close).toHaveBeenCalledOnce();
  });
  it('completes the bake when tracked landmarks extend beyond the source image', async () => {
    env.series.frames[0].faces[0].forEach((p: { x: number }) => { p.x -= 0.45; });
    await bake();
    expect(env.update).toHaveBeenCalledOnce();
    expect(decodeCableScene(env.update.mock.calls[0][1].effects[0].params.sceneData)?.version).toBe(2);
  });
  it('reuses saved depth after changing cable topology without another model inference', async () => {
    await bake();
    env.timeline.clips[0] = { ...env.timeline.clips[0], ...env.update.mock.calls[0][1] };
    const previous = decodeCableScene(env.timeline.clips[0].effects[0].params.sceneData)!;
    env.read.mockClear(); env.update.mockClear();
    await bakeFaceCables('clip', 'effect', [{ ...defaultFaceCable(), segments: 8 }], new AbortController().signal, vi.fn(), vi.fn(), true);
    expect(env.read).not.toHaveBeenCalled(); expect(env.update).toHaveBeenCalledOnce();
    const current = decodeCableScene(env.update.mock.calls[0][1].effects[0].params.sceneData)!;
    expect(current.depthBinding).toBe(previous.depthBinding); expect(current.depthGrid).toEqual(previous.depthGrid);
    expect(current.cables[0].segments).toBe(8);
  });
  it.each(['strength', 'pose', 'source'])('rejects reuse after a changed %s and retains the saved scene', async changed => {
    await bake();
    env.timeline.clips[0] = { ...env.timeline.clips[0], ...env.update.mock.calls[0][1] };
    if (changed === 'strength') env.timeline.clips[0].effects[0].params.sceneDepthStrength = 2;
    if (changed === 'pose') env.series.frames[0].faces[0][10].x += 0.1;
    if (changed === 'source') env.timeline.clips[0].inPoint = 0.01;
    env.update.mockClear(); env.read.mockClear();
    await expect(bakeFaceCables('clip', 'effect', [defaultFaceCable()], new AbortController().signal, vi.fn(), vi.fn(), true)).rejects.toThrow(/changed|no longer matches/);
    expect(env.update).not.toHaveBeenCalled(); expect(env.read).not.toHaveBeenCalled();
  });
  it.each(['missing binding', 'implicit face reference'])('reuses older project depth with %s only when its saved face and mapping still match', async legacy => {
    await bake();
    env.timeline.clips[0] = { ...env.timeline.clips[0], ...env.update.mock.calls[0][1] };
    const old = decodeCableScene(env.timeline.clips[0].effects[0].params.sceneData)!;
    const binding = JSON.parse(old.depthBinding!); delete binding.referenceFace;
    env.timeline.clips[0].effects[0].params.sceneData = encodeCableScene({ ...old, depthBinding: legacy === 'missing binding' ? undefined : JSON.stringify(binding) });
    env.update.mockClear(); env.read.mockClear();
    await bakeFaceCables('clip', 'effect', [defaultFaceCable()], new AbortController().signal, vi.fn(), vi.fn(), true);
    expect(env.read).not.toHaveBeenCalled(); expect(env.update).toHaveBeenCalledOnce();
    env.series.frames[0].faces[0][10].y += 0.1; env.update.mockClear();
    await expect(bakeFaceCables('clip', 'effect', [defaultFaceCable()], new AbortController().signal, vi.fn(), vi.fn(), true)).rejects.toThrow('face track');
    expect(env.update).not.toHaveBeenCalled();
  });
});
