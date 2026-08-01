import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRenderSoftwareFrame } from '../../src/services/render/workerRenderHostRuntimeCommands';
import { drawWorkerSoftwareLayer } from '../../src/services/render/workerRenderHostSoftwarePainter';
import { createWorkerSoftwareFeedbackStore } from '../../src/services/render/workerSoftwareFeedbackEffects';

function baseContext() {
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

function drawLayerWithPixels(
  inputPixels: Uint8ClampedArray,
  width: number,
  height: number,
  pixelEffects: WorkerRenderSoftwareFrame['layers'][number]['pixelEffects'],
  timelineTime = 0,
  feedbackStore = createWorkerSoftwareFeedbackStore(),
  feedbackScopeId = 'preview',
): Uint8ClampedArray | null {
  let outputPixels: Uint8ClampedArray | null = null;
  const scratchContext = {
    ...baseContext(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(inputPixels),
    })),
    putImageData: vi.fn((imageData: ImageData) => {
      outputPixels = new Uint8ClampedArray(imageData.data);
    }),
  };
  class TestOffscreenCanvas {
    readonly width: number;
    readonly height: number;

    constructor(canvasWidth: number, canvasHeight: number) {
      this.width = canvasWidth;
      this.height = canvasHeight;
    }

    getContext() {
      return scratchContext;
    }
  }
  vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas as unknown as typeof OffscreenCanvas);
  const targetContext = {
    ...baseContext(),
    drawImage: vi.fn(),
  };
  const layer: WorkerRenderSoftwareFrame['layers'][number] = {
    id: 'solid-pixel-effect',
    visible: true,
    opacity: 1,
    compositeOperation: 'source-over',
    filter: 'none',
    pixelEffects,
    geometry: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      sourceRect: { x: 0, y: 0, width: 1, height: 1 },
    },
    source: { kind: 'solid', color: '#000000' },
  };

  drawWorkerSoftwareLayer(
    targetContext as unknown as OffscreenCanvasRenderingContext2D,
    layer,
    width,
    height,
    timelineTime,
    feedbackStore,
    feedbackScopeId,
  );
  expect(targetContext.drawImage).toHaveBeenCalled();
  return outputPixels;
}

describe('worker software painter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies an adjustment to a snapshot of the lower accumulator', () => {
    const scratchContext = {
      ...baseContext(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([32, 64, 96, 255]),
      })),
      putImageData: vi.fn(),
    };
    class TestOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas as unknown as typeof OffscreenCanvas);
    const targetCanvas = { width: 1, height: 1 } as OffscreenCanvas;
    const targetContext = {
      ...baseContext(),
      canvas: targetCanvas,
      drawImage: vi.fn(),
    };
    const layer: WorkerRenderSoftwareFrame['layers'][number] = {
      id: 'adjustment-brightness',
      visible: true,
      opacity: 0.5,
      compositeOperation: 'screen',
      filter: 'contrast(1.2)',
      pixelEffects: { brightness: 0.2 },
      geometry: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        sourceRect: { x: 0, y: 0, width: 1, height: 1 },
      },
      source: { kind: 'adjustment' },
    };

    drawWorkerSoftwareLayer(
      targetContext as unknown as OffscreenCanvasRenderingContext2D,
      layer,
      1,
      1,
    );

    expect(scratchContext.drawImage).toHaveBeenCalledWith(targetCanvas, 0, 0, 1, 1);
    expect(scratchContext.putImageData).toHaveBeenCalledOnce();
    expect(targetContext.drawImage).toHaveBeenCalledWith(
      expect.any(TestOffscreenCanvas),
      0,
      0,
      1,
      1,
    );
    expect(targetContext.globalAlpha).toBe(0.5);
    expect(targetContext.globalCompositeOperation).toBe('screen');
    expect(targetContext.filter).toBe('contrast(1.2)');
  });

  it('applies rgb-split as channel offsets in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
    ]);
    let outputPixels: Uint8ClampedArray | null = null;
    const scratchContext = {
      ...baseContext(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(inputPixels),
      })),
      putImageData: vi.fn((imageData: ImageData) => {
        outputPixels = new Uint8ClampedArray(imageData.data);
      }),
    };
    class TestOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas as unknown as typeof OffscreenCanvas);
    const targetContext = {
      ...baseContext(),
      drawImage: vi.fn(),
    };
    const layer: WorkerRenderSoftwareFrame['layers'][number] = {
      id: 'solid-rgb-split',
      visible: true,
      opacity: 1,
      compositeOperation: 'source-over',
      filter: 'none',
      pixelEffects: {
        brightness: 0,
        rgbSplit: { amount: 1 / 3, angle: 0 },
      },
      geometry: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        sourceRect: { x: 0, y: 0, width: 1, height: 1 },
      },
      source: { kind: 'solid', color: '#000000' },
    };

    drawWorkerSoftwareLayer(
      targetContext as unknown as OffscreenCanvasRenderingContext2D,
      layer,
      3,
      1,
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      40, 20, 30, 255,
      70, 50, 30, 255,
      70, 80, 60, 255,
    ]);
    expect(targetContext.drawImage).toHaveBeenCalled();
  });

  it('applies exposure adjustment in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      64, 128, 200, 255,
    ]);
    let outputPixels: Uint8ClampedArray | null = null;
    const scratchContext = {
      ...baseContext(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(inputPixels),
      })),
      putImageData: vi.fn((imageData: ImageData) => {
        outputPixels = new Uint8ClampedArray(imageData.data);
      }),
    };
    class TestOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas as unknown as typeof OffscreenCanvas);
    const targetContext = {
      ...baseContext(),
      drawImage: vi.fn(),
    };
    const layer: WorkerRenderSoftwareFrame['layers'][number] = {
      id: 'solid-exposure',
      visible: true,
      opacity: 1,
      compositeOperation: 'source-over',
      filter: 'none',
      pixelEffects: {
        brightness: 0,
        exposureAdjustments: [{ exposure: 1, offset: 0.1, gamma: 2 }],
      },
      geometry: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        sourceRect: { x: 0, y: 0, width: 1, height: 1 },
      },
      source: { kind: 'solid', color: '#000000' },
    };

    drawWorkerSoftwareLayer(
      targetContext as unknown as OffscreenCanvasRenderingContext2D,
      layer,
      1,
      1,
    );

    const expectedChannel = (value: number): number => {
      const adjusted = Math.min(1, Math.max(0, (value / 255) * 2 + 0.1) ** 0.5);
      return Math.round(adjusted * 255);
    };
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedChannel(64),
      expectedChannel(128),
      expectedChannel(200),
      255,
    ]);
    expect(targetContext.drawImage).toHaveBeenCalled();
  });

  it('applies temperature and vibrance adjustments in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      100, 120, 130, 255,
    ]);
    let outputPixels: Uint8ClampedArray | null = null;
    const scratchContext = {
      ...baseContext(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(inputPixels),
      })),
      putImageData: vi.fn((imageData: ImageData) => {
        outputPixels = new Uint8ClampedArray(imageData.data);
      }),
    };
    class TestOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas as unknown as typeof OffscreenCanvas);
    const targetContext = {
      ...baseContext(),
      drawImage: vi.fn(),
    };
    const layer: WorkerRenderSoftwareFrame['layers'][number] = {
      id: 'solid-temperature-vibrance',
      visible: true,
      opacity: 1,
      compositeOperation: 'source-over',
      filter: 'none',
      pixelEffects: {
        brightness: 0,
        temperatureAdjustments: [{ temperature: 0.75, tint: -0.25 }],
        vibranceAdjustments: [{ amount: 0.4 }],
      },
      geometry: {
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        sourceRect: { x: 0, y: 0, width: 1, height: 1 },
      },
      source: { kind: 'solid', color: '#000000' },
    };

    drawWorkerSoftwareLayer(
      targetContext as unknown as OffscreenCanvasRenderingContext2D,
      layer,
      1,
      1,
    );

    let r = 100 / 255 + 0.75 * 0.1 + (-0.25) * 0.05;
    let g = 120 / 255 - (-0.25) * 0.1;
    let b = 130 / 255 - 0.75 * 0.1 + (-0.25) * 0.05;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const saturation = (maxChannel - minChannel) / (maxChannel + 0.001);
    const vibrance = 0.4 * (1 - saturation);
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const mixAmount = 1 + vibrance;
    r = gray * (1 - mixAmount) + r * mixAmount;
    g = gray * (1 - mixAmount) + g * mixAmount;
    b = gray * (1 - mixAmount) + b * mixAmount;
    const expectedChannel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedChannel(r),
      expectedChannel(g),
      expectedChannel(b),
      255,
    ]);
    expect(targetContext.drawImage).toHaveBeenCalled();
  });

  it('applies levels and posterize adjustments in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      64, 128, 192, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      1,
      1,
      {
        brightness: 0,
        levelsAdjustments: [{
          inputBlack: 0.1,
          inputWhite: 0.9,
          gamma: 1.2,
          outputBlack: 0.05,
          outputWhite: 0.95,
        }],
        posterizeAdjustments: [{ levels: 6 }],
      },
    );

    const applyLevels = (value: number): number => {
      const normalized = Math.max(0, Math.min(1, ((value / 255) - 0.1) / 0.8));
      const gammaAdjusted = normalized ** (1 / 1.2);
      return 0.05 * (1 - gammaAdjusted) + 0.95 * gammaAdjusted;
    };
    const posterize = (value: number): number => Math.floor(value * 6) / 5;
    const expectedChannel = (value: number): number => Math.round(Math.max(0, Math.min(1, posterize(applyLevels(value)))) * 255);
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedChannel(64),
      expectedChannel(128),
      expectedChannel(192),
      255,
    ]);
  });

  it('applies threshold adjustment in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      30, 30, 30, 255,
      230, 230, 230, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      2,
      1,
      {
        brightness: 0,
        thresholdAdjustments: [{ level: 0.5 }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  it('applies vignette adjustment in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      200, 200, 200, 255,
      200, 200, 200, 255,
      200, 200, 200, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        vignetteAdjustments: [{ amount: 0.8, size: 0.2, softness: 0.5, roundness: 1 }],
      },
    );

    const smoothstep = (edge0: number, edge1: number, value: number): number => {
      const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };
    const expectedAtX = (x: number): number => {
      const uvX = (x + 0.5) / 3;
      const distance = Math.abs(uvX - 0.5) * 2;
      const vignette = 1 - smoothstep(0.2, 0.7, distance);
      const factor = (1 - 0.8) + vignette * 0.8;
      return Math.round(200 * factor);
    };
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedAtX(0), expectedAtX(0), expectedAtX(0), 255,
      expectedAtX(1), expectedAtX(1), expectedAtX(1), 255,
      expectedAtX(2), expectedAtX(2), expectedAtX(2), 255,
    ]);
  });

  it('applies chroma key alpha and spill suppression in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      0, 255, 0, 255,
      255, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      2,
      1,
      {
        brightness: 0,
        chromaKeyAdjustments: [{
          keyColor: 'green',
          tolerance: 0.2,
          softness: 0.1,
          spillSuppression: 0.5,
        }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      64, 128, 64, 0,
      255, 0, 0, 255,
    ]);
  });

  it('applies edge detect as a Sobel neighborhood pass in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        edgeDetectAdjustments: [{ strength: 0.2, invert: false }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      0, 0, 0, 255,
      204, 204, 204, 255,
      204, 204, 204, 255,
    ]);
  });

  it('applies scanlines using timeline time in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      100, 100, 100, 255,
    ]);
    const timelineTime = 1.25;
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      1,
      1,
      {
        brightness: 0,
        scanlineAdjustments: [{ density: 1, opacity: 0.5, speed: 2 }],
      },
      timelineTime,
    );

    const uvY = 0.5;
    const scrollOffset = timelineTime * 2 * 0.1;
    const scanline = Math.sin((uvY + scrollOffset) * 1 * 100) * 0.5 + 0.5;
    const darken = 1 - 0.5 * (1 - scanline);
    const expected = Math.round(100 * darken);
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expected, expected, expected, 255,
    ]);
  });

  it('applies grain using deterministic timeline time in the worker pixel pass', () => {
    const inputPixels = new Uint8ClampedArray([
      128, 128, 128, 255,
    ]);
    const timelineTime = 1.25;
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      1,
      1,
      {
        brightness: 0,
        grainAdjustments: [{ amount: 0.1, size: 1, speed: 2 }],
      },
      timelineTime,
    );

    const uvX = 0.5;
    const uvY = 0.5;
    const time = timelineTime * 2;
    const grainU = uvX * 100 + time * 0.1;
    const grainV = uvY * 100 + time * 0.07;
    const fract = (value: number): number => value - Math.floor(value);
    const noise = fract(Math.sin(grainU * 12.9898 + grainV * 78.233) * 43758.5453) * 2 - 1;
    const channel = 128 / 255;
    const luminance = channel;
    const intensity = 0.1 * (1 - luminance * 0.5);
    const expected = Math.round(Math.max(0, Math.min(1, channel + noise * intensity)) * 255);
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expected, expected, expected, 255,
    ]);
  });

  it('applies wave distortion as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        waveAdjustments: [{
          amplitudeX: 0,
          amplitudeY: 0.5,
          frequencyX: 1,
          frequencyY: 0.25,
        }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      50, 0, 0, 255,
      90, 0, 0, 255,
      90, 0, 0, 255,
    ]);
  });

  it('applies kaleidoscope distortion as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        kaleidoscopeAdjustments: [{ segments: 4, rotation: 0 }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      90, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
  });

  it('applies sharpen as a weighted worker neighborhood pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      80, 0, 0, 255,
      150, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        sharpenAdjustments: [{ amount: 1, radius: 1 }],
      },
    );

    const sampleAt = (uvX: number): number => {
      const index = Math.max(0, Math.min(2, Math.round(Math.max(0, Math.min(1, uvX)) * 2)));
      return [10, 80, 150][index] ?? 0;
    };
    const expectedAtX = (x: number): number => {
      const uvX = (x + 0.5) / 3;
      const sigma = 1;
      let blur = 0;
      let weightTotal = 0;
      for (let sampleX = -3; sampleX <= 3; sampleX += 1) {
        for (let sampleY = -3; sampleY <= 3; sampleY += 1) {
          const weight = Math.exp(-(sampleX * sampleX + sampleY * sampleY) / (2 * sigma * sigma));
          blur += sampleAt(uvX + sampleX / 3) * weight;
          weightTotal += weight;
        }
      }
      const center = sampleAt(uvX);
      return Math.round(Math.max(0, Math.min(255, center + (center - blur / weightTotal))));
    };

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedAtX(0), 0, 0, 255,
      expectedAtX(1), 0, 0, 255,
      expectedAtX(2), 0, 0, 255,
    ]);
  });

  it('applies glow as a worker neighborhood pass', () => {
    const inputPixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        glowAdjustments: [{
          amount: 0.5,
          threshold: 0.2,
          radius: 0.05,
          softness: 0.8,
          rings: 1,
          samplesPerRing: 4,
        }],
      },
    );

    const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
    const smoothstep = (edge0: number, edge1: number, value: number): number => {
      const t = clamp01((value - edge0) / (edge1 - edge0));
      return t * t * (3 - 2 * t);
    };
    const sampleAt = (uvX: number): number => {
      const index = Math.max(0, Math.min(2, Math.round(clamp01(uvX) * 2)));
      return [0, 1, 0][index] ?? 0;
    };
    const expectedAtX = (x: number): number => {
      const uvX = (x + 0.5) / 3;
      const color = sampleAt(uvX);
      const ringWeight = Math.exp(-(1 * 1) / (2 * 1.1 * 1.1));
      const ringRadius = 1 * 0.05 * (1 / 3) * 10;
      let glow = 0;
      let weightTotal = 0;
      for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
        const angle = sampleIndex * Math.PI * 2 / 4 + 0.5;
        const sample = sampleAt(uvX + Math.cos(angle) * ringRadius);
        glow += sample * smoothstep(0.1, 0.3, sample) * ringWeight;
        weightTotal += ringWeight;
      }
      glow += color * smoothstep(0.1, 0.3, color) * 2;
      weightTotal += 2;
      return Math.round(clamp01(color + (glow / weightTotal)) * 255);
    };

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedAtX(0), expectedAtX(0), expectedAtX(0), 255,
      expectedAtX(1), expectedAtX(1), expectedAtX(1), 255,
      expectedAtX(2), expectedAtX(2), expectedAtX(2), 255,
    ]);
  });

  it('applies acuarela as a worker feedback pass', () => {
    const feedbackStore = createWorkerSoftwareFeedbackStore();
    const pixelEffects: WorkerRenderSoftwareFrame['layers'][number]['pixelEffects'] = {
      brightness: 0,
      acuarelaAdjustments: [{
        feedbackKey: 'solid-a:acuarela-a',
        opacity: 1,
        gain: 0,
        speed: 0,
        detail: 1,
        strength: 0,
        density: 1,
        gainX: 0,
        gainY: 0,
        reset: false,
      }],
    };

    const first = drawLayerWithPixels(
      new Uint8ClampedArray([255, 255, 255, 255]),
      1,
      1,
      pixelEffects,
      0,
      feedbackStore,
    );
    const second = drawLayerWithPixels(
      new Uint8ClampedArray([0, 0, 0, 0]),
      1,
      1,
      pixelEffects,
      0.25,
      feedbackStore,
    );

    expect(first ? Array.from(first) : null).toEqual([245, 245, 245, 255]);
    expect(second ? Array.from(second) : null).toEqual([10, 10, 10, 250]);
  });

  it('applies rom1 as a worker feedback pass', () => {
    const feedbackStore = createWorkerSoftwareFeedbackStore();
    const pixelEffects: WorkerRenderSoftwareFrame['layers'][number]['pixelEffects'] = {
      brightness: 0,
      rom1Adjustments: [{
        feedbackKey: 'solid-a:rom1-a',
        opacity: 1,
        gain: 0,
        speed: 0,
        detail: 1,
        strength: 0,
        density: 1,
        gainX: 0,
        gainY: 0,
        reset: false,
      }],
    };

    const first = drawLayerWithPixels(
      new Uint8ClampedArray([100, 50, 0, 255]),
      1,
      1,
      pixelEffects,
      0,
      feedbackStore,
    );
    const second = drawLayerWithPixels(
      new Uint8ClampedArray([0, 0, 0, 0]),
      1,
      1,
      pixelEffects,
      0.25,
      feedbackStore,
    );

    expect(first ? Array.from(first) : null).toEqual([100, 50, 0, 255]);
    expect(second ? Array.from(second) : null).toEqual([98, 49, 0, 250]);
  });

  it('applies motion blur as a weighted worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        motionBlurAdjustments: [{ amount: 0.5, angle: 0, samples: 4 }],
      },
    );

    const sampleAt = (uvX: number): number => {
      const wrapped = uvX - Math.floor(uvX * 0.5) * 2;
      const mirrored = wrapped > 1 ? 2 - wrapped : wrapped;
      const index = Math.max(0, Math.min(2, Math.round(mirrored * 2)));
      return [10, 50, 90][index] ?? 0;
    };
    const expectedAtX = (x: number): number => {
      const uvX = (x + 0.5) / 3;
      let total = 0;
      let weightTotal = 0;
      for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
        const t = (sampleIndex / 3 - 0.5) * 2;
        const weight = Math.exp(-t * t * 2);
        total += sampleAt(uvX + t * 0.5) * weight;
        weightTotal += weight;
      }
      return Math.round(total / weightTotal);
    };

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedAtX(0), 0, 0, 255,
      expectedAtX(1), 0, 0, 255,
      expectedAtX(2), 0, 0, 255,
    ]);
  });

  it('applies radial blur as a weighted worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        radialBlurAdjustments: [{ amount: 2, centerX: 0, centerY: 0.5, samples: 4 }],
      },
    );

    const sampleAt = (uvX: number): number => {
      const index = Math.max(0, Math.min(2, Math.round(Math.max(0, Math.min(1, uvX)) * 2)));
      return [10, 50, 90][index] ?? 0;
    };
    const expectedAtX = (x: number): number => {
      const uvX = (x + 0.5) / 3;
      const distance = Math.abs(uvX);
      let total = 0;
      let weightTotal = 0;
      for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
        const t = sampleIndex / 3;
        const scale = 1 - 2 * 0.2 * t * distance;
        const weight = 1 - t * 0.5;
        total += sampleAt(uvX * scale) * weight;
        weightTotal += weight;
      }
      return Math.round(total / weightTotal);
    };

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedAtX(0), 0, 0, 255,
      expectedAtX(1), 0, 0, 255,
      expectedAtX(2), 0, 0, 255,
    ]);
  });

  it('applies zoom blur as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        zoomBlurAdjustments: [{ amount: 1, centerX: 0, centerY: 0.5, samples: 4 }],
      },
    );

    const sampleAt = (uvX: number): number => {
      const index = Math.max(0, Math.min(2, Math.round(Math.max(0, Math.min(1, uvX)) * 2)));
      return [10, 50, 90][index] ?? 0;
    };
    const expectedAtX = (x: number): number => {
      const uvX = (x + 0.5) / 3;
      let total = 0;
      for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
        const t = sampleIndex / 3;
        total += sampleAt(uvX * (1 + 0.5 * t));
      }
      return Math.round(total / 4);
    };

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      expectedAtX(0), 0, 0, 255,
      expectedAtX(1), 0, 0, 255,
      expectedAtX(2), 0, 0, 255,
    ]);
  });

  it('applies twirl distortion as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        twirlAdjustments: [{
          amount: Math.PI,
          radius: 1,
          centerX: 0.5,
          centerY: 0.5,
        }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      50, 0, 0, 255,
      50, 0, 0, 255,
      50, 0, 0, 255,
    ]);
  });

  it('applies bulge distortion as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(
      inputPixels,
      3,
      1,
      {
        brightness: 0,
        bulgeAdjustments: [{
          amount: 2,
          radius: 1,
          centerX: 0.5,
          centerY: 0.5,
        }],
      },
    );

    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      50, 0, 0, 255,
      50, 0, 0, 255,
      50, 0, 0, 255,
    ]);
  });
});
