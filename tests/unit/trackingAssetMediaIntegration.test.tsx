import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TrackingAssetActions } from '../../src/components/panels/media/TrackingAssetActions';
import {
  getTrackingAssetCoverageLabel,
  getTrackingAssetStateLabel,
} from '../../src/components/panels/media/trackingAssetPresentation';
import { getClassicMediaColumnText } from '../../src/components/panels/media/list/classicListPlanning';
import { useMediaPanelProjectItems } from '../../src/components/panels/media/panel/useMediaPanelProjectItems';
import { useMediaPanelTrackingAssets } from '../../src/components/panels/media/panel/useMediaPanelTrackingAssets';
import { useMediaPanelRenameDeleteCommands } from '../../src/components/panels/media/panel/useMediaPanelRenameDeleteCommands';
import {
  requestTrackingAssetAction,
  TRACKING_ASSET_ACTION_EVENT,
  type TrackingAssetActionEventDetail,
} from '../../src/services/planarTracking/trackingAssetActions';
import { useTrackingStore } from '../../src/stores/trackingStore';
import type { TrackingAsset } from '../../src/types/trackingAsset';

const quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

const asset: TrackingAsset = {
  id: 'tracking:media-1:track-1',
  type: 'tracking',
  name: 'Wall Track',
  parentId: null,
  createdAt: 1,
  sourceMediaId: 'media-1',
  sourceVideoClipId: 'clip-1',
  sourceCompositionId: 'comp-1',
  revision: 1,
  track: {
    id: 'track-1',
    name: 'Wall Track',
    sourceId: 'media-1',
    fps: 25,
    referenceTime: 0,
    referenceQuad: [...quad],
    samples: [{ time: 0, quad: [...quad], confidence: 1 }],
    occlusions: [],
    enabled: true,
    color: '#00ffff',
    opacity: 1,
    fill: 0,
    lineWidth: 2,
    inset: 0,
    shape: 'outline',
    visibleFrom: 0,
    visibleTo: 1,
    fade: 0,
  },
};

const terrainAsset: TrackingAsset = {
  ...asset,
  id: 'tracking:media-1:terrain-1',
  track: {
    ...asset.track,
    id: 'terrain-1',
    samples: [],
    terrain: {
      version: 1,
      solver: 'browser-sfm',
      referenceTime: 2,
      intrinsics: { width: 1920, height: 1080, fx: 1000, fy: 1000, cx: 960, cy: 540 },
      cameras: [
        { time: 2, duration: 0.04, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0], error: 0, observations: 20 },
        { time: 3, duration: 0.04, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [1, 0, 0], error: 0, observations: 20 },
      ],
      vertices: [],
      triangles: [],
      sourceFrameCount: 2,
      sparsePointCount: 0,
      medianError: 0,
    },
  },
};

function createRenameDeleteProps(overrides: Record<string, unknown> = {}) {
  return {
    selectedIds: [asset.id],
    files: [],
    folders: [],
    compositions: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    lightItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    trackingAssets: [asset],
    renameFile: vi.fn(),
    renameSignalAsset: vi.fn(),
    renameFolder: vi.fn(),
    renameTrackingAsset: vi.fn(),
    updateComposition: vi.fn(),
    getMediaFileUsages: vi.fn(() => []),
    deleteMediaFilesEverywhere: vi.fn(async () => ({ artifactFailures: [] })),
    removeSignalAsset: vi.fn(),
    removeTrackingAsset: vi.fn(),
    moveTrackingAsset: vi.fn(),
    removeComposition: vi.fn(),
    removeFolder: vi.fn(),
    removeTextItem: vi.fn(),
    removeSolidItem: vi.fn(),
    removeMeshItem: vi.fn(),
    removeCameraItem: vi.fn(),
    removeLightItem: vi.fn(),
    removeSplatEffectorItem: vi.fn(),
    removeMathSceneItem: vi.fn(),
    removeMotionShapeItem: vi.fn(),
    closeContextMenu: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  act(() => useTrackingStore.getState().reset());
});

describe('tracking assets in the Media panel', () => {
  it('dispatches identity-only actions without copying track geometry', () => {
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(TRACKING_ASSET_ACTION_EVENT, listener);

    requestTrackingAssetAction('open', asset);

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent<TrackingAssetActionEventDetail>).detail;
    expect(detail).toEqual({ action: 'open', assetId: asset.id, sourceVideoClipId: 'clip-1' });
    expect(detail).not.toHaveProperty('track');
    window.removeEventListener(TRACKING_ASSET_ACTION_EVENT, listener);
  });

  it('offers Use and 3D actions and selects the reusable result', () => {
    useTrackingStore.getState().upsertAsset(asset);
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(TRACKING_ASSET_ACTION_EVENT, listener);
    render(<TrackingAssetActions asset={asset} />);

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    fireEvent.click(screen.getByRole('button', { name: '3D' }));

    expect(useTrackingStore.getState().selectedAssetId).toBe(asset.id);
    expect(listener.mock.calls.map(([event]) => (
      event as CustomEvent<TrackingAssetActionEventDetail>
    ).detail.action)).toEqual(['use', 'scene-3d']);
    window.removeEventListener(TRACKING_ASSET_ACTION_EVENT, listener);
  });

  it('preserves keyboard focus and clears pointer focus on action buttons', () => {
    useTrackingStore.getState().upsertAsset(asset);
    render(<TrackingAssetActions asset={asset} />);
    const useButton = screen.getByRole('button', { name: 'Use' });

    useButton.focus();
    fireEvent.click(useButton, { detail: 0 });
    expect(document.activeElement).toBe(useButton);

    fireEvent.click(useButton, { detail: 1 });
    expect(document.activeElement).not.toBe(useButton);
  });

  it('summarizes terrain camera frames and their source-time coverage', () => {
    expect(getTrackingAssetStateLabel(terrainAsset)).toBe('2 camera frames');
    expect(getTrackingAssetCoverageLabel(terrainAsset)).toBe('2.00s–3.04s source');
    expect(getClassicMediaColumnText(terrainAsset, 'resolution')).toBe('2 camera frames');
    expect(getClassicMediaColumnText(terrainAsset, 'duration')).toBe('2.00s–3.04s source');
  });

  it('includes reusable results in project browsing and search', () => {
    const { result } = renderHook(() => useMediaPanelProjectItems({
      files: [],
      compositions: [],
      folders: [],
      textItems: [],
      solidItems: [],
      meshItems: [],
      cameraItems: [],
      lightItems: [],
      splatEffectorItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      trackingAssets: [asset],
      expandedFolderIds: [],
      mediaSearchQuery: 'tracking wall',
      gridFolderId: null,
      classicListViewport: { scrollTop: 0, height: 200 },
      sortItems: items => items,
    }));

    expect(result.current.allProjectItems).toContain(asset);
    expect(result.current.gridItems).toEqual([asset]);
    expect(result.current.mediaSearchResultCount).toBe(1);
    expect(getClassicMediaColumnText(asset, 'resolution')).toBe('1 sample');
    expect(getClassicMediaColumnText(asset, 'audio')).toBe('Linked');
  });

  it('moves tracking results inside Media folders without forwarding them as media files', () => {
    useTrackingStore.getState().upsertAsset(asset);
    const moveMediaItems = vi.fn();
    const { result } = renderHook(() => useMediaPanelTrackingAssets(moveMediaItems));

    act(() => result.current.moveProjectItemsToFolder([asset.id, 'media-2'], 'folder-1'));

    expect(useTrackingStore.getState().assets[0].parentId).toBe('folder-1');
    expect(moveMediaItems).toHaveBeenCalledWith(['media-2'], 'folder-1');
  });

  it('renames and explicitly deletes tracking results through normal Media commands', async () => {
    const props = createRenameDeleteProps();
    const { result } = renderHook(() => useMediaPanelRenameDeleteCommands(props));

    act(() => result.current.startRename(asset.id, asset.name));
    act(() => result.current.setRenameValue('Hero Wall Track'));
    act(() => result.current.finishRename());
    await act(() => result.current.handleDelete());

    expect(props.renameTrackingAsset).toHaveBeenCalledWith(asset.id, 'Hero Wall Track');
    expect(props.removeTrackingAsset).toHaveBeenCalledWith(asset.id);
  });
});
