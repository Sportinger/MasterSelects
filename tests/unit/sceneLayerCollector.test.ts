import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerRenderData } from '../../src/engine/core/types';
import { collectScene3DLayers } from '../../src/engine/scene/SceneLayerCollector';
import { isMobileAppleWebKit } from '../../src/utils/mobileAppleWebKit';

describe('SceneLayerCollector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects iPad WebKit including desktop-class iPad user agents', () => {
    const ipadSafari = {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    };

    expect(isMobileAppleWebKit(ipadSafari)).toBe(true);
    expect(isMobileAppleWebKit({
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 10,
    })).toBe(false);
  });

  it('collects shared-scene layers with world matrices and native scene payloads', () => {
    const textCanvas = document.createElement('canvas');
    const layerData: LayerRenderData[] = [
      {
        layer: {
          id: 'plane-layer',
          name: 'Plane',
          sourceClipId: 'clip-plane',
          visible: true,
          opacity: 0.8,
          blendMode: 'normal',
          source: {
            type: 'image',
            textCanvas,
            mediaTime: 4.25,
          },
          effects: [
            {
              id: 'analog-fx',
              name: 'Analog Signal Lab',
              type: 'analog-signal-lab',
              enabled: true,
              params: {},
            },
            {
              id: 'grain-fx',
              name: 'Grain',
              type: 'grain',
              enabled: true,
              params: {},
            },
          ],
          position: { x: 1, y: 2, z: 3 },
          scale: { x: 1.5, y: 2 },
          rotation: { x: Math.PI / 4, y: 0, z: Math.PI / 2 },
          is3D: true,
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 640,
        sourceHeight: 360,
      },
      {
        layer: {
          id: 'primitive-layer',
          name: 'Cube',
          sourceClipId: 'clip-primitive',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          source: {
            type: 'model',
            meshType: 'cube',
          },
          effects: [],
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          is3D: true,
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 100,
        sourceHeight: 100,
      },
      {
        layer: {
          id: 'text-layer',
          name: 'Title',
          sourceClipId: 'clip-text',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          source: {
            type: 'model',
            meshType: 'text3d',
            text3DProperties: {
              text: 'Hello',
              fontFamily: 'helvetiker',
              fontWeight: 'regular',
              size: 1,
              depth: 0.2,
              color: '#fff',
              letterSpacing: 0,
              lineHeight: 1.2,
              textAlign: 'center',
              curveSegments: 4,
              bevelEnabled: false,
              bevelThickness: 0,
              bevelSize: 0,
              bevelSegments: 0,
            },
          },
          effects: [],
          position: { x: 0, y: 1, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          is3D: true,
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 100,
        sourceHeight: 40,
      },
      {
        layer: {
          id: 'splat-layer',
          name: 'Splat',
          sourceClipId: 'clip-splat',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat',
            gaussianSplatFileName: 'hero.splat',
            gaussianSplatRuntimeKey: 'hero-runtime',
          },
          effects: [],
          position: { x: -1, y: -2, z: -3 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          is3D: true,
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 128,
        sourceHeight: 128,
      },
    ];

    const collected = collectScene3DLayers(layerData, {
      width: 1920,
      height: 1080,
      preciseVideoSampling: true,
      preciseSplatSorting: true,
    });

    expect(collected.map((layer) => layer.kind)).toEqual([
      'plane',
      'primitive',
      'text3d',
      'splat',
    ]);
    expect(collected[0]?.worldMatrix[12]).toBeCloseTo(1);
    expect(collected[0]?.worldMatrix[13]).toBeCloseTo(2);
    expect(collected[0]?.worldMatrix[14]).toBeCloseTo(3);
    expect(collected[0]?.worldTransform?.rotationDegrees.z).toBeCloseTo(90);

    expect(collected[0]).toMatchObject({
      kind: 'plane',
      canvas: textCanvas,
      mediaTime: 4.25,
      layerSpaceEffects: [{ id: 'analog-fx', type: 'analog-signal-lab' }],
    });
    expect(collected[3]).toMatchObject({
      kind: 'splat',
      gaussianSplatRuntimeKey: 'hero-runtime',
      preciseSplatSorting: true,
    });
  });

  it('applies gaussian splat orientation presets in the native world-matrix contract only', () => {
    const layerData: LayerRenderData[] = [
      {
        layer: {
          id: 'splat-layer',
          name: 'PLY Splat',
          sourceClipId: 'clip-splat',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat',
            gaussianSplatFileName: 'hero.ply',
            gaussianSplatSettings: {
              render: {
                orientationPreset: 'flip-x-180',
              },
            },
          },
          effects: [],
          position: { x: 4, y: 5, z: 6 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          is3D: true,
        },
        isVideo: false,
        externalTexture: null,
        textureView: null,
        sourceWidth: 128,
        sourceHeight: 128,
      },
    ];

    const collected = collectScene3DLayers(layerData, {
      width: 1920,
      height: 1080,
    });
    const nativeSplat = collected[0]!;

    expect(nativeSplat.kind).toBe('splat');
    expect(nativeSplat.worldMatrix[0]).toBeCloseTo(1);
    expect(nativeSplat.worldMatrix[5]).toBeCloseTo(-1);
    expect(nativeSplat.worldMatrix[10]).toBeCloseTo(-1);
    expect(nativeSplat.worldMatrix[12]).toBeCloseTo(4);
    expect(nativeSplat.worldMatrix[13]).toBeCloseTo(5);
    expect(nativeSplat.worldMatrix[14]).toBeCloseTo(6);
    expect(nativeSplat.worldTransform?.rotationDegrees).toEqual({ x: 0, y: 0, z: 0 });
    expect(nativeSplat.worldTransform?.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('forwards VideoFrame sources to native 3D video planes for export', () => {
    const videoElement = document.createElement('video');
    const videoFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;
    const layerData: LayerRenderData[] = [
      {
        layer: {
          id: 'video-plane',
          name: '3D Video',
          sourceClipId: 'clip-video',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          source: {
            type: 'video',
            videoElement,
            videoFrame,
          },
          effects: [],
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          is3D: true,
        },
        isVideo: true,
        externalTexture: null,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    ];

    const collected = collectScene3DLayers(layerData, {
      width: 1920,
      height: 1080,
    });

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      kind: 'plane',
      alphaMode: 'opaque',
      castsDepth: true,
      videoElement,
      videoFrame,
    });
  });

  it('uses oriented dimensions while sampling a 3D live input directly from video', () => {
    const presentationVideo = document.createElement('video');
    const presentationCanvas = document.createElement('canvas');
    presentationCanvas.width = 1920;
    presentationCanvas.height = 1080;
    const layerData: LayerRenderData[] = [{
      layer: {
        id: 'live-video-plane',
        name: 'Live Camera',
        sourceClipId: 'clip-live',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: {
          type: 'video',
          videoElement: presentationVideo,
          canvasElement: presentationCanvas,
          intrinsicWidth: 1080,
          intrinsicHeight: 1920,
          isLiveInput: true,
        },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        is3D: true,
      },
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: presentationCanvas.width,
      sourceHeight: presentationCanvas.height,
    }];

    const [collected] = collectScene3DLayers(layerData, {
      width: 1080,
      height: 1920,
    });

    expect(collected).toMatchObject({
      kind: 'plane',
      alphaMode: 'opaque',
      castsDepth: true,
      videoElement: presentationVideo,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    expect(collected?.kind === 'plane' ? collected.canvas : null).toBeUndefined();
  });

  it('keeps iPad live-input voxel sampling on the staged presentation canvas', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    const presentationVideo = document.createElement('video');
    const presentationCanvas = document.createElement('canvas');
    presentationCanvas.width = 1920;
    presentationCanvas.height = 1080;
    const layerData: LayerRenderData[] = [{
      layer: {
        id: 'live-voxel',
        name: 'Live Camera Voxel',
        sourceClipId: 'clip-live',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: {
          type: 'video',
          videoElement: presentationVideo,
          canvasElement: presentationCanvas,
          isLiveInput: true,
        },
        effects: [{
          id: 'voxel-fx',
          name: 'Voxel Relief',
          type: 'voxel-relief',
          enabled: true,
          params: {},
        }],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        is3D: true,
      },
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: presentationCanvas.width,
      sourceHeight: presentationCanvas.height,
    }];

    const [collected] = collectScene3DLayers(layerData, {
      width: 1920,
      height: 1080,
    });

    expect(collected).toMatchObject({
      kind: 'voxel',
      canvas: presentationCanvas,
      preciseVideoSampling: false,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    expect(collected?.kind === 'voxel' ? collected.videoElement : null).toBeUndefined();
  });
});
