import { describe, expect, it } from 'vitest';
import { validateWorkerGpuFrameStackContract } from '../../src/services/render/workerGpuFrameStackContract';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';

describe('native scene frame-stack admission', () => {
  it('admits a frozen Flock scene in an ordered mixed stack', () => {
    const { stack, admission } = nativeSceneFixture();
    expect(validateWorkerGpuFrameStackContract(structuredClone(stack), admission).ok).toBe(true);
  });
  it.each(['clock', 'camera', 'matrix', 'duplicate', 'handle', 'graph', 'unsupported', 'keyframe'])('rejects invalid %s before GPU execution', kind => {
    const { stack, admission, payload } = nativeSceneFixture();
    const data = payload as any;
    if (kind === 'clock') data.timelineTime += 1;
    if (kind === 'camera') data.camera.viewport.width = 128;
    if (kind === 'matrix') data.layers[0].worldMatrix[0] = 1e100;
    if (kind === 'duplicate') data.layers.push(structuredClone(data.layers[0]));
    if (kind === 'handle') data.layers[0].definition.runtime = new Map();
    if (kind === 'graph') data.layers[0].definition.version = 999;
    if (kind === 'unsupported') data.layers[0].kind = 'video';
    if (kind === 'keyframe') data.layers[0].keyframes.push({ id: 'key', clipId: 'other', property: 'flock.node.sim.speed', time: 0, value: 1, easing: 'linear' });
    expect(validateWorkerGpuFrameStackContract(stack, admission).ok).toBe(false);
  });
  it('rejects accessors without invoking them', () => {
    const { stack, admission, payload } = nativeSceneFixture();
    let called = false;
    Object.defineProperty(payload.camera, 'fov', { enumerable: true, get: () => { called = true; return 45; } });
    expect(validateWorkerGpuFrameStackContract(stack, admission).ok).toBe(false);
    expect(called).toBe(false);
  });
});
