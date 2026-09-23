import { expect, it } from 'vitest';
import { imageGraphResourceDeclarations, imageGraphResourceViewDimension } from '../../src/effects/_shared/imageGraphShaderResources';
it('declares every sampler-specific history atlas as an array in both shader and layout', () => {
  const resources = ['input-history:atlas', 'input-history:rgb-time-Red-history:atlas', 'input-history:rgb-time-Red-history:ages',
    'source-motion:time-field-motion-source:atlas', 'slit-scan:time-map'];
  const wgsl = imageGraphResourceDeclarations({ resourceInputs: resources, capabilities: [],
    resourceSampling: ['hardware-linear-clamp', 'hardware-linear-clamp', 'exact-pixel-load', 'hardware-linear-clamp', 'hardware-linear-clamp'] });
  resources.forEach((id, index) => {
    const type = [0, 1, 3].includes(index) ? 'texture_2d_array<f32>' : 'texture_2d<f32>';
    expect(wgsl).toContain(`var imageGraphResource${index}: ${type};`);
    expect(imageGraphResourceViewDimension(id)).toBe([0, 1, 3].includes(index) ? '2d-array' : '2d');
  });
});
