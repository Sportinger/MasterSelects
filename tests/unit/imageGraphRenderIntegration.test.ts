import { describe, expect, it, vi } from 'vitest';
import { splitLayerEffects } from '../../src/engine/render/layerEffectStack';
import { createDefaultInvertImageGraph, compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { invert } from '../../src/effects/color/invert';
import { brightness } from '../../src/effects/color/brightness';
import { contrast } from '../../src/effects/color/contrast';
import { saturation } from '../../src/effects/color/saturation';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createOperatorCompositePipeline } from '../../src/engine/pipeline/compositor/operatorPipeline';

const colorDefinitions = { brightness, contrast, saturation } as const;

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

  it.each([
    ['brightness', 0.25],
    ['contrast', 0],
    ['saturation', 0],
  ] as const)('uses the canonical %s graph in both inline and ordered paths, including zero amounts', (type, amount) => {
    const instance = { id: `${type}-test`, type, name: type, enabled: true, params: { amount } };
    const inline = splitLayerEffects([instance]).inlineEffects;
    expect(inline.operatorProgram?.key).toMatch(/^image-v1-/);
    expect(inline.brightness).toBe(0);
    expect(inline.contrast).toBe(1);
    expect(inline.saturation).toBe(1);
    const ordered = imageGraphDefinition(instance, colorDefinitions[type] as FullscreenEffectDefinition);
    expect(ordered.shader).toContain(inline.operatorProgram!.wgsl);
    expect(ordered.shader).toContain(`fn ${colorDefinitions[type].entryPoint}`);
    expect(splitLayerEffects([instance, effect()]).complexEffects).toEqual([instance, effect()]);
  });

  it.each(['brightness', 'contrast', 'saturation'] as const)('keeps legacy %s defaults when amount is absent', type => {
    const instance = { id: `${type}-default`, type, name: type, enabled: true, params: {} };
    const plan = splitLayerEffects([instance]).inlineEffects.operatorProgram!;
    const pixel: [number, number, number, number] = [0.2, 0.4, 0.8, 0.35];
    expect(evaluateImageOperatorPlan(plan, pixel)).toEqual(pixel);
  });

  it('pauses an incomplete graph instead of silently rendering the legacy effect', () => {
    const graph = createDefaultInvertImageGraph();
    graph.incomplete = 'Reconnect the output';
    const instance = { ...effect(), operatorGraph: graph };
    expect(splitLayerEffects([instance]).inlineEffects.operatorProgram).toBeUndefined();
    expect(() => imageGraphDefinition(instance, invert as FullscreenEffectDefinition)).toThrow('incomplete invert');
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
