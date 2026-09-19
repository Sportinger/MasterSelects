import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaFolder, TextItem } from '../../src/stores/mediaStore/types';
import { findNearestMediaBoardGridSlot } from '../../src/components/panels/media/board/nearestGridSlot';
import { buildMediaBoardLayoutGeometry, getMediaBoardGroupChrome } from '../../src/components/panels/media/board/layout';
import { useMediaBoardLayoutCommit } from '../../src/components/panels/media/board/useMediaBoardLayoutCommit';
import type { MediaBoardGroupOffset } from '../../src/components/panels/media/board/types';

function textItem(id: string, parentId: string | null): TextItem {
  return { id, parentId, name: id, type: 'text', createdAt: 1, text: id, fontFamily: 'Arial', fontSize: 48, color: '#ffffff', duration: 5 };
}

describe('nearest media board placement', () => {
  it('keeps a free requested position and searches beyond the first free perimeter for the actual nearest slot', () => {
    expect(findNearestMediaBoardGridSlot(7, -2, () => true)).toEqual({ column: 7, row: -2 });
    expect(findNearestMediaBoardGridSlot(0, 0, (column, row) =>
      (column === 3 && row === 3) || (column === 4 && row === 0),
    )).toEqual({ column: 4, row: 0 });
  });

  it.each([null, 'folder'])('uses the closest vertical gap consistently for preview, drop and reload in %s', (parentId) => {
    const items = [textItem('fixed', parentId), textItem('moving', parentId)];
    const folders: MediaFolder[] = parentId
      ? [{ id: parentId, parentId: null, name: 'Folder', createdAt: 1, isExpanded: true }]
      : [];
    const initial: Record<string, MediaBoardGroupOffset> = {
      fixed: { x: 0, y: 0 }, moving: { x: 320, y: 0 },
      ...(parentId ? { [parentId]: { x: 0, y: 0 } } : {}),
    };
    const original = buildMediaBoardLayoutGeometry({ mediaBoardItems: items, folders, mediaBoardLayouts: initial, mediaBoardInsertionPreview: null });
    const movingLayout = original.placements.find(placement => placement.item.id === 'moving')!.layout;
    const preview = buildMediaBoardLayoutGeometry({
      mediaBoardItems: items, folders, mediaBoardLayouts: initial,
      mediaBoardInsertionPreview: {
        movingIds: ['moving'], targetGroupId: parentId, targetPosition: { x: 0, y: 0 }, sourceLayouts: { moving: movingLayout },
      },
    });
    const moveToFolder = vi.fn();
    const { result, unmount } = renderHook(() => {
      const [layouts, setLayouts] = useState(initial);
      const commit = useMediaBoardLayoutCommit({
        mediaBoardItems: items, mediaBoardItemsById: new Map(items.map(item => [item.id, item])),
        mediaBoardGroups: original.groups, mediaBoardPlacementsById: new Map(original.placements.map(placement => [placement.item.id, placement])),
        moveToFolder, setMediaBoardLayouts: setLayouts,
      });
      return { layouts, commit };
    });
    act(() => result.current.commit(['moving'], parentId, { x: 0, y: 0 }));

    // These wide cards occupy seven columns but only four rows. Moving four
    // rows is closer than scanning seven columns to the right.
    const expected = { x: 0, y: parentId ? 128 : -128 };
    expect(result.current.layouts.moving).toEqual(expected);
    expect(result.current.layouts.fixed).toEqual(initial.fixed);
    expect(moveToFolder).toHaveBeenCalledWith(['moving'], parentId);
    const previewGroup = preview.groups.find(group => group.id === parentId)!;
    const chrome = getMediaBoardGroupChrome(parentId);
    expect(preview.insertGaps[0].layout).toMatchObject({
      x: previewGroup.x + chrome.padding + expected.x,
      y: previewGroup.y + chrome.headerHeight + chrome.padding + expected.y,
    });
    const reloaded = buildMediaBoardLayoutGeometry({ mediaBoardItems: items, folders, mediaBoardLayouts: result.current.layouts, mediaBoardInsertionPreview: null });
    expect(reloaded.placements.find(placement => placement.item.id === 'moving')!.layout).toEqual(preview.insertGaps[0].layout);
    unmount();
  });

  it('resolves overlapping saved positions without moving the first item', () => {
    const layout = buildMediaBoardLayoutGeometry({
      mediaBoardItems: [textItem('fixed', null), textItem('overlap', null)], folders: [],
      mediaBoardLayouts: { fixed: { x: 96, y: 64 }, overlap: { x: 96, y: 64 } }, mediaBoardInsertionPreview: null,
    });
    expect(layout.placements.find(placement => placement.item.id === 'fixed')!.layout).toMatchObject({ x: 96, y: 64 });
    expect(layout.placements.find(placement => placement.item.id === 'overlap')!.layout).toMatchObject({ x: 96, y: -64 });
  });

  it('keeps a dense folder within its row boundary when a closer slot exists outside that boundary', () => {
    const folder: MediaFolder = { id: 'folder', parentId: null, name: 'Folder', createdAt: 1, isExpanded: true };
    const items: TextItem[] = [];
    let layouts: Record<string, MediaBoardGroupOffset> = { folder: { x: 0, y: 0 }, moving: { x: 448, y: 512 } };
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const id = `fixed-${column}-${row}`;
        items.push(textItem(id, folder.id));
        layouts[id] = { x: column * 224, y: row * 128 };
      }
    }
    items.push(textItem('moving', folder.id));
    const original = buildMediaBoardLayoutGeometry({ mediaBoardItems: items, folders: [folder], mediaBoardLayouts: layouts, mediaBoardInsertionPreview: null });
    const { result, unmount } = renderHook(() => useMediaBoardLayoutCommit({
      mediaBoardItems: items, mediaBoardItemsById: new Map(items.map(item => [item.id, item])),
      mediaBoardGroups: original.groups, mediaBoardPlacementsById: new Map(original.placements.map(placement => [placement.item.id, placement])),
      moveToFolder: vi.fn(), setMediaBoardLayouts: update => { layouts = typeof update === 'function' ? update(layouts) : update; },
    }));
    const preview = buildMediaBoardLayoutGeometry({
      mediaBoardItems: items, folders: [folder], mediaBoardLayouts: layouts,
      mediaBoardInsertionPreview: { movingIds: ['moving'], targetGroupId: folder.id, targetPosition: { x: 448, y: 128 }, sourceLayouts: {} },
    });
    act(() => result.current(['moving'], folder.id, { x: 448, y: 128 }));
    expect(layouts.moving).toEqual({ x: 448, y: 384 });
    const reloaded = buildMediaBoardLayoutGeometry({ mediaBoardItems: items, folders: [folder], mediaBoardLayouts: layouts, mediaBoardInsertionPreview: null });
    expect(reloaded.groups.find(group => group.id === folder.id)!.width).toBeLessThanOrEqual(736);
    expect(reloaded.placements.find(placement => placement.item.id === 'moving')!.layout).toEqual(preview.insertGaps[0].layout);
    unmount();
  });
});
