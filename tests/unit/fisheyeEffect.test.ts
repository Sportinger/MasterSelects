import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect, isFullscreenEffectDefinition } from '../../src/effects';
import { groupEffectParameters } from '../../src/effects/parameterGroups';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwareSourceResamplingEffects } from '../../src/services/render/workerSoftwareSourceResamplingEffects';
import type { Layer } from '../../src/types';
import type { WorkerRenderSoftwarePixelEffects } from '../../src/services/render/workerRenderHostRuntimeCommands';

const softwareAdjustment: NonNullable<WorkerRenderSoftwarePixelEffects['fisheyeAdjustments']>[number] = {
  projection: 'equidistant',
  strength: 1,
  fieldOfView: 140,
  curveBias: 0,
  radius: 2.1,
  zoom: 1,
  centerX: 0.5,
  centerY: 0.5,
  squeeze: 1,
  rotation: 0,
  preserveAspect: false,
  outside: 'original',
  feather: 0.05,
  edgeMode: 'transparent',
  edgeFeather: 0.005,
  chromaticAberration: 0,
  vignette: 0,
  vignetteSoftness: 0.25,
  samples: 1,
};

describe('fisheye effect', () => {
  it('registers a grouped, animatable lens control surface', () => {
    const effect = getEffect('fisheye');
    expect(isFullscreenEffectDefinition(effect)).toBe(true);
    if (!isFullscreenEffectDefinition(effect)) return;

    expect(effect.entryPoint).toBe('fisheyeFragment');
    expect(effect.uniformSize).toBe(96);
    expect(effect.params.projection.options?.map(({ value }) => value)).toEqual([
      'equidistant', 'equisolid', 'stereographic', 'orthographic',
    ]);
    expect(groupEffectParameters(effect.params).map(({ label }) => label)).toEqual([
      'Lens', 'Framing', 'Edges', 'Optics', 'Quality',
    ]);
    expect(effect.params.strength.animatable).toBe(true);
    expect(effect.params.centerX.animatable).toBe(true);
    expect(effect.params.chromaticAberration.animatable).toBe(true);
  });

  it('packs the complete lens contract with projection, edge, quality, and frame geometry', () => {
    const effect = getEffect('fisheye');
    if (!isFullscreenEffectDefinition(effect)) throw new Error('Expected fullscreen fisheye effect');

    const packed = effect.packUniforms({
      ...getDefaultParams('fisheye'),
      projection: 'stereographic',
      strength: -0.75,
      edgeMode: 'mirror',
      outside: 'transparent',
      samples: '8',
      preserveAspect: false,
      rotation: 90,
    }, 1920, 1080);

    expect(packed).toBeInstanceOf(Float32Array);
    expect(packed?.byteLength).toBe(effect.uniformSize);
    expect(packed?.[0]).toBeCloseTo(-0.75);
    expect(packed?.[7]).toBeCloseTo(Math.PI / 2);
    expect(packed?.[8]).toBeCloseTo(1920 / 1080);
    expect(packed?.[9]).toBe(2);
    expect(packed?.[10]).toBe(2);
    expect(packed?.[11]).toBe(1);
    expect(packed?.[17]).toBe(8);
    expect(packed?.[18]).toBe(0);
    expect(packed?.[20]).toBeCloseTo(1 / 1920);
    expect(packed?.[21]).toBeCloseTo(1 / 1080);
  });

  it('keeps malformed persisted values inside safe shader limits', () => {
    const effect = getEffect('fisheye');
    if (!isFullscreenEffectDefinition(effect)) throw new Error('Expected fullscreen fisheye effect');
    const packed = effect.packUniforms({
      strength: 99,
      fieldOfView: 999,
      radius: -1,
      zoom: 0,
      projection: 'unknown',
      edgeMode: 'unknown',
      samples: '99',
    }, 0, 0);

    expect(packed?.[0]).toBe(1);
    expect(packed?.[1]).toBeCloseTo(175 * Math.PI / 180);
    expect(packed?.[2]).toBeCloseTo(0.1);
    expect(packed?.[3]).toBeCloseTo(0.25);
    expect(packed?.[8]).toBe(1);
    expect(packed?.[9]).toBe(0);
    expect(packed?.[10]).toBe(0);
    expect(packed?.[17]).toBe(8);
    expect(packed?.[20]).toBe(1);
    expect(packed?.[21]).toBe(1);
  });

  it('is accepted and normalized by the software render plan', () => {
    const plan = workerSoftwareEffectPlanForLayer({
      id: 'lens-layer',
      effects: [{
        id: 'fisheye-a',
        type: 'fisheye',
        name: 'Fisheye Lens',
        enabled: true,
        params: {
          projection: 'orthographic',
          strength: -0.5,
          edgeMode: 'repeat',
          samples: '8',
        },
      }],
    } as unknown as Layer);

    expect(plan?.pixelEffects.fisheyeAdjustments).toEqual([
      expect.objectContaining({
        projection: 'orthographic',
        strength: -0.5,
        edgeMode: 'repeat',
        samples: 8,
      }),
    ]);
  });

  it('resamples a radial gradient through the software fallback', () => {
    const width = 21;
    const height = 21;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        source[offset] = Math.round(x / (width - 1) * 255);
        source[offset + 1] = Math.round(y / (height - 1) * 255);
        source[offset + 2] = 64;
        source[offset + 3] = 255;
      }
    }

    const output = applyWorkerSoftwareSourceResamplingEffects(
      source,
      width,
      height,
      5,
      10,
      { brightness: 0, fisheyeAdjustments: [softwareAdjustment] },
    );

    expect(output).not.toBeNull();
    expect(output?.[0]).toBeGreaterThan(5 / (width - 1));
    expect(output?.[3]).toBe(1);
  });
});
