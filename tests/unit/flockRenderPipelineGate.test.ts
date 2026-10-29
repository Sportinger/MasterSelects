import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGpuPipelineFailures, guardGpuDevice } from '../../src/engine/core/gpuPipelineGuard';
import { FlockBranchRenderer, type FlockDrawPlan } from '../../src/engine/flock/gpu/FlockBranchRenderer';
import { FlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';
import { FlockSimulationRuntime } from '../../src/engine/flock/runtime/FlockSimulationRuntime';
import type { FlockSimulationHost } from '../../src/engine/flock/runtime/flockSimulationHost';
import { indexFlockKeyframes, resolveFlockRender } from '../../src/services/flock/compiler/flockParamEvaluation';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import type { SceneCamera } from '../../src/engine/scene/types';
import { fluidProgram, safariDevice, stubFlockGpuGlobals } from '../fixtures/flockSafariDevice';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';

vi.mock('../../src/engine/flock/runtime/flockCheckpointStore', () => ({
  flockCheckpointStore: { listSteps: async () => [], get: async () => null, pruneClip: async () => undefined },
}));

const context = { keyframesByProperty: indexFlockKeyframes([]) };
const assets = { model: () => ({}), pigment: () => ({ view: {} as GPUTextureView, sampler: {} as GPUSampler }) };

function sceneInputs() {
  const { payload } = nativeSceneFixture();
  const layer = payload.layers[0];
  if (layer.kind !== 'flock') throw new Error('fixture has no flock layer');
  const compiled = compileFlockDefinition(layer.definition);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const camera = { ...payload.camera, viewMatrix: new Float32Array(payload.camera.viewMatrix),
    projectionMatrix: new Float32Array(payload.camera.projectionMatrix) } as SceneCamera;
  return { program: compiled.program, camera, worldMatrix: new Float32Array(layer.worldMatrix) };
}

function host(requestRender = vi.fn()): FlockSimulationHost {
  return {
    requestRender, renderAssets: () => assets, audioSampler: () => () => null, audioRevision: () => 0,
    audioFingerprint: () => '', modelState: () => null,
    status: { getStatus: () => null, publishStatus: () => undefined, clearStatus: () => undefined },
  };
}

beforeEach(() => { stubFlockGpuGlobals(); clearGpuPipelineFailures('editor'); });
afterEach(() => { vi.unstubAllGlobals(); clearGpuPipelineFailures('editor'); });

describe('flock renderer pipeline verdicts', () => {
  // The renderer encodes point-cache, rasterizer and render pipelines into the shared
  // frame encoder. One of them rejected before its verdict would lose the whole frame.
  it('draws nothing until the frame pipelines have verdicts, then a rejected one is skipped without invalidating the frame', async () => {
    const { device, errors, pipelinesSet } = safariDevice(/^flock-cachePoints$/);
    guardGpuDevice(device, 'editor');
    const { program, camera, worldMatrix } = sceneInputs();
    const pipelines = new FlockGpuPipelines(device);
    const session = new FlockGpuSession(device, pipelines, program, context);
    await expect(session.whenPipelinesSettled()).resolves.toBe('ready');
    expect(session.advanceTo(1, 1)).toBe(true);
    const settled = vi.fn();
    const renderer = new FlockBranchRenderer(device, pipelines, assets, settled);
    const plan: FlockDrawPlan = { layer: { clipId: 'particles', worldMatrix }, session, program,
      render: resolveFlockRender(program, 0, context), alpha: 1, links: new Map() };
    const frame = () => {
      pipelinesSet.length = 0;
      const encoder = device.createCommandEncoder({ label: 'frame' });
      expect(renderer.render(encoder, {} as GPUTextureView, {} as GPUTextureView, [plan], camera, 'opaque', [])).toBe(true);
      expect(renderer.render(encoder, {} as GPUTextureView, {} as GPUTextureView, [plan], camera, 'transparent', [])).toBe(true);
      encoder.finish();
    };

    frame();
    expect(pipelinesSet).toEqual([]);
    await vi.waitFor(() => expect(settled).toHaveBeenCalled());

    frame();
    expect(pipelinesSet.length).toBeGreaterThan(0);
    expect(pipelinesSet).not.toContain('flock-cachePoints');
    expect(errors).toEqual([]);
    session.dispose();
  });

  it('holds path traced spheres until their pipelines have verdicts', async () => {
    const { device } = safariDevice(/^$/);
    guardGpuDevice(device, 'editor');
    const { program, camera, worldMatrix } = sceneInputs();
    const pipelines = new FlockGpuPipelines(device);
    const session = new FlockGpuSession(device, pipelines, program, context);
    await session.whenPipelinesSettled();
    const settled = vi.fn();
    const renderer = new FlockBranchRenderer(device, pipelines, assets, settled);
    const plan: FlockDrawPlan = { layer: { clipId: 'particles', worldMatrix }, session, program,
      render: resolveFlockRender(program, 0, context), alpha: 1, links: new Map() };
    expect(renderer.pathTracePoints([plan], camera)).toEqual([]);
    await vi.waitFor(() => expect(settled).toHaveBeenCalled());
    expect(renderer.pathTracePoints([plan], camera)).toHaveLength(1);
    session.dispose();
  });
});

describe('flock runtime pipeline state', () => {
  it('a particle sample waits for pending verdicts and a pipeline hold resolves once ready', async () => {
    const { device } = safariDevice(/fluidP2GBlock/);
    guardGpuDevice(device, 'editor');
    const runtime = new FlockSimulationRuntime(host());
    const entry = runtime.acquire(device, 'clip', 'preview', fluidProgram(), [])!;
    expect(entry.session.pipelineState).toBe('pending');
    const hold = runtime.pipelineHold('clip', 'preview');
    expect(hold).not.toBeNull();
    await expect(runtime.sampleParticles('clip', { maxCount: 4 })).resolves.toMatchObject({ clipId: 'clip', count: 4 });
    await expect(hold).resolves.toBeUndefined();
    expect(runtime.pipelineHold('clip', 'preview')).toBeNull();
    runtime.dispose();
  });

  it('a particle sample and a pipeline hold carry the readable failure of a rejected required pipeline', async () => {
    const { device } = safariDevice(/^flock-simulate$/);
    guardGpuDevice(device, 'editor');
    const runtime = new FlockSimulationRuntime(host());
    runtime.acquire(device, 'clip', 'preview', fluidProgram(), []);
    const failure = /flock-simulate \(validation\); the simulation does not run on this device/;
    await expect(runtime.sampleParticles('clip', { maxCount: 4 })).rejects.toThrow(failure);
    await expect(runtime.pipelineHold('clip', 'preview')).rejects.toThrow(failure);
    await expect(runtime.sampleParticles('missing', { maxCount: 4 })).resolves.toBeNull();
    runtime.dispose();
  });
});
