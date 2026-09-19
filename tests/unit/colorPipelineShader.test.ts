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

    const primaryRows = 8;
    const curveRows = COLOR_CURVE_CHANNELS.length * COLOR_CURVE_SAMPLE_COUNT / 4;
    const expectedStride = primaryRows + curveRows;
    expect(shaderCode).toContain(`let baseIndex = nodeIndex * ${expectedStride}u;`);
    expect(shaderCode).not.toContain('let baseIndex = nodeIndex * 8u;');
  });
});
