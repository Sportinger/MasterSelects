import { describe, expect, it, vi } from 'vitest';
import { splitLayerEffects } from '../../src/engine/render/layerEffectStack';
import { createDefaultInvertImageGraph, compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { invert } from '../../src/effects/color/invert';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createOperatorCompositePipeline } from '../../src/engine/pipeline/compositor/operatorPipeline';

describe('image graph render integration', () => {
  const effect = () => ({ id: 'invert-test', type: 'invert', name: 'Invert', enabled: true, params: {} });

  it('keeps legacy invert in the existing composite pass and shares lowering with ordered chains', () => {
    const legacy = effect();
    const stack = splitLayerEffects([legacy]);
    expect(stack.complexEffects).toBeUndefined();
    expect(stack.inlineEffects.invert).toBe(false);
    const definition = imageGraphDefinition(legacy, invert as FullscreenEffectDefinition);
    expect(definition.shader).toContain(stack.inlineEffects.operatorProgram!.wgsl);
    expect(splitLayerEffects([legacy], false, true).complexEffects).toEqual([legacy]);
  });

  it('changes both execution paths when output is rewired directly to the input', () => {
    const graph = createDefaultInvertImageGraph();
    graph.edges = graph.edges.filter(edge => edge.to !== 'output');
    graph.edges.push({ id: 'direct', from: 'frame', output: 'image', to: 'output', input: 'image' });
    const edited = { ...effect(), operatorGraph: graph };
    const program = splitLayerEffects([edited]).inlineEffects.operatorProgram!;
    expect(program.key).not.toBe(splitLayerEffects([effect()]).inlineEffects.operatorProgram!.key);
    expect(program.wgsl).not.toContain('vec3f(1.0) -');
    expect(imageGraphDefinition(edited, invert as FullscreenEffectDefinition).shader).toContain(program.wgsl);
  });

  it.each([false, true])('specializes existing composite shader with no texture/pass allocation (external=%s)', external => {
    const createShaderModule = vi.fn(() => ({}));
    const createRenderPipeline = vi.fn(() => ({}));
    const device = { createShaderModule, createRenderPipeline, createPipelineLayout: vi.fn(() => ({})) } as unknown as GPUDevice;
    const program = compileImageOperatorGraph(createDefaultInvertImageGraph());
    createOperatorCompositePipeline(device, {} as GPUBindGroupLayout, external, program.wgsl);
    expect(createShaderModule.mock.calls[0][0].code).toContain('layerColor = evaluateImageGraph(layerColor);');
    expect(createRenderPipeline).toHaveBeenCalledTimes(1);
  });
});
