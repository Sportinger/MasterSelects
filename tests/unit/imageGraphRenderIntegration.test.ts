import { describe, expect, it, vi } from 'vitest';
import { splitLayerEffects } from '../../src/engine/render/layerEffectStack';
import { createDefaultInvertImageGraph, compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imageGraphDefinition } from '../../src/effects/_shared/imageGraphDefinition';
import { invert } from '../../src/effects/color/invert';
import { brightness } from '../../src/effects/color/brightness';
import { contrast } from '../../src/effects/color/contrast';
import { saturation } from '../../src/effects/color/saturation';
import { exposure } from '../../src/effects/color/exposure';
import { levels } from '../../src/effects/color/levels';
import { hueShift } from '../../src/effects/color/hue-shift';
import { temperature } from '../../src/effects/color/temperature';
import { vibrance } from '../../src/effects/color/vibrance';
import { threshold } from '../../src/effects/stylize/threshold';
import { posterize } from '../../src/effects/stylize/posterize';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { createOperatorCompositePipeline } from '../../src/engine/pipeline/compositor/operatorPipeline';
import { createDefaultPointwiseEffectGraph } from '../../src/services/operators/pointwiseEffectGraphs';
import { createDefaultVignetteGraph } from '../../src/services/operators/contextualEffectGraphs';
import { vignette } from '../../src/effects/stylize/vignette';
import { scanlines } from '../../src/effects/stylize/scanlines';
import { pixelate } from '../../src/effects/distort/pixelate';

const colorDefinitions = { brightness, contrast, saturation, exposure, levels,
  'hue-shift': hueShift, temperature, vibrance } as const;
const pointwiseDefinitions = { threshold, posterize } as const;

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

  it('does not inherit legacy-only resource bindings into generated shaders', () => {
    const legacy = {
      ...(invert as FullscreenEffectDefinition), usesFeedback: true,
      passes: 3,
      glyphAtlas: () => ({ fontFamily: 'monospace', charset: 'x', cellSize: 32 }),
      byteTexture: () => ({ width: 1, height: 1, data: new Uint8Array(4), version: 'test' }), landmarkPoints: true,
    } as FullscreenEffectDefinition;
    const generated = imageGraphDefinition(effect(), legacy);
    expect(generated).toMatchObject({ usesFeedback: false });
    expect(generated.glyphAtlas).toBeUndefined();
    expect(generated.byteTexture).toBeUndefined();
    expect(generated.landmarkPoints).toBeUndefined();
    expect(generated.passes).toBeUndefined();
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
    expect(ordered.uniformSize).toBe(256);
    expect(ordered.packUniforms({}, 1920, 1080)?.[0]).toBe(amount);
    expect(ordered.shader).toContain(`fn ${colorDefinitions[type].entryPoint}`);
    expect(splitLayerEffects([instance, effect()]).complexEffects).toEqual([instance, effect()]);
  });

  it('retains posterize white overflow until the render-target format clamps it', () => {
    const plan = compileImageOperatorGraph(createDefaultPointwiseEffectGraph('posterize'), { levels: 6 });
    expect(evaluateImageOperatorPlan(plan, [1, 1, 1, 0.4])).toEqual([1.2, 1.2, 1.2, 0.4]);
  });

  it('keeps contextual graphs in a fullscreen pass and supplies fragment UV', () => {
    const instance = { id: 'vignette-test', type: 'vignette', name: 'Vignette', enabled: true, params: {} };
    expect(splitLayerEffects([instance]).complexEffects).toEqual([instance]);
    const definition = imageGraphDefinition(instance, vignette as FullscreenEffectDefinition);
    expect(definition.shader).toContain('evaluateImageGraph(textureSample(inputTex, texSampler, input.uv), input.uv, imageParameters)');
  });

  it('packs composition time after the shared parameter block without specializing the shader key', () => {
    const instance = { id: 'scanlines-time', type: 'scanlines', name: 'Scanlines', enabled: true, params: {} };
    const atTwo = imageGraphDefinition(instance, scanlines as FullscreenEffectDefinition, 2);
    const atThree = imageGraphDefinition(instance, scanlines as FullscreenEffectDefinition, 3);
    expect(atTwo.id).toBe(atThree.id);
    expect(atTwo.uniformSize).toBe(272);
    expect(atTwo.packUniforms({}, 1920, 1080)?.[64]).toBe(2);
    expect(atThree.packUniforms({}, 1920, 1080)?.[64]).toBe(3);
    expect(atTwo.shader).toContain('input.uv, imageGraphRuntime.timelineTimeSeconds, imageGraphRuntime.imageParameters');
  });

  it('adapts sampling graphs with the existing texture source and packed input resolution', () => {
    const instance = { id: 'pixelate-sample', type: 'pixelate', name: 'Pixelate', enabled: true, params: {} };
    const definition = imageGraphDefinition(instance, pixelate as FullscreenEffectDefinition);
    const packed = definition.packUniforms({}, 1280, 720)!;
    expect(definition.uniformSize).toBe(272);
    expect([...packed.slice(64)]).toEqual([0, 0, 1280, 720]);
    expect(definition.shader).toContain('fn sampleImageGraphSource(uv: vec2f) -> vec4f { return textureSampleLevel(inputTex, texSampler, uv, 0.0); }');
    expect(definition.shader).toContain('input.uv, imageGraphRuntime.inputResolution, imageGraphRuntime.imageParameters');
  });

  it('routes an edited formerly-local graph with UV capability through a fullscreen pass', () => {
    const instance = { id: 'brightness-uv', type: 'brightness', name: 'Brightness', enabled: true,
      params: { amount: 0.2 }, operatorGraph: createDefaultVignetteGraph() };
    expect(splitLayerEffects([instance]).complexEffects).toEqual([instance]);
  });

  it.each([
    ['exposure', { exposure: 1.25, offset: -0.1, gamma: 0.8 }],
    ['levels', { inputBlack: 0.1, inputWhite: 0.9, gamma: 1.4, outputBlack: 0.05, outputWhite: 0.95 }],
    ['hue-shift', { shift: 0.9 }],
    ['temperature', { temperature: 0.7, tint: -0.35 }],
    ['vibrance', { amount: 1 }],
  ] as const)('uses the canonical %s graph inline and retains ordered multistack passes', (type, params) => {
    const instance = { id: `${type}-test`, type, name: type, enabled: true, params: { ...params } };
    const inline = splitLayerEffects([instance]).inlineEffects;
    expect(inline.operatorProgram?.key).toMatch(/^image-v1-/);
    const ordered = imageGraphDefinition(instance, colorDefinitions[type] as FullscreenEffectDefinition);
    expect(ordered.shader).toContain(inline.operatorProgram!.wgsl);
    expect(ordered.shader).toContain(`fn ${colorDefinitions[type].entryPoint}`);
    expect(splitLayerEffects([instance, effect()]).complexEffects).toEqual([instance, effect()]);
  });

  it.each([
    ['threshold', { level: 0.5 }],
    ['posterize', { levels: 6 }],
  ] as const)('uses the canonical pointwise %s graph in inline and ordered paths', (type, params) => {
    const instance = { id: `${type}-test`, type, name: type, enabled: true, params };
    const inline = splitLayerEffects([instance]).inlineEffects;
    expect(inline.operatorProgram?.key).toMatch(/^image-v1-/);
    const ordered = imageGraphDefinition(instance, pointwiseDefinitions[type] as FullscreenEffectDefinition);
    expect(ordered.shader).toContain(inline.operatorProgram!.wgsl);
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
    createOperatorCompositePipeline(device, {} as GPUBindGroupLayout, external, program);
    expect(createShaderModule.mock.calls[0][0].code).toContain('layerColor = evaluateImageGraph(layerColor);');
    expect(createRenderPipeline).toHaveBeenCalledTimes(1);
  });
});
