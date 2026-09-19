import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  getTimelineOwnedMediaItemIds,
  useMediaPanelProjectItems,
} from '../../src/components/panels/media/panel/useMediaPanelProjectItems';
import { useMediaPanelRenameDeleteCommands } from '../../src/components/panels/media/panel/useMediaPanelRenameDeleteCommands';
import type { Composition, MediaFile, ProjectItem, TextItem } from '../../src/stores/mediaStore';
import type { TimelineClip } from '../../src/types/timeline';

function composition(id: string, transition = false): Composition {
  return {
    id,
    name: transition ? 'Transition - Crossfade' : 'Scene Comp',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: '#000000',
    timelineData: { tracks: [], clips: [], duration: 5 },
    transitionComp: transition
      ? {
          kind: 'transition-comp',
          parentCompositionId: 'parent-comp',
          parentTransitionId: 'transition-1',
          parentOutgoingClipId: 'clip-out',
          parentIncomingClipId: 'clip-in',
          linkedOutgoingClipId: 'linked-out',
          linkedIncomingClipId: 'linked-in',
          innerTransitionId: 'inner-transition',
          paddingBefore: 0,
          paddingAfter: 0,
          bodyStart: 0,
          bodyEnd: 1,
        }
      : undefined,
  };
}

describe('media panel project items', () => {
  it('hides legacy one-off items owned by timeline-native clips', () => {
    const generatedText: TextItem = {
      id: 'text-generated',
      name: 'Text',
      type: 'text',
      parentId: null,
      createdAt: 1,
      text: 'Text',
      fontFamily: 'Arial',
      fontSize: 48,
      color: '#ffffff',
      duration: 5,
    };
    const reusableText: TextItem = {
      ...generatedText,
      id: 'text-preset',
      name: 'Reusable title',
      text: 'Reusable title',
    };
    const hiddenProjectItemIds = getTimelineOwnedMediaItemIds([{
      mediaFileId: generatedText.id,
      source: { type: 'text', mediaFileId: generatedText.id },
    } as TimelineClip]);

    const { result } = renderHook(() => useMediaPanelProjectItems({
      files: [],
      compositions: [],
      folders: [],
      textItems: [generatedText, reusableText],
      solidItems: [],
      meshItems: [],
      cameraItems: [],
      splatEffectorItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      trackingAssets: [],
      expandedFolderIds: [],
      mediaSearchQuery: '',
      gridFolderId: null,
      classicListViewport: { scrollTop: 0, height: 400 },
      hiddenProjectItemIds,
      sortItems: (items: ProjectItem[]) => items,
    }));

    expect([...hiddenProjectItemIds]).toEqual(['text-generated']);
    expect(result.current.allProjectItems.map((item) => item.id)).toEqual(['text-preset']);
    expect(result.current.totalItems).toBe(1);
  });

  it('hides transition compositions from visible project lists', () => {
    const visibleComposition = composition('comp-visible');
    const transitionComposition = composition('comp-transition', true);

    const { result, rerender } = renderHook(({ mediaSearchQuery }) => useMediaPanelProjectItems({
      files: [],
      compositions: [visibleComposition, transitionComposition],
      folders: [],
      textItems: [],
      solidItems: [],
      meshItems: [],
      cameraItems: [],
      splatEffectorItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      trackingAssets: [],
      expandedFolderIds: [],
      mediaSearchQuery,
      gridFolderId: null,
      classicListViewport: { scrollTop: 0, height: 400 },
      sortItems: (items: ProjectItem[]) => items,
    }), { initialProps: { mediaSearchQuery: '' } });

    expect(result.current.allProjectItems.map((item) => item.id)).toEqual(['comp-visible']);
    expect(result.current.gridItems.map((item) => item.id)).toEqual(['comp-visible']);
    expect(result.current.classicRows.map((row) => row.item.id)).toEqual(['comp-visible']);
    expect(result.current.totalItems).toBe(1);

    rerender({ mediaSearchQuery: 'transition' });

    expect(result.current.gridItems).toHaveLength(0);
    expect(result.current.classicRows.map((row) => row.item.id)).toEqual([]);
    expect(result.current.mediaSearchResultCount).toBe(0);
  });

  it('does not delete hidden transition compositions from stale media-panel selection', async () => {
    const visibleComposition = composition('comp-visible');
    const transitionComposition = composition('comp-transition', true);
    const removeComposition = vi.fn();

    const { result } = renderHook(() => useMediaPanelRenameDeleteCommands({
      selectedIds: [transitionComposition.id, visibleComposition.id],
      files: [],
      folders: [],
      compositions: [visibleComposition, transitionComposition],
      textItems: [],
      solidItems: [],
      meshItems: [],
      cameraItems: [],
      splatEffectorItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      trackingAssets: [],
      renameFile: vi.fn(),
      renameSignalAsset: vi.fn(),
      renameTrackingAsset: vi.fn(),
      renameFolder: vi.fn(),
      updateComposition: vi.fn(),
      getMediaFileUsages: vi.fn(() => []),
      deleteMediaFilesEverywhere: vi.fn(async () => ({ deletedIds: [], missingIds: [], artifactFailures: [] })),
      removeSignalAsset: vi.fn(),
      removeTrackingAsset: vi.fn(),
      moveTrackingAsset: vi.fn(),
      removeComposition,
      removeFolder: vi.fn(),
      removeTextItem: vi.fn(),
      removeSolidItem: vi.fn(),
      removeMeshItem: vi.fn(),
      removeCameraItem: vi.fn(),
      removeSplatEffectorItem: vi.fn(),
      removeMathSceneItem: vi.fn(),
      removeMotionShapeItem: vi.fn(),
      closeContextMenu: vi.fn(),
    }));

    await result.current.handleDelete();

    expect(removeComposition).toHaveBeenCalledWith(visibleComposition.id);
    expect(removeComposition).not.toHaveBeenCalledWith(transitionComposition.id);
  });

  it('does not show a destructive confirmation just because media has files in the project folder', async () => {
    const mediaFile = {
      id: 'media-disk-backed',
      name: 'clip.mov',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:clip',
      projectPath: 'Raw/clip.mov',
      fileHash: 'hash-clip',
      proxyStatus: 'ready',
    } as MediaFile;
    const deleteMediaFilesEverywhere = vi.fn(async () => ({
      deletedMediaFileIds: [mediaFile.id],
      removedClipCount: 0,
      usages: [],
      artifactFailures: [],
    }));

    const { result } = renderHook(() => useMediaPanelRenameDeleteCommands({
      selectedIds: [mediaFile.id],
      files: [mediaFile],
      folders: [],
      compositions: [],
      textItems: [],
      solidItems: [],
      meshItems: [],
      cameraItems: [],
      splatEffectorItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      trackingAssets: [],
      renameFile: vi.fn(),
      renameSignalAsset: vi.fn(),
      renameTrackingAsset: vi.fn(),
      renameFolder: vi.fn(),
      updateComposition: vi.fn(),
      getMediaFileUsages: vi.fn(() => []),
      deleteMediaFilesEverywhere,
      removeSignalAsset: vi.fn(),
      removeTrackingAsset: vi.fn(),
      moveTrackingAsset: vi.fn(),
      removeComposition: vi.fn(),
      removeFolder: vi.fn(),
      removeTextItem: vi.fn(),
      removeSolidItem: vi.fn(),
      removeMeshItem: vi.fn(),
      removeCameraItem: vi.fn(),
      removeSplatEffectorItem: vi.fn(),
      removeMathSceneItem: vi.fn(),
      removeMotionShapeItem: vi.fn(),
      closeContextMenu: vi.fn(),
    }));

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(deleteMediaFilesEverywhere).toHaveBeenCalledWith([mediaFile.id]);
    expect(result.current.deleteConfirmation).toBeNull();
  });
});
