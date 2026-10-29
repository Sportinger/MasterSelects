import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGpuPipelineFailures, getGpuPipelineFailures, guardGpuDevice } from '../../src/engine/core/gpuPipelineGuard';
import { FlockFluidGrid } from '../../src/engine/flock/gpu/FlockFluidGrid';
import { FlockGpuPipelines } from '../../src/engine/flock/gpu/FlockGpuPipelines';
import { FlockGpuSession } from '../../src/engine/flock/gpu/FlockGpuSession';
import { awaitFlockPipelines } from '../../src/engine/flock/gpu/flockPipelineGate';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import { fluidProgram, safariDevice, stubFlockGpuGlobals } from '../fixtures/flockSafariDevice';

const context = { keyframesByProperty: indexFlockKeyframes([]) };

beforeEach(() => {
  stubFlockGpuGlobals();
  clearGpuPipelineFailures('editor');
});
afterEach(() => { vi.unstubAllGlobals(); clearGpuPipelineFailures('editor'); });

describe('flock pipeline verdict gate', () => {
  it('reproduces the production failure when a frame encodes a pipeline before its verdict', () => {
    const { device, errors } = safariDevice(/fluidP2GBlock/);
    guardGpuDevice(device, 'editor');
    const states = [device.createBuffer({ size: 257 * 64, usage: 0 })];
    const grid = new FlockFluidGrid(device, fluidProgram().fluid!, states, 1, { dispatchWidth: 2 });
    const encoder = device.createCommandEncoder();
    grid.encode(encoder, 0, 0, 257);
    encoder.finish();
    expect(errors).toContain('encoder state is invalid');
  });

  it('a fluid grid that owns its particle order encodes nothing before its first encode', () => {
    const { device, pipelinesSet, finishedEncoders } = safariDevice(/^$/);
    const states = [device.createBuffer({ size: 257 * 64, usage: 0 })];
    const grid = new FlockFluidGrid(device, fluidProgram().fluid!, states, 1, { dispatchWidth: 2 });
    expect(device.createCommandEncoder).not.toHaveBeenCalled();
    expect(device.queue.submit).not.toHaveBeenCalled();
    const encoder = device.createCommandEncoder({ label: 'frame' });
    grid.encode(encoder, 0, 0, 257);
    encoder.finish();
    expect(pipelinesSet[0]).toBe('flock-order-resetMapping');
    expect(pipelinesSet.filter(label => label === 'flock-order-resetMapping')).toHaveLength(1);
    expect(finishedEncoders).toEqual(['frame']);
    grid.encode(device.createCommandEncoder(), 0, 0, 257);
    expect(pipelinesSet.filter(label => label === 'flock-order-resetMapping')).toHaveLength(1);
  });

  it('waits for verdicts, then runs the reference transfer when the block transfer is rejected', async () => {
    const { device, errors, pipelinesSet, finishedEncoders } = safariDevice(/fluidP2GBlock/);
    guardGpuDevice(device, 'editor');
    const session = new FlockGpuSession(device, new FlockGpuPipelines(device), fluidProgram(), context);
    expect(session.pipelineState).toBe('pending');
    expect(session.advanceTo(3, 3)).toBe(false);
    expect(finishedEncoders).not.toContain('flock-steps');

    await expect(session.whenPipelinesSettled()).resolves.toBe('ready');
    expect(session.pipelineFallbacks.map(failure => failure.label)).toEqual(['flock-fluidP2GBlock']);
    expect(session.advanceTo(3, 3)).toBe(true);
    expect(finishedEncoders).toContain('flock-steps');
    expect(pipelinesSet).toContain('flock-fluidP2G');
    expect(pipelinesSet).not.toContain('flock-fluidP2GBlock');
    expect(errors).toEqual([]);
    // A fallback is a warning, not a "feature skipped" notice.
    expect(getGpuPipelineFailures()).toEqual([]);
    session.dispose();
  });

  it('never encodes a session whose required pipeline was rejected and reports it once', async () => {
    const { device, errors, finishedEncoders } = safariDevice(/^flock-simulate$/);
    guardGpuDevice(device, 'editor');
    const session = new FlockGpuSession(device, new FlockGpuPipelines(device), fluidProgram(), context);
    await expect(session.whenPipelinesSettled()).resolves.toBe('failed');
    expect(session.pipelineFailure).toMatchObject({ label: 'flock-simulate', kind: 'validation' });
    expect(session.advanceTo(3, 3)).toBe(false);
    expect(() => session.encodeLinks(device.createCommandEncoder() as unknown as GPUCommandEncoder, { branchIndex: 0, radius: 4, perParticle: 2, fraction: 1, salt: 1 }))
      .toThrow(/pipelines are failed/);
    expect(finishedEncoders).not.toContain('flock-steps');
    expect(errors).toEqual([]);
    await expect(awaitFlockPipelines(session)).rejects.toThrow(/flock-simulate .*does not run on this device.*program_source:812:21: error/);
    expect(getGpuPipelineFailures().map(record => record.label)).toEqual(['flock-simulate']);
    session.dispose();
  });

  it('works on an unguarded device through its own error scopes', async () => {
    const { device, errors } = safariDevice(/fluidP2GBlock/);
    const session = new FlockGpuSession(device, new FlockGpuPipelines(device), fluidProgram(), context);
    await expect(session.whenPipelinesSettled()).resolves.toBe('ready');
    expect(session.pipelineFallbacks).toHaveLength(1);
    expect(session.advanceTo(2, 2)).toBe(true);
    expect(errors).toEqual([]);
    session.dispose();
  });
});
