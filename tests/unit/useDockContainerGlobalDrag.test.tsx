import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDockContainerGlobalDrag } from '../../src/components/dock/container/useDockContainerGlobalDrag';
import {
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import { findTabGroupById } from '../../src/stores/dockStore/layoutTree';

function dispatchPrimaryPointerUp(clientX: number, clientY: number): void {
  const event = new MouseEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 7 },
    pointerType: { value: 'touch' },
  });
  window.dispatchEvent(event);
}

function dispatchBlockedPrimaryPointerUp(target: HTMLElement, clientX: number, clientY: number): void {
  const event = new MouseEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 7 },
    pointerType: { value: 'touch' },
  });
  target.dispatchEvent(event);
}

describe('dock container global drag release', () => {
  beforeEach(() => {
    localStorage.clear();
    useDockStore.setState({
      savedLayouts: getFactoryDockLayouts(),
      defaultSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      activeSavedLayoutId: null,
    });
    useDockStore.getState().resetLayout();
  });

  it('commits a drag on the first pointer release even when dragging began later', () => {
    const { unmount } = renderHook(() => useDockContainerGlobalDrag({
      getRootEdgeDropTarget: () => null,
    }));

    const rightGroup = findTabGroupById(useDockStore.getState().layout.root, 'right-group');
    const exportPanel = rightGroup?.panels.find((panel) => panel.id === 'export');
    expect(exportPanel).toBeDefined();

    act(() => {
      useDockStore.getState().startDrag(
        exportPanel!,
        'right-group',
        { x: 8, y: 8 },
        { x: 240, y: 120 },
      );
      useDockStore.getState().updateDrag({ x: 300, y: 140 }, {
        groupId: 'preview-group',
        position: 'center',
        tabInsertIndex: 1,
      });
      dispatchPrimaryPointerUp(300, 140);
    });

    const state = useDockStore.getState();
    expect(state.dragState.isDragging).toBe(false);
    expect(state.dragState.lastDropCommitted).toBe(true);
    expect(findTabGroupById(state.layout.root, 'preview-group')?.panels.map((panel) => panel.id))
      .toEqual(['preview', 'export']);

    unmount();
  });

  it('commits the first touch release before a nested gesture can stop propagation', () => {
    const { unmount } = renderHook(() => useDockContainerGlobalDrag({
      getRootEdgeDropTarget: () => null,
    }));
    const blockingTarget = document.createElement('div');
    document.body.appendChild(blockingTarget);
    blockingTarget.addEventListener('pointerup', event => event.stopPropagation(), true);

    const rightGroup = findTabGroupById(useDockStore.getState().layout.root, 'right-group');
    const exportPanel = rightGroup?.panels.find((panel) => panel.id === 'export');
    expect(exportPanel).toBeDefined();

    act(() => {
      useDockStore.getState().startDrag(
        exportPanel!,
        'right-group',
        { x: 8, y: 8 },
        { x: 240, y: 120 },
      );
      useDockStore.getState().updateDrag({ x: 300, y: 140 }, {
        groupId: 'preview-group',
        position: 'center',
        tabInsertIndex: 1,
      });
      dispatchBlockedPrimaryPointerUp(blockingTarget, 300, 140);
    });

    const state = useDockStore.getState();
    expect(state.dragState.isDragging).toBe(false);
    expect(state.dragState.lastDropCommitted).toBe(true);

    blockingTarget.remove();
    unmount();
  });
});
