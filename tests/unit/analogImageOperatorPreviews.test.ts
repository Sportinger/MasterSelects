import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileAnalogSignalGraph, compileAnalogSignalPreview, createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';
import { compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { captureAnalogImageOperatorPreviews } from '../../src/services/nodePreview/analogImageOperatorPreviews';
import { analogSignalPreviewStage } from '../../src/services/nodePreview/analogSignalPreviewStages';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';

const compiledStage = () => compileAnalogSignalGraph(createDefaultAnalogSignalGraph(), {}).stages.find(item => item.kind === 'resolve' && item.imagePreview)!;
const outputTarget = (stage: ReturnType<typeof compiledStage>, type: 'number' | 'rgb') => {
  for (const node of stage.imagePreview!.graph.nodes) {
    const port = getEffectOperator(node.operator)?.outputs.find(output => output.type === type);
    if (port) return { effectId: 'analog', nodeId: node.id, direction: 'output' as const, portId: port.id };
  }
  throw new Error(`Default Analog image island has no ${type} output.`);
};
function gpu() {
  const texture = { createView: vi.fn(() => ({ preview: true })), destroy: vi.fn() };
  const device = { lost: new Promise<never>(() => {}), createTexture: vi.fn(() => texture) };
  return { device, texture };
}

describe('Analog flat-island image previews', () => {
  beforeEach(() => vi.stubGlobal('GPUTextureUsage', { STORAGE_BINDING: 8, TEXTURE_BINDING: 4 }));
  it('reuses the canonical extracted island with stable target node ids for scalar and RGB previews', () => {
    const stage = compiledStage();
    expect(stage?.imagePreview).toBeDefined();
    const compilation = stage!.imagePreview!;
    const scalar = compileImageOperatorPreview(compilation.graph, compilation.params, outputTarget(stage, 'number'), compilation.context);
    const rgb = compileImageOperatorPreview(compilation.graph, compilation.params, outputTarget(stage, 'rgb'), compilation.context);
    expect(scalar.passes).toBeUndefined(); expect(rgb.passes).toBeUndefined();
    expect((scalar.resourceInputs ?? []).every(id => id === 'source' || id === 'decoded')).toBe(true);
    expect((rgb.resourceInputs ?? []).every(id => id === 'source' || id === 'decoded')).toBe(true);
  });

  it('does not allocate without demand and skips the final producer handled by the stage tap', () => {
    const stage = compiledStage(), mock = gpu(), encode = vi.fn();
    const matching = vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([]);
    const encodePlan = vi.fn();
    expect(captureAnalogImageOperatorPreviews({ effect: { id: 'analog', params: {} }, stage, inputs: { width: 320, height: 180, encode, encodePlan },
      device: mock.device as never, encoder: {} as never, sampler: {} as never })).toBe(0);
    expect(mock.device.createTexture).not.toHaveBeenCalled();
    const finalNode = stage.imagePreview!.graph.nodes.find(node => node.id === stage.nodeId)!;
    const port = getEffectOperator(finalNode.operator)!.outputs[0];
    const target = { effectId: 'analog', nodeId: stage.nodeId, direction: 'output' as const, portId: port.id };
    matching.mockReturnValue([{ stage: analogSignalPreviewStage(target), request: {} as never }]);
    expect(captureAnalogImageOperatorPreviews({ effect: { id: 'analog', params: {} }, stage, inputs: { width: 320, height: 180, encode, encodePlan },
      device: mock.device as never, encoder: {} as never, sampler: {} as never })).toBe(0);
    expect(encode).not.toHaveBeenCalled(); expect(mock.device.createTexture).not.toHaveBeenCalled(); matching.mockRestore();
  });

  it('encodes and captures a demanded target while reusing its scratch texture', () => {
    const stage = compiledStage(), target = outputTarget(stage, 'rgb'), previewStage = analogSignalPreviewStage(target), mock = gpu(), encode = vi.fn();
    const matching = vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage: previewStage, request: {} as never }]);
    const capture = vi.spyOn(nodePreviewTextureTap, 'capture').mockImplementation(() => {});
    const options = { effect: { id: 'analog', params: {} }, stage, inputs: { width: 320, height: 180, encode, encodePlan: vi.fn() }, device: mock.device as never,
      encoder: {} as never, sampler: {} as never };
    expect(captureAnalogImageOperatorPreviews(options)).toBe(1);
    expect(captureAnalogImageOperatorPreviews(options)).toBe(1);
    expect(mock.device.createTexture).toHaveBeenCalledTimes(1); expect(encode).toHaveBeenCalledTimes(2); expect(capture).toHaveBeenCalledTimes(2);
    matching.mockRestore(); capture.mockRestore();
  });

  it('compiles and dispatches a disconnected target through a demand-only specialized Analog plan', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.push({ id: 'detached-a', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .25 } },
      { id: 'detached-b', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .5 } },
      { id: 'detached-add', operator: 'math.add.scalar', operatorVersion: 1, bindings: {} });
    graph.edges.push({ id: 'detached-a-add', from: 'detached-a', output: 'value', to: 'detached-add', input: 'a' },
      { id: 'detached-b-add', from: 'detached-b', output: 'value', to: 'detached-add', input: 'b' });
    graph.layout['detached-a'] = { x: 0, y: 0 }; graph.layout['detached-b'] = { x: 0, y: 100 }; graph.layout['detached-add'] = { x: 200, y: 0 };
    const stage = compileAnalogSignalGraph(graph, {}).stages.find(item => item.kind === 'resolve' && item.imagePreview)!;
    const target = { effectId: 'analog', nodeId: 'detached-add', direction: 'output' as const, portId: 'value' };
    const previewStage = analogSignalPreviewStage(target), mock = gpu(), encode = vi.fn(), encodePlan = vi.fn();
    const matching = vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage: previewStage, request: {} as never }]);
    const capture = vi.spyOn(nodePreviewTextureTap, 'capture').mockImplementation(() => {});
    expect(captureAnalogImageOperatorPreviews({ effect: { id: 'analog', params: {}, operatorGraph: graph }, stage,
      inputs: { width: 320, height: 180, encode, encodePlan }, device: mock.device as never, encoder: {} as never, sampler: {} as never })).toBe(1);
    expect(encode).not.toHaveBeenCalled(); expect(encodePlan).toHaveBeenCalledTimes(1); expect(capture).toHaveBeenCalledTimes(1);
    const [specializedPlan, specializedStage, program] = encodePlan.mock.calls[0];
    expect(specializedStage.imagePreview.graph.nodes.some((node: { id: string }) => node.id === 'detached-add')).toBe(true);
    expect(program.resourceInputs ?? []).toEqual([]); expect(specializedPlan.passthrough).toBe(false);
    matching.mockRestore(); capture.mockRestore();
  });

  it('normalizes disconnected input targets and projects every image-preview-supported value type', () => {
    const graph = createDefaultAnalogSignalGraph();
    graph.nodes.push({ id: 'preview-number', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .25 } },
      { id: 'preview-add', operator: 'math.add.scalar', operatorVersion: 1, bindings: {} },
      { id: 'preview-bool', operator: 'values.boolean', operatorVersion: 1, bindings: {}, constants: { value: true } },
      { id: 'preview-vec2', operator: 'convert.scalar-to-vec2', operatorVersion: 1, bindings: {} },
      { id: 'preview-vec3', operator: 'vector.combine.vec3', operatorVersion: 1, bindings: {} });
    graph.edges.push({ id: 'preview-number-add-a', from: 'preview-number', output: 'value', to: 'preview-add', input: 'a' },
      { id: 'preview-number-add-b', from: 'preview-number', output: 'value', to: 'preview-add', input: 'b' },
      { id: 'preview-number-vec2', from: 'preview-number', output: 'value', to: 'preview-vec2', input: 'value' },
      ...['x', 'y', 'z'].map(id => ({ id: `preview-number-vec3-${id}`, from: 'preview-number', output: 'value', to: 'preview-vec3', input: id })));
    for (const [index, id] of ['preview-number', 'preview-add', 'preview-bool', 'preview-vec2', 'preview-vec3'].entries()) graph.layout[id] = { x: index * 100, y: 0 };
    expect(compileAnalogSignalPreview(graph, {}, { nodeId: 'preview-add', direction: 'input', portId: 'a' }).program).toBeDefined();
    for (const [nodeId, portId] of [['preview-bool', 'value'], ['preview-vec2', 'value'], ['preview-vec3', 'value']] as const) {
      const result = compileAnalogSignalPreview(graph, {}, { nodeId, direction: 'output', portId });
      expect(result.program.passes).toBeUndefined();
    }
  });
});
