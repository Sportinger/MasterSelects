import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import type { LandmarkSeries } from '../../src/services/landmarkTracking/types';

const fakes = vi.hoisted(() => ({ state: {} as Record<string, unknown>, start: vi.fn(), end: vi.fn(), invalidate: vi.fn(), render: vi.fn() }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: {
  getState: () => fakes.state,
  setState: (patch: Record<string, unknown>) => Object.assign(fakes.state, patch),
} }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [{ id: 'source', width: 1000, height: 1000 }],
  getActiveComposition: () => ({ width: 1000, height: 1000, frameRate: 10 }),
}) } }));
vi.mock('../../src/stores/historyStore', () => ({ useHistoryStore: { getState: () => ({ startBatch: fakes.start, endBatch: fakes.end }) } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: fakes.render } }));
import { bakeFaceStabilization } from '../../src/services/landmarkTracking/bakeFaceStabilization';
import { landmarkRuntime } from '../../src/services/landmarkTracking/landmarkRuntime';

const transform = { opacity: 1, blendMode: 'normal' as const, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } };
const clip = { id: 'bake', trackId: 'video', inPoint: 2, outPoint: 3, duration: 1, startTime: 0, speed: 1,
  source: { type: 'video', mediaFileId: 'source' }, transform } as TimelineClip;
const unrelated: Keyframe = { id: 'opacity', clipId: 'bake', property: 'opacity', time: 0, value: 0.8, easing: 'linear' };
beforeEach(() => {
  vi.clearAllMocks();
  fakes.start.mockReturnValue({ opened: true });
  fakes.state = { clips: [{ ...clip }], tracks: [{ id: 'video', locked: false }], isExporting: false,
    clipKeyframes: new Map([['bake', [unrelated]]]), invalidateCache: fakes.invalidate,
    getClipKeyframes: () => (fakes.state.clipKeyframes as Map<string, Keyframe[]>).get('bake')!,
    getInterpolatedTransform: () => transform,
  };
  const face = Array.from({ length: 478 }, () => ({ x: 0.6, y: 0.55, z: 0 }));
  face[33] = { x: 0.4, y: 0.4, z: 0 }; face[263] = { x: 0.7, y: 0.45, z: 0 };
  const series: LandmarkSeries = { version: 1, clipId: 'face:bake', sourceId: 'source', createdAt: 0, sampleInterval: 0.1,
    faceTracking: { sourceStart: 2, sourceEnd: 3, detectedFrames: 9, contours: [] },
    frames: Array.from({ length: 10 }, (_, i) => ({ time: 2 + i / 10, duration: 0.1, faces: i === 4 ? [] : [face], hands: [], poses: [] })),
  };
  landmarkRuntime.setSeries(series);
});
describe('baked face stabilization', () => {
  it('writes one undo batch, preserves unrelated keys and holds a missing detection', () => {
    expect(bakeFaceStabilization('bake', 'face', true, 0)).toBe(10);
    const keys = (fakes.state.clipKeyframes as Map<string, Keyframe[]>).get('bake')!;
    expect(keys).toContain(unrelated);
    expect(keys).toHaveLength(34);
    const x = keys.filter(k => k.property === 'position.x');
    expect(x[4].value).toBe(x[3].value);
    expect(fakes.start).toHaveBeenCalledOnce(); expect(fakes.end).toHaveBeenCalledOnce();
    expect(fakes.render).toHaveBeenCalledOnce();
  });
  it('replaces only the three stabilization channels when rebaked', () => {
    bakeFaceStabilization('bake', 'face', true, 0);
    bakeFaceStabilization('bake', 'face', true, 0);
    expect((fakes.state.clipKeyframes as Map<string, Keyframe[]>).get('bake')).toHaveLength(34);
  });
  it('rejects locked clips and wrong-source tracking without mutating', () => {
    fakes.state.tracks = [{ id: 'video', locked: true }];
    expect(() => bakeFaceStabilization('bake', 'face', true, 0)).toThrow('locked');
    fakes.state.tracks = [{ id: 'video', locked: false }];
    fakes.state.clips = [{ ...clip, source: { type: 'video', mediaFileId: 'other' } }];
    expect(() => bakeFaceStabilization('bake', 'face', true, 0)).toThrow('Track this face');
    expect(fakes.start).not.toHaveBeenCalled();
  });
});
