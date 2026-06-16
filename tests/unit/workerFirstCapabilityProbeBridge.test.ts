import { describe, expect, it, vi } from 'vitest';

import type { RenderCapabilityProbeResult } from '../../src/services/render/renderCapabilityProbe';
import {
  handleRunWorkerFirstRenderCapabilityProbe,
} from '../../src/services/aiTools/workerFirstCapabilityProbeBridge';

const capabilityProbe: RenderCapabilityProbeResult = {
  timestamp: 1,
  browserEngine: 'chromium',
  os: 'windows',
  gpuAdapter: {
    vendor: 'amd',
    architecture: null,
    device: null,
    description: 'test adapter',
  },
  facts: {
    workerNavigatorGpu: true,
    workerWebGpuDevice: true,
    offscreenCanvasTransfer: true,
    offscreenCanvasWebGpuContext: true,
    workerCanvasPresentation: false,
    videoFrameTransfer: true,
    imageBitmapTransfer: true,
    webCodecs: true,
    webCodecsWorker: true,
    copyExternalImageToTexture: true,
    audioContext: true,
  },
  selectedStrategy: 'worker-webgpu-main-present',
  selectionReason: 'worker WebGPU works but direct worker presentation is unproven',
};

describe('worker-first capability probe bridge', () => {
  it('rejects caller-supplied probe evidence', async () => {
    const runProbe = vi.fn(async () => capabilityProbe);

    const result = await handleRunWorkerFirstRenderCapabilityProbe({
      selectedStrategy: 'worker-webgpu-present',
    }, { runProbe });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be caller-supplied');
    expect(runProbe).not.toHaveBeenCalled();
  });

  it('runs the in-browser capability probe without enabling W5 starts', async () => {
    const runProbe = vi.fn(async () => capabilityProbe);

    const result = await handleRunWorkerFirstRenderCapabilityProbe({}, { runProbe });

    expect(result.success).toBe(true);
    expect(runProbe).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      selectedStrategy: 'worker-webgpu-main-present',
      w5StartPermissionsRemainStatsGuarded: true,
      capabilityProbe,
    });
  });

  it('surfaces probe failures without recording synthetic facts', async () => {
    const runProbe = vi.fn(async () => {
      throw new Error('probe unavailable');
    });

    const result = await handleRunWorkerFirstRenderCapabilityProbe({}, { runProbe });

    expect(result.success).toBe(false);
    expect(result.error).toBe('probe unavailable');
  });
});
