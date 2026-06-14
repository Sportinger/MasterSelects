import { useMediaStore } from '../mediaStore';
import { DEFAULT_DRAG_STATE } from './layoutDefaults';
import { findTabGroupById } from './layoutTree';
import type { DockSliceCreator, DragAndPanelStateActions } from './storeTypes';

export const createDragAndPanelStateActions: DockSliceCreator<DragAndPanelStateActions> = (set, get) => ({
  startDrag: (panel, sourceGroupId, offset, initialPos, sourceFloatingId = null) => {
    set({
      dragState: {
        isDragging: true,
        draggedPanel: panel,
        sourceGroupId,
        sourceFloatingId,
        dropTarget: null,
        dragOffset: offset,
        currentPos: initialPos || { x: 0, y: 0 },
      },
    });
  },

  updateDrag: (pos, dropTarget) => {
    set((state) => ({
      dragState: {
        ...state.dragState,
        currentPos: pos,
        dropTarget,
      },
    }));
  },

  endDrag: () => {
    const { dragState } = get();
    if (dragState.isDragging && dragState.draggedPanel && dragState.dropTarget && dragState.sourceFloatingId) {
      get().dockFloatingPanel(dragState.sourceFloatingId, dragState.dropTarget);
    } else if (dragState.isDragging && dragState.draggedPanel && dragState.dropTarget && dragState.sourceGroupId) {
      get().movePanel(dragState.draggedPanel.id, dragState.sourceGroupId, dragState.dropTarget);
    }
    set({ dragState: DEFAULT_DRAG_STATE });
  },

  cancelDrag: () => {
    set({ dragState: DEFAULT_DRAG_STATE });
  },

  setHoveredTabTarget: (target) => {
    set({ hoveredTabTarget: target });
  },

  clearHoveredTabTarget: (panelId) => {
    set((state) => {
      if (!state.hoveredTabTarget) return {};
      if (panelId && state.hoveredTabTarget.panelId !== panelId) return {};
      return { hoveredTabTarget: null };
    });
  },

  setMaximizedPanel: (panelId) => {
    set({ maximizedPanelId: panelId });
  },

  toggleHoveredTabMaximized: () => {
    const { hoveredTabTarget, maximizedPanelId, layout, setActiveTab } = get();

    if (!hoveredTabTarget) {
      if (maximizedPanelId) {
        set({ maximizedPanelId: null });
      }
      return;
    }

    if (maximizedPanelId === hoveredTabTarget.panelId) {
      set({ maximizedPanelId: null });
      return;
    }

    if (hoveredTabTarget.kind === 'panel') {
      const group = findTabGroupById(layout.root, hoveredTabTarget.groupId);
      const panelIndex = group?.panels.findIndex((panel) => panel.id === hoveredTabTarget.panelId) ?? -1;
      if (!group || panelIndex < 0) {
        set({ hoveredTabTarget: null, maximizedPanelId: null });
        return;
      }
      setActiveTab(group.id, panelIndex);
    } else if (hoveredTabTarget.compositionId) {
      useMediaStore.getState().setActiveComposition(hoveredTabTarget.compositionId);
    }

    set({ maximizedPanelId: hoveredTabTarget.panelId });
  },

  setPanelZoom: (panelId, zoom) => {
    const clampedZoom = Math.max(0.5, Math.min(2.0, zoom));
    set((state) => ({
      layout: {
        ...state.layout,
        panelZoom: {
          ...state.layout.panelZoom,
          [panelId]: clampedZoom,
        },
      },
    }));
  },

  getPanelZoom: (panelId) => {
    return get().layout.panelZoom[panelId] ?? 1.0;
  },
});
