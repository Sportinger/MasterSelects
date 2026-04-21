import { describe, expect, it } from 'vitest';
import type { LayerRenderData } from '../../src/engine/core/types';
import {
  collectScene3DLayers,
} from '../../src/engine/scene/SceneLayerCollector';

describe('SceneLayerCollector', () => {
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
          },
          effects: [],
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
});
