import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import type { ExportClipState, FrameContext } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';
import type { ParallelDecodeManager } from '../../src/engine/ParallelDecodeManager';
import { planTransition } from '../../src/stores/timeline/editOperations/transitionPlanner';
import type { TransitionParamValue, TransitionType } from '../../src/transitions';

const initialMediaState = useMediaStore.getState();

function createVideoTrack(): TimelineTrack {
  return {
    id: 'track-1',
    type: 'video',
    visible: true,
    solo: false,
  } as unknown as TimelineTrack;
}

function createTransitionClip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  sourceType: 'image' | 'video' = 'image',
): TimelineClip {
  const source = sourceType === 'video'
    ? { type: 'video' as const, videoElement: document.createElement('video') }
    : { type: 'image' as const, imageElement: document.createElement('img') };

  return {
    id,
    name: id,
    trackId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source,
    transform: {},
    effects: [],
  } as unknown as TimelineClip;
}

function createDefaultTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    opacity: 1,
    blendMode: 'normal' as const,
  };
}

interface BuildTransitionExportLayersOptions {
  transitionType: TransitionType;
  requestedDuration?: number;
  time?: number;
  sourceType?: 'image' | 'video';
  outgoingClip?: Partial<TimelineClip>;
  incomingClip?: Partial<TimelineClip>;
  clipEffects?: ReturnType<FrameContext['getInterpolatedEffects']>;
  clipStates?: Map<string, ExportClipState>;
  outputWidth?: number;
  outputHeight?: number;
  transitionParams?: Record<string, TransitionParamValue>;
}

function buildTransitionExportLayers({
  transitionType,
  requestedDuration = 2,
  time = 10,
  sourceType = 'image',
  outgoingClip: outgoingOverrides,
  incomingClip: incomingOverrides,
  clipEffects = [],
  clipStates = new Map(),
  outputWidth = 1280,
  outputHeight = 720,
  transitionParams,
}: BuildTransitionExportLayersOptions) {
  const track = createVideoTrack();
  const outgoingClip = {
    ...createTransitionClip('outgoing', track.id, 0, 10, sourceType),
    transitionOut: {
      type: transitionType,
      duration: requestedDuration,
      linkedClipId: 'incoming',
      ...(transitionParams ? { params: transitionParams } : {}),
    },
    ...outgoingOverrides,
  } as TimelineClip;
  const incomingClip = {
    ...createTransitionClip('incoming', track.id, 10, 5, sourceType),
    ...incomingOverrides,
  } as TimelineClip;
  const plan = planTransition({
    outgoingClip,
    incomingClip,
    transitionType,
    requestedDuration,
    placement: 'center',
    edgePolicy: 'hold',
    junctionTime: outgoingClip.startTime + outgoingClip.duration,
    params: transitionParams,
  });
  expect(plan).not.toBeNull();

  const ctx: FrameContext = {
    time,
    fps: 30,
    frameTolerance: 50_000,
    outputWidth,
    outputHeight,
    clipsAtTime: [outgoingClip],
    renderClipsAtTime: [outgoingClip, incomingClip],
    trackMap: new Map([[track.id, track]]),
    clipsByTrack: new Map([[track.id, outgoingClip]]),
    transitionParticipantsByTrack: new Map([[track.id, {
      plan: plan!,
      outgoingClip,
      incomingClip,
    }]]),
    getInterpolatedTransform: createDefaultTransform,
    getInterpolatedEffects: () => clipEffects,
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({}),
    getInterpolatedTextBounds: () => undefined,
    getSourceTimeForClip: (_clipId, localTime) => localTime,
    getInterpolatedSpeed: () => 1,
  };

  initializeLayerBuilder([track]);

  return {
    layers: buildLayersAtTime(ctx, clipStates, null, false),
    plan: plan!,
    outgoingClip,
    incomingClip,
  };
}

function withMediaStoreState<T>(
  overrides: Partial<ReturnType<typeof useMediaStore.getState>>,
  run: () => T,
): T {
  const getStateMock = vi.mocked(useMediaStore.getState);
  const previousImplementation = getStateMock.getMockImplementation();
  getStateMock.mockReturnValue({
    ...initialMediaState,
    ...overrides,
  });

  try {
    return run();
  } finally {
    if (previousImplementation) {
      getStateMock.mockImplementation(previousImplementation);
    }
  }
}

describe('ExportLayerBuilder', () => {
  beforeEach(() => {
    useMediaStore.setState({
      compositions: [],
    });
    useTimelineStore.setState({
      clipKeyframes: new Map(),
    });
  });

  afterEach(() => {
    cleanupLayerBuilder();
  });

  it('builds export layers for virtual transition participants', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const outgoingImage = document.createElement('img');
    const incomingImage = document.createElement('img');
    const outgoingClip = {
      id: 'outgoing',
      name: 'Outgoing',
      trackId: track.id,
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      transitionOut: { type: 'crossfade', duration: 2, linkedClipId: 'incoming' },
      source: { type: 'image', imageElement: outgoingImage },
      transform: {},
    } as unknown as TimelineClip;
    const incomingClip = {
      id: 'incoming',
      name: 'Incoming',
      trackId: track.id,
      startTime: 10,
      duration: 5,
      inPoint: 0.5,
      outPoint: 5.5,
      source: { type: 'image', imageElement: incomingImage },
      transform: {},
    } as unknown as TimelineClip;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });
    expect(plan).not.toBeNull();

    const ctx: FrameContext = {
      time: 10,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [outgoingClip],
      renderClipsAtTime: [outgoingClip, incomingClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, outgoingClip]]),
      transitionParticipantsByTrack: new Map([[track.id, {
        plan: plan!,
        outgoingClip,
        incomingClip,
      }]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId, localTime) => localTime,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(2);
    expect(layers.map(layer => layer.sourceClipId)).toEqual(['incoming', 'outgoing']);
    expect(layers[0]?.opacity).toBeCloseTo(0.5);
    expect(layers[0]?.id).toContain('transition:crossfade:outgoing:incoming:incoming');
  });

  it('applies transform transition offsets to export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const outgoingImage = document.createElement('img');
    const incomingImage = document.createElement('img');
    const outgoingClip = {
      id: 'outgoing',
      name: 'Outgoing',
      trackId: track.id,
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      transitionOut: { type: 'push-left', duration: 2, linkedClipId: 'incoming' },
      source: { type: 'image', imageElement: outgoingImage },
      transform: {},
    } as unknown as TimelineClip;
    const incomingClip = {
      id: 'incoming',
      name: 'Incoming',
      trackId: track.id,
      startTime: 10,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: 'image', imageElement: incomingImage },
      transform: {},
    } as unknown as TimelineClip;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'push-left',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });
    expect(plan).not.toBeNull();

    const ctx: FrameContext = {
      time: 10,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [outgoingClip],
      renderClipsAtTime: [outgoingClip, incomingClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, outgoingClip]]),
      transitionParticipantsByTrack: new Map([[track.id, {
        plan: plan!,
        outgoingClip,
        incomingClip,
      }]]),
      getInterpolatedTransform: (clipId) => ({
        position: clipId === 'outgoing'
          ? { x: 0.2, y: 0.1, z: 0.3 }
          : { x: -0.1, y: -0.2, z: 0.4 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId, localTime) => localTime,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers.map(layer => layer.sourceClipId)).toEqual(['incoming', 'outgoing']);
    expect(layers[0]?.position).toEqual({ x: 0.4, y: -0.2, z: 0.4 });
    expect(layers[1]?.position).toEqual({ x: -0.3, y: 0.1, z: 0.3 });
  });

  it('exports representative transition primitive families through the shared assembly path', () => {
    const lightSweepLayers = buildTransitionExportLayers({ transitionType: 'light-sweep' }).layers;
    const overlayLayers = lightSweepLayers
      .filter((layer) => layer.id.includes(':overlay:'));
    expect(lightSweepLayers.map((layer) => layer.sourceClipId ?? 'overlay')).toEqual([
      'incoming',
      'outgoing',
      'overlay',
      'overlay',
    ]);
    expect(overlayLayers).toHaveLength(2);
    expect(overlayLayers[0]?.blendMode).toBe('screen');
    expect(overlayLayers[0]?.opacity).toBeCloseTo(0.5759, 3);
    expect(overlayLayers[1]?.opacity).toBeCloseTo(0.42, 2);
    expect(overlayLayers[0]?.source?.type).toBe('solid');
    expect(overlayLayers[0]?.source?.color).toBe('#fff7d2');
    expect(overlayLayers[0]?.source?.textCanvas?.width).toBe(1280);
    expect(overlayLayers[0]?.source?.textCanvas?.height).toBe(720);
    expect(lightSweepLayers.at(-1)?.id).toContain(':overlay:');

    for (const transitionType of ['chroma-leak', 'lens-flare', 'film-burn'] as const) {
      const layers = buildTransitionExportLayers({ transitionType }).layers;
      const generatedOverlays = layers.filter((layer) => layer.id.includes(':overlay:'));

      expect(generatedOverlays).toHaveLength(2);
      expect(generatedOverlays[0]?.blendMode).toBe('normal');
      expect(generatedOverlays[0]?.opacity).toBeGreaterThan(0);
      expect(generatedOverlays[0]?.source?.type).toBe('solid');
      expect(generatedOverlays[0]?.source?.textCanvas?.width).toBe(1280);
      expect(generatedOverlays[0]?.source?.textCanvas?.height).toBe(720);
    }

    const clipEffect = {
      id: 'clip-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { value: 0.2 },
    } as ReturnType<FrameContext['getInterpolatedEffects']>[number];
    const effectLayers = buildTransitionExportLayers({
      transitionType: 'rgb-split-glitch',
      clipEffects: [clipEffect],
    }).layers;
    const effectOutgoing = effectLayers.find((layer) => layer.sourceClipId === 'outgoing');
    const rgbSplitEffect = effectOutgoing?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:rgb-split:outgoing')
    );
    expect(effectOutgoing?.effects[0]).toBe(clipEffect);
    expect(rgbSplitEffect?.type).toBe('rgb-split');
    expect(rgbSplitEffect?.enabled).toBe(true);
    expect(rgbSplitEffect?.params.angle).toBe(0);
    expect(rgbSplitEffect?.params.amount).toBeCloseTo(0.031217, 6);

    const kaleidoscopeLayers = buildTransitionExportLayers({ transitionType: 'kaleidoscope' }).layers;
    const kaleidoscopeOutgoing = kaleidoscopeLayers.find((layer) => layer.sourceClipId === 'outgoing');
    const kaleidoscopeIncoming = kaleidoscopeLayers.find((layer) => layer.sourceClipId === 'incoming');
    const outgoingKaleidoscope = kaleidoscopeOutgoing?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:kaleidoscope:outgoing')
    );
    const incomingKaleidoscope = kaleidoscopeIncoming?.effects.find((effect) =>
      effect.id.startsWith('transition-effect:kaleidoscope:incoming')
    );
    expect(outgoingKaleidoscope?.type).toBe('kaleidoscope');
    expect(incomingKaleidoscope?.type).toBe('kaleidoscope');
    expect(outgoingKaleidoscope?.params.segments).toBeCloseTo(9.340278, 6);
    expect(incomingKaleidoscope?.params.segments).toBeCloseTo(9.858025, 6);

    const blendLayers = buildTransitionExportLayers({ transitionType: 'additive-dissolve' }).layers;
    expect(blendLayers.find((layer) => layer.sourceClipId === 'incoming')?.blendMode).toBe('add');
    expect(blendLayers.find((layer) => layer.sourceClipId === 'outgoing')?.blendMode).toBe('normal');
    const inactiveBlendLayers = buildTransitionExportLayers({
      transitionType: 'additive-dissolve',
      time: 10.95,
    }).layers;
    expect(inactiveBlendLayers.find((layer) => layer.sourceClipId === 'incoming')?.blendMode).toBe('normal');

    const proceduralLayers = buildTransitionExportLayers({
      transitionType: 'noise-dissolve',
      transitionParams: { seed: 17 },
    }).layers;
    expect(proceduralLayers.find((layer) => layer.sourceClipId === 'incoming')?.transitionRender).toEqual({
      kind: 'procedural-mask',
      procedural: 'noise',
      progress: 0.5,
      seed: 17,
    });
    expect(proceduralLayers.find((layer) => layer.sourceClipId === 'outgoing')?.transitionRender).toBeUndefined();

    const patternLayers = buildTransitionExportLayers({ transitionType: 'checker-wipe' }).layers;
    expect(patternLayers.find((layer) => layer.sourceClipId === 'incoming')?.transitionRender).toEqual({
      kind: 'pattern-mask',
      pattern: 'checker',
      progress: 0.5,
    });
    expect(patternLayers.find((layer) => layer.sourceClipId === 'outgoing')?.transitionRender).toBeUndefined();

    const puzzleLayers = buildTransitionExportLayers({ transitionType: 'puzzle-push' }).layers;
    const puzzlePanelLayers = puzzleLayers.filter((layer) =>
      layer.id.includes(':incoming:incoming:') && layer.sourceRect
    );
    expect(puzzlePanelLayers).toHaveLength(16);
    expect(puzzleLayers.find((layer) => layer.sourceClipId === 'incoming' && !layer.sourceRect)).toBeUndefined();
    expect(puzzleLayers.find((layer) => layer.sourceClipId === 'outgoing')).toBeTruthy();
    expect(puzzlePanelLayers.at(-1)?.sourceRect).toEqual({
      x: 0,
      y: 0,
      width: 0.25,
      height: 0.25,
    });
    expect(puzzlePanelLayers.at(-1)?.scale.x).toBeCloseTo(0.25);
    expect(puzzlePanelLayers.at(-1)?.scale.y).toBeCloseTo(0.25);

    const magneticLayers = buildTransitionExportLayers({ transitionType: 'magnetic-tiles' }).layers;
    const magneticPanelLayers = magneticLayers.filter((layer) =>
      layer.id.includes(':incoming:incoming:') && layer.sourceRect
    );
    expect(magneticPanelLayers).toHaveLength(20);
    expect(magneticLayers.find((layer) => layer.sourceClipId === 'incoming' && !layer.sourceRect)).toBeUndefined();
    expect(magneticLayers.find((layer) => layer.sourceClipId === 'outgoing')).toBeTruthy();
    const magneticTopLeftLayer = magneticPanelLayers.find((layer) =>
      layer.sourceRect?.x === 0 && layer.sourceRect.y === 0
    );
    expect(magneticTopLeftLayer?.sourceRect).toEqual({
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.25,
    });

    const threeDLayers = buildTransitionExportLayers({ transitionType: 'roll-3d' }).layers;
    const incoming3DLayer = threeDLayers.find((layer) => layer.sourceClipId === 'incoming');
    const outgoing3DLayer = threeDLayers.find((layer) => layer.sourceClipId === 'outgoing');
    const incomingRotation = incoming3DLayer?.rotation as { x: number; y: number; z: number } | undefined;
    const outgoingRotation = outgoing3DLayer?.rotation as { x: number; y: number; z: number } | undefined;
    expect(incoming3DLayer?.is3D).toBe(true);
    expect(outgoing3DLayer?.is3D).toBe(true);
    expect(incoming3DLayer?.position.y).toBeCloseTo(0.055, 3);
    expect(incoming3DLayer?.position.z).toBeCloseTo(-0.148, 3);
    expect(incoming3DLayer?.scale.x).toBeCloseTo(0.963, 3);
    expect(incomingRotation?.x).toBeCloseTo(1.4522895033236836, 6);
    expect(incomingRotation?.z).toBeCloseTo(0.09245562130177513, 6);
    expect(outgoingRotation?.x).toBeCloseTo(-1.4522895033236836, 6);
  });

  it('exports hold-frame transition participants at fixed source times across transition primitive families', () => {
    const transitionTypes: TransitionType[] = [
      'light-sweep',
      'rgb-split-glitch',
      'additive-dissolve',
      'noise-dissolve',
      'kaleidoscope',
      'checker-wipe',
      'roll-3d',
    ];
    const baseOutgoing = createTransitionClip('outgoing', 'track-1', 0, 1, 'video');
    const baseIncoming = createTransitionClip('incoming', 'track-1', 1, 1, 'video');
    const expectedHoldSourceTime = 1 - (1 / 120);
    const clipStates = new Map<string, ExportClipState>([
      ['outgoing', {
        clipId: 'outgoing',
        webCodecsPlayer: { getCurrentFrame: () => ({ displayWidth: 1920, displayHeight: 1080 }) as VideoFrame } as unknown as ExportClipState['webCodecsPlayer'],
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: baseOutgoing.source?.videoElement,
      }],
      ['incoming', {
        clipId: 'incoming',
        webCodecsPlayer: { getCurrentFrame: () => ({ displayWidth: 1920, displayHeight: 1080 }) as VideoFrame } as unknown as ExportClipState['webCodecsPlayer'],
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: baseIncoming.source?.videoElement,
      }],
    ]);

    for (const transitionType of transitionTypes) {
      const { layers, plan } = buildTransitionExportLayers({
        transitionType,
        requestedDuration: 4,
        time: 2.5,
        sourceType: 'video',
        clipStates,
        outgoingClip: {
          startTime: baseOutgoing.startTime,
          duration: baseOutgoing.duration,
          inPoint: baseOutgoing.inPoint,
          outPoint: baseOutgoing.outPoint,
        },
        incomingClip: {
          startTime: baseIncoming.startTime,
          duration: baseIncoming.duration,
          inPoint: baseIncoming.inPoint,
          outPoint: baseIncoming.outPoint,
        },
      });

      const outgoingHold = plan.outgoing.coverage.find((range) =>
        range.kind === 'hold' &&
        2.5 >= range.startTime &&
        2.5 <= range.endTime
      );
      const incomingHold = plan.incoming.coverage.find((range) =>
        range.kind === 'hold' &&
        2.5 >= range.startTime &&
        2.5 <= range.endTime
      );
      const outgoingLayer = layers.find((layer) => layer.sourceClipId === 'outgoing');
      const incomingLayer = layers.find((layer) => layer.sourceClipId === 'incoming');

      expect(outgoingHold?.sourceStart).toBeCloseTo(expectedHoldSourceTime, 6);
      expect(incomingHold?.sourceStart).toBeCloseTo(expectedHoldSourceTime, 6);
      expect(outgoingLayer?.source?.type).toBe('video');
      expect(incomingLayer?.source?.type).toBe('video');
      expect(outgoingLayer?.source?.mediaTime).toBeCloseTo(expectedHoldSourceTime, 6);
      expect(incomingLayer?.source?.mediaTime).toBeCloseTo(expectedHoldSourceTime, 6);
    }
  });

  it('uses transition source time for export video layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const outgoingVideo = document.createElement('video');
    const incomingVideo = document.createElement('video');
    const outgoingClip = {
      id: 'outgoing',
      name: 'Outgoing',
      trackId: track.id,
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      transitionOut: { type: 'crossfade', duration: 2, linkedClipId: 'incoming' },
      source: { type: 'video', videoElement: outgoingVideo },
      transform: {},
    } as unknown as TimelineClip;
    const incomingClip = {
      id: 'incoming',
      name: 'Incoming',
      trackId: track.id,
      startTime: 10,
      duration: 5,
      inPoint: 0.5,
      outPoint: 5.5,
      source: { type: 'video', videoElement: incomingVideo },
      transform: {},
    } as unknown as TimelineClip;
    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: 'crossfade',
      requestedDuration: 2,
      placement: 'center',
      edgePolicy: 'hold',
      junctionTime: 10,
    });
    expect(plan).not.toBeNull();

    const currentFrame = { displayWidth: 1920, displayHeight: 1080 } as VideoFrame;
    const clipStates = new Map<string, ExportClipState>([
      ['outgoing', {
        clipId: 'outgoing',
        webCodecsPlayer: { getCurrentFrame: () => currentFrame } as unknown as ExportClipState['webCodecsPlayer'],
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: outgoingVideo,
      }],
      ['incoming', {
        clipId: 'incoming',
        webCodecsPlayer: { getCurrentFrame: () => currentFrame } as unknown as ExportClipState['webCodecsPlayer'],
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: incomingVideo,
      }],
    ]);
    const ctx: FrameContext = {
      time: 9.75,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [outgoingClip],
      renderClipsAtTime: [outgoingClip, incomingClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, outgoingClip]]),
      transitionParticipantsByTrack: new Map([[track.id, {
        plan: plan!,
        outgoingClip,
        incomingClip,
      }]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getSourceTimeForClip: (_clipId, localTime) => localTime,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, null, false);

    expect(layers[0]?.sourceClipId).toBe('incoming');
    expect(layers[0]?.source?.mediaTime).toBeCloseTo(0.25);
    expect(layers[1]?.sourceClipId).toBe('outgoing');
    expect(layers[1]?.source?.mediaTime).toBeCloseTo(9.75);
  });

  it('uses the current WebCodecs VideoFrame for sequential export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const videoElement = document.createElement('video');
    const currentFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;

    const clip = {
      id: 'clip-1',
      name: 'Clip 1',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'video',
        videoElement,
      },
      transform: {},
    } as unknown as TimelineClip;

    const clipStates = new Map<string, ExportClipState>([
      ['clip-1', {
        clipId: 'clip-1',
        webCodecsPlayer: {
          getCurrentFrame: () => currentFrame,
        } as unknown as TimelineClip,
        lastSampleIndex: 0,
        isSequential: true,
        preciseVideoElement: videoElement,
      }],
    ]);

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.videoFrame).toBe(currentFrame);
    expect(layers[0]?.source?.webCodecsPlayer).toBe(clipStates.get('clip-1')?.webCodecsPlayer);
  });

  it('uses export lookup tolerance for parallel decoded frames', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const videoElement = document.createElement('video');
    const parallelFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;

    const clip = {
      id: 'clip-1',
      name: 'Clip 1',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'video',
        videoElement,
      },
      transform: {},
    } as unknown as TimelineClip;

    const clipStates = new Map<string, ExportClipState>([
      ['clip-1', {
        clipId: 'clip-1',
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        preciseVideoElement: videoElement,
      }],
    ]);

    const parallelDecoder = {
      hasClip: vi.fn(() => true),
      getFrameForClip: vi.fn(() => parallelFrame),
      getFrameForClipSourceTime: vi.fn(() => parallelFrame),
    } as unknown as ParallelDecodeManager;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, parallelDecoder, true);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.videoFrame).toBe(parallelFrame);
    expect(parallelDecoder.getFrameForClipSourceTime).toHaveBeenCalledWith(
      'clip-1',
      0.5,
      { toleranceMultiplier: 3 },
    );
  });

  it('uses prepared export image elements for data-only image clips', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const imageElement = document.createElement('img');
    const clip = {
      id: 'clip-image',
      name: 'Still',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: {
        type: 'image',
        imageUrl: 'blob:data-only-image',
      },
      transform: {},
      effects: [],
    } as unknown as TimelineClip;
    const clipStates = new Map<string, ExportClipState>([[
      clip.id,
      {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        exportImageElement: imageElement,
      },
    ]]);
    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, clipStates, null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source).toEqual({
      type: 'image',
      imageElement,
    });
    expect(clip.source?.imageElement).toBeUndefined();
  });

  it('forces gaussian splats onto the native scene path while keeping full-quality export settings', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-splat',
      name: 'Splat Clip',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:splat',
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
            maxSplats: 2048,
            splatScale: 1.5,
            nearPlane: 0.5,
            farPlane: 500,
            backgroundColor: 'transparent',
            sortFrequency: 8,
          },
          temporal: {
            enabled: false,
            playbackMode: 'loop',
            sequenceFps: 30,
            frameBlend: 0,
          },
          particle: {
            enabled: false,
            effectType: 'none',
            intensity: 0.5,
            speed: 1,
            seed: 42,
          },
        },
      },
      file: { name: 'hero.splat' },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getInterpolatedVectorAnimationSettings: () => ({
        loop: false,
        endBehavior: 'hold',
        playbackMode: 'forward',
        fit: 'contain',
      }),
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);
    const settings = layers[0]?.source?.gaussianSplatSettings;

    expect(layers).toHaveLength(1);
    expect(settings?.render.useNativeRenderer).toBe(true);
    expect(settings?.render.maxSplats).toBe(0);
    expect(settings?.render.sortFrequency).toBe(1);
    expect(settings?.render.splatScale).toBe(1.5);
  });

  it('converts gaussian splat export rotations to radians for the native shared scene', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-splat-rotation',
      name: 'Splat Rotation',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:splat',
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
          },
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 90, y: 45, z: 180 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.rotation).toMatchObject({
      x: Math.PI / 2,
      y: Math.PI / 4,
      z: Math.PI,
    });
  });

  it('preserves mesh metadata for 3D text export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-text3d',
      name: '3D Text',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'model',
      },
      meshType: 'text3d',
      text3DProperties: {
        text: 'Hello',
        fontFamily: 'helvetiker',
        fontWeight: 'bold',
        size: 1,
        depth: 0.2,
        color: '#ffffff',
        letterSpacing: 0.1,
        lineHeight: 1.1,
        textAlign: 'center',
        curveSegments: 8,
        bevelEnabled: false,
        bevelThickness: 0,
        bevelSize: 0,
        bevelSegments: 0,
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.meshType).toBe('text3d');
    expect(layers[0]?.source?.text3DProperties?.text).toBe('Hello');
  });

  it('resolves the correct model sequence frame for export time', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    useMediaStore.setState({
      files: [{
        id: 'media-model-seq-1',
        name: 'hero (3f)',
        type: 'model',
        createdAt: 1,
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            { name: 'hero000000.glb', modelUrl: 'blob:hero-0' },
            { name: 'hero000001.glb', modelUrl: 'blob:hero-1' },
            { name: 'hero000002.glb', modelUrl: 'blob:hero-2' },
          ],
        },
      }],
      compositions: [],
    });

    const clip = {
      id: 'clip-model-seq-1',
      name: 'Hero Sequence',
      trackId: 'track-1',
      mediaFileId: 'media-model-seq-1',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'model',
        mediaFileId: 'media-model-seq-1',
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            { name: 'hero000000.glb', modelUrl: 'blob:hero-0' },
            { name: 'hero000001.glb', modelUrl: 'blob:hero-1' },
            { name: 'hero000002.glb', modelUrl: 'blob:hero-2' },
          ],
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('blob:hero-1');
    expect(layers[0]?.source?.modelSequence?.frameCount).toBe(3);
  });

  it('falls back to media-library model sequence and URL for export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const modelFile = new File(['model'], 'fallback.glb', { type: 'model/gltf-binary' });

    const mediaState = {
      files: [{
        id: 'media-model-fallback',
        name: 'fallback.glb',
        type: 'model',
        createdAt: 1,
        file: modelFile,
        url: 'blob:media-model-fallback',
        modelSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'fallback',
          frames: [
            { name: 'fallback000000.glb', modelUrl: 'https://assets.local/fallback-0.glb' },
            { name: 'fallback000001.glb', modelUrl: 'https://assets.local/fallback-1.glb' },
            { name: 'fallback000002.glb', modelUrl: 'https://assets.local/fallback-2.glb' },
          ],
        },
      }],
      compositions: [],
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useMediaStore.setState(mediaState);

    const clip = {
      id: 'clip-model-fallback',
      name: 'Fallback Model',
      trackId: 'track-1',
      mediaFileId: 'media-model-fallback',
      file: modelFile,
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'model',
        mediaFileId: 'media-model-fallback',
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = withMediaStoreState(mediaState, () => buildLayersAtTime(ctx, new Map(), null, false));

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('https://assets.local/fallback-1.glb');
    expect(layers[0]?.source?.modelSequence?.frameCount).toBe(3);
  });

  it('falls back to media-library model URL for export layers without sequence data', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const mediaState = {
      files: [{
        id: 'media-model-url',
        name: 'url-model.glb',
        type: 'model',
        createdAt: 1,
        url: 'https://assets.local/url-model.glb',
      }],
      compositions: [],
    } satisfies Partial<ReturnType<typeof useMediaStore.getState>>;
    useMediaStore.setState(mediaState);

    const clip = {
      id: 'clip-model-url',
      name: 'URL Model',
      trackId: 'track-1',
      mediaFileId: 'media-model-url',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'model',
        mediaFileId: 'media-model-url',
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = withMediaStoreState(mediaState, () => buildLayersAtTime(ctx, new Map(), null, false));

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('model');
    expect(layers[0]?.source?.modelUrl).toBe('https://assets.local/url-model.glb');
    expect(layers[0]?.source?.modelSequence).toBeUndefined();
  });

  it('resolves the correct gaussian splat sequence frame for export and keeps native renderer selection', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const frameFiles = [
      new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
      new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
    ];

    useMediaStore.setState({
      files: [{
        id: 'media-splat-seq-1',
        name: 'scan (3f)',
        type: 'gaussian-splat',
        createdAt: 1,
        gaussianSplatSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          frames: [
            { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
            { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
            { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
          ],
        },
      }],
      compositions: [],
    });

    const clip = {
      id: 'clip-splat-seq-1',
      name: 'Scan Sequence',
      trackId: 'track-1',
      mediaFileId: 'media-splat-seq-1',
      startTime: 0,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: {
        type: 'gaussian-splat',
        mediaFileId: 'media-splat-seq-1',
        gaussianSplatSequence: {
          fps: 2,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          frames: [
            { name: 'scan000000.ply', projectPath: 'Raw/scan000000.ply', file: frameFiles[0], splatUrl: 'blob:scan-0' },
            { name: 'scan000001.ply', projectPath: 'Raw/scan000001.ply', file: frameFiles[1], splatUrl: 'blob:scan-1' },
            { name: 'scan000002.ply', projectPath: 'Raw/scan000002.ply', file: frameFiles[2], splatUrl: 'blob:scan-2' },
          ],
        },
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
            maxSplats: 4096,
            splatScale: 1.25,
            nearPlane: 0.5,
            farPlane: 500,
            backgroundColor: 'transparent',
            sortFrequency: 6,
          },
          temporal: {
            enabled: false,
            playbackMode: 'loop',
            sequenceFps: 30,
            frameBlend: 0,
          },
          particle: {
            enabled: false,
            effectType: 'none',
            intensity: 0,
            speed: 1,
            seed: 1,
          },
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 0.5,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 0.5,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('gaussian-splat');
    expect(layers[0]?.source?.gaussianSplatUrl).toBe('blob:scan-1');
    expect(layers[0]?.source?.gaussianSplatFileName).toBe('scan000001.ply');
    expect(layers[0]?.source?.gaussianSplatFileHash).toBeUndefined();
    expect(layers[0]?.source?.gaussianSplatRuntimeKey).toBe('Raw/scan000001.ply');
    expect(layers[0]?.source?.file).toBe(frameFiles[1]);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.useNativeRenderer).toBe(true);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.maxSplats).toBe(0);
    expect(layers[0]?.source?.gaussianSplatSettings?.render.sortFrequency).toBe(1);
  });

  it('builds nested 3D text and gaussian splat export layers for compositions', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    useMediaStore.setState({
      compositions: [
        {
          id: 'comp-1',
          width: 1280,
          height: 720,
        },
      ],
    });

    const compositionClip = {
      id: 'comp-clip',
      name: 'Nested Comp',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      isComposition: true,
      compositionId: 'comp-1',
      nestedTracks: [
        {
          id: 'nested-track-1',
          type: 'video',
          visible: true,
          solo: false,
        },
        {
          id: 'nested-track-2',
          type: 'video',
          visible: true,
          solo: false,
        },
      ],
      nestedClips: [
        {
          id: 'nested-text3d',
          name: 'Nested 3D Text',
          trackId: 'nested-track-1',
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          source: { type: 'model' },
          meshType: 'text3d',
          text3DProperties: {
            text: 'Nested Hello',
            fontFamily: 'helvetiker',
            fontWeight: 'bold',
            size: 1,
            depth: 0.2,
            color: '#ffffff',
            letterSpacing: 0,
            lineHeight: 1.1,
            textAlign: 'center',
            curveSegments: 8,
            bevelEnabled: false,
            bevelThickness: 0,
            bevelSize: 0,
            bevelSegments: 0,
          },
          transform: {},
          is3D: true,
          effects: [],
        },
        {
          id: 'nested-splat',
          name: 'Nested Splat',
          trackId: 'nested-track-2',
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:nested-splat',
            gaussianSplatFileName: 'nested.splat',
            gaussianSplatFileHash: 'nested-hash',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: false,
                maxSplats: 1024,
                sortFrequency: 5,
              },
              temporal: {
                enabled: false,
                playbackMode: 'loop',
                sequenceFps: 30,
                frameBlend: 0,
              },
              particle: {
                enabled: false,
                effectType: 'none',
                intensity: 0,
                speed: 1,
                seed: 1,
              },
            },
          },
          transform: {},
          is3D: true,
          effects: [],
        },
      ],
      source: {
        type: 'image',
        imageElement: document.createElement('img'),
      },
      transform: {},
      effects: [],
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [compositionClip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, compositionClip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);
    const nestedLayers = layers[0]?.source?.nestedComposition?.layers ?? [];

    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.nestedComposition?.sceneClips).toBe(compositionClip.nestedClips);
    expect(layers[0]?.source?.nestedComposition?.sceneTracks).toBe(compositionClip.nestedTracks);
    expect(nestedLayers).toHaveLength(2);
    expect(nestedLayers[0]?.source?.meshType).toBe('text3d');
    expect(nestedLayers[0]?.source?.text3DProperties?.text).toBe('Nested Hello');
    expect(nestedLayers[1]?.source?.gaussianSplatFileHash).toBe('nested-hash');
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.useNativeRenderer).toBe(true);
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.maxSplats).toBe(0);
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.sortFrequency).toBe(1);
  });

  it('keeps sequence gaussian splat export rotations in radians for the native shared scene', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;

    const clip = {
      id: 'clip-native-sequence-rotation',
      name: 'Native Sequence Rotation',
      trackId: 'track-1',
      startTime: 0,
      duration: 5,
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:splat',
        gaussianSplatRuntimeKey: 'Raw/frame_0002.ply',
        gaussianSplatSequence: {
          frameCount: 2,
          fps: 24,
          frames: [],
        },
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
          },
        },
      },
      transform: {},
      is3D: true,
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 90, y: 45, z: 180 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(layers).toHaveLength(1);
    expect(layers[0]?.rotation).toMatchObject({
      x: Math.PI / 2,
      y: Math.PI / 4,
      z: Math.PI,
    });
  });

  it('exports lottie clips via the shared text canvas path', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as unknown as TimelineTrack;
    const canvas = document.createElement('canvas');
    const renderSpy = vi.spyOn(vectorAnimationRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

    const clip = {
      id: 'clip-lottie',
      name: 'Lottie Clip',
      trackId: 'track-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: {
        type: 'lottie',
        textCanvas: canvas,
        naturalDuration: 4,
      },
      transform: {},
      effects: [],
      file: new File(['lottie'], 'anim.lottie', { type: 'application/zip' }),
    } as unknown as TimelineClip;

    const ctx: FrameContext = {
      time: 1,
      fps: 30,
      frameTolerance: 50_000,
      clipsAtTime: [clip],
      trackMap: new Map([[track.id, track]]),
      clipsByTrack: new Map([[track.id, clip]]),
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
      getInterpolatedEffects: () => [],
      getSourceTimeForClip: () => 1,
      getInterpolatedSpeed: () => 1,
    };

    initializeLayerBuilder([track]);

    const layers = buildLayersAtTime(ctx, new Map(), null, false);

    expect(renderSpy).toHaveBeenCalledWith(
      clip,
      1,
      expect.objectContaining({ playbackMode: 'forward' }),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('text');
    expect(layers[0]?.source?.textCanvas).toBe(canvas);

    renderSpy.mockRestore();
  });
});
