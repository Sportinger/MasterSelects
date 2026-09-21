import { describe, expect, it } from 'vitest';
import { imageGraphProgramShader } from '../../src/effects/_shared/imageGraphDefinition';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const plan = (resourceInputs: readonly string[], resourceSampling?: ImageOperatorPlan['resourceSampling']): ImageOperatorPlan => ({
  fusion: 'inline', capabilities: [], instructions: [], output: 0, sampleScopes: [], values: [], key: 'resource-sampling', wgsl: '',
  resourceInputs, ...(resourceSampling ? { resourceSampling } : {}),
});

describe('image graph named-resource sampling wrappers', () => {
  it('emits manual bilinear clamp and hardware-linear helpers in aligned slots', () => {
    const shader = imageGraphProgramShader(plan(['decoded', 'original'], ['manual-bilinear-clamp', 'hardware-linear-clamp']), 'fragmentMain');
    expect(shader).toContain('let dimensions = vec2i(textureDimensions(imageGraphResource0));');
    expect(shader).toContain('let position = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions) - 0.5;');
    expect(shader).toContain('textureLoad(imageGraphResource0, clamp(origin + vec2i(1, 1), vec2i(0), maximum), 0)');
    expect(shader).toContain('return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);');
    expect(shader).toContain('sampleImageGraphResource1(uv: vec2f) -> vec4f { return textureSampleLevel(imageGraphResource1, texSampler, uv, 0.0); }');
  });

  it('keeps omitted sampling descriptors on the existing hardware path', () => {
    const shader = imageGraphProgramShader(plan(['source']), 'fragmentMain');
    expect(shader).toContain('textureSampleLevel(imageGraphResource0, texSampler, uv, 0.0)');
    expect(shader).not.toContain('textureDimensions(imageGraphResource0)');
  });

  it('declares typed uint resources with aligned metadata and exact legacy decode helpers', () => {
    const shader = imageGraphProgramShader({ ...plan(['source', 'memory'], ['hardware-linear-clamp', 'exact-u32-pixel-load']),
      values: [1] }, 'fragmentMain');
    expect(shader).toContain('@binding(4) var imageGraphResource1: texture_2d<u32>');
    expect(shader).toContain('resourceMetadata: array<vec4f, 2>');
    expect(shader).toContain('fn imageGraphResourceMetadata1() -> vec4f');
    expect(shader).toContain('fn decodeImageGraphBytePixel1(pixel: vec2f, depth: f32, floatMode: f32, floatGain: f32) -> vec4f');
    expect(shader).toContain('unpack4x8unorm(imageGraphByteWord1(coordinate))');
    expect(shader).toContain('unpack2x16unorm(imageGraphByteWord1(vec2i(coordinate.x * 2, coordinate.y)))');
    expect(shader).toContain('(word & 0x7f800000u) == 0x7f800000u');
    expect(shader).toContain('imageGraphRuntime.imageParameters');
    expect(shader).not.toContain('@binding(4) var imageGraphResource1: texture_2d<f32>');
  });

  it('fails closed for misaligned or unsupported descriptors', () => {
    expect(() => imageGraphProgramShader(plan(['a', 'b'], ['manual-bilinear-clamp']), 'fragmentMain'))
      .toThrow('must align with resource inputs');
    const invalid = { ...plan(['a']), resourceSampling: ['nearest-repeat'] } as unknown as ImageOperatorPlan;
    expect(() => imageGraphProgramShader(invalid, 'fragmentMain')).toThrow('mode is unsupported');
  });
});
