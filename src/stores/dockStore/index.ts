// Zustand store for dock layout state management

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type {
  DockLayout,
  DockPanel,
  DockDragState,
  DropTarget,
  FloatingPanel,
  PanelType,
  PanelData,
  PreviewPanelData,
  HoveredDockTabTarget,
  SavedDockLayout,
  SavedDockTimelineLayout,
  SavedDockTimelineTrackSlotLayout,
} from '../../types/dock';
import { MULTI_INSTANCE_PANEL_TYPES } from '../../types/dock';
import {
  removePanel,
  insertPanelAtTarget,
  collapseSingleChildSplits,
  adjustDropTargetForMovedPanel,
} from '../../utils/dockLayout';
import { Logger } from '../../services/logger';
import { createPreviewPanelDataPatch, createPreviewPanelSource } from '../../utils/previewPanelSource';
import { useMediaStore } from '../mediaStore';
import { useTimelineStore } from '../timeline';
import { DEFAULT_DRAG_STATE, DEFAULT_LAYOUT } from './layoutDefaults';
import { getPanelConfig, VALID_PANEL_TYPES, FACTORY_VIDEO_EDIT_LAYOUT_ID } from './panelRegistry';
import { cleanupSavedTimelineLayout, TIMELINE_TRACK_TYPES, type TimelineTrackType } from './timelineLayoutPersistence';
import {
  cleanupPersistedLayout,
  cleanupRestoredCurrentLayout,
  cleanupSavedLayout,
  cloneDockLayout,
  getFactoryDockLayouts,
  getLayoutMaxZIndex,
  getMatchingEditableSavedLayout,
  isProtectedFactoryDockLayout,
  mergeFactoryDockLayouts,
} from './layoutPersistence';
import {
  collectPanelTypes,
  findFirstTabGroup,
  findGroupIdByPanelId,
  findPanelAndGroup,
  findPanelById,
  findTabGroupById,
  replacePanelInLayout,
  updateNodeInLayout,
  updatePanelDataInLayout,
} from './layoutTree';

export {
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  CAN_EDIT_FACTORY_DOCK_LAYOUTS,
} from './panelRegistry';
export {
  getFactoryDockLayouts,
  isFactoryDockLayout,
  isFactoryDockLayoutId,
  isProtectedFactoryDockLayout,
} from './layoutPersistence';

const log = Logger.create('DockStore');
const LEGACY_DEFAULT_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default';
const DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default-timeline';
export const DOCK_LAYOUT_TRANSITION_EVENT = 'masterselects:dock-layout-transition';
const DOCK_LAYOUT_TRANSITION_DURATION_MS = 500;

function requestDockLayoutTransition(durationMs = DOCK_LAYOUT_TRANSITION_DURATION_MS): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(DOCK_LAYOUT_TRANSITION_EVENT, {
    detail: { durationMs },
  }));
}


function captureTimelineLayout(): SavedDockTimelineLayout {
  const timelineState = useTimelineStore.getState();
  const videoTracks = timelineState.tracks.filter((track) => track.type === 'video');
  const audioTracks = timelineState.tracks.filter((track) => track.type === 'audio');
  const firstVideoTrack = videoTracks[0];
  const firstAudioTrack = audioTracks[0];
  const toTrackSlotLayouts = (tracks: typeof timelineState.tracks): SavedDockTimelineTrackSlotLayout[] => (
    tracks.map((track) => ({
      height: track.height,
      visible: track.visible !== false,
    }))
  );

  return {
    audioDisplayMode: timelineState.audioDisplayMode,
    audioLayerAdvancedMode: timelineState.audioLayerAdvancedMode !== false,
    audioFocusMode: timelineState.audioFocusMode,
    trackFocusMode: timelineState.trackFocusMode,
    trackHeaderWidth: timelineState.trackHeaderWidth,
    timelineSplitRatio: timelineState.timelineSplitRatio,
    trackHeights: Object.fromEntries(
      timelineState.tracks.map((track) => [track.id, track.height]),
    ),
    trackTypeHeights: {
      ...(firstVideoTrack ? { video: firstVideoTrack.height } : {}),
      ...(firstAudioTrack ? { audio: firstAudioTrack.height } : {}),
    },
    trackVisibility: Object.fromEntries(
      timelineState.tracks.map((track) => [track.id, track.visible !== false]),
    ),
    trackTypeVisibility: {
      ...(firstVideoTrack ? { video: firstVideoTrack.visible !== false } : {}),
      ...(firstAudioTrack ? { audio: firstAudioTrack.visible !== false } : {}),
    },
    trackTypeCounts: {
      video: videoTracks.length,
      audio: audioTracks.length,
    },
    trackTypeLayouts: {
      video: toTrackSlotLayouts(videoTracks),
      audio: toTrackSlotLayouts(audioTracks),
    },
  };
}

function getTimelineTrackTypeTargetCount(
  timeline: SavedDockTimelineLayout,
  type: TimelineTrackType,
): number {
  return Math.max(
    timeline.trackTypeCounts?.[type] ?? 0,
    timeline.trackTypeLayouts?.[type]?.length ?? 0,
  );
}

function ensureTimelineTrackTypeCounts(timeline: SavedDockTimelineLayout): void {
  for (const type of TIMELINE_TRACK_TYPES) {
    const targetCount = getTimelineTrackTypeTargetCount(timeline, type);
    if (targetCount <= 0) {
      continue;
    }

    let currentCount = useTimelineStore.getState().tracks.filter((track) => track.type === type).length;
    while (currentCount < targetCount) {
      useTimelineStore.getState().addTrack(type);
      const nextCount = useTimelineStore.getState().tracks.filter((track) => track.type === type).length;
      if (nextCount <= currentCount) {
        break;
      }
      currentCount = nextCount;
    }
  }
}

function applySavedTimelineLayout(timeline: SavedDockTimelineLayout | undefined): void {
  const cleaned = cleanupSavedTimelineLayout(timeline);
  if (!cleaned) {
    return;
  }

  ensureTimelineTrackTypeCounts(cleaned);

  const timelineStore = useTimelineStore.getState();
  if (cleaned.audioDisplayMode) {
    timelineStore.setAudioDisplayMode(cleaned.audioDisplayMode);
  }
  if (typeof cleaned.audioLayerAdvancedMode === 'boolean') {
    timelineStore.setAudioLayerAdvancedMode(cleaned.audioLayerAdvancedMode);
  }
  if (cleaned.trackFocusMode) {
    timelineStore.setTrackFocusMode(cleaned.trackFocusMode);
  } else if (typeof cleaned.audioFocusMode === 'boolean') {
    timelineStore.setAudioFocusMode(cleaned.audioFocusMode);
  }
  if (typeof cleaned.trackHeaderWidth === 'number') {
    timelineStore.setTrackHeaderWidth(cleaned.trackHeaderWidth);
  }
  if ('timelineSplitRatio' in cleaned) {
    timelineStore.setTimelineSplitRatio(cleaned.timelineSplitRatio ?? null);
  }

  const exactTrackHeightIds = new Set(Object.keys(cleaned.trackHeights ?? {}));
  if (cleaned.trackHeights) {
    const currentTrackIds = new Set(useTimelineStore.getState().tracks.map((track) => track.id));
    for (const [trackId, height] of Object.entries(cleaned.trackHeights)) {
      if (currentTrackIds.has(trackId)) {
        useTimelineStore.getState().setTrackHeight(trackId, height);
      }
    }
  }

  const indexedTrackHeightIds = new Set<string>();
  if (cleaned.trackTypeLayouts) {
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = cleaned.trackTypeLayouts[type] ?? [];
      if (slots.length === 0) {
        continue;
      }

      const currentTracks = useTimelineStore.getState().tracks.filter((track) => track.type === type);
      slots.forEach((slot, index) => {
        const track = currentTracks[index];
        if (!track || exactTrackHeightIds.has(track.id) || typeof slot.height !== 'number') {
          return;
        }
        useTimelineStore.getState().setTrackHeight(track.id, slot.height);
        indexedTrackHeightIds.add(track.id);
      });
    }
  }

  if (cleaned.trackTypeHeights) {
    const currentTracks = useTimelineStore.getState().tracks;
    for (const track of currentTracks) {
      if (exactTrackHeightIds.has(track.id) || indexedTrackHeightIds.has(track.id)) {
        continue;
      }
      const typeHeight = cleaned.trackTypeHeights[track.type];
      if (typeof typeHeight === 'number') {
        useTimelineStore.getState().setTrackHeight(track.id, typeHeight);
      }
    }
  }

  const exactTrackVisibilityIds = new Set(Object.keys(cleaned.trackVisibility ?? {}));
  if (cleaned.trackVisibility) {
    const currentTrackIds = new Set(useTimelineStore.getState().tracks.map((track) => track.id));
    for (const [trackId, visible] of Object.entries(cleaned.trackVisibility)) {
      if (currentTrackIds.has(trackId)) {
        useTimelineStore.getState().setTrackVisible(trackId, visible);
      }
    }
  }

  const indexedTrackVisibilityIds = new Set<string>();
  if (cleaned.trackTypeLayouts) {
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = cleaned.trackTypeLayouts[type] ?? [];
      if (slots.length === 0) {
        continue;
      }

      const currentTracks = useTimelineStore.getState().tracks.filter((track) => track.type === type);
      slots.forEach((slot, index) => {
        const track = currentTracks[index];
        if (!track || exactTrackVisibilityIds.has(track.id) || typeof slot.visible !== 'boolean') {
          return;
        }
        useTimelineStore.getState().setTrackVisible(track.id, slot.visible);
        indexedTrackVisibilityIds.add(track.id);
      });
    }
  }

  if (cleaned.trackTypeVisibility) {
    const currentTracks = useTimelineStore.getState().tracks;
    for (const track of currentTracks) {
      if (exactTrackVisibilityIds.has(track.id) || indexedTrackVisibilityIds.has(track.id)) {
        continue;
      }
      const typeVisible = cleaned.trackTypeVisibility[track.type];
      if (typeof typeVisible === 'boolean') {
        useTimelineStore.getState().setTrackVisible(track.id, typeVisible);
      }
    }
  }
}


interface DockState {
  layout: DockLayout;
  dragState: DockDragState;
  maxZIndex: number;
  hoveredTabTarget: HoveredDockTabTarget | null;
  maximizedPanelId: string | null;
  savedLayouts: SavedDockLayout[];
  defaultSavedLayoutId: string | null;
  activeSavedLayoutId: string | null;

  // Layout mutations
  setActiveTab: (groupId: string, index: number) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  movePanel: (panelId: string, sourceGroupId: string, target: DropTarget) => void;
  closePanel: (panelId: string, groupId: string) => void;
  closePanelById: (panelId: string) => void;
  changePanelType: (panelId: string, type: PanelType) => void;

  // Floating panel actions
  floatPanel: (panelId: string, groupId: string, position: { x: number; y: number }) => void;
  dockFloatingPanel: (floatingId: string, target: DropTarget) => void;
  updateFloatingPosition: (floatingId: string, position: { x: number; y: number }) => void;
  updateFloatingSize: (floatingId: string, size: { width: number; height: number }) => void;
  bringToFront: (floatingId: string) => void;

  // Drag state actions
  startDrag: (panel: DockPanel, sourceGroupId: string, offset: { x: number; y: number }, initialPos?: { x: number; y: number }) => void;
  updateDrag: (pos: { x: number; y: number }, dropTarget: DropTarget | null) => void;
  endDrag: () => void;
  cancelDrag: () => void;

  // Hovered/maximized dock tabs
  setHoveredTabTarget: (target: HoveredDockTabTarget | null) => void;
  clearHoveredTabTarget: (panelId?: string) => void;
  setMaximizedPanel: (panelId: string | null) => void;
  toggleHoveredTabMaximized: () => void;

  // Panel zoom
  setPanelZoom: (panelId: string, zoom: number) => void;
  getPanelZoom: (panelId: string) => number;

  // Panel visibility
  getVisiblePanelTypes: () => PanelType[];
  isPanelTypeVisible: (type: PanelType) => boolean;
  togglePanelType: (type: PanelType) => void;
  showPanelType: (type: PanelType) => void;
  hidePanelType: (type: PanelType) => void;
  activatePanelType: (type: PanelType) => void;
  // Add a panel type as a tab into a specific group (used by the per-panel "+" button)
  addPanelTypeToGroup: (type: PanelType, groupId: string) => void;

  // Multiple preview panels. Optional targetGroupId places the new instance
  // side-by-side (split right) of that group — e.g. the tab bar whose "+" was clicked.
  addPreviewPanel: (compositionId: string | null, targetGroupId?: string) => void;
  updatePanelData: (panelId: string, data: Partial<PanelData>) => void;

  // Layout management
  saveNamedLayout: (name: string) => SavedDockLayout | null;
  saveCurrentNamedLayout: () => SavedDockLayout | null;
  loadSavedLayout: (layoutId: string) => void;
  setDefaultSavedLayout: (layoutId: string | null) => void;
  toggleFavoriteSavedLayout: (layoutId: string) => void;
  resetLayout: () => void;
  saveLayoutAsDefault: () => void;

  // Project persistence (for saving/loading layout from project file)
  getLayoutForProject: () => DockLayout;
  setLayoutFromProject: (layout: DockLayout) => void;
}

export const useDockStore = create<DockState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        layout: cloneDockLayout(DEFAULT_LAYOUT),
        dragState: DEFAULT_DRAG_STATE,
        maxZIndex: 1000,
        hoveredTabTarget: null,
        maximizedPanelId: null,
        savedLayouts: getFactoryDockLayouts(),
        defaultSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
        activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,

        setActiveTab: (groupId, index) => {
          set((state) => ({
            layout: updateNodeInLayout(state.layout, groupId, (node) => {
              if (node.kind === 'tab-group') {
                return { ...node, activeIndex: Math.min(index, node.panels.length - 1) };
              }
              return node;
            }),
          }));
        },

        setSplitRatio: (splitId, ratio) => {
          set((state) => ({
            layout: updateNodeInLayout(state.layout, splitId, (node) => {
              if (node.kind === 'split') {
                return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
              }
              return node;
            }),
          }));
        },

        movePanel: (panelId, sourceGroupId, target) => {
          const { layout } = get();
          const targetAfterRemoval = adjustDropTargetForMovedPanel(layout.root, panelId, sourceGroupId, target);

          // Remove panel from source
          let newLayout = removePanel(layout, panelId, sourceGroupId);

          // Insert at target
          const panel = findPanelById(layout, panelId);
          if (panel) {
            newLayout = insertPanelAtTarget(newLayout, panel, targetAfterRemoval);
          }

          // Clean up empty groups and single-child splits
          newLayout = {
            ...newLayout,
            root: collapseSingleChildSplits(newLayout.root),
          };

          set({ layout: newLayout });
        },

        closePanel: (panelId, groupId) => {
          const { layout } = get();
          let newLayout = removePanel(layout, panelId, groupId);
          newLayout = {
            ...newLayout,
            root: collapseSingleChildSplits(newLayout.root),
          };
          set((state) => ({
            layout: newLayout,
            hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
            maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
          }));
        },

        closePanelById: (panelId) => {
          const { layout } = get();
          // First check floating panels
          const floating = layout.floatingPanels.find(f => f.panel.id === panelId);
          if (floating) {
            set((state) => ({
              layout: {
                ...layout,
                floatingPanels: layout.floatingPanels.filter(f => f.panel.id !== panelId),
              },
              hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
            }));
            return;
          }
          // Find in docked panels
          const groupId = findGroupIdByPanelId(layout.root, panelId);
          if (groupId) {
            let newLayout = removePanel(layout, panelId, groupId);
            newLayout = {
              ...newLayout,
              root: collapseSingleChildSplits(newLayout.root),
            };
            set((state) => ({
              layout: newLayout,
              hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
            }));
          }
        },

        changePanelType: (panelId, type) => {
          if (!VALID_PANEL_TYPES.has(type)) return;

          const { layout } = get();
          const sourceGroupId = findGroupIdByPanelId(layout.root, panelId);
          if (!sourceGroupId) return;
          const sourcePanel = findPanelById(layout, panelId);
          if (!sourcePanel || sourcePanel.type === type) return;

          let nextLayout = layout;
          let replacementPanel: DockPanel | null = null;

          const existingDockedPanel = findPanelAndGroup(nextLayout.root, type);
          if (existingDockedPanel && existingDockedPanel.panel.id !== panelId) {
            replacementPanel = existingDockedPanel.panel;
            nextLayout = removePanel(nextLayout, existingDockedPanel.panel.id, existingDockedPanel.groupId);
            nextLayout = {
              ...nextLayout,
              root: collapseSingleChildSplits(nextLayout.root),
            };
          }

          if (!replacementPanel) {
            const floatingPanel = nextLayout.floatingPanels.find((floating) => floating.panel.type === type);
            if (floatingPanel && floatingPanel.panel.id !== panelId) {
              replacementPanel = floatingPanel.panel;
              nextLayout = {
                ...nextLayout,
                floatingPanels: nextLayout.floatingPanels.filter((floating) => floating.id !== floatingPanel.id),
              };
            }
          }

          if (!replacementPanel) {
            const config = getPanelConfig(type);
            replacementPanel = {
              id: type,
              type,
              title: config.title,
            };
          }

          nextLayout = replacePanelInLayout(nextLayout, panelId, replacementPanel);
          const nextPanelId = replacementPanel.id;
          set((state) => ({
            layout: nextLayout,
            hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId || state.hoveredTabTarget?.panelId === nextPanelId
              ? null
              : state.hoveredTabTarget,
            maximizedPanelId: state.maximizedPanelId === panelId ? nextPanelId : state.maximizedPanelId,
          }));
        },

        floatPanel: (panelId, groupId, position) => {
          const { layout, maxZIndex } = get();
          const panel = findPanelById(layout, panelId);
          if (!panel) return;

          // Remove from dock
          let newLayout = removePanel(layout, panelId, groupId);
          newLayout = {
            ...newLayout,
            root: collapseSingleChildSplits(newLayout.root),
          };

          // Add as floating
          const floatingPanel: FloatingPanel = {
            id: `floating-${panelId}-${Date.now()}`,
            panel,
            position,
            size: { width: 400, height: 300 },
            zIndex: maxZIndex + 1,
          };

          set({
            layout: {
              ...newLayout,
              floatingPanels: [...newLayout.floatingPanels, floatingPanel],
            },
            maxZIndex: maxZIndex + 1,
          });
        },

        dockFloatingPanel: (floatingId, target) => {
          const { layout } = get();
          const floating = layout.floatingPanels.find((f) => f.id === floatingId);
          if (!floating) return;

          // Remove from floating
          const newFloating = layout.floatingPanels.filter((f) => f.id !== floatingId);

          // Insert at target
          const newLayout = insertPanelAtTarget(
            { ...layout, floatingPanels: newFloating },
            floating.panel,
            target
          );

          set({ layout: newLayout });
        },

        updateFloatingPosition: (floatingId, position) => {
          set((state) => ({
            layout: {
              ...state.layout,
              floatingPanels: state.layout.floatingPanels.map((f) =>
                f.id === floatingId ? { ...f, position } : f
              ),
            },
          }));
        },

        updateFloatingSize: (floatingId, size) => {
          set((state) => ({
            layout: {
              ...state.layout,
              floatingPanels: state.layout.floatingPanels.map((f) =>
                f.id === floatingId ? { ...f, size } : f
              ),
            },
          }));
        },

        bringToFront: (floatingId) => {
          const { maxZIndex } = get();
          set((state) => ({
            layout: {
              ...state.layout,
              floatingPanels: state.layout.floatingPanels.map((f) =>
                f.id === floatingId ? { ...f, zIndex: maxZIndex + 1 } : f
              ),
            },
            maxZIndex: maxZIndex + 1,
          }));
        },

        startDrag: (panel, sourceGroupId, offset, initialPos) => {
          set({
            dragState: {
              isDragging: true,
              draggedPanel: panel,
              sourceGroupId,
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
          if (dragState.isDragging && dragState.draggedPanel && dragState.dropTarget && dragState.sourceGroupId) {
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
            const panelIndex = group?.panels.findIndex(panel => panel.id === hoveredTabTarget.panelId) ?? -1;
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

        getVisiblePanelTypes: () => {
          const { layout } = get();
          const types: PanelType[] = [];
          collectPanelTypes(layout.root, types);
          // Also check floating panels
          layout.floatingPanels.forEach((f) => {
            if (VALID_PANEL_TYPES.has(f.panel.type) && !types.includes(f.panel.type)) {
              types.push(f.panel.type);
            }
          });
          return types;
        },

        isPanelTypeVisible: (type) => {
          return get().getVisiblePanelTypes().includes(type);
        },

        togglePanelType: (type) => {
          const { isPanelTypeVisible, showPanelType, hidePanelType } = get();
          if (isPanelTypeVisible(type)) {
            hidePanelType(type);
          } else {
            showPanelType(type);
          }
        },

        showPanelType: (type) => {
          if (!VALID_PANEL_TYPES.has(type)) return;
          const { layout, isPanelTypeVisible } = get();
          if (isPanelTypeVisible(type)) return; // Already visible

          const config = getPanelConfig(type);
          const newPanel: DockPanel = {
            id: type,
            type,
            title: config.title,
          };

          // Find the right-group to add to, or create a new floating panel
          const rightGroup = findTabGroupById(layout.root, 'right-group');
          if (rightGroup) {
            const newLayout = insertPanelAtTarget(layout, newPanel, {
              groupId: 'right-group',
              position: 'center',
            });
            set({ layout: newLayout });
          } else {
            // Fallback: find any tab group
            const anyGroup = findFirstTabGroup(layout.root);
            if (anyGroup) {
              const newLayout = insertPanelAtTarget(layout, newPanel, {
                groupId: anyGroup.id,
                position: 'center',
              });
              set({ layout: newLayout });
            }
          }
        },

        hidePanelType: (type) => {
          const { layout } = get();

          // Find and remove the panel from the layout
          const result = findPanelAndGroup(layout.root, type);
          if (result) {
            let newLayout = removePanel(layout, result.panel.id, result.groupId);
            newLayout = {
              ...newLayout,
              root: collapseSingleChildSplits(newLayout.root),
            };
            set((state) => ({
              layout: newLayout,
              hoveredTabTarget: state.hoveredTabTarget?.panelId === result.panel.id ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === result.panel.id ? null : state.maximizedPanelId,
            }));
          }

          // Also check floating panels
          const floatingIndex = layout.floatingPanels.findIndex((f) => f.panel.type === type);
          if (floatingIndex >= 0) {
            set((state) => ({
              layout: {
                ...layout,
                floatingPanels: layout.floatingPanels.filter((_, i) => i !== floatingIndex),
              },
              hoveredTabTarget: state.hoveredTabTarget?.panelId === layout.floatingPanels[floatingIndex]?.panel.id ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === layout.floatingPanels[floatingIndex]?.panel.id ? null : state.maximizedPanelId,
            }));
          }
        },

        activatePanelType: (type) => {
          if (!VALID_PANEL_TYPES.has(type)) return;
          const { setActiveTab, showPanelType, isPanelTypeVisible, bringToFront } = get();

          // First make sure the panel is visible
          if (!isPanelTypeVisible(type)) {
            showPanelType(type);
          }

          const { layout } = get();

          // Find the panel in the layout and activate it
          const result = findPanelAndGroup(layout.root, type);
          if (result) {
            // Find the actual tab group to get the panel index
            const group = findTabGroupById(layout.root, result.groupId);
            if (group) {
              const panelIndex = group.panels.findIndex((p) => p.type === type);
              if (panelIndex >= 0) {
                setActiveTab(result.groupId, panelIndex);
              }
            }
          }

          // Also check floating panels
          const floatingPanel = layout.floatingPanels.find((f) => f.panel.type === type);
          if (floatingPanel) {
            bringToFront(floatingPanel.id);
          }
        },

        addPanelTypeToGroup: (type, groupId) => {
          if (!VALID_PANEL_TYPES.has(type)) return;

          // Multi-instance panels (e.g. Preview) always spawn a fresh, independent
          // instance side-by-side of the clicked group instead of focusing the
          // existing one. Each instance has its own id / render target.
          if (MULTI_INSTANCE_PANEL_TYPES.includes(type)) {
            if (type === 'preview') {
              get().addPreviewPanel(null, groupId);
            }
            return;
          }

          const { layout, isPanelTypeVisible, activatePanelType } = get();

          // Built-in panels are singletons (id === type). If already visible,
          // just focus it instead of trying to create a duplicate.
          if (isPanelTypeVisible(type)) {
            activatePanelType(type);
            return;
          }

          const config = getPanelConfig(type);
          const newPanel: DockPanel = {
            id: type,
            type,
            title: config.title,
          };

          // Insert into the requested group, falling back to any group.
          const targetGroupId = findTabGroupById(layout.root, groupId)
            ? groupId
            : findFirstTabGroup(layout.root)?.id;
          if (!targetGroupId) return;

          const newLayout = insertPanelAtTarget(layout, newPanel, {
            groupId: targetGroupId,
            position: 'center',
          });
          set({ layout: newLayout });
        },

        addPreviewPanel: (compositionId, targetGroupId) => {
          const { layout } = get();

          const newPanelId = `preview-${Date.now()}`;
          const newPanel: DockPanel = {
            id: newPanelId,
            type: 'preview',
            title: 'Preview',
            data: createPreviewPanelDataPatch(createPreviewPanelSource(compositionId)) as PreviewPanelData,
          };

          // Prefer the explicitly requested group (the tab bar whose "+" was clicked),
          // then the canonical preview-group, then any tab group. Insert side-by-side.
          const resolvedGroupId =
            (targetGroupId && findTabGroupById(layout.root, targetGroupId) ? targetGroupId : null)
            ?? (findTabGroupById(layout.root, 'preview-group') ? 'preview-group' : null)
            ?? findFirstTabGroup(layout.root)?.id;
          if (!resolvedGroupId) return;

          const newLayout = insertPanelAtTarget(layout, newPanel, {
            groupId: resolvedGroupId,
            position: 'right',
          });
          set({ layout: newLayout });
        },

        updatePanelData: (panelId, data) => {
          set((state) => ({
            layout: updatePanelDataInLayout(state.layout, panelId, data),
          }));
        },

        saveNamedLayout: (name) => {
          const trimmedName = name.trim();
          if (!trimmedName) {
            return null;
          }

          const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(get().layout));
          const timelineLayout = captureTimelineLayout();
          const now = Date.now();
          const existingLayout = get().savedLayouts.find((savedLayout) => (
            savedLayout.name.trim().toLowerCase() === trimmedName.toLowerCase()
          ));
          if (isProtectedFactoryDockLayout(existingLayout)) {
            return null;
          }
          const nextSavedLayout: SavedDockLayout = existingLayout
            ? {
                ...existingLayout,
                name: trimmedName,
                layout: cleanedLayout,
                timeline: timelineLayout,
                updatedAt: now,
              }
            : {
                id: `saved-layout-${now}-${Math.random().toString(36).slice(2, 8)}`,
                name: trimmedName,
                layout: cleanedLayout,
                timeline: timelineLayout,
                createdAt: now,
                updatedAt: now,
              };

          set((state) => ({
            savedLayouts: [
              nextSavedLayout,
              ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
            ],
            activeSavedLayoutId: nextSavedLayout.id,
          }));

          return nextSavedLayout;
        },

        saveCurrentNamedLayout: () => {
          const { activeSavedLayoutId, savedLayouts, layout } = get();
          if (!activeSavedLayoutId) {
            return null;
          }

          const existingLayout = savedLayouts.find((savedLayout) => savedLayout.id === activeSavedLayoutId);
          if (!existingLayout) {
            set({ activeSavedLayoutId: null });
            return null;
          }
          if (isProtectedFactoryDockLayout(existingLayout)) {
            return null;
          }

          const nextSavedLayout: SavedDockLayout = {
            ...existingLayout,
            layout: cleanupPersistedLayout(cloneDockLayout(layout)),
            timeline: captureTimelineLayout(),
            updatedAt: Date.now(),
          };

          set((state) => ({
            savedLayouts: [
              nextSavedLayout,
              ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
            ],
            activeSavedLayoutId: nextSavedLayout.id,
          }));

          return nextSavedLayout;
        },

        loadSavedLayout: (layoutId) => {
          const savedLayout = get().savedLayouts.find((candidate) => candidate.id === layoutId);
          if (!savedLayout) {
            return;
          }

          const nextLayout = cleanupPersistedLayout(cloneDockLayout(savedLayout.layout));
          requestDockLayoutTransition();
          set({
            layout: nextLayout,
            maxZIndex: getLayoutMaxZIndex(nextLayout),
            hoveredTabTarget: null,
            maximizedPanelId: null,
            activeSavedLayoutId: savedLayout.id,
          });
          applySavedTimelineLayout(savedLayout.timeline);
        },

        setDefaultSavedLayout: (layoutId) => {
          if (layoutId !== null && !get().savedLayouts.some((savedLayout) => savedLayout.id === layoutId)) {
            return;
          }

          set({ defaultSavedLayoutId: layoutId });
        },

        toggleFavoriteSavedLayout: (layoutId) => {
          set((state) => ({
            savedLayouts: state.savedLayouts.map((savedLayout) => (
              savedLayout.id === layoutId
                ? { ...savedLayout, favorite: savedLayout.favorite !== true }
                : savedLayout
            )),
          }));
        },

        resetLayout: () => {
          const { defaultSavedLayoutId, savedLayouts } = get();
          if (defaultSavedLayoutId) {
            const defaultSavedLayout = savedLayouts.find((savedLayout) => savedLayout.id === defaultSavedLayoutId);
            if (defaultSavedLayout) {
              const nextLayout = cleanupPersistedLayout(cloneDockLayout(defaultSavedLayout.layout));
              requestDockLayoutTransition();
              set({
                layout: nextLayout,
                maxZIndex: getLayoutMaxZIndex(nextLayout),
                hoveredTabTarget: null,
                maximizedPanelId: null,
                activeSavedLayoutId: defaultSavedLayout.id,
              });
              applySavedTimelineLayout(defaultSavedLayout.timeline);
              return;
            }
          }

          // Check if there's a legacy raw default layout
          const savedDefault = localStorage.getItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY);
          if (savedDefault) {
            try {
              const parsed = cleanupPersistedLayout(JSON.parse(savedDefault) as DockLayout);
              const defaultTimeline = localStorage.getItem(DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY);
              requestDockLayoutTransition();
              set({
                layout: parsed,
                maxZIndex: getLayoutMaxZIndex(parsed),
                hoveredTabTarget: null,
                maximizedPanelId: null,
                activeSavedLayoutId: null,
              });
              if (defaultTimeline) {
                try {
                  applySavedTimelineLayout(JSON.parse(defaultTimeline) as SavedDockTimelineLayout);
                } catch (e) {
                  log.warn('Failed to parse saved default timeline layout:', e);
                }
              }
              return;
            } catch (e) {
              log.error('Failed to parse saved default layout:', e);
            }
          }
          requestDockLayoutTransition();
          set({
            layout: cloneDockLayout(DEFAULT_LAYOUT),
            maxZIndex: getLayoutMaxZIndex(DEFAULT_LAYOUT),
            hoveredTabTarget: null,
            maximizedPanelId: null,
            activeSavedLayoutId: null,
          });
        },

        saveLayoutAsDefault: () => {
          const { layout } = get();
          const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(layout));
          const timelineLayout = captureTimelineLayout();
          localStorage.setItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify(cleanedLayout));
          localStorage.setItem(DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY, JSON.stringify(timelineLayout));

          const matchingSavedLayout = getMatchingEditableSavedLayout(get().savedLayouts, cleanedLayout);
          if (matchingSavedLayout) {
            const updatedLayout: SavedDockLayout = {
              ...matchingSavedLayout,
              layout: cleanedLayout,
              timeline: timelineLayout,
              updatedAt: Date.now(),
            };
            set((state) => ({
              savedLayouts: [
                updatedLayout,
                ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== updatedLayout.id),
              ],
              defaultSavedLayoutId: updatedLayout.id,
              activeSavedLayoutId: state.activeSavedLayoutId === matchingSavedLayout.id
                ? updatedLayout.id
                : state.activeSavedLayoutId,
            }));
            return;
          }

          set({ defaultSavedLayoutId: null });
        },

        getLayoutForProject: () => {
          return cleanupPersistedLayout(cloneDockLayout(get().layout));
        },

        setLayoutFromProject: (layout: DockLayout) => {
          // Clean up any invalid panel types from the loaded layout
          const cleanedLayout = cleanupPersistedLayout(layout);
          set({
            layout: cleanedLayout,
            maxZIndex: getLayoutMaxZIndex(cleanedLayout),
            hoveredTabTarget: null,
            maximizedPanelId: null,
            activeSavedLayoutId: null,
          });
        },
      }),
      {
        name: 'webvj-dock-layout',
        partialize: (state) => ({
          layout: state.layout,
          maxZIndex: state.maxZIndex,
          savedLayouts: state.savedLayouts,
          defaultSavedLayoutId: state.defaultSavedLayoutId,
          activeSavedLayoutId: state.activeSavedLayoutId,
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<DockState> | undefined;
          const savedLayouts = Array.isArray(persisted?.savedLayouts)
            ? mergeFactoryDockLayouts(persisted.savedLayouts.map(cleanupSavedLayout))
            : mergeFactoryDockLayouts(currentState.savedLayouts);
          const defaultSavedLayoutId = (
            typeof persisted?.defaultSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.defaultSavedLayoutId)
          )
            ? persisted.defaultSavedLayoutId
            : FACTORY_VIDEO_EDIT_LAYOUT_ID;
          const persistedActiveSavedLayoutId = (
            typeof persisted?.activeSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.activeSavedLayoutId)
          )
            ? persisted.activeSavedLayoutId
            : null;
          const activeSavedLayoutId = persistedActiveSavedLayoutId
            ?? (persisted?.layout ? null : FACTORY_VIDEO_EDIT_LAYOUT_ID);

          if (persisted?.layout) {
            // Clean up any invalid panel types from persisted layout
            const cleanedLayout = cleanupRestoredCurrentLayout(persisted.layout);
            return {
              ...currentState,
              layout: cleanedLayout,
              maxZIndex: persisted.maxZIndex ?? currentState.maxZIndex,
              savedLayouts,
              defaultSavedLayoutId,
              activeSavedLayoutId,
            };
          }
          return {
            ...currentState,
            savedLayouts,
            defaultSavedLayoutId,
            activeSavedLayoutId,
          };
        },
      }
    )
  )
);
