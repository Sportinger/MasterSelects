import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCENE_NAV_FPS_MOVE_SPEED_STEPS,
  getSceneNavFpsMoveSpeedStepIndex,
  snapSceneNavFpsMoveSpeed,
  stepSceneNavFpsMoveSpeed,
  useEngineStore,
} from '../../src/stores/engineStore';

const initialEngineState = useEngineStore.getState();

describe('scene nav FPS movement speed', () => {
  beforeEach(() => {
    useEngineStore.setState(initialEngineState);
  });

  it('uses ten fine steps up to 1x and eight faster steps up to 8x', () => {
    expect([...SCENE_NAV_FPS_MOVE_SPEED_STEPS.slice(0, 10)]).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.5,
      0.6, 0.7, 0.8, 0.9, 1,
    ]);
    expect([...SCENE_NAV_FPS_MOVE_SPEED_STEPS.slice(10)]).toEqual([
      1.5, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('snaps arbitrary speeds to the nearest speed step', () => {
    expect(getSceneNavFpsMoveSpeedStepIndex(0.36)).toBe(3);
    expect(snapSceneNavFpsMoveSpeed(0.96)).toBe(1);
    expect(snapSceneNavFpsMoveSpeed(1.35)).toBe(1.5);
    expect(snapSceneNavFpsMoveSpeed(Number.NaN)).toBe(1);
  });

  it('steps speed up and down with clamping', () => {
    expect(stepSceneNavFpsMoveSpeed(1, 1)).toBe(1.5);
    expect(stepSceneNavFpsMoveSpeed(1, -1)).toBe(0.9);
    expect(stepSceneNavFpsMoveSpeed(8, 1)).toBe(8);
    expect(stepSceneNavFpsMoveSpeed(0.1, -1)).toBe(0.1);
  });

  it('snaps store updates to the speed ladder', () => {
    useEngineStore.getState().setSceneNavFpsMoveSpeed(1.35);
    expect(useEngineStore.getState().sceneNavFpsMoveSpeed).toBe(1.5);
  });
});
