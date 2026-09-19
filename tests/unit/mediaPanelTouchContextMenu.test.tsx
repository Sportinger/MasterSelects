import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaPanelSelectionCommands } from '../../src/components/panels/media/panel/useMediaPanelSelectionCommands';
import { useMediaPanelContextMenuState } from '../../src/components/panels/media/panel/useMediaPanelContextMenuState';

afterEach(cleanup);

describe('Media Panel touch context menu', () => {
  it('closes an open menu on a press anywhere outside the menu', () => {
    const { result } = renderHook(useMediaPanelContextMenuState);

    act(() => result.current.setContextMenu({ x: 40, y: 50 }));
    expect(result.current.contextMenu).not.toBeNull();
    fireEvent.pointerDown(document.body);

    expect(result.current.contextMenu).toBeNull();
  });

  it('keeps the context menu anchored to the finger coordinates', () => {
    const setContextMenu = vi.fn();
    const input = {
      selectedIds: [],
      contextMenu: null,
      viewMode: 'icons',
      setGridFolderId: vi.fn(),
      setContextMenu,
      closeContextMenu: vi.fn(),
      setSelectedMediaBoardAnnotationId: vi.fn(),
      setGenerativeTrayExpanded: vi.fn(),
      getActiveParentId: () => null,
      getAiReferenceMediaFileIds: () => [],
      updateAiReferenceMediaFileIds: vi.fn(),
      createComposition: vi.fn(),
      updateComposition: vi.fn(),
      setSelection: vi.fn(),
      addToSelection: vi.fn(),
      removeFromSelection: vi.fn(),
      toggleFolderExpanded: vi.fn(),
      openCompositionTab: vi.fn(),
      reloadFile: vi.fn(),
      setSourceMonitorFile: vi.fn(),
      ensureFileThumbnail: vi.fn(),
      generateAudioProxy: vi.fn(),
      generateMediaWaveform: vi.fn(),
      generateMediaSpectrogram: vi.fn(),
      copyMediaItems: vi.fn(),
      duplicateMediaItems: vi.fn(),
      pasteMediaItems: vi.fn(),
      hasMediaClipboard: () => false,
      folders: [],
      createFolder: vi.fn(),
      importFiles: vi.fn(),
      importFilesWithHandles: vi.fn(),
      handleDelete: vi.fn(),
    } as unknown as Parameters<typeof useMediaPanelSelectionCommands>[0];
    const { result } = renderHook(() => useMediaPanelSelectionCommands(input));
    const event = {
      clientX: 143,
      clientY: 287,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    } as unknown as ReactMouseEvent;

    act(() => result.current.handleContextMenu(event, 'media-1', null));

    expect(setContextMenu).toHaveBeenCalledWith({
      x: 143,
      y: 287,
      itemId: 'media-1',
      parentId: null,
      boardPosition: undefined,
    });
    expect(setContextMenu.mock.calls[0][0]).not.toHaveProperty('preferAbove');
  });

  it('positions a synthetic touch menu above the finger', () => {
    const setContextMenu = vi.fn();
    const input = {
      selectedIds: [],
      contextMenu: null,
      viewMode: 'icons',
      setGridFolderId: vi.fn(),
      setContextMenu,
      closeContextMenu: vi.fn(),
      setSelectedMediaBoardAnnotationId: vi.fn(),
      setGenerativeTrayExpanded: vi.fn(),
      getActiveParentId: () => null,
      getAiReferenceMediaFileIds: () => [],
      updateAiReferenceMediaFileIds: vi.fn(),
      createComposition: vi.fn(),
      updateComposition: vi.fn(),
      setSelection: vi.fn(),
      addToSelection: vi.fn(),
      removeFromSelection: vi.fn(),
      toggleFolderExpanded: vi.fn(),
      openCompositionTab: vi.fn(),
      reloadFile: vi.fn(),
      setSourceMonitorFile: vi.fn(),
      ensureFileThumbnail: vi.fn(),
      generateAudioProxy: vi.fn(),
      generateMediaWaveform: vi.fn(),
      generateMediaSpectrogram: vi.fn(),
      copyMediaItems: vi.fn(),
      duplicateMediaItems: vi.fn(),
      pasteMediaItems: vi.fn(),
      hasMediaClipboard: () => false,
      folders: [],
      createFolder: vi.fn(),
      importFiles: vi.fn(),
      importFilesWithHandles: vi.fn(),
      handleDelete: vi.fn(),
    } as unknown as Parameters<typeof useMediaPanelSelectionCommands>[0];
    const { result } = renderHook(() => useMediaPanelSelectionCommands(input));
    const nativeEvent = new MouseEvent('contextmenu');
    Object.defineProperty(nativeEvent, '__masterSelectsTouchContextMenu', { value: true });
    const event = {
      clientX: 143,
      clientY: 287,
      ctrlKey: false,
      metaKey: false,
      nativeEvent,
      preventDefault: vi.fn(),
    } as unknown as ReactMouseEvent;

    act(() => result.current.handleContextMenu(event, 'media-1', null));

    expect(setContextMenu).toHaveBeenCalledWith(expect.objectContaining({
      x: 143,
      y: 287,
      preferAbove: true,
    }));
  });
});
