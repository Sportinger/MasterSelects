import type {
  DockLayout,
  DockPanel,
  DockDragState,
  BrowserWindowPanel,
  DropTarget,
  PanelType,
  PanelData,
  HoveredDockTabTarget,
  SavedDockLayout,
} from '../../types/dock';

export interface LayoutMutationActions {
  setActiveTab: (groupId: string, index: number) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  movePanel: (panelId: string, sourceGroupId: string, target: DropTarget) => void;
  closePanel: (panelId: string, groupId: string) => void;
  closePanelById: (panelId: string) => void;
  changePanelType: (panelId: string, type: PanelType) => void;
  floatPanel: (panelId: string, groupId: string, position: { x: number; y: number }) => void;
  dockFloatingPanel: (floatingId: string, target: DropTarget) => void;
  detachPanelToBrowserWindow: (panelId: string, groupId: string) => BrowserWindowPanel | null;
  dockBrowserWindowPanel: (windowPanelId: string, target?: DropTarget) => void;
  updateFloatingPosition: (floatingId: string, position: { x: number; y: number }) => void;
  updateFloatingSize: (floatingId: string, size: { width: number; height: number }) => void;
  bringToFront: (floatingId: string) => void;
}

export interface DragAndPanelStateActions {
  startDrag: (
    panel: DockPanel,
    sourceGroupId: string | null,
    offset: { x: number; y: number },
    initialPos?: { x: number; y: number },
    sourceFloatingId?: string | null
  ) => void;
  updateDrag: (pos: { x: number; y: number }, dropTarget: DropTarget | null) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  setHoveredTabTarget: (target: HoveredDockTabTarget | null) => void;
  clearHoveredTabTarget: (panelId?: string) => void;
  setMaximizedPanel: (panelId: string | null) => void;
  toggleHoveredTabMaximized: () => void;
  setPanelZoom: (panelId: string, zoom: number) => void;
  getPanelZoom: (panelId: string) => number;
}

export interface PanelVisibilityActions {
  getVisiblePanelTypes: () => PanelType[];
  isPanelTypeVisible: (type: PanelType) => boolean;
  togglePanelType: (type: PanelType) => void;
  showPanelType: (type: PanelType) => void;
  hidePanelType: (type: PanelType) => void;
  activatePanelType: (type: PanelType) => void;
  addPanelTypeToGroup: (type: PanelType, groupId: string) => void;
  addPreviewPanel: (compositionId: string | null, targetGroupId?: string) => void;
  updatePanelData: (panelId: string, data: Partial<PanelData>) => void;
}

export interface SavedLayoutActions {
  saveNamedLayout: (name: string) => SavedDockLayout | null;
  saveCurrentNamedLayout: () => SavedDockLayout | null;
  loadSavedLayout: (layoutId: string) => void;
  setDefaultSavedLayout: (layoutId: string | null) => void;
  toggleFavoriteSavedLayout: (layoutId: string) => void;
  resetLayout: () => void;
  saveLayoutAsDefault: () => void;
  getLayoutForProject: () => DockLayout;
  setLayoutFromProject: (layout: DockLayout) => void;
}

export interface DockStoreState
  extends LayoutMutationActions,
    DragAndPanelStateActions,
    PanelVisibilityActions,
    SavedLayoutActions {
  layout: DockLayout;
  browserWindowPanels: BrowserWindowPanel[];
  dragState: DockDragState;
  maxZIndex: number;
  hoveredTabTarget: HoveredDockTabTarget | null;
  maximizedPanelId: string | null;
  savedLayouts: SavedDockLayout[];
  defaultSavedLayoutId: string | null;
  activeSavedLayoutId: string | null;
}

export type DockSliceCreator<T> = (
  set: (
    partial: Partial<DockStoreState> | ((state: DockStoreState) => Partial<DockStoreState>)
  ) => void,
  get: () => DockStoreState
) => T;
