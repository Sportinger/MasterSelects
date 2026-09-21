import { describe, expect, it } from 'vitest';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import { imageGraphResourceSampleExpression, imageGraphSampleExpression } from '../../src/effects/_shared/imageGraphSampling';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const plan = (resourceInputs: readonly string[] = []): ImageOperatorPlan => ({
  fusion: 'inline', capabilities: ['sample'], instructions: [], output: 0, sampleScopes: [],
  values: [], key: 'sampling-test', wgsl: '', ...(resourceInputs.length ? { resourceInputs } : {}),
});

describe('image graph scoped sampling', () => {
  it('uses explicit level zero for scoped texture and resource sampling', () => {
    expect(imageGraphSampleExpression('texture', 'source', 'sampler', 'uv', true))
      .toBe('textureSampleLevel(source, sampler, uv, 0.0)');
    expect(imageGraphResourceSampleExpression('resource', 'sampler', 'uv'))
      .toBe('textureSampleLevel(resource, sampler, uv, 0.0)');
    const shader = imageGraphProgramShader(plan(['horizontal']), 'fragmentMain');
    expect(shader).toContain('sampleImageGraphSource(uv: vec2f) -> vec4f { return textureSampleLevel(inputTex, texSampler, uv, 0.0); }');
    expect(shader).toContain('sampleImageGraphResource0(uv: vec2f) -> vec4f { return textureSampleLevel(imageGraphResource0, texSampler, uv, 0.0); }');
    expect(shader).toContain('evaluateImageGraph(textureSample(inputTex, texSampler, input.uv))');
  });

  it('keeps external textures on their base-level sampling operation', () => {
    expect(imageGraphSampleExpression('external', 'source', 'sampler', 'uv', true))
      .toBe('textureSampleBaseClampToEdge(source, sampler, uv)');
    const shader = imageGraphProgramShader(plan(), 'fragmentMain', 'external');
    expect(shader).toContain('sampleImageGraphSource(uv: vec2f) -> vec4f { return textureSampleBaseClampToEdge(inputTex, texSampler, uv); }');
  });
});
