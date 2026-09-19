import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/audioRoutingManager', () => ({
  audioRoutingManager: { dispose: vi.fn() },
}));

const runtimeStores = vi.hoisted(() => ({
  media: { activeCompositionId: 'comp-1', compositions: [] as Array<Record<string, unknown>> },
  timeline: { clips: [] as Array<Record<string, unknown>> },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => runtimeStores.media },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => runtimeStores.timeline },
}));
import { decodeProjectTerrain, encodeProjectTerrain } from '../../src/services/project/core/packageTerrainGeometry';
import {
  createTrackingAssetId,
  ensureLegacyTrackingAssets,
  getTrackingAsset,
  publishTrackingAsset,
} from '../../src/services/planarTracking/trackingAssets';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import type { HistoryStoreRefs } from '../../src/stores/historyStore/historyStoreTypes';
import { useTrackingStore } from '../../src/stores/trackingStore';
import type { PlanarTrack } from '../../src/types/planarTracking';
import type { DenseTerrainMesh } from '../../src/types/terrainTracking';
import type { ProjectFile } from '../../src/services/project/types';

function mesh(): DenseTerrainMesh {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    origin: [0, 0, 0],
    axisX: [1, 0, 0],
    axisY: [0, 1, 0],
    normal: [0, 0, 1],
    size: [1, 1],
  };
}

function track(denseMesh = mesh()): PlanarTrack {
  const quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ] as const;
  return {
    id: 'surface:1',
    name: 'Ground track',
    sourceId: 'media/one',
    fps: 30,
    referenceTime: 0,
    referenceQuad: [...quad],
    samples: [{ time: 0, quad: [...quad], confidence: 1 }],
    occlusions: [],
    enabled: true,
    color: '#fff',
    opacity: 1,
    fill: 0,
    lineWidth: 1,
    inset: 0,
    shape: 'outline',
    visibleFrom: 0,
    visibleTo: 1,
    fade: 0,
    terrain: {
      version: 1,
      solver: 'browser-sfm',
      denseMesh,
      referenceTime: 0,
      intrinsics: { width: 1920, height: 1080, fx: 1, fy: 1, cx: 0, cy: 0 },
      cameras: [],
      vertices: [],
      triangles: [],
      sourceFrameCount: 1,
      sparsePointCount: 0,
      medianError: 0,
    },
  };
}

describe('reusable tracking assets', () => {
  beforeEach(() => {
    useTrackingStore.getState().reset();
    runtimeStores.media.activeCompositionId = 'comp-1';
    runtimeStores.media.compositions = [];
    runtimeStores.timeline.clips = [];
  });

  it('migrates legacy clip tracks once with a stable source-derived identity', () => {
    const legacyTrack = track();
    const compositions = [
      { id: 'comp-1', clips: [{ id: 'clip-1', mediaId: 'media/one', planarTracks: [legacyTrack] }] },
      { id: 'comp-2', clips: [{ id: 'clip-2', mediaId: 'media/one', planarTracks: [legacyTrack] }] },
    ];

    expect(ensureLegacyTrackingAssets(compositions)).toHaveLength(1);
    expect(ensureLegacyTrackingAssets(compositions)).toHaveLength(0);

    const id = createTrackingAssetId('media/one', 'surface:1');
    const asset = getTrackingAsset(id);
    expect(asset).toMatchObject({
      id: 'tracking:media%2Fone:surface%3A1',
      sourceMediaId: 'media/one',
      sourceVideoClipId: 'clip-1',
      sourceCompositionId: 'comp-1',
      revision: 1,
    });
    expect(asset?.track).not.toBe(legacyTrack);
    expect(asset?.track.terrain?.denseMesh).toBe(legacyTrack.terrain?.denseMesh);

    useTrackingStore.getState().renameAsset(id, 'Canonical name');
    useTrackingStore.getState().moveAsset(id, 'tracking-folder');
    expect(ensureLegacyTrackingAssets(compositions)).toHaveLength(0);
    expect(getTrackingAsset(id)).toMatchObject({
      name: 'Canonical name',
      parentId: 'tracking-folder',
      revision: 3,
    });
  });

  it('publishes revisions while preserving the asset name and folder', () => {
    const originalTrack = track();
    runtimeStores.timeline.clips = [{
      id: 'clip-1',
      name: 'Source clip',
      mediaFileId: 'media/one',
      source: { mediaFileId: 'media/one' },
    }];

    const published = publishTrackingAsset('clip-1', originalTrack)!;
    const firstAssets = useTrackingStore.getState().assets;
    expect(publishTrackingAsset('clip-1', originalTrack)).toBe(published);
    expect(useTrackingStore.getState().assets).toBe(firstAssets);
    expect(published.revision).toBe(1);

    const structurallyEqualTrack = {
      ...originalTrack,
      samples: originalTrack.samples.map((sample) => ({ ...sample, quad: [...sample.quad] })),
      terrain: originalTrack.terrain
        ? { ...originalTrack.terrain, cameras: [...originalTrack.terrain.cameras] }
        : undefined,
    };
    expect(publishTrackingAsset('clip-1', structurallyEqualTrack)).toBe(published);
    expect(useTrackingStore.getState().assets).toBe(firstAssets);

    useTrackingStore.getState().renameAsset(published.id, 'Trail surface');
    useTrackingStore.getState().moveAsset(published.id, 'folder-tracks');
    const editedTrack = { ...originalTrack, opacity: 0.4 };
    const revised = publishTrackingAsset('clip-1', editedTrack)!;

    expect(revised).toMatchObject({
      id: published.id,
      name: 'Trail surface',
      parentId: 'folder-tracks',
      sourceVideoClipId: 'clip-1',
      revision: 4,
    });
    expect(revised.track.opacity).toBe(0.4);
    expect(revised.track.terrain?.denseMesh).toBe(originalTrack.terrain?.denseMesh);

    const revisedAssets = useTrackingStore.getState().assets;
    expect(publishTrackingAsset('clip-1', editedTrack)).toBe(revised);
    expect(useTrackingStore.getState().assets).toBe(revisedAssets);
    useTrackingStore.getState().upsertAsset(revised);
    expect(useTrackingStore.getState().assets).toBe(revisedAssets);

    // Simulate history restoring an older asset while the clip-side track
    // object remains reachable. The identity memo must defer to store revision.
    useTrackingStore.getState().hydrateAssets([published]);
    const republishedAfterRestore = publishTrackingAsset('clip-1', editedTrack)!;
    expect(republishedAfterRestore).toMatchObject({ revision: 2 });
    expect(republishedAfterRestore.track.opacity).toBe(0.4);

    useTrackingStore.getState().selectAsset(revised.id);
    useTrackingStore.getState().removeAsset(revised.id);
    expect(useTrackingStore.getState()).toMatchObject({ assets: [], selectedAssetId: null });
  });

  it('keeps asset edits in undo snapshots without copying immutable geometry', () => {
    ensureLegacyTrackingAssets([
      { id: 'comp-1', clips: [{ id: 'clip-1', mediaId: 'media/one', planarTracks: [track()] }] },
    ]);
    const refs: HistoryStoreRefs = {
      getTrackingState: () => useTrackingStore.getState(),
      setTrackingState: (state) => useTrackingStore.setState(state),
    };
    const snapshot = createHistorySnapshot('before rename', refs);
    const originalMesh = snapshot.tracking?.assets[0]?.track.terrain?.denseMesh;

    useTrackingStore.getState().renameAsset(snapshot.tracking!.assets[0]!.id, 'Renamed');
    expect(useTrackingStore.getState().assets[0]).toMatchObject({ name: 'Renamed', revision: 2 });

    applyHistorySnapshot(snapshot, refs);
    expect(useTrackingStore.getState().assets[0]).toMatchObject({ name: 'Ground track', revision: 1 });
    expect(useTrackingStore.getState().assets[0]!.track.terrain?.denseMesh).toBe(originalMesh);
  });

  it('packages a mesh owned by an asset once and restores shared clip references', async () => {
    const denseMesh = mesh();
    const sharedTrack = track(denseMesh);
    const id = createTrackingAssetId('media/one', sharedTrack.id);
    const project = {
      version: 1,
      name: 'Tracking geometry',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      trackingAssets: [{
        id,
        type: 'tracking',
        name: sharedTrack.name,
        parentId: null,
        createdAt: 1,
        sourceMediaId: 'media/one',
        track: sharedTrack,
        revision: 1,
      }],
      compositions: [{ clips: [{ planarTracks: [sharedTrack] }] }],
    } as unknown as ProjectFile;

    const encoded = await encodeProjectTerrain(project);
    expect(encoded.entries).toHaveLength(1);
    expect(new TextDecoder().decode(encoded.bytes)).not.toContain('"positions"');

    const entries = Object.fromEntries(encoded.entries);
    const restored = decodeProjectTerrain(encoded.bytes, entries);
    const assetMesh = restored.trackingAssets![0]!.track.terrain!.denseMesh;
    const clipMesh = restored.compositions[0]!.clips[0]!.planarTracks![0]!.terrain!.denseMesh;
    expect(assetMesh).toBe(clipMesh);
  });
});
