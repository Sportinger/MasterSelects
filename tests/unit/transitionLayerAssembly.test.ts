import { describe, expect, it } from 'vitest';

import { assembleTransitionLayers } from '../../src/services/layerBuilder/transitionLayerAssembly';
import type { TransitionPlan } from '../../src/stores/timeline/editOperations/transitionPlanner';
import { blurDissolve } from '../../src/transitions/blurDissolve';
import { chromaLeak } from '../../src/transitions/chromaLeak';
import { crtCollapse } from '../../src/transitions/crtCollapse';
import { filmBurn } from '../../src/transitions/filmBurn';
import { filmRoll } from '../../src/transitions/filmRoll';
import { kaleidoscope } from '../../src/transitions/kaleidoscope';
import { lensFlare } from '../../src/transitions/lensFlare';
import { lightLeak } from '../../src/transitions/lightLeak';
import { lightSweep } from '../../src/transitions/lightSweep';
import { mosaicGlitch } from '../../src/transitions/mosaicGlitch';
import { noiseDissolve } from '../../src/transitions/noiseDissolve';
import { rgbSplitGlitch } from '../../src/transitions/rgbSplitGlitch';
import { scanlineGlitch } from '../../src/transitions/scanlineGlitch';
import { swirl } from '../../src/transitions/swirl';
import { vignetteBloom } from '../../src/transitions/vignetteBloom';
import { waterDrop } from '../../src/transitions/waterDrop';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip } from '../../src/types/timeline';

const outgoingClip = {
  id: 'clip-a',
  trackId: 'track-v1',
  name: 'Outgoing',
  startTime: 0,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  effects: [],
  transform: {},
} as TimelineClip;

const incomingClip = {
  id: 'clip-b',
  trackId: 'track-v1',
  name: 'Incoming',
  startTime: 2,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  effects: [],
  transform: {},
} as TimelineClip;

function createLayer(role: 'outgoing' | 'incoming'): Layer {
  return {
    id: role,
    name: role,
    sourceClipId: role === 'incoming' ? 'clip-b' : 'clip-a',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: null,
    effects: [],
    position: { x: 0.1, y: -0.2, z: 0.3 },
    scale: { x: 2, y: 3, z: 4 },
    rotation: { x: 0.1, y: 0.2, z: 0.3 },
  };
}

function createPlan(recipe: TransitionPlan['definition']['recipe']): TransitionPlan {
  return {
    transitionType: 'crossfade',
    definition: {
      id: 'crossfade',
      name: 'Mask Test',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      description: 'Mask assembly test',
      recipe,
    },
    placement: 'center',
    edgePolicy: 'hold',
    requestedDuration: 2,
    resolvedDuration: 2,
    bodyOffset: 0,
    junctionTime: 2,
    bodyStart: 0,
    bodyEnd: 2,
    timingChanges: [],
    outgoing: {
      clipId: 'clip-a',
      trackId: 'track-v1',
      role: 'outgoing',
      startTime: 0,
      endTime: 2,
      handleNeeded: 1,
      handleAvailable: 1,
      realHandleDuration: 1,
      holdDuration: 0,
      coverage: [],
    },
    incoming: {
      clipId: 'clip-b',
      trackId: 'track-v1',
      role: 'incoming',
      startTime: 0,
      endTime: 2,
      handleNeeded: 1,
      handleAvailable: 1,
      realHandleDuration: 1,
      holdDuration: 0,
      coverage: [],
    },
  };
}

describe('transition layer assembly', () => {
  it('immutably composes scale and rotate transform primitives', () => {
    const incomingBaseLayer = createLayer('incoming');
    const plan = {
      transitionType: 'crossfade',
      definition: {
        id: 'crossfade',
        name: 'Transform Test',
        category: 'slide',
        defaultDuration: 2,
        minDuration: 0.1,
        description: 'Transform assembly test',
        recipe: [{
          kind: 'transform',
          target: 'incoming',
          scaleX: { from: 1, to: 2 },
          scaleY: { from: 1, to: 0.5 },
          rotateZ: { from: 0, to: Math.PI },
          curve: 'linear',
        }],
      },
      placement: 'center',
      edgePolicy: 'hold',
      requestedDuration: 2,
      resolvedDuration: 2,
      bodyOffset: 0,
      junctionTime: 2,
      bodyStart: 0,
      bodyEnd: 2,
      timingChanges: [],
      outgoing: {
        clipId: 'clip-a',
        trackId: 'track-v1',
        role: 'outgoing',
        startTime: 0,
        endTime: 2,
        handleNeeded: 1,
        handleAvailable: 1,
        realHandleDuration: 1,
        holdDuration: 0,
        coverage: [],
      },
      incoming: {
        clipId: 'clip-b',
        trackId: 'track-v1',
        role: 'incoming',
        startTime: 0,
        endTime: 2,
        handleNeeded: 1,
        handleAvailable: 1,
        realHandleDuration: 1,
        holdDuration: 0,
        coverage: [],
      },
    } satisfies TransitionPlan;

    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => role === 'incoming' ? incomingBaseLayer : createLayer('outgoing'),
    });

    const incomingLayer = layers.find((layer) => layer.sourceClipId === 'clip-b');

    expect(incomingLayer?.scale).toEqual({ x: 3, y: 2.25, z: 4 });
    expect(incomingLayer?.rotation).toEqual({ x: 0.1, y: 0.2, z: 0.3 + Math.PI / 2 });
    expect(incomingLayer?.scale).not.toBe(incomingBaseLayer.scale);
    expect(incomingLayer?.rotation).not.toBe(incomingBaseLayer.rotation);
    expect(incomingBaseLayer.scale).toEqual({ x: 2, y: 3, z: 4 });
    expect(incomingBaseLayer.rotation).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('composes 2.5D transform primitives without marking layers as shared-scene 3D', () => {
    const incomingBaseLayer = {
      ...createLayer('incoming'),
      rotation: 0,
    };
    const plan = createPlan([{
      kind: 'transform',
      target: 'incoming',
      translateZ: { from: 0, to: -0.4 },
      rotateX: { from: 0, to: Math.PI / 2 },
      rotateY: { from: 0, to: Math.PI / 3 },
      curve: 'linear',
    }]);

    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => role === 'incoming' ? incomingBaseLayer : createLayer('outgoing'),
    });

    const incomingLayer = layers.find((layer) => layer.sourceClipId === 'clip-b');

    expect(incomingLayer?.position.x).toBeCloseTo(0.1);
    expect(incomingLayer?.position.y).toBeCloseTo(-0.2);
    expect(incomingLayer?.position.z).toBeCloseTo(0.1);
    expect(typeof incomingLayer?.rotation).toBe('object');
    const rotation = incomingLayer?.rotation as { x: number; y: number; z: number } | undefined;
    expect(rotation?.x).toBeCloseTo(Math.PI / 4);
    expect(rotation?.y).toBeCloseTo(Math.PI / 6);
    expect(rotation?.z).toBeCloseTo(0);
    expect(incomingLayer?.is3D).toBeUndefined();
    expect(incomingLayer?.position).not.toBe(incomingBaseLayer.position);
    expect(incomingBaseLayer.position).toEqual({ x: 0.1, y: -0.2, z: 0.3 });
    expect(incomingBaseLayer.rotation).toBe(0);
  });

  it('marks scene panel transition participants as shared-scene 3D when they have renderable sources', () => {
    const incomingBaseLayer = {
      ...createLayer('incoming'),
      source: { type: 'image' as const, imageElement: document.createElement('img') },
      rotation: 0,
    };
    const outgoingBaseLayer = {
      ...createLayer('outgoing'),
      source: { type: 'video' as const, videoElement: document.createElement('video') },
      rotation: 0,
    };
    const plan = createPlan([{
      kind: 'transform',
      target: 'incoming',
      rotateY: { from: Math.PI / 2, to: 0 },
      startProgress: 0.5,
      curve: 'ease-out',
    }, {
      kind: 'transform',
      target: 'outgoing',
      rotateY: { from: 0, to: -Math.PI / 2 },
      endProgress: 0.5,
      curve: 'ease-in',
    }]);
    plan.definition.renderMode = 'scene-3d-panel';

    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => role === 'incoming' ? incomingBaseLayer : outgoingBaseLayer,
    });

    const incomingLayer = layers.find((layer) => layer.sourceClipId === 'clip-b');
    const outgoingLayer = layers.find((layer) => layer.sourceClipId === 'clip-a');

    expect(incomingLayer?.is3D).toBe(true);
    expect(outgoingLayer?.is3D).toBe(true);
  });

  it('compresses crt collapse into a horizontal transition beam at the midpoint', () => {
    const plan = createPlan(crtCollapse.recipe);

    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
    });

    const outgoingLayer = layers.find((layer) => layer.sourceClipId === 'clip-a');
    const incomingLayer = layers.find((layer) => layer.sourceClipId === 'clip-b');

    expect(outgoingLayer?.scale.x).toBeCloseTo(2.16);
    expect(outgoingLayer?.scale.y).toBeCloseTo(0.135);
    expect(outgoingLayer?.opacity).toBeGreaterThan(0.85);
    expect(incomingLayer?.scale.x).toBeCloseTo(2.16);
    expect(incomingLayer?.scale.y).toBeCloseTo(0.135);
    expect(incomingLayer?.opacity).toBe(0);
  });

  it('appends transition-scoped effects without replacing existing clip effects', () => {
    const plan = createPlan(blurDissolve.recipe);
    const clipEffect = {
      id: 'clip-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { value: 0.1 },
    } as Layer['effects'][number];

    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
        effects: [clipEffect],
      }),
    });

    const outgoingLayer = layers.find((layer) => layer.sourceClipId === 'clip-a');
    const incomingLayer = layers.find((layer) => layer.sourceClipId === 'clip-b');
    const outgoingTransitionEffect = outgoingLayer?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:gaussian-blur:outgoing')
    );
    const incomingTransitionEffect = incomingLayer?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:gaussian-blur:incoming')
    );

    expect(outgoingLayer?.effects[0]).toBe(clipEffect);
    expect(incomingLayer?.effects[0]).toBe(clipEffect);
    expect(outgoingTransitionEffect?.type).toBe('gaussian-blur');
    expect(incomingTransitionEffect?.type).toBe('gaussian-blur');
    expect(outgoingTransitionEffect?.params.radius).toBeCloseTo(9.04, 2);
    expect(incomingTransitionEffect?.params.radius).toBeCloseTo(9.04, 2);
    expect(outgoingTransitionEffect?.params.samples).toBe(11);
    expect(incomingTransitionEffect?.params.samples).toBe(11);
  });

  it('appends registered glitch effects with evaluated transition params', () => {
    const recipes = [
      { definition: rgbSplitGlitch, effectType: 'rgb-split', param: 'amount', expected: 0.031217 },
      { definition: mosaicGlitch, effectType: 'pixelate', param: 'size', expected: 25.678604 },
      { definition: scanlineGlitch, effectType: 'scanlines', param: 'opacity', expected: 0.354694 },
      { definition: kaleidoscope, effectType: 'kaleidoscope', param: 'segments', expected: 9.340278 },
    ];

    for (const { definition, effectType, param, expected } of recipes) {
      const layers = assembleTransitionLayers({
        plan: createPlan(definition.recipe),
        playheadPosition: 1,
        trackIndex: 0,
        outgoingClip,
        incomingClip,
        buildClipLayer: (_clip, role, opacity) => ({
          ...createLayer(role),
          opacity,
        }),
      });

      const outgoingLayer = layers.find((layer) => layer.sourceClipId === 'clip-a');
      const transitionEffect = outgoingLayer?.effects.find((effect) =>
        effect.id.startsWith(`transition-effect:${effectType}:outgoing`)
      );

      expect(transitionEffect?.type).toBe(effectType);
      expect(transitionEffect?.params[param]).toBeCloseTo(expected, 3);
    }
  });

  it('applies kaleidoscope transition effects to both participants', () => {
    const layers = assembleTransitionLayers({
      plan: createPlan(kaleidoscope.recipe),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
    });

    const outgoingEffect = layers
      .find((layer) => layer.sourceClipId === 'clip-a')
      ?.effects.find((effect) => effect.id.startsWith('transition-effect:kaleidoscope:outgoing'));
    const incomingEffect = layers
      .find((layer) => layer.sourceClipId === 'clip-b')
      ?.effects.find((effect) => effect.id.startsWith('transition-effect:kaleidoscope:incoming'));

    expect(outgoingEffect?.type).toBe('kaleidoscope');
    expect(incomingEffect?.type).toBe('kaleidoscope');
    expect(outgoingEffect?.params.segments).toBeCloseTo(9.340278, 3);
    expect(incomingEffect?.params.segments).toBeCloseTo(9.858025, 3);
    expect(outgoingEffect?.params.rotation).toBeCloseTo(3.030086, 3);
    expect(incomingEffect?.params.rotation).toBeCloseTo(-3.030086, 3);
  });

  it('applies light and film transition transforms and registered effects', () => {
    const filmLayers = assembleTransitionLayers({
      plan: createPlan(filmRoll.recipe),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
    });

    const filmOutgoing = filmLayers.find((layer) => layer.sourceClipId === 'clip-a');
    const filmIncoming = filmLayers.find((layer) => layer.sourceClipId === 'clip-b');
    const motionEffect = filmIncoming?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:motion-blur:incoming')
    );

    expect(filmOutgoing?.position.y).toBeLessThan(-0.2);
    expect(filmIncoming?.position.y).toBeGreaterThan(-0.2);
    expect(motionEffect?.type).toBe('motion-blur');
    expect(motionEffect?.params.amount).toBeCloseTo(0.048225, 3);

    const bloomLayers = assembleTransitionLayers({
      plan: createPlan(vignetteBloom.recipe),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
    });

    const bloomOutgoing = bloomLayers.find((layer) => layer.sourceClipId === 'clip-a');
    const glowEffect = bloomOutgoing?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:glow:outgoing')
    );
    const vignetteEffect = bloomOutgoing?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:vignette:outgoing')
    );

    expect(glowEffect?.type).toBe('glow');
    expect(glowEffect?.params.amount).toBeCloseTo(1.220408, 3);
    expect(vignetteEffect?.type).toBe('vignette');
    expect(vignetteEffect?.params.amount).toBeCloseTo(0.40963, 3);
  });

  it('applies transition-scoped blend modes only inside their progress window', () => {
    const plan = createPlan([{
      kind: 'blend',
      target: 'incoming',
      mode: 'add',
      startProgress: 0.2,
      endProgress: 0.8,
    }]);

    const midpointLayers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => createLayer(role),
    });
    const endLayers = assembleTransitionLayers({
      plan,
      playheadPosition: 2,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => createLayer(role),
    });

    expect(midpointLayers.find((layer) => layer.sourceClipId === 'clip-b')?.blendMode).toBe('add');
    expect(midpointLayers.find((layer) => layer.sourceClipId === 'clip-a')?.blendMode).toBe('normal');
    expect(endLayers.find((layer) => layer.sourceClipId === 'clip-b')?.blendMode).toBe('normal');
  });

  it('evaluates multi-segment solid opacity without later segments overwriting the active segment', () => {
    const plan = createPlan([
      { kind: 'solid', color: '#ffffff' },
      {
        kind: 'opacity',
        target: 'solid',
        from: 0,
        to: 1,
        startProgress: 0,
        endProgress: 0.5,
        curve: 'linear',
      },
      {
        kind: 'opacity',
        target: 'solid',
        from: 1,
        to: 0,
        startProgress: 0.5,
        endProgress: 1,
        curve: 'linear',
      },
    ]);

    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 0.5,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => createLayer(role),
    });

    const solidLayer = layers.find((layer) => layer.source?.type === 'solid');

    expect(solidLayer?.opacity).toBeCloseTo(0.5);
    expect(solidLayer?.source?.color).toBe('#ffffff');
  });

  it('sizes generated solid transition layers to the output aspect', () => {
    const layers = assembleTransitionLayers({
      plan: createPlan([{ kind: 'solid', color: '#ffffff' }]),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => createLayer(role),
      outputSize: { width: 1920, height: 1080 },
    });

    const solidCanvas = layers.find((layer) =>
      layer.source?.type === 'solid' &&
      layer.id.includes(':solid:')
    )?.source?.textCanvas;

    expect(solidCanvas?.width).toBe(1920);
    expect(solidCanvas?.height).toBe(1080);
  });

  it('creates generated light sweep overlay canvas layers above transition participants', () => {
    const layers = assembleTransitionLayers({
      plan: createPlan(lightSweep.recipe),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
    });

    const overlayLayers = layers.filter((layer) =>
      layer.source?.type === 'solid' &&
      layer.id.includes(':overlay:')
    );

    expect(overlayLayers.length).toBe(2);
    expect(overlayLayers[0]?.blendMode).toBe('screen');
    expect(overlayLayers[0]?.opacity).toBeGreaterThan(0);
    expect(overlayLayers[0]?.source?.color).toBe('#fff7d2');
    expect(overlayLayers[0]?.source?.textCanvas?.width).toBe(512);
    expect(overlayLayers[0]?.source?.textCanvas?.height).toBe(288);
    expect(layers[0]?.id).toContain(':overlay:');
    expect(layers.find((layer) => layer.sourceClipId === 'clip-b')?.transitionRender).toEqual({
      kind: 'soft-wipe',
      direction: 'right',
      progress: 0.5,
      angle: 0.18,
      feather: 0.1,
    });
  });

  it('creates generated light leak overlay canvas layers above transition participants', () => {
    const layers = assembleTransitionLayers({
      plan: createPlan(lightLeak.recipe),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
    });

    const overlayLayers = layers.filter((layer) =>
      layer.source?.type === 'solid' &&
      layer.id.includes(':overlay:')
    );

    expect(overlayLayers.length).toBe(1);
    expect(overlayLayers[0]?.blendMode).toBe('screen');
    expect(overlayLayers[0]?.opacity).toBeGreaterThan(0);
    expect(overlayLayers[0]?.source?.color).toBe('#ffb36a');
    expect(overlayLayers[0]?.source?.textCanvas?.width).toBe(512);
    expect(overlayLayers[0]?.source?.textCanvas?.height).toBe(288);
    expect(layers[0]?.id).toContain(':overlay:');
  });

  it('creates generated chroma, flare, and burn overlay canvas layers above transition participants', () => {
    const cases = [
      { definition: chromaLeak, color: '#ff3b8f' },
      { definition: lensFlare, color: '#d7f0ff' },
      { definition: filmBurn, color: '#ff6a2e' },
    ] as const;

    for (const { definition, color } of cases) {
      const layers = assembleTransitionLayers({
        plan: createPlan(definition.recipe),
        playheadPosition: 1,
        trackIndex: 0,
        outgoingClip,
        incomingClip,
        buildClipLayer: (_clip, role, opacity) => ({
          ...createLayer(role),
          opacity,
        }),
        outputSize: { width: 960, height: 540 },
      });
      const overlayLayers = layers.filter((layer) =>
        layer.source?.type === 'solid' &&
        layer.id.includes(':overlay:')
      );

      expect(overlayLayers.length).toBe(2);
      expect(overlayLayers[0]?.blendMode).toBe('normal');
      expect(overlayLayers[0]?.opacity).toBeGreaterThan(0);
      expect(overlayLayers[0]?.source?.color).toBe(color);
      expect(overlayLayers[0]?.source?.textCanvas?.width).toBe(960);
      expect(overlayLayers[0]?.source?.textCanvas?.height).toBe(540);
      expect(layers[0]?.id).toContain(':overlay:');
    }
  });

  it('keys generated overlay canvas cache entries by output size', () => {
    const buildLayers = (width: number, height: number) => assembleTransitionLayers({
      plan: createPlan(lightSweep.recipe),
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role, opacity) => ({
        ...createLayer(role),
        opacity,
      }),
      outputSize: { width, height },
    });
    const getOverlayCanvas = (layers: Layer[]) => layers.find((layer) =>
      layer.source?.type === 'solid' &&
      layer.id.includes(':overlay:')
    )?.source?.textCanvas;

    const first640 = getOverlayCanvas(buildLayers(640, 360));
    const second640 = getOverlayCanvas(buildLayers(640, 360));
    const first960 = getOverlayCanvas(buildLayers(960, 540));

    expect(first640?.width).toBe(640);
    expect(first640?.height).toBe(360);
    expect(second640).toBe(first640);
    expect(first960?.width).toBe(960);
    expect(first960?.height).toBe(540);
    expect(first960).not.toBe(first640);
  });

  it('maps shape, clock, and center mask primitives into transition render state', () => {
    const cases = [
      [
        [{ kind: 'mask', target: 'incoming', mask: 'shape', shape: 'circle' }],
        { kind: 'shape-mask', shape: 'circle', progress: 0.5 },
      ],
      [
        [{ kind: 'mask', target: 'incoming', mask: 'clock', clockwise: true, angleOffset: 0 }],
        { kind: 'clock-mask', clockwise: true, angleOffset: 0, progress: 0.5 },
      ],
      [
        [{ kind: 'mask', target: 'incoming', mask: 'center', axis: 'x' }],
        { kind: 'center-mask', axis: 'x', progress: 0.5 },
      ],
      [
        [{ kind: 'mask', target: 'incoming', mask: 'procedural', procedural: 'noise' }],
        { kind: 'procedural-mask', procedural: 'noise', progress: 0.5, seed: 0 },
      ],
      [
        [{ kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'checker' }],
        { kind: 'pattern-mask', pattern: 'checker', progress: 0.5 },
      ],
    ] as const;

    for (const [recipe, transitionRender] of cases) {
      const layers = assembleTransitionLayers({
        plan: createPlan(recipe),
        playheadPosition: 1,
        trackIndex: 0,
        outgoingClip,
        incomingClip,
        buildClipLayer: (_clip, role) => createLayer(role),
      });

      expect(layers.find((layer) => layer.sourceClipId === 'clip-b')?.transitionRender).toEqual(transitionRender);
      expect(layers.find((layer) => layer.sourceClipId === 'clip-a')?.transitionRender).toBeUndefined();
    }
  });

  it('passes normalized procedural mask seeds into transition render state', () => {
    const plan = {
      ...createPlan(noiseDissolve.recipe),
      transitionType: 'noise-dissolve',
      definition: noiseDissolve,
      params: { seed: 42 },
    } as TransitionPlan;
    const layers = assembleTransitionLayers({
      plan,
      playheadPosition: 1,
      trackIndex: 0,
      outgoingClip,
      incomingClip,
      buildClipLayer: (_clip, role) => createLayer(role),
    });

    expect(layers.find((layer) => layer.sourceClipId === 'clip-b')?.transitionRender).toEqual({
      kind: 'procedural-mask',
      procedural: 'noise',
      progress: 0.5,
      seed: 42,
    });
  });

  it('passes experimental distortion render state and seeds into transition participants', () => {
    for (const definition of [waterDrop, swirl]) {
      const plan = {
        ...createPlan(definition.recipe),
        transitionType: definition.id,
        definition,
        params: { seed: 77 },
      } as TransitionPlan;
      const layers = assembleTransitionLayers({
        plan,
        playheadPosition: 1,
        trackIndex: 0,
        outgoingClip,
        incomingClip,
        buildClipLayer: (_clip, role) => createLayer(role),
      });

      expect(layers.find((layer) => layer.sourceClipId === 'clip-b')?.transitionRender).toEqual({
        kind: 'distortion',
        distortion: definition.id,
        progress: 0.5,
        seed: 77,
      });
      expect(layers.find((layer) => layer.sourceClipId === 'clip-a')?.transitionRender).toEqual({
        kind: 'distortion',
        distortion: definition.id,
        progress: 0.5,
        seed: 77,
      });
    }
  });
});
