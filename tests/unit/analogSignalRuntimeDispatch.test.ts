import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalogSignalRuntime } from '../../src/effects/analog/signal-lab/AnalogSignalRuntime';
import { getEffect } from '../../src/effects';
import { isComputeEffectDefinition } from '../../src/effects/types';
import { compileAnalogSignalGraph, createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';

function harness() {
  const labels: string[] = [], dispatches: number[][] = [];
  const pass = (label: string) => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(),
    dispatchWorkgroups: (...values: number[]) => dispatches.push(values), end: vi.fn(() => labels.push(label)) });
  const texture = () => ({ createView: vi.fn(() => ({})), destroy: vi.fn() });
  const buffer = () => ({ destroy: vi.fn() });
  const device = {
    queue: { writeBuffer: vi.fn() }, createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})), createComputePipeline: vi.fn(() => ({})), createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(texture), createBuffer: vi.fn(buffer),
  };
  const encoder = { beginComputePass: vi.fn(({ label }: { label: string }) => pass(label)) };
  return { device, encoder, labels, dispatches };
}

describe('Analog Signal graph runtime dispatch', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, STORAGE_BINDING: 8 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8 });
  });

  it('dispatches the reachable default graph in dependency order and fixed representation sizes', () => {
    const definition = getEffect('analog-signal-lab'); expect(isComputeEffectDefinition(definition)).toBe(true);
    if (!isComputeEffectDefinition(definition)) return;
    const graph = createDefaultAnalogSignalGraph(), plan = compileAnalogSignalGraph(graph, {}), gpu = harness();
    const rendered = new AnalogSignalRuntime(gpu.device as never).encode({ commandEncoder: gpu.encoder as never, definition, plan,
      instanceId: 'effect', inputView: {} as never, outputView: {} as never, width: 1920, height: 1080, timelineTimeSeconds: 2 });
    expect(rendered).toBe(true);
    expect(gpu.labels).toEqual(['analog-encode-encode', 'analog-rf-rf', 'analog-vhs-vhs', 'analog-analyze-analyze', 'analog-decode-decode', `analog-${plan.output}-image-resolve`]);
    expect(plan.stages.at(-1)?.imageProgram).toBeDefined();
    expect(gpu.dispatches).toEqual([[108, 40], [108, 40], [108, 40], [1, 313], [45, 36], [240, 135]]);
  });

  it('does no GPU work for direct frame output and omits bypassed RF/VHS stages', () => {
    const definition = getEffect('analog-signal-lab'); if (!isComputeEffectDefinition(definition)) return;
    const direct = createDefaultAnalogSignalGraph(); direct.nodes = direct.nodes.filter(node => node.id === 'frame' || node.id === 'output');
    direct.edges = [{ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' }];
    const gpu = harness(), runtime = new AnalogSignalRuntime(gpu.device as never);
    expect(runtime.encode({ commandEncoder: gpu.encoder as never, definition, plan: compileAnalogSignalGraph(direct, {}), instanceId: 'direct',
      inputView: {} as never, outputView: {} as never, width: 640, height: 360, timelineTimeSeconds: 0 })).toBe(false);
    expect(gpu.encoder.beginComputePass).not.toHaveBeenCalled();
    const bypass = createDefaultAnalogSignalGraph(); bypass.nodes.find(node => node.id === 'rf')!.bypassed = true; bypass.nodes.find(node => node.id === 'vhs')!.bypassed = true;
    const bypassPlan = compileAnalogSignalGraph(bypass, {});
    runtime.encode({ commandEncoder: gpu.encoder as never, definition, plan: bypassPlan, instanceId: 'bypass',
      inputView: {} as never, outputView: {} as never, width: 640, height: 360, timelineTimeSeconds: 0 });
    expect(gpu.labels).toEqual(['analog-encode-encode', 'analog-analyze-analyze', 'analog-decode-decode', `analog-${bypassPlan.output}-image-resolve`]);
  });
});
