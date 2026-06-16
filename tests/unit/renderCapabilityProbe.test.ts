import { describe, expect, it, vi } from 'vitest';

import type { RenderCapabilityFacts } from '../../src/services/render/renderCapabilityProbe';
import {
  clearRenderCapabilityProbeForTests,
  runRenderCapabilityProbe,
  selectRenderPresentationStrategy,
} from '../../src/services/render/renderCapabilityProbe';

const baseFacts: RenderCapabilityFacts = {
  workerNavigatorGpu: false,
  workerWebGpuDevice: false,
  offscreenCanvasTransfer: false,
  offscreenCanvasWebGpuContext: false,
  workerCanvasPresentation: false,
  videoFrameTransfer: false,
  imageBitmapTransfer: false,
  webCodecs: false,
  webCodecsWorker: false,
  copyExternalImageToTexture: false,
  audioContext: false,
};

function facts(overrides: Partial<RenderCapabilityFacts>): RenderCapabilityFacts {
  return { ...baseFacts, ...overrides };
}

describe('render capability strategy selection', () => {
  it('selects direct worker WebGPU presentation for the full capability set', () => {
    expect(selectRenderPresentationStrategy(facts({
      workerNavigatorGpu: true,
      workerWebGpuDevice: true,
      offscreenCanvasTransfer: true,
      offscreenCanvasWebGpuContext: true,
      workerCanvasPresentation: true,
      videoFrameTransfer: true,
      imageBitmapTransfer: true,
      webCodecs: true,
      webCodecsWorker: true,
      copyExternalImageToTexture: true,
      audioContext: true,
    })).strategy).toBe('worker-webgpu-present');
  });

  it('selects worker WebGPU with a main-thread presenter when presentation is partial', () => {
    expect(selectRenderPresentationStrategy(facts({
      workerNavigatorGpu: true,
      workerWebGpuDevice: true,
      offscreenCanvasTransfer: true,
      offscreenCanvasWebGpuContext: false,
      workerCanvasPresentation: false,
      videoFrameTransfer: true,
      imageBitmapTransfer: true,
      copyExternalImageToTexture: true,
    })).strategy).toBe('worker-webgpu-main-present');
  });

  it('selects a worker CPU/ImageBitmap presenter for Safari-style worker GPU gaps', () => {
    expect(selectRenderPresentationStrategy(facts({
      offscreenCanvasTransfer: true,
      imageBitmapTransfer: true,
      audioContext: true,
    })).strategy).toBe('worker-cpu-present');
  });

  it('keeps the temporary main host path when transfer and presentation facts are missing', () => {
    expect(selectRenderPresentationStrategy(facts({
      workerNavigatorGpu: true,
      workerWebGpuDevice: false,
      offscreenCanvasTransfer: false,
      imageBitmapTransfer: false,
    })).strategy).toBe('main-host-dev');
  });

  it('does not consume a main-thread GPU device while probing capabilities', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const gpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    const destroy = vi.fn();
    const requestDevice = vi.fn(async () => ({ destroy }));
    const requestAdapter = vi.fn(async () => ({
      info: { description: 'main-thread-adapter' },
      requestDevice,
    }));

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter },
    });

    try {
      const probe = await runRenderCapabilityProbe();

      expect(requestAdapter).toHaveBeenCalledTimes(1);
      expect(requestDevice).not.toHaveBeenCalled();
      expect(probe.facts.workerNavigatorGpu).toBe(false);
      expect(probe.facts.workerWebGpuDevice).toBe(false);
      expect(probe.facts.workerCanvasPresentation).toBe(false);
      expect(probe.selectedStrategy).not.toBe('worker-webgpu-present');
      expect(destroy).not.toHaveBeenCalled();
    } finally {
      clearRenderCapabilityProbeForTests();
      if (workerDescriptor) {
        Object.defineProperty(globalThis, 'Worker', workerDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'Worker');
      }
      if (gpuDescriptor) {
        Object.defineProperty(navigator, 'gpu', gpuDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'gpu');
      }
    }
  });

  it('uses WebGL debug renderer details when WebGPU adapter info is empty', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const gpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement');
    const destroy = vi.fn();
    const requestDevice = vi.fn(async () => ({ destroy }));
    const requestAdapter = vi.fn(async () => ({
      info: {},
      requestDevice,
    }));
    const webGlContext = {
      VENDOR: 0x1f00,
      RENDERER: 0x1f01,
      getExtension: vi.fn(() => ({
        UNMASKED_VENDOR_WEBGL: 0x9245,
        UNMASKED_RENDERER_WEBGL: 0x9246,
      })),
      getParameter: vi.fn((key: number) => {
        if (key === 0x9245) return 'Mesa/X.org';
        if (key === 0x9246) return 'llvmpipe (LLVM 18.1.3, 256 bits)';
        return '';
      }),
    };

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter },
    });
    createElement.mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: vi.fn(() => webGlContext),
        });
      }
      return element;
    });

    try {
      const probe = await runRenderCapabilityProbe();

      expect(probe.gpuAdapter).toMatchObject({
        vendor: 'Mesa/X.org',
        description: 'Mesa/X.org llvmpipe (LLVM 18.1.3, 256 bits)',
        source: 'webgl-debug-renderer',
      });
    } finally {
      clearRenderCapabilityProbeForTests();
      createElement.mockRestore();
      if (workerDescriptor) {
        Object.defineProperty(globalThis, 'Worker', workerDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'Worker');
      }
      if (gpuDescriptor) {
        Object.defineProperty(navigator, 'gpu', gpuDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'gpu');
      }
    }
  });

  it('times out a stalled main-thread WebGPU adapter request and keeps WebGL Mesa details', async () => {
    vi.useFakeTimers();
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const gpuDescriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement');
    const requestAdapter = vi.fn(() => new Promise<null>(() => {}));
    const webGlContext = {
      VENDOR: 0x1f00,
      RENDERER: 0x1f01,
      getExtension: vi.fn(() => ({
        UNMASKED_VENDOR_WEBGL: 0x9245,
        UNMASKED_RENDERER_WEBGL: 0x9246,
      })),
      getParameter: vi.fn((key: number) => {
        if (key === 0x9245) return 'Mesa';
        if (key === 0x9246) return 'llvmpipe, or similar';
        return '';
      }),
    };

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter },
    });
    createElement.mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'canvas') {
        Object.defineProperty(element, 'getContext', {
          configurable: true,
          value: vi.fn(() => webGlContext),
        });
      }
      return element;
    });

    try {
      const probePromise = runRenderCapabilityProbe();
      await vi.advanceTimersByTimeAsync(2000);
      const probe = await probePromise;

      expect(requestAdapter).toHaveBeenCalledTimes(1);
      expect(probe.gpuAdapter).toMatchObject({
        vendor: 'Mesa',
        description: 'Mesa llvmpipe, or similar',
        source: 'webgl-debug-renderer',
      });
      expect(probe.facts.copyExternalImageToTexture).toBe(false);
    } finally {
      clearRenderCapabilityProbeForTests();
      vi.useRealTimers();
      createElement.mockRestore();
      if (workerDescriptor) {
        Object.defineProperty(globalThis, 'Worker', workerDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'Worker');
      }
      if (gpuDescriptor) {
        Object.defineProperty(navigator, 'gpu', gpuDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'gpu');
      }
    }
  });

  it('returns a conservative probe and revokes the blob URL when Worker construction throws', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn(() => 'blob:render-probe');
    const revokeObjectURL = vi.fn();

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class ThrowingWorker {
        constructor() {
          throw new Error('blocked');
        }
      },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    try {
      const probe = await runRenderCapabilityProbe();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:render-probe');
      expect(probe.facts.workerNavigatorGpu).toBe(false);
      expect(probe.facts.workerWebGpuDevice).toBe(false);
      expect(probe.facts.workerCanvasPresentation).toBe(false);
    } finally {
      clearRenderCapabilityProbeForTests();
      if (workerDescriptor) {
        Object.defineProperty(globalThis, 'Worker', workerDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'Worker');
      }
      if (createObjectUrlDescriptor) {
        Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor);
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }
      if (revokeObjectUrlDescriptor) {
        Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor);
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    }
  });

  it('closes a probe-created VideoFrame when transfer probing throws', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const videoFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame');
    const structuredCloneDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
    const close = vi.fn();

    class ThrowingTransferVideoFrame {
      close = close;
    }

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'VideoFrame', {
      configurable: true,
      value: ThrowingTransferVideoFrame,
    });
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: vi.fn((value: unknown, options?: StructuredSerializeOptions) => {
        if (value instanceof ThrowingTransferVideoFrame) {
          throw new Error('transfer failed');
        }
        return structuredCloneDescriptor?.value?.(value, options);
      }),
    });

    try {
      await runRenderCapabilityProbe();

      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      clearRenderCapabilityProbeForTests();
      if (workerDescriptor) {
        Object.defineProperty(globalThis, 'Worker', workerDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'Worker');
      }
      if (videoFrameDescriptor) {
        Object.defineProperty(globalThis, 'VideoFrame', videoFrameDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'VideoFrame');
      }
      if (structuredCloneDescriptor) {
        Object.defineProperty(globalThis, 'structuredClone', structuredCloneDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'structuredClone');
      }
    }
  });
});
