import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMediaPanelProjectItems } from '../../src/components/panels/media/panel/useMediaPanelProjectItems';
import { useMediaPanelRenameDeleteCommands } from '../../src/components/panels/media/panel/useMediaPanelRenameDeleteCommands';
import type { Composition, ProjectItem } from '../../src/stores/mediaStore';

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
      renameFile: vi.fn(),
      renameSignalAsset: vi.fn(),
      renameFolder: vi.fn(),
      updateComposition: vi.fn(),
      getMediaFileUsages: vi.fn(() => []),
      deleteMediaFilesEverywhere: vi.fn(async () => ({ deletedIds: [], missingIds: [], artifactFailures: [] })),
      removeSignalAsset: vi.fn(),
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
});
