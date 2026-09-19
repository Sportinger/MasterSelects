import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cableSimulationOrder, cableMidpoint } from '../../src/services/faceCables/cableConnections';
import { defaultFaceCable, decodeCableBake, cableFrameLayout } from '../../src/services/faceCables/cableData';
import { bakeFaceCables } from '../../src/services/faceCables/bakeFaceCables';
import { cableProperty, sampleCableConfig } from '../../src/services/faceCables/cableAnimation';
import type { Keyframe } from '../../src/types/keyframes';
import { previewFaceCables } from '../../src/services/faceCables/previewFaceCables';

const env = vi.hoisted(() => ({ timeline: {} as any, media: {} as any }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => env.timeline } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => env.media } }));
vi.mock('../../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => ({ startBatch: () => ({ opened: true }), endBatch: vi.fn() }) } }));
vi.mock('../../src/stores/timeline/exclusiveMutationLease', () => ({ assertExclusiveTimelineMutationAllowed: vi.fn() }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: vi.fn() } }));
vi.mock('../../src/services/landmarkTracking/landmarkRuntime', () => ({ landmarkRuntime: { getSeries: () => ({ sourceId: 'source', faceTracking: {} }) } }));
vi.mock('../../src/services/landmarkTracking/preciseFaceSampling', () => ({
  faceTrackKey: (id: string) => id,
  samplePreciseFace: (_series: unknown, time: number) => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    face[61] = { x: 0.4 + time * 0.1, y: 0.6 };
    face[468] = { x: 0.6, y: 0.2 };
    face[234] = { x: 0.1, y: 0.4 };
    return { faces: [face] };
  },
}));
vi.mock('../../src/utils/keyframeInterpolation', async importOriginal => ({ ...await importOriginal<typeof import('../../src/utils/keyframeInterpolation')>(), getInterpolatedClipTransform: (_keys: unknown, _time: number, transform: unknown) => transform }));
vi.mock('../../src/services/planarTracking/trackingPreviewTransform', () => ({ trackingPreviewTransform: () => ({ toComposition: (p: unknown) => p, toSource: (p: unknown) => p }) }));
vi.mock('../../src/services/planarTracking/surfaceEffects', () => ({ surfaceSourceTime: (_clip: unknown, time: number) => time }));

beforeEach(() => {
  const comp = { width: 1000, height: 1000, frameRate: 30 };
  const clip = { id: 'clip', trackId: 'track', startTime: 0, duration: 0.3, inPoint: 0, outPoint: 0.3,
    source: { mediaFileId: 'source' }, transform: { rotation: { x: 0, y: 0 }, position: { z: 0 } },
    effects: [{ id: 'effect', type: 'face-cables', enabled: true }] };
  env.timeline = { clips: [clip], tracks: [], clipKeyframes: new Map(), getClipKeyframes: () => [],
    invalidateCache: vi.fn(), updateClip: (_id: string, patch: object) => { env.timeline.clips = [{ ...clip, ...patch }]; } };
  env.media = { activeCompositionId: 'comp', getActiveComposition: () => comp, files: [{ id: 'source', width: 1000, height: 1000 }] };
});
const pair = () => {
  const parent = { ...defaultFaceCable(), id: 'parent', windZ: 0.6 };
  return [{ ...defaultFaceCable(), id: 'branch', fromCableId: 'parent', to: 'rightEar' as const }, parent];
};

describe('cable branches', () => {
  it('orders parents first and rejects cycles, missing parents and duplicate IDs', () => {
    const cables = pair();
    expect(cableSimulationOrder(cables)).toEqual([1, 0]);
    expect(() => cableSimulationOrder([{ ...cables[1], fromCableId: 'parent' }])).toThrow(/cycle/);
    expect(() => cableSimulationOrder([cables[0]])).toThrow(/missing/);
    expect(() => cableSimulationOrder([cables[1], cables[1]])).toThrow(/unique/);
    expect(() => cableSimulationOrder([cables[0], { ...cables[1], fromCableId: 'branch' }])).toThrow(/cycle/);
  });
  it('interpolates a midpoint including Z for odd segment counts', () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }];
    expect(cableMidpoint({ points, previous: points, length: 4 })).toEqual({ x: 0.5, y: 1, z: 1.5 });
  });
  it('pins the baked branch to the moving parent midpoint and ear across every frame', async () => {
    const configs = pair();
    await bakeFaceCables('clip', 'effect', configs, new AbortController().signal, vi.fn());
    const bake = decodeCableBake(env.timeline.clips[0].effects[0].params.bakedData)!;
    expect(bake.cables[0].fromCableId).toBe('parent');
    const layout = cableFrameLayout(3, configs);
    const starts: number[] = [];
    for (let frame = 0; frame < bake.frames; frame++) {
      const base = frame * layout.stride, child = base + layout.offsets[0], parent = base + layout.offsets[1];
      expect(bake.data[child]).toBe(1);
      for (let axis = 0; axis < 3; axis++) expect(bake.data[child + 2 + axis]).toBeCloseTo(bake.data[parent + 2 + 12 * 3 + axis], 5);
      expect(bake.data[child + 2 + 24 * 3]).toBeCloseTo(0.1);
      expect(bake.data[child + 3 + 24 * 3]).toBeCloseTo(0.4);
      starts.push(bake.data[child + 2]);
    }
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.001);
  });
  it('uses the same attachment in the draft preview', () => {
    const configs = pair(), bake = decodeCableBake(previewFaceCables('clip', configs, 0.1))!;
    const layout = cableFrameLayout(3, configs), parent = layout.offsets[1], child = layout.offsets[0];
    for (let axis = 0; axis < 3; axis++) expect(bake.data[child + 2 + axis]).toBeCloseTo(bake.data[parent + 2 + 12 * 3 + axis], 5);
  });
});


describe('independent cable animation', () => {
  it('applies shared wind to the whole bake and preserves the environment settings', async () => {
    const configs = pair();
    env.timeline.clips[0].effects[0].params = { sharedWind: true, faceCollision: true, globalWindStrength: 3, globalWindYaw: 180, globalWindGusts: 0 };
    await bakeFaceCables('clip', 'effect', configs, new AbortController().signal, vi.fn());
    const params = env.timeline.clips[0].effects[0].params;
    expect(params.sharedWind).toBe(true);
    expect(params.faceCollision).toBe(true);
    expect(params.globalWindYaw).toBe(180);
    const bake = decodeCableBake(params.bakedData)!;
    expect(bake.data.every(Number.isFinite)).toBe(true);
    const preview = decodeCableBake(previewFaceCables('clip', configs, 0.15, 'effect'))!;
    expect(preview.data[0]).toBe(1);
  });
  const widthKeys = (): Keyframe[] => [0, 0.3].map((time, i) => ({
    id: `width-${i}`, clipId: 'clip', property: cableProperty('effect', 'branch', 'width'),
    time, value: 2 + i * 6, easing: 'linear',
  }));
  it('interpolates only the addressed cable and effect without changing base settings', () => {
    const configs = pair(), keys = widthKeys();
    expect(sampleCableConfig(configs[0], 'effect', keys, 0.15).width).toBeCloseTo(5);
    expect(sampleCableConfig(configs[1], 'effect', keys, 0.15).width).toBe(configs[1].width);
    expect(sampleCableConfig(configs[0], 'other-effect', keys, 0.15).width).toBe(configs[0].width);
    expect(configs[0].width).toBe(defaultFaceCable().width);
  });
  it('bakes animated branch thickness per frame while retaining the parent thickness', async () => {
    const configs = pair(), keys = widthKeys();
    env.timeline.getClipKeyframes = () => keys;
    env.timeline.clipKeyframes.set('clip', keys);
    await bakeFaceCables('clip', 'effect', configs, new AbortController().signal, vi.fn());
    const bake = decodeCableBake(env.timeline.clips[0].effects[0].params.bakedData)!;
    const layout = cableFrameLayout(3, configs);
    for (let frame = 0; frame < bake.frames; frame++) {
      const base = frame * layout.stride;
      expect(bake.data[base + layout.offsets[0] + 1]).toBeCloseTo((2 + frame / 30 / 0.3 * 6) / 2160, 7);
      expect(bake.data[base + layout.offsets[1] + 1]).toBeCloseTo(configs[1].width / 2160, 7);
    }
    const preview = decodeCableBake(previewFaceCables('clip', configs, 0.15, 'effect'))!;
    expect(preview.data[layout.offsets[0] + 1]).toBeCloseTo(5 / 2160, 7);
  });
});
