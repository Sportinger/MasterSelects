import { afterEach, describe, expect, it } from 'vitest';
import { resolveSharedSceneCameraConfig } from '../../src/engine/scene/SceneCameraUtils';
import { resolveOrbitCameraFrame } from '../../src/engine/gaussian/core/SplatCameraUtils';
import { resolveSceneOrbitPosition } from '../../src/components/preview/previewSceneCameraMath';
import { captureCameraOrbit, cameraOrbitKeyframeFields } from '../../src/services/cameraOrbitCapture';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { Keyframe } from '../../src/types/keyframes';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const viewport = { width: 1920, height: 1080 };
const settings = { fov: 60, nearPlane: .1, farPlane: 1000, minimumDistance: 2 };
const pivot = { x: 3, y: -2, z: 1 };

function fixture(yaw = 90, pitch = 0, offset = { x: 0, y: 0, z: 5 }) {
  const pose = (t: number) => {
    const rotation = { x: pitch * t, y: yaw * t, z: 12 };
    const frame = resolveOrbitCameraFrame({ position: pivot, scale: { x: 1, y: 1 }, rotation }, settings, viewport);
    return { rotation, position: resolveSceneOrbitPosition(frame, pivot, offset) };
  };
  const clip = createMockClip({ id: 'orbit-camera', trackId: 'v', startTime: 0, duration: 4,
    source: { type: 'camera', cameraSettings: { fov: 60, near: .1, far: 1000 } },
    transform: { ...createMockClip().transform, ...pose(0) } });
  const keys: Keyframe[] = [];
  for (const t of [0, 1]) for (const group of ['position', 'rotation'] as const) for (const axis of ['x', 'y', 'z'] as const) {
    keys.push({ id: `${group}.${axis}.${t}`, clipId: clip.id, time: t * 4, property: `${group}.${axis}`, value: pose(t)[group][axis],
      easing: 'linear', ...(group === 'rotation' && t === 0 ? { rotationInterpolation: 'continuous' as const } : {}),
      ...(t === 1 ? { cameraOrbitPivot: { ...pivot } } : {}) });
  }
  const at = (t: number) => resolveSharedSceneCameraConfig(viewport, t * 4, { sceneNavClipId: clip.id,
    tracks: [createMockTrack({ id: 'v', type: 'video', visible: true })], clips: [clip], clipKeyframes: new Map([[clip.id, keys]]) });
  return { clip, keys, at, pose };
}

describe('recorded camera orbit paths', () => {
  it.each([[90, 0], [180, 0], [360, 0], [450, 35]])('replays an off-origin %s°/%s° orbit including off-axis framing', (yaw, pitch) => {
    const f = fixture(yaw, pitch, { x: 1.2, y: .8, z: 5 });
    for (const t of [0, .1, .5, .9, 1]) {
      const actual = f.at(t).position, expected = f.pose(t).position;
      expect(actual.x).toBeCloseTo(expected.x, 5); expect(actual.y).toBeCloseTo(expected.y, 5); expect(actual.z).toBeCloseTo(expected.z, 5);
      expect(Math.hypot(actual.x - pivot.x, actual.y - pivot.y, actual.z - pivot.z)).toBeCloseTo(Math.hypot(1.2, .8, 5), 5);
    }
    for (const key of f.keys) key.rotationInterpolation = 'shortest';
    const direct = f.at(.5).position, a = f.pose(0).position, b = f.pose(1).position;
    for (const axis of ['x', 'y', 'z'] as const) expect(direct[axis]).toBeCloseTo((a[axis] + b[axis]) / 2, 12);
  });

  it('recovers an old off-origin look-at orbit without adding metadata to the project', () => {
    const f = fixture(); f.keys.forEach(key => { delete key.cameraOrbitPivot; });
    const actual = f.at(.5).position, expected = f.pose(.5).position;
    expect(actual.x).toBeCloseTo(expected.x, 5); expect(actual.y).toBeCloseTo(expected.y, 5); expect(actual.z).toBeCloseTo(expected.z, 5);
  });

  it('records pivot metadata on the arriving pose and clears every axis when panning instead', () => {
    const f = fixture();
    useTimelineStore.setState({ clips: [f.clip], tracks: [createMockTrack({ id: 'v' })], clipKeyframes: new Map(), playheadPosition: 4 });
    captureCameraOrbit(f.clip.id, 4, pivot);
    for (const key of f.keys.filter(k => k.time === 4)) useTimelineStore.getState().addKeyframe(f.clip.id, key.property, key.value);
    const keys = useTimelineStore.getState().clipKeyframes.get(f.clip.id)!;
    expect(keys).toHaveLength(6); expect(keys.every(key => key.cameraOrbitPivot?.x === pivot.x)).toBe(true);
    expect(cameraOrbitKeyframeFields(f.clip.id, 3)).toBeUndefined();
    captureCameraOrbit(f.clip.id, 4);
    useTimelineStore.getState().addKeyframe(f.clip.id, 'position.x', 7);
    expect(useTimelineStore.getState().clipKeyframes.get(f.clip.id)!.every(key => !key.cameraOrbitPivot)).toBe(true);
  });
});
