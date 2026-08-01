import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/types';
import { DEFAULT_PRIMARY_COLOR_PARAMS } from '../../src/types/colorCorrection';

const mockFactory = vi.hoisted(() => {
  const pixels = new Uint8ClampedArray([7, 6, 5, 4]);
  const engine = {
    cleanupExportCanvas: vi.fn(),
    createVideoFrameFromExport: vi.fn(async () => null),
    ensureExportLayersReady: vi.fn(async () => undefined),
    ensureGaussianSplatSceneLoaded: vi.fn(async () => true),
    ensureSceneRendererInitialized: vi.fn(async () => true),
    getOutputDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
    hasMaskTexture: vi.fn(() => false),
    initExportCanvas: vi.fn(() => true),
    initialize: vi.fn(async () => true),
    isDeviceValid: vi.fn(() => true),
    preloadSceneModelAsset: vi.fn(async () => true),
    readPixels: vi.fn(async () => pixels),
    removeMaskTexture: vi.fn(),
    render: vi.fn(),
    setExporting: vi.fn(),
    setRenderTimeOverride: vi.fn(),
    setResolution: vi.fn(),
    updateMaskTexture: vi.fn(),
  };
  const bridge = {
    attachTargetSurface: vi.fn(async () => ({ accepted: true })),
    detachTargetSurface: vi.fn(async () => ({ accepted: true })),
    initialize: vi.fn(async () => ({ accepted: true, initialized: true })),
    presentSoftwareFrame: vi.fn(async () => ({
      accepted: true,
      readback: { width: 64, height: 36, pixels },
    })),
    presentGpuFrameStack: vi.fn(async (command: {
      readonly commandId: string;
      readonly stack: {
        readonly frame: {
          readonly targetId: string;
          readonly compositionId: string;
          readonly timelineTime: number;
          readonly frameIndex: number;
        };
      };
      readonly readback?: {
        readonly readbackId: string;
        readonly width: number;
        readonly height: number;
      };
    }) => ({
      accepted: true,
      presentedFrameId: `${command.commandId}:presented`,
      readback: command.readback ? {
        width: command.readback.width,
        height: command.readback.height,
        pixels,
        identity: {
          readbackId: command.readback.readbackId,
          targetId: command.stack.frame.targetId,
          compositionId: command.stack.frame.compositionId,
          timelineTime: command.stack.frame.timelineTime,
          frameIndex: command.stack.frame.frameIndex,
        },
      } : null,
    })),
    registerTarget: vi.fn(async () => ({ accepted: true })),
  };
  return {
    bridge,
    createBridge: vi.fn(() => bridge),
    engine,
    pixels,
  };
});

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: mockFactory.engine,
}));

vi.mock('../../src/services/render/workerRenderHostRuntimeBridge', () => ({
  createBrowserWorkerRenderHostRuntimeBridge: mockFactory.createBridge,
  isBrowserWorkerRenderHostRuntimeSupported: vi.fn(() => true),
}));

import { exportRenderHostPort } from '../../src/engine/export/exportRenderHostPort';

const solidLayer: Layer = {
  id: 'solid-a',
  name: 'Solid A',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  source: {
    type: 'solid',
    color: '#ff0000',
  },
  effects: [],
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
};

const unsupportedEffectLayer: Layer = {
  ...solidLayer,
  id: 'solid-unsupported-effect',
  name: 'Solid Unsupported Effect',
  effects: [{
    id: 'effect-a',
    type: 'voxel-relief',
    name: 'Voxel Relief',
    enabled: true,
    params: {},
  }],
};

const brightnessLayer: Layer = {
  ...solidLayer,
  id: 'solid-brightness',
  name: 'Solid Brightness',
  effects: [{
    id: 'brightness-a',
    type: 'brightness',
    name: 'Brightness',
    enabled: true,
    params: { amount: 0.1 },
  }],
};

const exposureLayer: Layer = {
  ...solidLayer,
  id: 'solid-exposure',
  name: 'Solid Exposure',
  effects: [{
    id: 'exposure-a',
    type: 'exposure',
    name: 'Exposure',
    enabled: true,
    params: { exposure: 0.75, offset: 0.1, gamma: 1.2 },
  }],
};

const temperatureVibranceLayer: Layer = {
  ...solidLayer,
  id: 'solid-temperature-vibrance',
  name: 'Solid Temperature Vibrance',
  effects: [
    {
      id: 'temperature-a',
      type: 'temperature',
      name: 'Temperature',
      enabled: true,
      params: { temperature: 0.75, tint: -0.25 },
    },
    {
      id: 'vibrance-a',
      type: 'vibrance',
      name: 'Vibrance',
      enabled: true,
      params: { amount: 0.4 },
    },
  ],
};

const levelsStylizeLayer: Layer = {
  ...solidLayer,
  id: 'solid-levels-stylize',
  name: 'Solid Levels Stylize',
  effects: [
    {
      id: 'levels-a',
      type: 'levels',
      name: 'Levels',
      enabled: true,
      params: {
        inputBlack: 0.1,
        inputWhite: 0.9,
        gamma: 1.2,
        outputBlack: 0.05,
        outputWhite: 0.95,
      },
    },
    {
      id: 'threshold-a',
      type: 'threshold',
      name: 'Threshold',
      enabled: true,
      params: { level: 0.45 },
    },
    {
      id: 'posterize-a',
      type: 'posterize',
      name: 'Posterize',
      enabled: true,
      params: { levels: 5 },
    },
    {
      id: 'vignette-a',
      type: 'vignette',
      name: 'Vignette',
      enabled: true,
      params: { amount: 0.6, size: 0.45, softness: 0.25, roundness: 1.2 },
    },
  ],
};

const chromaKeyLayer: Layer = {
  ...solidLayer,
  id: 'solid-chroma-key',
  name: 'Solid Chroma Key',
  effects: [{
    id: 'chroma-key-a',
    type: 'chroma-key',
    name: 'Chroma Key',
    enabled: true,
    params: { keyColor: 'green', tolerance: 0.2, softness: 0.1, spillSuppression: 0.5 },
  }],
};

const edgeDetectLayer: Layer = {
  ...solidLayer,
  id: 'solid-edge-detect',
  name: 'Solid Edge Detect',
  effects: [{
    id: 'edge-detect-a',
    type: 'edge-detect',
    name: 'Edge Detect',
    enabled: true,
    params: { strength: 0.2, invert: false },
  }],
};

const sharpenLayer: Layer = {
  ...solidLayer,
  id: 'solid-sharpen',
  name: 'Solid Sharpen',
  effects: [{
    id: 'sharpen-a',
    type: 'sharpen',
    name: 'Sharpen',
    enabled: true,
    params: { amount: 1.4, radius: 1.5 },
  }],
};

const glowLayer: Layer = {
  ...solidLayer,
  id: 'solid-glow',
  name: 'Solid Glow',
  effects: [{
    id: 'glow-a',
    type: 'glow',
    name: 'Glow',
    enabled: true,
    params: {
      amount: 0.6,
      threshold: 0.35,
      radius: 2,
      softness: 0.7,
      rings: 2,
      samplesPerRing: 8,
    },
  }],
};

const acuarelaLayer: Layer = {
  ...solidLayer,
  id: 'solid-acuarela',
  name: 'Solid Acuarela',
  effects: [{
    id: 'acuarela-a',
    type: 'acuarela',
    name: 'Acuarela',
    enabled: true,
    params: {
      opacity: 0.8,
      gain: 0.02,
      speed: 3,
      detail: 2,
      strength: 0.25,
      density: 6,
      gainX: 0.2,
      gainY: 0.4,
    },
  }],
};

const rom1Layer: Layer = {
  ...solidLayer,
  id: 'solid-rom1',
  name: 'Solid Rom1',
  effects: [{
    id: 'rom1-a',
    type: 'rom1',
    name: 'Rom1',
    enabled: true,
    params: { opacity: 0.7, gain: 0.03, speed: 2, detail: 3, strength: 0.2, density: 5 },
  }],
};

const scanlinesGrainLayer: Layer = {
  ...solidLayer,
  id: 'solid-scanlines-grain',
  name: 'Solid Scanlines Grain',
  effects: [
    {
      id: 'scanlines-a',
      type: 'scanlines',
      name: 'Scanlines',
      enabled: true,
      params: { density: 5, opacity: 0.25, speed: 2 },
    },
    {
      id: 'grain-a',
      type: 'grain',
      name: 'Film Grain',
      enabled: true,
      params: { amount: 0.1, size: 1.5, speed: 1.25 },
    },
  ],
};

const waveLayer: Layer = {
  ...solidLayer,
  id: 'solid-wave',
  name: 'Solid Wave',
  effects: [{
    id: 'wave-a',
    type: 'wave',
    name: 'Wave',
    enabled: true,
    params: { amplitudeX: 0.01, amplitudeY: 0.02, frequencyX: 4, frequencyY: 6 },
  }],
};

const kaleidoscopeLayer: Layer = {
  ...solidLayer,
  id: 'solid-kaleidoscope',
  name: 'Solid Kaleidoscope',
  effects: [{
    id: 'kaleidoscope-a',
    type: 'kaleidoscope',
    name: 'Kaleidoscope',
    enabled: true,
    params: { segments: 8, rotation: 0.25 },
  }],
};

const twirlLayer: Layer = {
  ...solidLayer,
  id: 'solid-twirl',
  name: 'Solid Twirl',
  effects: [{
    id: 'twirl-a',
    type: 'twirl',
    name: 'Twirl',
    enabled: true,
    params: { amount: 1.2, radius: 0.75, centerX: 0.5, centerY: 0.45 },
  }],
};

const bulgeLayer: Layer = {
  ...solidLayer,
  id: 'solid-bulge',
  name: 'Solid Bulge',
  effects: [{
    id: 'bulge-a',
    type: 'bulge',
    name: 'Bulge',
    enabled: true,
    params: { amount: 1.4, radius: 0.6, centerX: 0.55, centerY: 0.5 },
  }],
};

const motionBlurLayer: Layer = {
  ...solidLayer,
  id: 'solid-motion-blur',
  name: 'Solid Motion Blur',
  effects: [{
    id: 'motion-blur-a',
    type: 'motion-blur',
    name: 'Motion Blur',
    enabled: true,
    params: { amount: 0.08, angle: 0.4, samples: 12 },
  }],
};

const radialBlurLayer: Layer = {
  ...solidLayer,
  id: 'solid-radial-blur',
  name: 'Solid Radial Blur',
  effects: [{
    id: 'radial-blur-a',
    type: 'radial-blur',
    name: 'Radial Blur',
    enabled: true,
    params: { amount: 0.75, centerX: 0.45, centerY: 0.55, samples: 20 },
  }],
};

const zoomBlurLayer: Layer = {
  ...solidLayer,
  id: 'solid-zoom-blur',
  name: 'Solid Zoom Blur',
  effects: [{
    id: 'zoom-blur-a',
    type: 'zoom-blur',
    name: 'Zoom Blur',
    enabled: true,
    params: { amount: 0.4, centerX: 0.5, centerY: 0.45, samples: 18 },
  }],
};

const mirrorLayer: Layer = {
  ...solidLayer,
  id: 'solid-mirror',
  name: 'Solid Mirror',
  effects: [{
    id: 'mirror-a',
    type: 'mirror',
    name: 'Mirror',
    enabled: true,
    params: { horizontal: true, vertical: true },
  }],
};

const pixelateLayer: Layer = {
  ...solidLayer,
  id: 'solid-pixelate',
  name: 'Solid Pixelate',
  effects: [{
    id: 'pixelate-a',
    type: 'pixelate',
    name: 'Pixelate',
    enabled: true,
    params: { size: 10 },
  }],
};

const rgbSplitLayer: Layer = {
  ...solidLayer,
  id: 'solid-rgb-split',
  name: 'Solid RGB Split',
  effects: [{
    id: 'rgb-split-a',
    type: 'rgb-split',
    name: 'RGB Split',
    enabled: true,
    params: { amount: 0.04, angle: Math.PI / 2 },
  }],
};

const gaussianBlurLayer: Layer = {
  ...solidLayer,
  id: 'solid-gaussian-blur',
  name: 'Solid Gaussian Blur',
  effects: [{
    id: 'gaussian-blur-a',
    type: 'gaussian-blur',
    name: 'Gaussian Blur',
    enabled: true,
    params: { radius: 8, samples: 9 },
  }] as Layer['effects'],
};

const colorCorrectionPrimary = {
  ...DEFAULT_PRIMARY_COLOR_PARAMS,
  exposure: 1,
  saturation: 0.85,
};

const colorCorrectionLayer: Layer = {
  ...solidLayer,
  id: 'solid-color-correction',
  name: 'Solid Color Correction',
  colorCorrection: {
    enabled: true,
    graphHash: 'color-correction-a',
    nodeIds: ['primary-a'],
    primary: colorCorrectionPrimary,
    primaryNodes: [colorCorrectionPrimary],
    diagnostics: [],
  },
};

const wipeTransitionLayer: Layer = {
  ...solidLayer,
  id: 'solid-wipe-transition',
  name: 'Solid Wipe Transition',
  transitionRender: {
    kind: 'wipe',
    direction: 'up',
    progress: 0.5,
  },
};

const patternTransitionLayer: Layer = {
  ...solidLayer,
  id: 'solid-pattern-transition',
  name: 'Solid Pattern Transition',
  transitionRender: {
    kind: 'pattern-mask',
    pattern: 'checker',
    progress: 0.5,
  },
};

/**
 * The Worker GPU frame-stack contract validates payload bitmaps with
 * `isImageBitmapValue`, i.e. `value instanceof ImageBitmap`. jsdom provides no
 * ImageBitmap constructor, so an object literal is rejected as
 * MD7_FRAME_STACK_INVALID_PAYLOAD and the whole projection throws before
 * anything is presented. Stubbing the global keeps `instanceof` meaningful.
 */
class FakeImageBitmap {
  readonly width: number;
  readonly height: number;
  readonly close = vi.fn();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      filter: 'none',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    };
  }
}

function restoreCreateImageBitmap(originalCreateImageBitmap: typeof globalThis.createImageBitmap | undefined): void {
  if (originalCreateImageBitmap) {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: originalCreateImageBitmap,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
}

describe('worker-first export render host port', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('masterselects.renderHostMode', 'worker-software');
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
  });

  it('keeps the main export fallback cold while explicit worker software readback succeeds', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);

    expect(mockFactory.createBridge).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.initialize).toHaveBeenCalledWith(
      'worker-software-export-host',
      'worker-software-readback',
    );
    expect(mockFactory.engine.initialize).not.toHaveBeenCalled();
    expect(mockFactory.engine.isDeviceValid).not.toHaveBeenCalled();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([solidLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    const attachCallsAfterReadback = mockFactory.bridge.attachTargetSurface.mock.calls.length;
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.detachTargetSurface).toHaveBeenCalledWith('export');
    expect(mockFactory.bridge.attachTargetSurface).toHaveBeenCalledTimes(attachCallsAfterReadback);
    expect(mockFactory.engine.setResolution).not.toHaveBeenCalled();
    expect(mockFactory.engine.setExporting).not.toHaveBeenCalled();
    expect(mockFactory.engine.initExportCanvas).not.toHaveBeenCalled();
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(mockFactory.engine.cleanupExportCanvas).not.toHaveBeenCalled();
  });

  it('uses the WebGPU main export host by default', async () => {
    localStorage.removeItem('masterselects.renderHostMode');

    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(true);

    expect(mockFactory.createBridge).not.toHaveBeenCalled();
    expect(mockFactory.engine.isDeviceValid).toHaveBeenCalled();
    expect(mockFactory.engine.setResolution).toHaveBeenCalledWith(64, 36);
    expect(mockFactory.engine.setExporting).toHaveBeenCalledWith(true);
    expect(mockFactory.engine.initExportCanvas).toHaveBeenCalledWith(64, 36, false);
    expect(exportRenderHostPort.getTelemetry()).toEqual({
      mode: 'main',
      presentationStrategy: 'main-host-fallback',
      lifecycleOwner: 'exportRenderHostPort',
    });
  });

  it('keeps explicit main render host mode on the main export fallback', async () => {
    localStorage.setItem('masterselects.renderHostMode', 'main');

    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(true);
    exportRenderHostPort.setRenderTimeOverride(0);
    await exportRenderHostPort.ensureExportLayersReady([solidLayer]);
    exportRenderHostPort.render([solidLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();

    expect(mockFactory.createBridge).not.toHaveBeenCalled();
    expect(mockFactory.bridge.presentSoftwareFrame).not.toHaveBeenCalled();
    expect(mockFactory.engine.isDeviceValid).toHaveBeenCalled();
    expect(mockFactory.engine.setResolution).toHaveBeenCalledWith(64, 36);
    expect(mockFactory.engine.setExporting).toHaveBeenCalledWith(true);
    expect(mockFactory.engine.initExportCanvas).toHaveBeenCalledWith(64, 36, false);
    expect(mockFactory.engine.ensureExportLayersReady).toHaveBeenCalledWith([solidLayer]);
    expect(mockFactory.engine.render).toHaveBeenCalledWith([solidLayer], {
      compositionId: 'export',
      timelineTimeSeconds: 0,
    });
    expect(mockFactory.engine.readPixels).toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry()).toEqual({
      mode: 'main',
      presentationStrategy: 'main-host-fallback',
      lifecycleOwner: 'exportRenderHostPort',
    });
  });

  it('keeps supported additive brightness on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([brightnessLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects).toMatchObject({
      brightness: 0.1,
    });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported exposure on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([exposureLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ exposureAdjustments: [{ exposure: 0.75, offset: 0.1, gamma: 1.2 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported temperature and vibrance on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([temperatureVibranceLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        temperatureAdjustments: [{ temperature: 0.75, tint: -0.25 }],
        vibranceAdjustments: [{ amount: 0.4 }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported levels and simple stylize effects on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([levelsStylizeLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        levelsAdjustments: [{
          inputBlack: 0.1,
          inputWhite: 0.9,
          gamma: 1.2,
          outputBlack: 0.05,
          outputWhite: 0.95,
        }],
        thresholdAdjustments: [{ level: 0.45 }],
        posterizeAdjustments: [{ levels: 5 }],
        vignetteAdjustments: [{ amount: 0.6, size: 0.45, softness: 0.25, roundness: 1.2 }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported chroma key on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([chromaKeyLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        chromaKeyAdjustments: [{
          keyColor: 'green',
          tolerance: 0.2,
          softness: 0.1,
          spillSuppression: 0.5,
        }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported edge detect on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([edgeDetectLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ edgeDetectAdjustments: [{ strength: 0.2, invert: false }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported sharpen on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([sharpenLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ sharpenAdjustments: [{ amount: 1.4, radius: 1.5 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported glow on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([glowLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        glowAdjustments: [{
          amount: 0.6,
          threshold: 0.35,
          radius: 2,
          softness: 0.7,
          rings: 2,
          samplesPerRing: 8,
        }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported standalone feedback effects on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([acuarelaLayer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        acuarelaAdjustments: [{
          feedbackKey: 'solid-acuarela:acuarela-a',
          opacity: 0.8,
          gain: 0.02,
          speed: 3,
          detail: 2,
          strength: 0.25,
          density: 6,
          gainX: 0.2,
          gainY: 0.4,
          reset: false,
        }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);

    mockFactory.bridge.presentSoftwareFrame.mockClear();
    exportRenderHostPort.setRenderTimeOverride(0.25);
    exportRenderHostPort.render([rom1Layer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        rom1Adjustments: [{
          feedbackKey: 'solid-rom1:rom1-a',
          opacity: 0.7,
          gain: 0.03,
          speed: 2,
          detail: 3,
          strength: 0.2,
          density: 5,
          gainX: 0.3,
          gainY: 0.3,
          reset: false,
        }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported scanlines and grain on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([scanlinesGrainLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({
        scanlineAdjustments: [{ density: 5, opacity: 0.25, speed: 2 }],
        grainAdjustments: [{ amount: 0.1, size: 1.5, speed: 1.25 }],
      });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported wave distortion on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([waveLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ waveAdjustments: [{ amplitudeX: 0.01, amplitudeY: 0.02, frequencyX: 4, frequencyY: 6 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported kaleidoscope distortion on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([kaleidoscopeLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ kaleidoscopeAdjustments: [{ segments: 8, rotation: 0.25 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported twirl, bulge, and motion blur distortions on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([twirlLayer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ twirlAdjustments: [{ amount: 1.2, radius: 0.75, centerX: 0.5, centerY: 0.45 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);

    mockFactory.bridge.presentSoftwareFrame.mockClear();
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([bulgeLayer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ bulgeAdjustments: [{ amount: 1.4, radius: 0.6, centerX: 0.55, centerY: 0.5 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);

    mockFactory.bridge.presentSoftwareFrame.mockClear();
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([motionBlurLayer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ motionBlurAdjustments: [{ amount: 0.08, angle: 0.4, samples: 12 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported radial and zoom blur on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([radialBlurLayer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ radialBlurAdjustments: [{ amount: 0.75, centerX: 0.45, centerY: 0.55, samples: 20 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);

    mockFactory.bridge.presentSoftwareFrame.mockClear();
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([zoomBlurLayer]);
    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ zoomBlurAdjustments: [{ amount: 0.4, centerX: 0.5, centerY: 0.45, samples: 18 }] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported mirror on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([mirrorLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects).toMatchObject({
      mirrorHorizontal: true,
      mirrorVertical: true,
    });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported pixelate on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([pixelateLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects).toMatchObject({
      pixelateSize: 10,
    });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps supported rgb-split on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([rgbSplitLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects).toMatchObject({
      rgbSplit: { amount: 0.04, angle: Math.PI / 2 },
    });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps canvas-compatible gaussian blur on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([gaussianBlurLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].filter).toBe('blur(8px)');
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps runtime primary color correction on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([colorCorrectionLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].pixelEffects)
      .toMatchObject({ colorGradePrimaryNodes: [colorCorrectionPrimary] });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps simple wipe transitions on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([wipeTransitionLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].transition).toEqual({
      kind: 'wipe',
      direction: 'up',
      progress: 0.5,
    });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('keeps pattern mask transitions on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([patternTransitionLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    expect(mockFactory.bridge.presentSoftwareFrame.mock.calls[0]?.[3].layers[0].transition).toEqual({
      kind: 'pattern-mask',
      pattern: 'checker',
      progress: 0.5,
    });
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
  });

  it('retries transient seeking video snapshots before touching the main export fallback', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    let seeking = true;
    let currentTime = 0;
    const video = document.createElement('video');
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => currentTime },
      readyState: { configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA },
      seeking: { configurable: true, get: () => seeking },
      videoHeight: { configurable: true, get: () => 720 },
      videoWidth: { configurable: true, get: () => 1280 },
    });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const videoLayer: Layer = {
      ...solidLayer,
      id: 'video-seeking',
      name: 'Video Seeking',
      source: {
        type: 'video',
        videoElement: video,
        mediaTime: 1,
      },
    };

    try {
      exportRenderHostPort.setResolution(64, 36);
      exportRenderHostPort.setExporting(true);
      expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
      exportRenderHostPort.setRenderTimeOverride(1);
      exportRenderHostPort.render([videoLayer]);

      const readbackPromise = exportRenderHostPort.readPixels();
      await new Promise((resolve) => {
        setTimeout(() => {
          seeking = false;
          currentTime = 1;
          resolve(undefined);
        }, 10);
      });
      await expect(readbackPromise).resolves.toEqual(mockFactory.pixels);
      exportRenderHostPort.cleanupExportCanvas();
      exportRenderHostPort.setExporting(false);
      exportRenderHostPort.setResolution(1920, 1080);

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video);
      expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
      expect(mockFactory.engine.render).not.toHaveBeenCalled();
      expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
      expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
      expect(exportRenderHostPort.getTelemetry().worker?.transientRetryCount).toBeGreaterThan(0);
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('keeps html video snapshots presentable during worker-only export without main fallback', async () => {
    localStorage.setItem('masterselects.renderHostMode', 'worker-only');
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    const video = document.createElement('video');
    Object.defineProperties(video, {
      currentTime: { configurable: true, value: 1 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      seeking: { configurable: true, value: false },
      videoHeight: { configurable: true, value: 720 },
      videoWidth: { configurable: true, value: 1280 },
    });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const videoLayer: Layer = {
      ...solidLayer,
      id: 'video-worker-only',
      name: 'Video Worker Only',
      source: {
        type: 'video',
        videoElement: video,
        mediaTime: 1,
      },
    };

    try {
      exportRenderHostPort.setResolution(64, 36);
      exportRenderHostPort.setExporting(true);
      expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
      exportRenderHostPort.setRenderTimeOverride(1);
      await exportRenderHostPort.ensureExportLayersReady([videoLayer]);
      exportRenderHostPort.render([videoLayer]);

      await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
      exportRenderHostPort.cleanupExportCanvas();
      exportRenderHostPort.setExporting(false);
      exportRenderHostPort.setResolution(1920, 1080);

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video);
      expect(mockFactory.bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
      expect(mockFactory.engine.render).not.toHaveBeenCalled();
      expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
      expect(exportRenderHostPort.getTelemetry()).toMatchObject({
        strictWorkerOnly: true,
        worker: {
          fallbackFrameCount: 0,
          lastDiagnostics: {
            sourceLayerCount: 1,
            presentableLayerCount: 1,
            skippedLayerCount: 0,
          },
        },
      });
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('blocks unsupported worker-only export frames instead of touching the main fallback', async () => {
    localStorage.setItem('masterselects.renderHostMode', 'worker-only');
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    await exportRenderHostPort.ensureExportLayersReady([unsupportedEffectLayer]);
    exportRenderHostPort.render([unsupportedEffectLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toBeNull();
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    const telemetry = exportRenderHostPort.getTelemetry();
    expect(telemetry).toMatchObject({
      mode: 'worker-software',
      presentationStrategy: 'worker-software-readback',
      strictWorkerOnly: true,
      worker: {
        fallbackFrameCount: 0,
        lastDiagnostics: {
          skippedByReason: {
            'unsupported-effects': 1,
          },
        },
      },
    });
    expect(telemetry.worker?.strictBlockedFrameCount).toBeGreaterThan(0);
    expect(mockFactory.bridge.presentSoftwareFrame).not.toHaveBeenCalled();
    expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
    expect(mockFactory.engine.render).not.toHaveBeenCalled();
    expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
  });

  it('keeps supported nested compositions on the worker export readback path', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.engine.ensureExportLayersReady.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    const bitmap = new FakeImageBitmap(64, 36) as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const nestedLayer: Layer = {
      ...solidLayer,
      id: 'nested-export-parent',
      name: 'Nested Export Parent',
      source: {
        type: 'image',
        nestedComposition: {
          compositionId: 'nested-export-comp',
          width: 64,
          height: 36,
          currentTime: 0,
          layers: [{
            ...solidLayer,
            id: 'nested-export-child',
            name: 'Nested Export Child',
          }],
        },
      },
    };

    try {
      exportRenderHostPort.setResolution(64, 36);
      exportRenderHostPort.setExporting(true);
      expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
      exportRenderHostPort.setRenderTimeOverride(0);
      exportRenderHostPort.render([nestedLayer]);

      await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
      exportRenderHostPort.cleanupExportCanvas();
      exportRenderHostPort.setExporting(false);
      exportRenderHostPort.setResolution(1920, 1080);

      expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
      expect(mockFactory.bridge.presentSoftwareFrame).not.toHaveBeenCalled();
      expect(mockFactory.bridge.presentGpuFrameStack).toHaveBeenCalledTimes(1);
      const [command] = mockFactory.bridge.presentGpuFrameStack.mock.calls[0] ?? [];
      expect(command).toMatchObject({
        type: 'gpu.presentFrameStack',
        stack: {
          frame: { intent: 'export', targetId: 'export' },
          bindings: [{
            layerId: 'nested-export-parent',
            payload: {
              kind: 'nested-stack',
              stack: { frame: { intent: 'export', compositionId: 'nested-export-comp' } },
            },
          }],
        },
        readback: { width: 64, height: 36, format: 'rgba8unorm' },
      });
      expect(mockFactory.engine.ensureExportLayersReady).not.toHaveBeenCalled();
      expect(mockFactory.engine.render).not.toHaveBeenCalled();
      expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
      expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedLayerCount).toBe(0);
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('exports Adjustment stacks atomically and prefers the exact VideoFrame over HTML video', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);
    mockFactory.bridge.presentSoftwareFrame.mockClear();
    mockFactory.bridge.presentGpuFrameStack.mockClear();
    mockFactory.engine.render.mockClear();
    mockFactory.engine.readPixels.mockClear();

    const videoFrame = {
      displayWidth: 1280,
      displayHeight: 720,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const htmlVideo = document.createElement('video');
    Object.defineProperties(htmlVideo, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoHeight: { configurable: true, value: 360 },
      videoWidth: { configurable: true, value: 640 },
    });
    const bitmap = new FakeImageBitmap(1280, 720) as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const videoLayer: Layer = {
      ...solidLayer,
      id: 'adjustment-video',
      sourceClipId: 'adjustment-video-clip',
      source: { type: 'video', videoFrame, videoElement: htmlVideo, mediaTime: 1.25 },
    };
    const adjustmentLayer: Layer = {
      ...solidLayer,
      id: 'adjustment-export',
      sourceClipId: 'adjustment-export-clip',
      source: { type: 'motion-adjustment' },
      effects: [{
        id: 'adjustment-export-brightness',
        name: 'Brightness',
        type: 'brightness',
        enabled: true,
        params: { amount: 0.2 },
      }],
    };

    try {
      exportRenderHostPort.setResolution(64, 36);
      exportRenderHostPort.setExporting(true);
      expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
      exportRenderHostPort.setRenderTimeOverride(1.25);
      exportRenderHostPort.render([adjustmentLayer, videoLayer], {
        compositionId: 'export-adjustment-composition',
        timelineTimeSeconds: 1.25,
      });

      await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(videoFrame);
      expect(globalThis.createImageBitmap).not.toHaveBeenCalledWith(htmlVideo);
      expect(mockFactory.bridge.presentSoftwareFrame).not.toHaveBeenCalled();
      expect(mockFactory.bridge.presentGpuFrameStack).toHaveBeenCalledTimes(1);
      const [command] = mockFactory.bridge.presentGpuFrameStack.mock.calls[0] ?? [];
      expect(command).toMatchObject({
        stack: {
          frame: {
            compositionId: 'export-adjustment-composition',
            timelineTime: 1.25,
            intent: 'export',
            exact: true,
          },
          execution: { kind: 'frozen-adjustment' },
          bindings: [{
            // The projector canonicalizes bindings to the stable clip id
            // (workerGpuFrameStackProjector.ts: `layer.sourceClipId ?? layer.id`)
            // so a binding correlates with the adjustment plan's `clip:*` passes.
            layerId: 'adjustment-video-clip',
            sourceId: 'export-video:adjustment-video-clip',
            payload: { kind: 'bitmap', width: 1280, height: 720 },
          }],
        },
        readback: {
          compositionId: 'export-adjustment-composition',
          timelineTime: 1.25,
          width: 64,
          height: 36,
        },
      });
      expect(mockFactory.engine.render).not.toHaveBeenCalled();
      expect(mockFactory.engine.readPixels).not.toHaveBeenCalled();
      exportRenderHostPort.cleanupExportCanvas();
      exportRenderHostPort.setExporting(false);
      exportRenderHostPort.setResolution(1920, 1080);
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('uses the isolated main fallback for unsupported worker software features', async () => {
    await expect(exportRenderHostPort.ensureReady()).resolves.toBe(true);

    exportRenderHostPort.setResolution(64, 36);
    exportRenderHostPort.setExporting(true);
    expect(exportRenderHostPort.initExportCanvas(64, 36, false)).toBe(false);
    exportRenderHostPort.setRenderTimeOverride(0);
    exportRenderHostPort.render([unsupportedEffectLayer]);

    await expect(exportRenderHostPort.readPixels()).resolves.toEqual(mockFactory.pixels);
    exportRenderHostPort.cleanupExportCanvas();
    exportRenderHostPort.setExporting(false);
    exportRenderHostPort.setResolution(1920, 1080);

    expect(mockFactory.engine.isDeviceValid).toHaveBeenCalled();
    expect(mockFactory.engine.setResolution).toHaveBeenCalledWith(64, 36);
    expect(mockFactory.engine.setExporting).toHaveBeenCalledWith(true);
    expect(mockFactory.engine.setRenderTimeOverride).toHaveBeenCalledWith(0);
    expect(mockFactory.engine.ensureExportLayersReady).toHaveBeenCalledWith([unsupportedEffectLayer]);
    expect(mockFactory.engine.render).toHaveBeenCalledWith([unsupportedEffectLayer], {
      compositionId: 'export',
      timelineTimeSeconds: 0,
    });
    expect(mockFactory.engine.readPixels).toHaveBeenCalled();
    expect(exportRenderHostPort.getTelemetry().worker?.fallbackFrameCount).toBeGreaterThan(0);
    expect(exportRenderHostPort.getTelemetry().worker?.lastDiagnostics?.skippedByReason['unsupported-effects']).toBe(1);
  });
});
