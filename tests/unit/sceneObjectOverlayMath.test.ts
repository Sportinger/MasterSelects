import { describe, expect, it } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { collectPreviewSceneObjects, projectWorldToCanvas } from '../../src/components/preview/sceneObjectOverlayMath';
import { resolveRenderableSharedSceneCamera } from '../../src/engine/scene/SceneCameraUtils';

function makeClip(partial: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'clip',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.dat'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'gaussian-splat' },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    masks: [],
    ...partial,
  };
}

const tracks: TimelineTrack[] = [{
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  clips: [],
  visible: true,
  muted: false,
  locked: false,
}];

describe('sceneObjectOverlayMath', () => {
  it('projects world origin into the canvas', () => {
    const camera = resolveRenderableSharedSceneCamera({ width: 1920, height: 1080 }, 0);
    const screen = projectWorldToCanvas({ x: 0, y: 0, z: 0 }, camera, { width: 960, height: 540 });

    expect(screen.visible).toBe(true);
    expect(screen.x).toBeCloseTo(480, 0);
    expect(screen.y).toBeCloseTo(270, 0);
  });

  it('collects active scene objects only from visible video tracks and skips cameras', () => {
    const clips = [
      makeClip({ id: 'active-splat', name: 'Splat' }),
      makeClip({ id: 'future-splat', startTime: 20 }),
      makeClip({
        id: 'camera',
        name: 'Camera',
        source: { type: 'camera', cameraSettings: { fov: 50, near: 0.1, far: 1000 } },
      }),
    ];

    const { objects } = collectPreviewSceneObjects({
      clips,
      tracks,
      clipKeyframes: new Map(),
      playheadPosition: 1,
      viewport: { width: 1920, height: 1080 },
      canvasSize: { width: 960, height: 540 },
    });

    expect(objects.map((object) => object.clipId).toSorted()).toEqual(['active-splat']);
  });

  it('maps effector transform into shared scene space', () => {
    const clips = [
      makeClip({
        id: 'effector',
        source: { type: 'splat-effector' },
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0.5, y: 0.25, z: 2 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      }),
    ];

    const { objects } = collectPreviewSceneObjects({
      clips,
      tracks,
      clipKeyframes: new Map(),
      playheadPosition: 1,
      viewport: { width: 1920, height: 1080 },
      canvasSize: { width: 960, height: 540 },
    });

    expect(objects[0]?.kind).toBe('effector');
    expect(objects[0]?.worldPosition.x).toBeCloseTo(0.8889, 3);
    expect(objects[0]?.worldPosition.y).toBeCloseTo(-0.25, 3);
    expect(objects[0]?.worldPosition.z).toBe(2);
  });
});
