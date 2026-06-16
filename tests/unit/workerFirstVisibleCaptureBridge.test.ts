import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RenderCapabilityProbeResult } from '../../src/services/render/renderCapabilityProbe';
import {
  clearWorkerFirstProofCapturesForTests,
  getWorkerFirstProofCaptures,
} from '../../src/services/aiTools/workerFirstProofCaptures';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSourceSnapshot,
} from '../../src/services/aiTools/workerFirstCounterSources';
import {
  handleCaptureWorkerFirstVisiblePresentationProof,
} from '../../src/services/aiTools/workerFirstVisibleCaptureBridge';

const originalElementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

const capabilityProbe: RenderCapabilityProbeResult = {
  timestamp: 1,
  browserEngine: 'chromium',
  os: 'windows',
  gpuAdapter: null,
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
  selectionReason: 'test',
};

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  Object.defineProperty(canvas, 'isConnected', {
    configurable: true,
    value: true,
  });
  canvas.getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 330,
    bottom: 200,
    width: 320,
    height: 180,
    toJSON: () => ({}),
  } as DOMRect));
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => canvas),
  });
  return canvas;
}

function mockCanvasReadback(luma = 128): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < data.length; offset += 4) {
        data[offset] = luma;
        data[offset + 1] = luma;
        data[offset + 2] = luma;
        data[offset + 3] = 255;
      }
      return { data, width, height } as ImageData;
    }),
  } as unknown as CanvasRenderingContext2D);
}

describe('worker-first visible capture bridge', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    vi.restoreAllMocks();
    if (originalElementFromPointDescriptor) {
      Object.defineProperty(document, 'elementFromPoint', originalElementFromPointDescriptor);
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    } else {
      Reflect.deleteProperty(document, 'hidden');
    }
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('requires an explicit W5 platform', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({}, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'test' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid W5 proof platform');
  });

  it('fails when no render capture canvas is available', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
    }, {
      getCaptureCanvas: () => null,
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active render capture canvas');
  });

  it('requires a capability probe before recording proof evidence', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'test' }),
      getCapabilityProbe: () => null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('capability probe is required');
  });

  it('rejects a requested platform that does not match the capability probe', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'linux-chromium-mesa',
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'test' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('platform does not match');
    expect(result.data).toMatchObject({
      requestedPlatform: 'linux-chromium-mesa',
      probePlatform: 'windows-chromium',
    });
  });

  it('rejects a requested strategy that does not match the capability probe', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-present',
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'test' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('strategy does not match');
    expect(result.data).toMatchObject({
      requestedStrategy: 'worker-webgpu-present',
      probeStrategy: 'worker-webgpu-main-present',
    });
  });

  it('rejects caller-supplied playback stress counters', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      playbackDurationMs: 1000,
      frameCount: 30,
      staleVisibleFrameCount: 0,
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'test' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('must come from a dedicated playback smoke');
  });

  it('rejects hidden browser tabs before recording visible proof', async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'test' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('foreground browser tab');
    expect(result.data).toMatchObject({
      document: {
        hidden: true,
        visibilityState: 'hidden',
        visible: false,
      },
    });
    expect(getWorkerFirstProofCaptures().visibleProofs).toHaveLength(0);
  });

  it('records a DOM-visible proof from the render host capture canvas without enabling cutover', async () => {
    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      includeFingerprint: false,
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'renderTarget:program' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      source: 'renderTarget:program',
      w5StartPermissionsRemainStatsGuarded: true,
      proof: {
        platform: 'windows-chromium',
        strategy: 'worker-webgpu-main-present',
        proof: {
          attached: true,
          viewportIntersecting: true,
          centerOccluded: false,
          fingerprint: null,
        },
        stress: null,
      },
    });
    expect(getWorkerFirstProofCaptures().visibleProofs).toHaveLength(1);
  });

  it('publishes visible pixel counters when a fingerprint is captured', async () => {
    mockCanvasReadback();

    const result = await handleCaptureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
    }, {
      getCaptureCanvas: () => ({ canvas: createCanvas(), source: 'renderTarget:program' }),
      getCapabilityProbe: () => capabilityProbe,
    });

    expect(result.success).toBe(true);
    expect(getWorkerFirstCounterSourceSnapshot().visiblePixels).toEqual({
      nonBlankRatio: 1,
      blackFrameCount: 0,
    });
  });
});
