import { beforeEach, describe, expect, it } from 'vitest';
import { bindTerrainLayer } from '../../src/services/planarTracking/terrainLayerBindings';
import { setCanvasContentBounds } from '../../src/services/canvasContentBounds';
import { useTrackingStore } from '../../src/stores/trackingStore';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip } from '../../src/types/timeline';
import type { TerrainReconstruction } from '../../src/types/terrainTracking';

const terrain = { version: 1, cameras: [] } as unknown as TerrainReconstruction;
const attachment = { version: 1 as const, targetVideoClipId: 'video', trackId: 'track', visible: true,
  placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 } };
const video = { id: 'video', planarTracks: [{ id: 'track', enabled: false, terrain }] } as TimelineClip;
const clip = { id: 'content', terrainAttachment: attachment } as TimelineClip;

describe('terrain render bindings', () => {
  beforeEach(() => useTrackingStore.getState().reset());
  it('projects editable content using the shared mesh even when the old video overlay is disabled', () => {
    const layer = bindTerrainLayer({ visible: true } as Layer, clip, [video, clip]);
    expect(layer.terrainProjection?.terrain).toBe(terrain);
    expect(layer.terrainProjection?.attachment).toBe(attachment);
    expect(layer.visible).toBe(true);
    expect(layer.terrainProjection?.camera).toBeUndefined();
  });
  it('does not silently turn a broken tracking reference into flat screen content', () => {
    expect(bindTerrainLayer({ visible: true } as Layer, clip, [clip]).visible).toBe(false);
  });
  it('uses the resolved motion stroke for terrain connectors while resolving its screen anchor', () => {
    const screenAnchor = {
      attachment,
      offset: { x: 0.1, y: -0.2 },
    };
    const bound = {
      id: 'motion-label',
      terrainScreenAnchor: screenAnchor,
      terrainAnchorConnector: {
        anchorClipId: 'motion-label',
        color: '#000000',
        width: 1,
        opacity: 1,
      },
      motion: {
        appearance: {
          items: [{
            id: 'persisted-stroke',
            kind: 'stroke',
            name: 'Stroke',
            visible: true,
            opacity: 1,
            color: { r: 1, g: 1, b: 1, a: 1 },
            width: 2,
            alignment: 'center',
          }],
        },
      },
    } as TimelineClip;
    const layer = {
      visible: true,
      source: {
        type: 'motion',
        motion: {
          appearance: {
            items: [{
              id: 'resolved-stroke',
              kind: 'stroke',
              name: 'Stroke',
              visible: true,
              opacity: 0.6,
              color: { r: 0.25, g: 0.5, b: 0.75, a: 0.5 },
              width: 7.5,
              alignment: 'center',
            }],
          },
        },
      },
    } as Layer;

    const result = bindTerrainLayer(layer, bound, [video, bound]);

    expect(result.terrainAnchorConnector).toEqual({
      anchorClipId: 'motion-label',
      color: '#4080bf',
      width: 7.5,
      opacity: 0.3,
    });
    expect(result.terrainScreenAnchor).toEqual({ anchor: screenAnchor, terrain });
  });
  it('promotes observed browser reconstruction triangles for a reusable mesh binding', () => {
    const sparse = {
      version: 1, solver: 'browser-sfm', referenceTime: 0,
      intrinsics: { width: 100, height: 100, fx: 80, fy: 80, cx: 50, cy: 50 },
      cameras: [],
      vertices: [
        { position: [0, 0, 1], uvq: [0, 0, 1] },
        { position: [1, 0, 1], uvq: [1, 0, 1] },
        { position: [0, 1, 1], uvq: [0, 1, 1] },
      ],
      triangles: [0, 1, 2], sourceFrameCount: 1, sparsePointCount: 3, medianError: 0,
    } as TerrainReconstruction;
    const asset = {
      id: 'asset', type: 'tracking' as const, name: 'Sparse', parentId: null, createdAt: 1,
      sourceMediaId: 'media', revision: 1,
      track: {
        id: 'sparse-track', name: 'Sparse', sourceId: 'media', fps: 30, referenceTime: 0,
        referenceQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        samples: [], occlusions: [], enabled: true, color: '#fff', opacity: 1, fill: 0,
        lineWidth: 1, inset: 0, shape: 'outline' as const, visibleFrom: 0, visibleTo: 1, fade: 0,
        terrain: sparse,
      },
    };
    useTrackingStore.setState({ assets: [asset] });
    const bound = {
      id: 'content', startTime: 0,
      trackingBinding: {
        version: 1, assetId: 'asset', sourceStart: 0, mode: 'surface',
        point: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 },
      },
    } as TimelineClip;
    const layer = bindTerrainLayer({ visible: true } as Layer, bound, [bound], 0);
    expect(layer.terrainProjection?.terrain.denseMesh?.indices).toEqual([0, 1, 2]);
    expect(sparse.denseMesh).toBeUndefined();
  });
  it('forwards tight text bounds without changing other projected source types', () => {
    const sparse = {
      version: 1, solver: 'browser-sfm', referenceTime: 0,
      intrinsics: { width: 100, height: 100, fx: 80, fy: 80, cx: 50, cy: 50 }, cameras: [],
      vertices: [
        { position: [0, 0, 1], uvq: [0, 0, 1] },
        { position: [1, 0, 1], uvq: [1, 0, 1] },
        { position: [0, 1, 1], uvq: [0, 1, 1] },
      ], triangles: [0, 1, 2], sourceFrameCount: 1, sparsePointCount: 3, medianError: 0,
    } as TerrainReconstruction;
    useTrackingStore.setState({ assets: [{
      id: 'asset', type: 'tracking', name: 'Sparse', parentId: null, createdAt: 1,
      sourceMediaId: 'media', revision: 1,
      track: {
        id: 'sparse-track', name: 'Sparse', sourceId: 'media', fps: 30, referenceTime: 0,
        referenceQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        samples: [], occlusions: [], enabled: true, color: '#fff', opacity: 1, fill: 0,
        lineWidth: 1, inset: 0, shape: 'outline', visibleFrom: 0, visibleTo: 1, fade: 0,
        terrain: sparse,
      },
    }] });
    const bound = { id: 'content', startTime: 0, trackingBinding: {
      version: 1, assetId: 'asset', sourceStart: 0, mode: 'surface',
      point: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 },
    } } as TimelineClip;
    const canvas = document.createElement('canvas');
    setCanvasContentBounds(canvas, { x: 0.2, y: 0.4, width: 0.6, height: 0.1 });
    const textLayer = bindTerrainLayer({ visible: true, source: { type: 'text', textCanvas: canvas } } as Layer, bound, [bound], 0);
    const imageLayer = bindTerrainLayer({ visible: true, source: { type: 'image' } } as Layer, bound, [bound], 0);

    expect(textLayer.terrainProjection?.contentBounds).toEqual({ x: 0.2, y: 0.4, width: 0.6, height: 0.1 });
    expect(imageLayer.terrainProjection?.contentBounds).toBeUndefined();
  });
});
