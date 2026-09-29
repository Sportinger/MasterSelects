import { describe, expect, it } from 'vitest';
import type { FlockRuntimeStatus } from '../../src/engine/flock/runtime/flockRuntimeApi';
import { scenePreparationStatus } from '../../src/components/preview/scenePreparationStatus';
import { sceneModelLoadProgress } from '../../src/services/render/sceneModelLoadProgress';

const sim = (state: FlockRuntimeStatus['state'], step = 0, targetStep = 100) => ({
  name: 'Sculpture', status: { state, step, targetStep } as FlockRuntimeStatus,
});

describe('scene preparation progress', () => {
  it('reports real simulation work and clears when ready', () => {
    expect(scenePreparationStatus([sim('computing', 25)], [])?.percent).toBe(25);
    expect(scenePreparationStatus([sim('computing', 100)], [])?.percent).toBe(99);
    expect(scenePreparationStatus([sim('ready', 100)], [])).toBeNull();
  });
  it('does not invent a percentage before resources or compilation finish', () => {
    expect(scenePreparationStatus([{ name: 'Sculpture', status: null }], [])?.percent).toBeNull();
    expect(scenePreparationStatus([sim('compiling')], [])?.percent).toBeNull();
    expect(scenePreparationStatus([sim('invalid')], [])?.error).toBe(true);
  });
  it('tracks concurrent model loads separately and finishes each only once', () => {
    const first = sceneModelLoadProgress.begin('test:model', 'Model.glb');
    const second = sceneModelLoadProgress.begin('test:model', 'Model.glb');
    const matching = () => sceneModelLoadProgress.snapshot().filter(entry => entry.url === 'test:model');
    expect(matching()).toHaveLength(2);
    expect(scenePreparationStatus([], matching())?.label).toBe('Loading 3D model');
    first(); first();
    expect(matching()).toHaveLength(1);
    second();
    expect(matching()).toHaveLength(0);
  });
});
