import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRenderSoftwareFrame } from '../../src/services/render/workerRenderHostRuntimeCommands';
import { drawWorkerSoftwareLayer } from '../../src/services/render/workerRenderHostSoftwarePainter';
import { createWorkerSoftwareFeedbackStore } from '../../src/services/render/workerSoftwareFeedbackEffects';
import { applyWorkerSoftwareGlow, prepareWorkerSoftwareGlow } from '../../src/services/render/workerSoftwareGlow';
import { directionalBlurPlan, mirrorRepeat, transformDirectionalPixel, type DirectionalBlurType } from '../../src/effects/blur/blurSampling';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import type { Layer } from '../../src/types';

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

/** Pixel effects of a fresh built-in Wave, Twirl or Bulge, as the software plan builds them. */
function uvDistortPixelEffects(type: 'wave' | 'twirl' | 'bulge', params: Record<string, number | string>) {
  const plan = workerSoftwareEffectPlanForLayer({ id: 'distort-layer', effects: [{ id: `${type}-fx`, type, name: type, enabled: true, params }] } as unknown as Layer);
  expect(plan?.pixelEffects.uvDistortAdjustments).toHaveLength(1);
  expect(plan?.pixelEffects.imageOperatorPlans).toBeUndefined();
  return plan!.pixelEffects;
}

/** Linear filtering of one opaque row at u (texel centres at (i + 0.5) / n, clamp to edge). */
function rowBilinear(row: number[], u: number): number {
  const x = Math.min(row.length - 1, Math.max(0, u * row.length - 0.5)), left = Math.floor(x), right = Math.min(row.length - 1, left + 1);
  return row[left] + (row[right] - row[left]) * (x - left);
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
        // A third of the width: red reads one pixel to the right, blue one to the left (Clamp edges).
        mirrorPixelAdjustments: [{ type: 'rgb-split', amount: 1 / 3, angle: 0, lens: false, edges: 'clamp' }],
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
    // amplitudeY 0.5 at frequencyY 0.25 on the single row (v = 0.5) shifts every read by
    // 0.5 * sin(tau * 0.25 * 0.5) = 0.354 of the width; Clamp holds the right border.
    const outputPixels = drawLayerWithPixels(inputPixels, 3, 1, uvDistortPixelEffects('wave', {
      amplitudeX: 0, amplitudeY: 0.5, frequencyX: 1, frequencyY: 0.25, speed: 0, phase: 0, edges: 'clamp',
    }));
    const shift = 0.5 * Math.sin(Math.PI * 2 * 0.25 * 0.5);
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      Math.round(rowBilinear([10, 50, 90], 1 / 6 + shift)), 0, 0, 255,
      90, 0, 0, 255,
      90, 0, 0, 255,
    ]);
  });

  it('applies kaleidoscope distortion as a worker whole-frame resampling pass', () => {
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
        // Stretch to Frame and Clamp: the original UV-space fold (both outer pixels read the right edge).
        mirrorPixelAdjustments: [{ type: 'kaleidoscope', segments: 4, rotation: 0, sourceAngle: 0, zoom: 1, centerX: 0.5, centerY: 0.5,
          stretch: true, edges: 'clamp' }],
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
    const adjustment = { amount: 0.5, threshold: 0.2, radius: 0.05, softness: 0.8, rings: 1, samplesPerRing: 4 };
    const outputPixels = drawLayerWithPixels(inputPixels, 3, 1, { brightness: 0, glowAdjustments: [adjustment] });

    // The shared Glow contract (bright pass, separable prefilter, ring resolve) is checked against the
    // editable GPU graph in imageGlowGraph.test.ts; here the painter must route every pixel through it.
    const glow = prepareWorkerSoftwareGlow(inputPixels, 3, 1, adjustment);
    const expected = [0, 1, 2].flatMap(x => applyWorkerSoftwareGlow(glow, inputPixels, x, 0).map(value => Math.round(value * 255)));
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual(expected);
    // Neighborhood: the dark neighbours pick up light from the bright centre pixel.
    expect(expected[0]).toBeGreaterThan(0);
    expect(expected[8]).toBeGreaterThan(0);
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

  // Directional blurs follow the shared contract (effects/blur/blurSampling.ts) in one stage of
  // evenly spaced, taper-weighted taps along each pixel's range, averaged with premultiplied alpha.
  const contractRow = (type: DirectionalBlurType, params: Record<string, unknown>, row: Array<[number, number]>) => {
    const width = row.length, plan = directionalBlurPlan(type, params, width, 1);
    const nearest = (u: number) => row[Math.max(0, Math.min(width - 1, Math.round(u * (width - 1))))];
    return row.flatMap((_pixel, x) => {
      const pixel: [number, number] = [x + 0.5, 0.5], { start, length } = plan.range(pixel);
      const count = Math.max(2, Math.min(64, Math.ceil(Math.abs(length) * plan.speed(pixel)) + 1));
      let red = 0, alpha = 0, total = 0;
      for (let index = 0; index < count; index++) {
        const t = (index + 0.5) / count, weight = plan.taper(t), [px] = transformDirectionalPixel(plan, pixel, start + length * t);
        const u = type === 'motion-blur' ? mirrorRepeat(px / width) : Math.max(0, Math.min(1, px / width));
        const [value, opacity] = nearest(u);
        red += value * opacity * weight; alpha += opacity * weight; total += weight;
      }
      return [Math.round(red / Math.max(alpha, 1e-6)), 0, 0, Math.round(alpha / total)];
    });
  };
  const row: Array<[number, number]> = [[10, 255], [50, 255], [90, 255]];
  const rowPixels = new Uint8ClampedArray(row.flatMap(([red, alpha]) => [red, 0, 0, alpha]));

  it('applies motion blur along the contract streak as a worker source-resampling pass', () => {
    const outputPixels = drawLayerWithPixels(rowPixels, 3, 1, { brightness: 0, motionBlurAdjustments: [{ amount: 0.5, angle: 0 }] });
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual(contractRow('motion-blur', { amount: 0.5, angle: 0 }, row));
  });

  it('applies radial zoom and spin blur as worker source-resampling passes', () => {
    const zoom = drawLayerWithPixels(rowPixels, 3, 1, { brightness: 0, radialBlurAdjustments: [{ amount: 2, centerX: 0, centerY: 0.5, mode: 'zoom' }] });
    expect(zoom ? Array.from(zoom) : null).toEqual(contractRow('radial-blur', { amount: 2, centerX: 0, centerY: 0.5 }, row));
    const spin = drawLayerWithPixels(rowPixels, 3, 1, { brightness: 0, radialBlurAdjustments: [{ amount: 2, centerX: 0.5, centerY: 0.5, mode: 'spin' }] });
    // The centre pixel sits on the rotation centre and keeps its colour.
    expect(spin ? Array.from(spin).slice(4, 8) : null).toEqual([50, 0, 0, 255]);
  });

  it('applies zoom blur as a worker source-resampling pass and keeps colour at alpha edges', () => {
    const outputPixels = drawLayerWithPixels(rowPixels, 3, 1, { brightness: 0, zoomBlurAdjustments: [{ amount: 1, centerX: 0, centerY: 0.5 }] });
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual(contractRow('zoom-blur', { amount: 1, centerX: 0, centerY: 0.5 }, row));
    const edge = new Uint8ClampedArray([200, 0, 0, 255, 200, 0, 0, 255, 0, 0, 0, 0]);
    const blurred = drawLayerWithPixels(edge, 3, 1, { brightness: 0, motionBlurAdjustments: [{ amount: 0.5, angle: 0 }] });
    expect(blurred?.[8]).toBe(200);
    expect(blurred?.[11]).toBeGreaterThan(0);
  });

  it('applies twirl distortion as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(inputPixels, 3, 1, uvDistortPixelEffects('twirl', {
      amount: Math.PI, radius: 1, centerX: 0.5, centerY: 0.5, shape: 'frame', edges: 'clamp',
    }));
    // The outer pixels sit at r = 1/3 and turn by pi * (2/3)^2 about the centre.
    const angle = Math.PI * (2 / 3) ** 2, reach = Math.cos(angle) / 3;
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      Math.round(rowBilinear([10, 50, 90], 0.5 - reach)), 0, 0, 255,
      50, 0, 0, 255,
      Math.round(rowBilinear([10, 50, 90], 0.5 + reach)), 0, 0, 255,
    ]);
  });

  it('applies bulge distortion as a worker source-resampling pass', () => {
    const inputPixels = new Uint8ClampedArray([
      10, 0, 0, 255,
      50, 0, 0, 255,
      90, 0, 0, 255,
    ]);
    const outputPixels = drawLayerWithPixels(inputPixels, 3, 1, uvDistortPixelEffects('bulge', {
      amount: 2, radius: 1, centerX: 0.5, centerY: 0.5, shape: 'frame', edges: 'clamp',
    }));
    // r = 1/3: the read offset shrinks by exp(-ln 2 * (1 - 1/9)^2).
    const reach = Math.exp(-Math.log(2) * (8 / 9) ** 2) / 3;
    expect(outputPixels ? Array.from(outputPixels) : null).toEqual([
      Math.round(rowBilinear([10, 50, 90], 0.5 - reach)), 0, 0, 255,
      50, 0, 0, 255,
      Math.round(rowBilinear([10, 50, 90], 0.5 + reach)), 0, 0, 255,
    ]);
  });

  describe('Kaleidoscope, Mirror, RGB Split and Pixelate in a stack', () => {
    type StackEffect = { type: string; params: Record<string, number | string | boolean> };
    const twirl: StackEffect = { type: 'twirl', params: { amount: 3, radius: .6, centerX: .45, centerY: .5 } };
    const kaleidoscope: StackEffect = { type: 'kaleidoscope', params: { segments: 5, rotation: .3 } };
    const layerOf = (effects: StackEffect[]) => ({ id: 'stack-layer', effects: effects.map((effect, index) => ({ id: `fx-${index}-${effect.type}`,
      name: effect.type, enabled: true, ...effect })) } as unknown as Layer);
    const plan = (effects: StackEffect[]) => workerSoftwareEffectPlanForLayer(layerOf(effects))!;
    const width = 24, height = 14;
    const input = new Uint8ClampedArray(width * height * 4).map((_, index) => {
      const pixel = index >> 2, x = pixel % width, y = Math.floor(pixel / width);
      return [x * 10 + y * 3, y * 17 + (x % 5) * 9, (x * y * 7) % 256, 255][index & 3];
    });
    const draw = (effects: StackEffect[], pixels = input) => drawLayerWithPixels(pixels, width, height, plan(effects).pixelEffects)!;

    it('runs them first as one hand-written pass only when nothing that moves or mixes pixels comes before them', () => {
      expect(plan([kaleidoscope, twirl]).pixelEffects).toMatchObject({ mirrorPixelAdjustments: [{ type: 'kaleidoscope' }], uvDistortAdjustments: [{ kind: 'twirl' }] });
      // Pointwise effects in front join the pass as whole-frame steps in stack order (see workerSoftwareMirrorPixelStack.test.ts).
      expect(plan([{ type: 'exposure', params: { exposure: .5 } }, kaleidoscope]).pixelEffects).toMatchObject({
        mirrorPixelAdjustments: [{ type: 'pointwise', step: { kind: 'exposure' } }, { type: 'kaleidoscope' }] });
      expect(plan([{ type: 'exposure', params: { exposure: .5 } }, kaleidoscope]).pixelEffects.exposureAdjustments).toBeUndefined();
      expect(plan([{ type: 'mirror', params: {} }, { type: 'pixelate', params: { size: 30 } }]).pixelEffects.mirrorPixelAdjustments).toHaveLength(2);
      // A resampling or neighbourhood effect first would run after the hand-written pass: the layer runs as ordered graph plans.
      for (const earlier of [twirl, { type: 'motion-blur', params: { amount: .05, angle: 0 } }, { type: 'zoom-blur', params: { amount: .3 } }]) {
        const stacked = plan([earlier, kaleidoscope]).pixelEffects;
        expect(stacked.mirrorPixelAdjustments).toBeUndefined();
        expect(stacked.imageOperatorPlanOwners?.map(owner => JSON.parse(owner.feedbackKey)[1])).toEqual([`fx-0-${earlier.type}`, 'fx-1-kaleidoscope']);
      }
      for (const earlier of [{ type: 'gaussian-blur', params: { radius: 4 } }, { type: 'sharpen', params: { amount: 1 } }, { type: 'glow', params: {} }]) {
        expect(plan([earlier, { type: 'pixelate', params: { size: 30 } }]).pixelEffects.mirrorPixelAdjustments).toBeUndefined();
      }
    });

    it('renders Twirl then Kaleidoscope differently from Kaleidoscope then Twirl, each as its effects one after the other', () => {
      const twirlFirst = draw([twirl, kaleidoscope]), kaleidoscopeFirst = draw([kaleidoscope, twirl]);
      let differing = 0;
      for (let index = 0; index < twirlFirst.length; index += 4) {
        differing += Number([0, 1, 2].some(channel => Math.abs(twirlFirst[index + channel] - kaleidoscopeFirst[index + channel]) > 8));
      }
      expect(differing).toBeGreaterThan(width * height / 5);
      // Independent reference: each effect alone, applied in stack order.
      for (const [stacked, [first, second]] of [[twirlFirst, [twirl, kaleidoscope]], [kaleidoscopeFirst, [kaleidoscope, twirl]]] as const) {
        const reference = draw([second], draw([first]));
        for (let index = 0; index < stacked.length; index += 1) expect(Math.abs(stacked[index] - reference[index])).toBeLessThanOrEqual(3);
      }
    });
  });
});
