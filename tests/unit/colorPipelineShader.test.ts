import { afterEach, describe, expect, it, vi } from 'vitest';

import { ColorPipeline } from '../../src/engine/color/ColorPipeline';
import { COLOR_CURVE_CHANNELS, COLOR_CURVE_SAMPLE_COUNT } from '../../src/types/colorCurves';

describe('ColorPipeline shader layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('addresses every corrector using the complete primary and curve stride', async () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    let shaderCode = '';
    const device = {
      createShaderModule: vi.fn(({ code }: GPUShaderModuleDescriptor) => {
        shaderCode = code;
        return {};
      }),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
    } as unknown as GPUDevice;

    await new ColorPipeline(device).createPipeline();

    // 8 primary rows plus 2 window rows per node.
    const primaryRows = 10;
    const curveRows = COLOR_CURVE_CHANNELS.length * COLOR_CURVE_SAMPLE_COUNT / 4;
    const expectedStride = primaryRows + curveRows;
    expect(shaderCode).toContain(`let baseIndex = nodeIndex * ${expectedStride}u;`);
    expect(shaderCode).not.toContain('let baseIndex = nodeIndex * 8u;');
  });
});

describe('color node window', () => {
  it('weights a correction inside or outside a soft ellipse or box', async () => {
    const { colorWindowWeight, DEFAULT_COLOR_WINDOW_PARAMS } = await import('../../src/types/colorWindow');
    const ellipse = { ...DEFAULT_COLOR_WINDOW_PARAMS, windowShape: 1, windowSoftness: 0.2 };
    expect(colorWindowWeight(DEFAULT_COLOR_WINDOW_PARAMS, 0, 0)).toBe(1);
    expect(colorWindowWeight(ellipse, 0.5, 0.5)).toBe(1);
    expect(colorWindowWeight(ellipse, 0.98, 0.98)).toBe(0);
    const edge = colorWindowWeight(ellipse, 0.75, 0.5);
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.7);
    expect(colorWindowWeight({ ...ellipse, windowOutside: 1 }, 0.5, 0.5)).toBe(0);
    const box = { ...DEFAULT_COLOR_WINDOW_PARAMS, windowShape: 2, windowSoftness: 0 };
    expect(colorWindowWeight(box, 0.74, 0.74)).toBe(1);
    expect(colorWindowWeight(box, 0.76, 0.5)).toBe(0);
  });
});
