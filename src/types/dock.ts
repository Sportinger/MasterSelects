import type {
  RenderSourceActiveComp,
  RenderSourceComposition,
  RenderSourceLayerIndex,
} from './renderTarget';
import type { AnimatableProperty } from './animationProperties';

// Dock system type definitions

// Panel types that can be docked
// Note: Effects, Transcript, Analysis are now integrated into Properties panel
export type PanelType = 'start' | 'preview' | 'multi-preview' | 'timeline' | 'curves' | 'clip-properties' | 'history' | 'annotations' | 'stats' | 'audio-mixer' | 'node-workspace' | 'color-nodes' | 'color-controls' | 'color-clips' | 'color-timeline' | 'color-scopes' | 'color-keyframes' | 'media' | '3d-scan' | 'discover' | 'ai-studio' | 'export' | 'midi-mapping' | 'capture' | 'go-live' | 'slot-grid' | 'stream-chat' | 'stream-analytics' | 'story' | 'ai-segment' | 'scene-description' | 'transitions' | 'scope-waveform' | 'scope-histogram' | 'scope-vectorscope';
export type DockLayoutTransitionStaggerMode = 'puzzle' | 'sequence';
export type DockLayoutStartTransitionDirection = 'to-start' | 'from-start';

// The unified scopes surface shown in panel pickers and the View menu.
export const SCOPE_PANEL_TYPES: PanelType[] = ['color-scopes'];

// WIP panel types — shown grayed out with bug icon in View menu
export const WIP_PANEL_TYPES: PanelType[] = [];

// Panel types that may exist more than once at the same time. These spawn a fresh,
// independent instance (unique id) from the tab-bar "+" instead of focusing the
// existing one. Only one shared Timeline/Slot host owns Timeline mode at a time.
export const MULTI_INSTANCE_PANEL_TYPES: PanelType[] = ['preview', 'color-controls', 'curves', 'slot-grid'];

// AI panel types for View menu grouping
export const AI_PANEL_TYPES: PanelType[] = ['ai-studio', 'story', 'ai-segment', 'scene-description'];

// Registered for saved-layout compatibility, but intentionally absent from panel pickers.
export const PANEL_PICKER_HIDDEN_TYPES: PanelType[] = [
  'start',
  'scene-description',
  'scope-waveform',
  'scope-histogram',
  'scope-vectorscope',
];

export type PreviewPanelSource =
  | RenderSourceActiveComp
  | RenderSourceComposition
  | RenderSourceLayerIndex;

// Panel-specific data for configurable panels
export interface PreviewPanelData {
  source?: PreviewPanelSource;
  compositionId?: string | null; // legacy: null = active composition
  showTransparencyGrid?: boolean; // per-tab transparency grid toggle (default false)
  initialEditMode?: boolean;
  initialEditCameraView?: 'camera' | 'front' | 'side' | 'top';
  /** @deprecated Dock previews now expose the unified, collapsible transport. */
  showTransport?: boolean;
}

export interface MultiPreviewSlotData {
  compositionId: string | null;
}

export interface MultiPreviewPanelData {
  sourceCompositionId: string | null; // null = custom mode (per-slot), string = auto-distribute layers
  slots: [MultiPreviewSlotData, MultiPreviewSlotData, MultiPreviewSlotData, MultiPreviewSlotData];
  showTransparencyGrid: boolean;
}

export type ScopeDisplayMode = 'parade' | 'waveform' | 'vectorscope' | 'histogram';

export interface ScopesPanelData {
  scopeMode?: ScopeDisplayMode;
}

export interface CurvesPanelData {
  curvePreferredTarget?: {
    clipId: string;
    property: AnimatableProperty;
  } | null;
  curveTimeView?: {
    scrollX: number;
    zoom: number;
  };
  curveViewedClipId?: string | null;
}

export interface TimelinePanelData {
  timelineSurfaceMode?: 'timeline' | 'slot-grid';
}

export type PanelData = PreviewPanelData | MultiPreviewPanelData | ScopesPanelData | CurvesPanelData | TimelinePanelData;

// A panel instance
export interface DockPanel {
  id: string;
  type: PanelType;
  title: string;
  data?: PanelData; // Optional panel-specific configuration
}

// A group of tabbed panels
export interface DockTabGroup {
  kind: 'tab-group';
  id: string;
  panels: DockPanel[];
  activeIndex: number;
}

// A split container with two children
export interface DockSplit {
  kind: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  children: [DockNode, DockNode];
  ratio: number; // 0-1, position of splitter
}

// Union type for dock tree nodes
export type DockNode = DockTabGroup | DockSplit;

// Floating panel (detached from dock)
export interface FloatingPanel {
  id: string;
  panel: DockPanel;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

// Detached browser window panel. Persisted only in the local dock store so a
// browser refresh can rebuild detached windows; saved/project layouts still
// store docked and floating panels only.
export interface BrowserWindowPanel {
  id: string;
  panel: DockPanel;
  returnGroupId: string | null;
  size?: { width: number; height: number };
  position?: { left: number; top: number };
}

// Root layout state
export interface DockLayout {
  root: DockNode;
  floatingPanels: FloatingPanel[];
  panelZoom: Record<string, number>; // Panel ID -> zoom level (1.0 = 100%)
}

export type SavedDockTimelineAudioDisplayMode = 'compact' | 'detailed' | 'spectral';
export type SavedDockTimelineTrackFocusMode = 'balanced' | 'audio' | 'video';

export interface SavedDockTimelineLayout {
  audioDisplayMode?: SavedDockTimelineAudioDisplayMode;
  audioLayerAdvancedMode?: boolean;
  audioFocusMode?: boolean;
  trackFocusMode?: SavedDockTimelineTrackFocusMode;
  trackHeaderWidth?: number;
  timelineSplitRatio?: number | null;
  trackHeights?: Record<string, number>;
  trackTypeHeights?: Partial<Record<'video' | 'audio' | 'midi', number>>;
  trackVisibility?: Record<string, boolean>;
  trackTypeVisibility?: Partial<Record<'video' | 'audio' | 'midi', boolean>>;
  trackTypeCounts?: Partial<Record<'video' | 'audio' | 'midi', number>>;
  trackTypeLayouts?: Partial<Record<'video' | 'audio' | 'midi', SavedDockTimelineTrackSlotLayout[]>>;
}

export interface SavedDockTimelineTrackSlotLayout {
  height?: number;
  visible?: boolean;
}

export interface SavedDockLayout {
  id: string;
  name: string;
  layout: DockLayout;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  factory?: boolean;
  timeline?: SavedDockTimelineLayout;
}

export interface HoveredDockTabTarget {
  kind: 'panel' | 'timeline-composition';
  panelId: string;
  groupId: string;
  compositionId?: string;
}

// Drop target for drag operations
export type DropPosition = 'center' | 'left' | 'right' | 'top' | 'bottom';
export type DropScope = 'pane' | 'root-edge';

export interface DropTarget {
  groupId: string;
  position: DropPosition;
  scope?: DropScope; // Omitted/`pane` targets an existing tab group; `root-edge` wraps the full dock root
  tabInsertIndex?: number; // When position is 'center', which slot to insert at
}

// Drag state
export interface DockDragState {
  isDragging: boolean;
  draggedPanel: DockPanel | null;
  sourceGroupId: string | null;
  sourceFloatingId: string | null;
  dropTarget: DropTarget | null;
  dragOffset: { x: number; y: number };
  currentPos: { x: number; y: number };
  // True right after a drag that actually docked somewhere; distinguishes
  // drop from cancel for end-of-drag animations.
  lastDropCommitted: boolean;
}

// Panel metadata for configuration
export interface PanelConfig {
  type: PanelType;
  title: string;
  icon?: string;
  minWidth?: number;
  minHeight?: number;
  fixedWidth?: number;
  fixedHeight?: number;
  closable?: boolean;
}

export const PANEL_CONFIGS: Record<PanelType, PanelConfig> = {
  start: {
    type: 'start',
    title: 'Chat',
    minWidth: 320,
    minHeight: 240,
    closable: false,
  },
  preview: {
    type: 'preview',
    title: 'Preview',
    minWidth: 200,
    minHeight: 150,
    closable: false,
  },
  'multi-preview': {
    type: 'multi-preview',
    title: 'Multi Preview',
    minWidth: 400,
    minHeight: 300,
    closable: false,
  },
  timeline: {
    type: 'timeline',
    title: 'Timeline',
    minWidth: 300,
    minHeight: 150,
    closable: false,
  },
  curves: {
    type: 'curves',
    title: 'Curves',
    minWidth: 360,
    minHeight: 220,
    closable: false,
  },
  'clip-properties': {
    type: 'clip-properties',
    title: 'Properties',
    minWidth: 160,
    minHeight: 150,
    closable: false,
  },
  history: {
    type: 'history',
    title: 'History',
    minWidth: 240,
    minHeight: 180,
    closable: false,
  },
  stats: {
    type: 'stats',
    title: 'Stats',
    minWidth: 260,
    minHeight: 220,
    closable: false,
  },
  'audio-mixer': {
    type: 'audio-mixer',
    title: 'Audio Mixer',
    minWidth: 420,
    minHeight: 280,
    closable: false,
  },
  'node-workspace': {
    type: 'node-workspace',
    title: 'Nodes',
    minWidth: 520,
    minHeight: 360,
    closable: false,
  },
  media: {
    type: 'media',
    title: 'Media',
    minWidth: 200,
    minHeight: 200,
    closable: false,
  },
  '3d-scan': {
    type: '3d-scan',
    title: '3D Scan',
    icon: 'Scan',
    minWidth: 320,
    minHeight: 260,
    closable: false,
  },
  'color-nodes': {
    type: 'color-nodes',
    title: 'Nodes',
    minWidth: 300,
    minHeight: 180,
    closable: false,
  },
  'color-controls': {
    type: 'color-controls',
    title: 'Color Controls',
    minWidth: 168,
    minHeight: 1,
    closable: false,
  },
  'color-clips': {
    type: 'color-clips',
    title: 'Clips',
    minWidth: 300,
    minHeight: 134,
    fixedHeight: 134,
    closable: false,
  },
  'color-timeline': {
    type: 'color-timeline',
    title: 'Mini Timeline',
    minWidth: 300,
    minHeight: 80,
    fixedHeight: 80,
    closable: false,
  },
  'color-scopes': {
    type: 'color-scopes',
    title: 'Scopes',
    minWidth: 300,
    minHeight: 220,
    closable: false,
  },
  'color-keyframes': {
    type: 'color-keyframes',
    title: 'Keyframes',
    minWidth: 300,
    minHeight: 180,
    closable: false,
  },
  discover: {
    type: 'discover',
    title: 'Discover',
    icon: 'WorldSearch',
    minWidth: 360,
    minHeight: 280,
    closable: false,
  },
  'annotations': {
    type: 'annotations',
    title: 'Annotations',
    icon: 'MessageSquare',
    minWidth: 300,
    minHeight: 260,
    closable: false,
  },
  'ai-studio': {
    type: 'ai-studio',
    title: 'AI Studio',
    icon: 'Sparkles',
    minWidth: 360,
    minHeight: 280,
    closable: false,
  },
  export: {
    type: 'export',
    title: 'Export',
    minWidth: 200,
    minHeight: 300,
    closable: false,
  },
  'midi-mapping': {
    type: 'midi-mapping',
    title: 'MIDI Mapping',
    minWidth: 280,
    minHeight: 240,
    closable: false,
  },
  capture: {
    type: 'capture',
    title: 'Capture',
    minWidth: 320,
    minHeight: 420,
    closable: false,
  },
  'go-live': {
    type: 'go-live',
    title: 'Go Live',
    icon: 'Broadcast',
    minWidth: 320,
    minHeight: 200,
    closable: false,
  },
  'slot-grid': {
    type: 'slot-grid',
    title: 'Slot Grid',
    minWidth: 320,
    minHeight: 180,
    closable: false,
  },
  'stream-chat': {
    type: 'stream-chat',
    title: 'Stream Chat',
    minWidth: 240,
    minHeight: 280,
    closable: false,
  },
  'stream-analytics': {
    type: 'stream-analytics',
    title: 'Stream Analytics',
    minWidth: 280,
    minHeight: 240,
    closable: false,
  },
  story: {
    type: 'story',
    title: 'Story',
    minWidth: 320,
    minHeight: 240,
    closable: false,
  },
  transitions: {
    type: 'transitions',
    title: 'Transitions',
    icon: 'Blend',
    minWidth: 200,
    minHeight: 200,
    closable: false,
  },
  'ai-segment': {
    type: 'ai-segment',
    title: 'AI Segment',
    minWidth: 280,
    minHeight: 300,
    closable: false,
  },
  'scene-description': {
    type: 'scene-description',
    title: 'AI Scene Description',
    minWidth: 280,
    minHeight: 300,
    closable: false,
  },
  'scope-waveform': {
    type: 'scope-waveform',
    title: 'Waveform',
    minWidth: 200,
    minHeight: 200,
    closable: false,
  },
  'scope-histogram': {
    type: 'scope-histogram',
    title: 'Histogram',
    minWidth: 200,
    minHeight: 200,
    closable: false,
  },
  'scope-vectorscope': {
    type: 'scope-vectorscope',
    title: 'Vectorscope',
    minWidth: 200,
    minHeight: 200,
    closable: false,
  },
};
