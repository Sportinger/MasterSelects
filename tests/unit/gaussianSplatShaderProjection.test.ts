import { describe, expect, it } from 'vitest';

import shaderSource from '../../src/engine/gaussian/shaders/gaussianSplat.wgsl?raw';

describe('gaussianSplat.wgsl projection', () => {
  it('uses the PlayCanvas/SuperSplat covariance projection matrix order', () => {
    expect(shaderSource).toContain('let W = transpose(mat3x3f(');
    expect(shaderSource).toContain('let T = W * J;');
    expect(shaderSource).toContain('let cov2d = transpose(T) * cov3d * T;');
  });

  it('shrinks low-alpha splat quads before rasterization', () => {
    expect(shaderSource).toContain('sqrt(log(255.0 * alpha)) * 0.5');
    expect(shaderSource).toContain('let uv = cornerOffset * alphaClipScale(renderAlpha);');
    expect(shaderSource).toContain('out.opacity = renderAlpha;');
  });

  it('supports a higher fragment alpha cutoff for soft depth-mask passes', () => {
    expect(shaderSource).toContain('y = fragment alpha cutoff');
    expect(shaderSource).toContain('let alphaCutoff = max(1.0 / 255.0, camera.layer.y);');
    expect(shaderSource).toContain('if (a < alphaCutoff)');
  });

  it('uses oriented covariance ellipse support instead of axis-aligned splat quads', () => {
    expect(shaderSource).toContain('let rawAxis1 = vec2f(offDiagonal, lambda1 - diagonal1);');
    expect(shaderSource).toContain('let pixelOffset = uv.x * axis1Length * axis1 + uv.y * axis2Length * axis2;');
    expect(shaderSource).toContain('let support = dot(in.uv, in.uv);');
  });
});
