import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect, isFullscreenEffectDefinition } from '../../src/effects';
import { groupEffectParameters } from '../../src/effects/parameterGroups';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwareSourceResamplingEffects } from '../../src/services/render/workerSoftwareSourceResamplingEffects';
import type { Layer } from '../../src/types';
import type { WorkerRenderSoftwarePixelEffects } from '../../src/services/render/workerRenderHostRuntimeCommands';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { applyWorkerSoftwarePixelEffects } from '../../src/services/render/workerSoftwarePixelEffects';

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

  it.each(['canonical', 'legacy parameter'] as const)('routes enabled %s graph-backed Fisheye through a portable image plan', storage => {
    const graph = createDefaultFisheyeGraph();
    graph.nodes.find(node => node.id === 'curve-scale')!.constants = { value: .42 };
    const owner = storage === 'canonical' ? { operatorGraph: graph } : {};
    const params = storage === 'legacy parameter' ? { operatorGraph: JSON.stringify(graph) } : {};
    const plan = workerSoftwareEffectPlanForLayer({
      id: 'lens-layer', effects: [{ id: 'fisheye-graph', type: 'fisheye', name: 'Fisheye Lens', enabled: true, params, ...owner }],
    } as unknown as Layer);
    expect(plan?.filter).toBe('none');
    expect(plan?.pixelEffects.imageOperatorPlans).toHaveLength(1);
    expect(plan?.pixelEffects.fisheyeAdjustments).toBeUndefined();
  });

  it('ignores a disabled graph-backed Fisheye without rejecting the software layer', () => {
    const plan = workerSoftwareEffectPlanForLayer({
      id: 'lens-layer', effects: [{
        id: 'fisheye-disabled', type: 'fisheye', name: 'Fisheye Lens', enabled: false, params: {}, operatorGraph: { version: 1 },
      }],
    } as unknown as Layer);
    expect(plan).not.toBeNull();
    expect(plan?.pixelEffects.fisheyeAdjustments).toBeUndefined();
  });

  it('fails closed instead of reordering a mixed canonical and legacy stack', () => {
    const plan = workerSoftwareEffectPlanForLayer({
      id: 'lens-layer', effects: [
        { id: 'fisheye-graph', type: 'fisheye', name: 'Fisheye Lens', enabled: true, params: {}, operatorGraph: createDefaultFisheyeGraph() },
        { id: 'legacy-key', type: 'chroma-key', name: 'Chroma Key', enabled: true, params: {} },
      ],
    } as unknown as Layer);
    expect(plan).toBeNull();
  });

  it('fails closed for malformed persisted graph data', () => {
    const plan = workerSoftwareEffectPlanForLayer({
      id: 'lens-layer', effects: [{
        id: 'fisheye-broken', type: 'fisheye', name: 'Fisheye Lens', enabled: true, params: { operatorGraph: '{broken' },
      }],
    } as unknown as Layer);
    expect(plan).toBeNull();
  });

  it('executes a persisted identity rewire through the software pixel pipeline', () => {
    const width = 5, height = 3;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      source[offset] = x * 47 + y * 3; source[offset + 1] = y * 83 + x * 5;
      source[offset + 2] = 19 + x * 21 + y * 11; source[offset + 3] = 31 + x * 37 + y * 17;
    }
    const render = (operatorGraph: ReturnType<typeof createDefaultFisheyeGraph>) => {
      const planned = workerSoftwareEffectPlanForLayer({ id: 'lens-layer', effects: [{
        id: 'fisheye-graph', type: 'fisheye', name: 'Fisheye Lens', enabled: true, params: {}, operatorGraph,
      }] } as unknown as Layer)!;
      const data = new Uint8ClampedArray(source), imageData = { data };
      const context = { getImageData: () => imageData, putImageData: () => undefined } as unknown as OffscreenCanvasRenderingContext2D;
      applyWorkerSoftwarePixelEffects(context, width, height, { pixelEffects: planned.pixelEffects } as never, 0);
      return data;
    };
    const defaultOutput = render(createDefaultFisheyeGraph());
    const identityGraph = createDefaultFisheyeGraph();
    const outputEdge = identityGraph.edges.find(edge => edge.to === 'output' && edge.input === 'image')!;
    outputEdge.from = 'frame'; outputEdge.output = 'image';
    const identityOutput = render(identityGraph);
    expect(identityOutput).toEqual(source);
    expect(defaultOutput).not.toEqual(source);
    const sourceAlpha = [...source].filter((_value, index) => index % 4 === 3);
    expect([...identityOutput].filter((_value, index) => index % 4 === 3)).toEqual(sourceAlpha);
    expect([...defaultOutput].filter((_value, index) => index % 4 === 3)).not.toEqual(sourceAlpha);
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
