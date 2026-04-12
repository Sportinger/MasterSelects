import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import type { ExportClipState, FrameContext } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

describe('ExportLayerBuilder', () => {
  beforeEach(() => {
    useMediaStore.setState({
      compositions: [],
    } as any);
    useTimelineStore.setState({
      clipKeyframes: new Map(),
    } as any);
  });

  afterEach(() => {
    cleanupLayerBuilder();
  });

  it('uses the current WebCodecs VideoFrame for sequential export layers', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as any;

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
    } as any;

    const clipStates = new Map<string, ExportClipState>([
      ['clip-1', {
        clipId: 'clip-1',
        webCodecsPlayer: {
          getCurrentFrame: () => currentFrame,
        } as any,
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

  it('keeps gaussian splat renderer selection but forces full-quality export settings', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as any;

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
    } as any;

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
    const settings = layers[0]?.source?.gaussianSplatSettings;

    expect(layers).toHaveLength(1);
    expect(settings?.render.useNativeRenderer).toBe(false);
    expect(settings?.render.maxSplats).toBe(0);
    expect(settings?.render.sortFrequency).toBe(1);
    expect(settings?.render.splatScale).toBe(1.5);
  });

  it('keeps non-native gaussian splat rotations in the three.js path as radians', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as any;

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
    } as any;

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
    } as any;

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
    } as any;

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

  it('builds nested 3D text and gaussian splat export layers for compositions', () => {
    const track = {
      id: 'track-1',
      type: 'video',
      visible: true,
      solo: false,
    } as any;

    useMediaStore.setState({
      compositions: [
        {
          id: 'comp-1',
          width: 1280,
          height: 720,
        },
      ],
    } as any);

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
    } as any;

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
    expect(nestedLayers).toHaveLength(2);
    expect(nestedLayers[0]?.source?.meshType).toBe('text3d');
    expect(nestedLayers[0]?.source?.text3DProperties?.text).toBe('Nested Hello');
    expect(nestedLayers[1]?.source?.gaussianSplatFileHash).toBe('nested-hash');
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.maxSplats).toBe(0);
    expect(nestedLayers[1]?.source?.gaussianSplatSettings?.render.sortFrequency).toBe(1);
  });
});
