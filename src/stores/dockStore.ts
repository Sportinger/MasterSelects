// Zustand store for dock layout state management

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type {
  DockLayout,
  DockNode,
  DockPanel,
  DockDragState,
  DropTarget,
  FloatingPanel,
  PanelType,
  DockTabGroup,
  PanelData,
  PreviewPanelData,
  HoveredDockTabTarget,
  SavedDockLayout,
} from '../types/dock';
import { PANEL_CONFIGS } from '../types/dock';
import {
  removePanel,
  insertPanelAtTarget,
  collapseSingleChildSplits,
} from '../utils/dockLayout';
import { Logger } from '../services/logger';
import { createPreviewPanelDataPatch, createPreviewPanelSource } from '../utils/previewPanelSource';
import { useMediaStore } from './mediaStore';

const log = Logger.create('DockStore');
const LEGACY_DEFAULT_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default';

// Valid panel types (used to filter out removed panels from saved layouts)
const VALID_PANEL_TYPES = new Set(Object.keys(PANEL_CONFIGS));
const LEGACY_PANEL_TYPE_ALIASES: Partial<Record<PanelType, PanelType>> = {
  youtube: 'download',
};
const COLLAPSED_LEGACY_ALIAS_TYPES = new Set<PanelType>(['download']);

interface NormalizedDockPanel {
  panel: DockPanel;
  sourceType: PanelType;
}

interface NormalizedFloatingPanel {
  floatingPanel: FloatingPanel;
  sourceType: PanelType;
}

function resolvePanelType(type: PanelType): PanelType {
  return LEGACY_PANEL_TYPE_ALIASES[type] ?? type;
}

function normalizeDockPanel(panel: DockPanel): NormalizedDockPanel | null {
  const normalizedType = resolvePanelType(panel.type);
  if (!VALID_PANEL_TYPES.has(normalizedType)) {
    return null;
  }

  return {
    sourceType: panel.type,
    panel: {
      ...panel,
      type: normalizedType,
      title: normalizedType === panel.type ? panel.title : PANEL_CONFIGS[normalizedType].title,
    },
  };
}

function collapseAliasedPanels(panels: NormalizedDockPanel[]): DockPanel[] {
  const preferredPanelIds = new Map<PanelType, string>();

  for (const panelType of COLLAPSED_LEGACY_ALIAS_TYPES) {
    const candidates = panels.filter((candidate) => candidate.panel.type === panelType);
    if (candidates.length <= 1) {
      continue;
    }

    const preferredCandidate = candidates.find((candidate) => candidate.sourceType === panelType) ?? candidates[0];
    preferredPanelIds.set(panelType, preferredCandidate.panel.id);
  }

  return panels
    .filter((candidate) => {
      const preferredPanelId = preferredPanelIds.get(candidate.panel.type);
      return preferredPanelId === undefined || candidate.panel.id === preferredPanelId;
    })
    .map((candidate) => candidate.panel);
}

function normalizeFloatingPanel(floatingPanel: FloatingPanel): NormalizedFloatingPanel | null {
  const normalizedDockPanel = normalizeDockPanel(floatingPanel.panel);
  if (!normalizedDockPanel) {
    return null;
  }

  return {
    sourceType: normalizedDockPanel.sourceType,
    floatingPanel: {
      ...floatingPanel,
      panel: normalizedDockPanel.panel,
    },
  };
}

function collapseAliasedFloatingPanels(floatingPanels: NormalizedFloatingPanel[]): FloatingPanel[] {
  const preferredPanelIds = new Map<PanelType, string>();

  for (const panelType of COLLAPSED_LEGACY_ALIAS_TYPES) {
    const candidates = floatingPanels.filter((candidate) => candidate.floatingPanel.panel.type === panelType);
    if (candidates.length <= 1) {
      continue;
    }

    const preferredCandidate = candidates.find((candidate) => candidate.sourceType === panelType) ?? candidates[0];
    preferredPanelIds.set(panelType, preferredCandidate.floatingPanel.panel.id);
  }

  return floatingPanels
    .filter((candidate) => {
      const preferredPanelId = preferredPanelIds.get(candidate.floatingPanel.panel.type);
      return preferredPanelId === undefined || candidate.floatingPanel.panel.id === preferredPanelId;
    })
    .map((candidate) => candidate.floatingPanel);
}

// Normalize legacy aliases and filter out invalid panel types from a layout node
function filterInvalidPanels(node: DockNode): DockNode | null {
  if (node.kind === 'tab-group') {
    const validPanels = collapseAliasedPanels(
      node.panels
        .map(normalizeDockPanel)
        .filter((panel): panel is NormalizedDockPanel => panel !== null)
    );
    if (validPanels.length === 0) return null;
    return {
      ...node,
      panels: validPanels,
      activeIndex: Math.min(node.activeIndex, validPanels.length - 1),
    };
  } else {
    const [left, right] = node.children;
    const filteredLeft = filterInvalidPanels(left);
    const filteredRight = filterInvalidPanels(right);
    if (!filteredLeft && !filteredRight) return null;
    if (!filteredLeft) return filteredRight;
    if (!filteredRight) return filteredLeft;
    return { ...node, children: [filteredLeft, filteredRight] };
  }
}

// Clean up a persisted layout by removing invalid panels
function cleanupPersistedLayout(layout: DockLayout): DockLayout {
  const cleanedRoot = filterInvalidPanels(layout.root);
  return {
    ...layout,
    root: cleanedRoot || DEFAULT_LAYOUT.root,
    floatingPanels: collapseAliasedFloatingPanels(
      layout.floatingPanels
        .map(normalizeFloatingPanel)
        .filter((panel): panel is NormalizedFloatingPanel => panel !== null)
    ),
  };
}

function cloneDockLayout(layout: DockLayout): DockLayout {
  return JSON.parse(JSON.stringify(layout)) as DockLayout;
}

function getLayoutMaxZIndex(layout: DockLayout): number {
  return layout.floatingPanels.reduce((maxZIndex, floatingPanel) => (
    Math.max(maxZIndex, floatingPanel.zIndex)
  ), 1000);
}

function cleanupSavedLayout(savedLayout: SavedDockLayout): SavedDockLayout {
  return {
    ...savedLayout,
    layout: cleanupPersistedLayout(savedLayout.layout),
  };
}

function areDockLayoutsEqual(left: DockLayout, right: DockLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Default layout configuration
// 3-column layout: Media/AI left, Preview center, Properties/Scopes right
// Timeline at bottom
const DEFAULT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'root-split',
    direction: 'vertical',
    ratio: 0.6, // Top section 60%, Timeline 40%
    children: [
      {
        kind: 'split',
        id: 'top-split',
        direction: 'horizontal',
        ratio: 0.15, // Left column 15%
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
              { id: 'ai-chat', type: 'ai-chat', title: 'AI Chat' },
              { id: 'ai-video', type: 'ai-video', title: 'AI Video' },
              { id: 'download', type: 'download', title: 'Downloads' },
            ],
            activeIndex: 0, // Media active
          },
          {
            kind: 'split',
            id: 'center-right-split',
            direction: 'horizontal',
            ratio: 0.67, // Center 67% of remaining (≈57% total), Right 33% (≈28% total)
            children: [
              {
                kind: 'tab-group',
                id: 'preview-group',
                panels: [
                  { id: 'preview', type: 'preview', title: 'Preview' },
                ],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'right-group',
                panels: [
                  { id: 'export', type: 'export', title: 'Export' },
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'node-workspace', type: 'node-workspace', title: 'Nodes' },
                  { id: 'scope-waveform', type: 'scope-waveform', title: 'Waveform' },
                  { id: 'scope-histogram', type: 'scope-histogram', title: 'Histogram' },
                  { id: 'scope-vectorscope', type: 'scope-vectorscope', title: 'Vectorscope' },
                ],
                activeIndex: 3, // Waveform active
              },
            ],
          },
        ],
      },
      {
        kind: 'tab-group',
        id: 'timeline-group',
        panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
        activeIndex: 0,
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {},
};

const DEFAULT_DRAG_STATE: DockDragState = {
  isDragging: false,
  draggedPanel: null,
  sourceGroupId: null,
  dropTarget: null,
  dragOffset: { x: 0, y: 0 },
  currentPos: { x: 0, y: 0 },
};

interface DockState {
  layout: DockLayout;
  dragState: DockDragState;
  maxZIndex: number;
  hoveredTabTarget: HoveredDockTabTarget | null;
  maximizedPanelId: string | null;
  savedLayouts: SavedDockLayout[];
  defaultSavedLayoutId: string | null;

  // Layout mutations
  setActiveTab: (groupId: string, index: number) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  movePanel: (panelId: string, sourceGroupId: string, target: DropTarget) => void;
  closePanel: (panelId: string, groupId: string) => void;
  closePanelById: (panelId: string) => void;

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

  // Multiple preview panels
  addPreviewPanel: (compositionId: string | null) => void;
  updatePanelData: (panelId: string, data: Partial<import('../types/dock').PanelData>) => void;

  // Layout management
  saveNamedLayout: (name: string) => SavedDockLayout | null;
  loadSavedLayout: (layoutId: string) => void;
  setDefaultSavedLayout: (layoutId: string | null) => void;
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
        layout: DEFAULT_LAYOUT,
        dragState: DEFAULT_DRAG_STATE,
        maxZIndex: 1000,
        hoveredTabTarget: null,
        maximizedPanelId: null,
        savedLayouts: [],
        defaultSavedLayoutId: null,

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

          // Remove panel from source
          let newLayout = removePanel(layout, panelId, sourceGroupId);

          // Insert at target
          const panel = findPanelById(layout, panelId);
          if (panel) {
            newLayout = insertPanelAtTarget(newLayout, panel, target);
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
            const normalizedType = resolvePanelType(f.panel.type);
            if (!types.includes(normalizedType)) {
              types.push(normalizedType);
            }
          });
          return types;
        },

        isPanelTypeVisible: (type) => {
          return get().getVisiblePanelTypes().includes(resolvePanelType(type));
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
          const resolvedType = resolvePanelType(type);
          const { layout, isPanelTypeVisible } = get();
          if (isPanelTypeVisible(resolvedType)) return; // Already visible

          const config = PANEL_CONFIGS[resolvedType];
          const newPanel: DockPanel = {
            id: resolvedType,
            type: resolvedType,
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
          const resolvedType = resolvePanelType(type);
          const { layout } = get();

          // Find and remove the panel from the layout
          const result = findPanelAndGroup(layout.root, resolvedType);
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
          const floatingIndex = layout.floatingPanels.findIndex((f) => resolvePanelType(f.panel.type) === resolvedType);
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
          const resolvedType = resolvePanelType(type);
          const { layout, setActiveTab, showPanelType, isPanelTypeVisible, bringToFront } = get();

          // First make sure the panel is visible
          if (!isPanelTypeVisible(resolvedType)) {
            showPanelType(resolvedType);
          }

          // Find the panel in the layout and activate it
          const result = findPanelAndGroup(layout.root, resolvedType);
          if (result) {
            // Find the actual tab group to get the panel index
            const group = findTabGroupById(layout.root, result.groupId);
            if (group) {
              const panelIndex = group.panels.findIndex((p) => resolvePanelType(p.type) === resolvedType);
              if (panelIndex >= 0) {
                setActiveTab(result.groupId, panelIndex);
              }
            }
          }

          // Also check floating panels
          const floatingPanel = layout.floatingPanels.find((f) => resolvePanelType(f.panel.type) === resolvedType);
          if (floatingPanel) {
            bringToFront(floatingPanel.id);
          }
        },

        addPreviewPanel: (compositionId) => {
          const { layout } = get();

          // Find the preview-group to add to
          const previewGroup = findTabGroupById(layout.root, 'preview-group');
          const newPanelId = `preview-${Date.now()}`;
          const newPanel: DockPanel = {
            id: newPanelId,
            type: 'preview',
            title: 'Preview',
            data: createPreviewPanelDataPatch(createPreviewPanelSource(compositionId)) as PreviewPanelData,
          };

          if (previewGroup) {
            // Insert to the RIGHT of the preview group (side-by-side)
            const newLayout = insertPanelAtTarget(layout, newPanel, {
              groupId: 'preview-group',
              position: 'right',
            });
            set({ layout: newLayout });
          } else {
            // Fallback: find any tab group or create floating
            const anyGroup = findFirstTabGroup(layout.root);
            if (anyGroup) {
              const newLayout = insertPanelAtTarget(layout, newPanel, {
                groupId: anyGroup.id,
                position: 'right',
              });
              set({ layout: newLayout });
            }
          }
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
          const now = Date.now();
          const existingLayout = get().savedLayouts.find((savedLayout) => (
            savedLayout.name.trim().toLowerCase() === trimmedName.toLowerCase()
          ));
          const nextSavedLayout: SavedDockLayout = existingLayout
            ? {
                ...existingLayout,
                name: trimmedName,
                layout: cleanedLayout,
                updatedAt: now,
              }
            : {
                id: `saved-layout-${now}-${Math.random().toString(36).slice(2, 8)}`,
                name: trimmedName,
                layout: cleanedLayout,
                createdAt: now,
                updatedAt: now,
              };

          set((state) => ({
            savedLayouts: [
              nextSavedLayout,
              ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
            ],
          }));

          return nextSavedLayout;
        },

        loadSavedLayout: (layoutId) => {
          const savedLayout = get().savedLayouts.find((candidate) => candidate.id === layoutId);
          if (!savedLayout) {
            return;
          }

          const nextLayout = cleanupPersistedLayout(cloneDockLayout(savedLayout.layout));
          set({
            layout: nextLayout,
            maxZIndex: getLayoutMaxZIndex(nextLayout),
            hoveredTabTarget: null,
            maximizedPanelId: null,
          });
        },

        setDefaultSavedLayout: (layoutId) => {
          if (layoutId !== null && !get().savedLayouts.some((savedLayout) => savedLayout.id === layoutId)) {
            return;
          }

          set({ defaultSavedLayoutId: layoutId });
        },

        resetLayout: () => {
          const { defaultSavedLayoutId, savedLayouts } = get();
          if (defaultSavedLayoutId) {
            const defaultSavedLayout = savedLayouts.find((savedLayout) => savedLayout.id === defaultSavedLayoutId);
            if (defaultSavedLayout) {
              const nextLayout = cleanupPersistedLayout(cloneDockLayout(defaultSavedLayout.layout));
              set({
                layout: nextLayout,
                maxZIndex: getLayoutMaxZIndex(nextLayout),
                hoveredTabTarget: null,
                maximizedPanelId: null,
              });
              return;
            }
          }

          // Check if there's a legacy raw default layout
          const savedDefault = localStorage.getItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY);
          if (savedDefault) {
            try {
              const parsed = cleanupPersistedLayout(JSON.parse(savedDefault) as DockLayout);
              set({
                layout: parsed,
                maxZIndex: getLayoutMaxZIndex(parsed),
                hoveredTabTarget: null,
                maximizedPanelId: null,
              });
              return;
            } catch (e) {
              log.error('Failed to parse saved default layout:', e);
            }
          }
          set({
            layout: cloneDockLayout(DEFAULT_LAYOUT),
            maxZIndex: getLayoutMaxZIndex(DEFAULT_LAYOUT),
            hoveredTabTarget: null,
            maximizedPanelId: null,
          });
        },

        saveLayoutAsDefault: () => {
          const { layout } = get();
          const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(layout));
          localStorage.setItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify(cleanedLayout));

          const matchingSavedLayout = get().savedLayouts.find((savedLayout) => (
            areDockLayoutsEqual(savedLayout.layout, cleanedLayout)
          ));
          set({ defaultSavedLayoutId: matchingSavedLayout?.id ?? null });
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
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<DockState> | undefined;
          const savedLayouts = Array.isArray(persisted?.savedLayouts)
            ? persisted.savedLayouts.map(cleanupSavedLayout)
            : currentState.savedLayouts;
          const defaultSavedLayoutId = (
            typeof persisted?.defaultSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.defaultSavedLayoutId)
          )
            ? persisted.defaultSavedLayoutId
            : null;

          if (persisted?.layout) {
            // Clean up any invalid panel types from persisted layout
            const cleanedLayout = cleanupPersistedLayout(persisted.layout);
            return {
              ...currentState,
              layout: cleanedLayout,
              maxZIndex: persisted.maxZIndex ?? currentState.maxZIndex,
              savedLayouts,
              defaultSavedLayoutId,
            };
          }
          return {
            ...currentState,
            savedLayouts,
            defaultSavedLayoutId,
          };
        },
      }
    )
  )
);

// Helper: Update a node in the layout tree
function updateNodeInLayout(
  layout: DockLayout,
  nodeId: string,
  updater: (node: DockNode) => DockNode
): DockLayout {
  return {
    ...layout,
    root: updateNodeRecursive(layout.root, nodeId, updater),
  };
}

function updateNodeRecursive(
  node: DockNode,
  nodeId: string,
  updater: (node: DockNode) => DockNode
): DockNode {
  if (node.id === nodeId) {
    return updater(node);
  }
  if (node.kind === 'split') {
    return {
      ...node,
      children: [
        updateNodeRecursive(node.children[0], nodeId, updater),
        updateNodeRecursive(node.children[1], nodeId, updater),
      ] as [DockNode, DockNode],
    };
  }
  return node;
}

// Helper: Find a panel by ID in the layout
function findPanelById(layout: DockLayout, panelId: string): DockPanel | null {
  // Check floating panels
  for (const floating of layout.floatingPanels) {
    if (floating.panel.id === panelId) {
      return floating.panel;
    }
  }
  // Check docked panels
  return findPanelInNode(layout.root, panelId);
}

function findPanelInNode(node: DockNode, panelId: string): DockPanel | null {
  if (node.kind === 'tab-group') {
    return node.panels.find((p) => p.id === panelId) || null;
  }
  const left = findPanelInNode(node.children[0], panelId);
  if (left) return left;
  return findPanelInNode(node.children[1], panelId);
}

// Helper: Collect all panel types in a node
function collectPanelTypes(node: DockNode, types: PanelType[]): void {
  if (node.kind === 'tab-group') {
    node.panels.forEach((p) => {
      const normalizedType = resolvePanelType(p.type);
      if (!types.includes(normalizedType)) {
        types.push(normalizedType);
      }
    });
  } else {
    collectPanelTypes(node.children[0], types);
    collectPanelTypes(node.children[1], types);
  }
}

// Helper: Find a tab group by ID
function findTabGroupById(node: DockNode, groupId: string): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node.id === groupId ? node : null;
  }
  const left = findTabGroupById(node.children[0], groupId);
  if (left) return left;
  return findTabGroupById(node.children[1], groupId);
}

// Helper: Find the first tab group in the tree
function findFirstTabGroup(node: DockNode): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node;
  }
  const left = findFirstTabGroup(node.children[0]);
  if (left) return left;
  return findFirstTabGroup(node.children[1]);
}

// Helper: Find a panel and its group by panel type
function findPanelAndGroup(
  node: DockNode,
  panelType: PanelType
): { panel: DockPanel; groupId: string } | null {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find((p) => resolvePanelType(p.type) === panelType);
    if (panel) {
      return { panel, groupId: node.id };
    }
    return null;
  }
  const left = findPanelAndGroup(node.children[0], panelType);
  if (left) return left;
  return findPanelAndGroup(node.children[1], panelType);
}

// Helper: Find a panel's group ID by panel ID
function findGroupIdByPanelId(node: DockNode, panelId: string): string | null {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find((p) => p.id === panelId);
    if (panel) {
      return node.id;
    }
    return null;
  }
  const left = findGroupIdByPanelId(node.children[0], panelId);
  if (left) return left;
  return findGroupIdByPanelId(node.children[1], panelId);
}

// Helper: Update panel data in layout
function updatePanelDataInLayout(
  layout: DockLayout,
  panelId: string,
  data: Partial<PanelData>
): DockLayout {
  return {
    ...layout,
    root: updatePanelDataInNode(layout.root, panelId, data),
    floatingPanels: layout.floatingPanels.map((f) =>
      f.panel.id === panelId
        ? { ...f, panel: { ...f.panel, data: { ...f.panel.data, ...data } as PanelData } }
        : f
    ),
  };
}

function updatePanelDataInNode(
  node: DockNode,
  panelId: string,
  data: Partial<PanelData>
): DockNode {
  if (node.kind === 'tab-group') {
    const panelIndex = node.panels.findIndex((p) => p.id === panelId);
    if (panelIndex >= 0) {
      const newPanels = [...node.panels];
      newPanels[panelIndex] = {
        ...newPanels[panelIndex],
        data: { ...newPanels[panelIndex].data, ...data } as PanelData,
      };
      return { ...node, panels: newPanels };
    }
    return node;
  }
  return {
    ...node,
    children: [
      updatePanelDataInNode(node.children[0], panelId, data),
      updatePanelDataInNode(node.children[1], panelId, data),
    ] as [DockNode, DockNode],
  };
}
