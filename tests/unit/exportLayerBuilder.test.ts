import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLayersAtTime,
  cleanupLayerBuilder,
  initializeLayerBuilder,
} from '../../src/engine/export/ExportLayerBuilder';
import type { ExportClipState, FrameContext } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { lottieRuntimeManager } from '../../src/services/vectorAnimation/LottieRuntimeManager';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';

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
    const renderSpy = vi.spyOn(lottieRuntimeManager, 'renderClipAtTime').mockReturnValue(canvas);

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

    expect(renderSpy).toHaveBeenCalledWith(clip, 1);
    expect(layers).toHaveLength(1);
    expect(layers[0]?.source?.type).toBe('text');
    expect(layers[0]?.source?.textCanvas).toBe(canvas);

    renderSpy.mockRestore();
  });
});
