import { beforeEach, describe, expect, it } from 'vitest';

import {
  applySceneEffectorsToObjectTransform,
  collectActiveSceneSplatEffectors,
  resolveSceneEffectorAxis,
  resolveSceneEffectorsEnabled,
} from '../../src/engine/scene/SceneEffectorUtils';
import type { SceneSplatEffectorRuntimeData } from '../../src/engine/scene/types';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();

function createEffector(overrides: Partial<SceneSplatEffectorRuntimeData> = {}): SceneSplatEffectorRuntimeData {
  return {
    clipId: 'effector-1',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    radius: 2,
    mode: 'repel',
    strength: 100,
    falloff: 1,
    speed: 1,
    seed: 0,
    time: 0,
    ...overrides,
  };
}

describe('SceneEffectorUtils', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('treats undefined as enabled and false as disabled', () => {
    expect(resolveSceneEffectorsEnabled(undefined)).toBe(true);
    expect(resolveSceneEffectorsEnabled(true)).toBe(true);
    expect(resolveSceneEffectorsEnabled(false)).toBe(false);
  });

  it('resolves the default effector axis along positive z', () => {
    expect(resolveSceneEffectorAxis({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('repels objects away from the effector center', () => {
    const result = applySceneEffectorsToObjectTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }, [createEffector()], 'layer-a');

    expect(result.position.x).toBeGreaterThan(1);
    expect(result.position.y).toBeCloseTo(0, 6);
  });

  it('adds rotational influence for swirl mode', () => {
    const result = applySceneEffectorsToObjectTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }, [createEffector({ mode: 'swirl', time: 1.25 })], 'layer-b');

    expect(Math.abs(result.rotation.z)).toBeGreaterThan(0.1);
  });

  it('collects active effectors from an explicit nested scene context', () => {
    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [],
      clips: [],
      clipKeyframes: new Map(),
    } as any);

    const effectors = collectActiveSceneSplatEffectors(1920, 1080, 2, {
      tracks: [{
        id: 'nested-track',
        type: 'video',
        visible: true,
      }],
      clips: [{
        id: 'parent-clip',
        trackId: 'nested-track',
        startTime: 0,
        duration: 10,
        transform: {
          position: { x: 0.25, y: 0.1, z: 0.5 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          opacity: 1,
          blendMode: 'normal',
        },
        source: {
          type: 'solid',
        },
      }, {
        id: 'nested-effector',
        parentClipId: 'parent-clip',
        trackId: 'nested-track',
        startTime: 1,
        duration: 4,
        transform: {
          position: { x: 0.4, y: -0.25, z: 1.5 },
          scale: { x: 0.4, y: 0.6, z: 0.8 },
          rotation: { x: 10, y: 20, z: 30 },
          opacity: 1,
          blendMode: 'normal',
        },
        source: {
          type: 'splat-effector',
          splatEffectorSettings: {
            mode: 'swirl',
            strength: 55,
            falloff: 1.2,
            speed: 2,
            seed: 7,
          },
        },
      }],
      clipKeyframes: new Map([
        ['nested-effector', [
          {
            id: 'nested-effector-kf-1',
            clipId: 'nested-effector',
            property: 'position.x',
            time: 0,
            value: 0.4,
            easing: 'linear',
          },
          {
            id: 'nested-effector-kf-2',
            clipId: 'nested-effector',
            property: 'position.x',
            time: 2,
            value: 0.6,
            easing: 'linear',
          },
        ]],
      ]),
    });

    expect(effectors).toHaveLength(1);
    expect(effectors[0]).toMatchObject({
      clipId: 'nested-effector',
      mode: 'swirl',
      strength: 55,
      falloff: 1.2,
      speed: 2,
      seed: 7,
      time: 1,
      position: {
        x: 1.3333333333333333,
        y: 0.15,
        z: 2,
      },
      rotation: {
        x: 10,
        y: 20,
        z: 30,
      },
      scale: {
        x: 0.4,
        y: 0.6,
        z: 1,
      },
      radius: 1,
    });
  });
});
