import type { DockDragState, DockLayout, PreviewPanelData, SavedDockLayout, SavedDockTimelineLayout } from '../../types/dock';
import type { ThemeMode } from '../settings/settingsOptions';
import {
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from './panelRegistry';
import { MEDIUM_SAVED_DOCK_LAYOUT } from './mediumLayoutDefaults';
import { LIVE_SAVED_DOCK_LAYOUT } from './liveLayoutDefaults';

export const FACTORY_3D_EDIT_PREVIEW_DEFAULTS: Record<string, Pick<PreviewPanelData, 'initialEditMode' | 'initialEditCameraView'>> = {
  '3d-preview-front': { initialEditMode: true, initialEditCameraView: 'front' },
  '3d-preview-side': { initialEditMode: true, initialEditCameraView: 'side' },
  '3d-preview-top': { initialEditMode: true, initialEditCameraView: 'top' },
  '3d-preview-perspective': { initialEditMode: true, initialEditCameraView: 'camera' },
};

// Default editing layout: Media left, Preview center, Export active on the right, Timeline bottom.
export const DEFAULT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'root-split',
    direction: 'vertical',
    ratio: 0.6698039215686274,
    children: [
      {
        kind: 'split',
        id: 'top-split',
        direction: 'horizontal',
        ratio: 0.29449423815621,
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
              { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
              { id: 'transitions', type: 'transitions', title: 'Transitions' },
            ],
            activeIndex: 0,
          },
          {
                kind: 'split',
                id: 'center-right-split',
                direction: 'horizontal',
                ratio: 0.7109300593133233,
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
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'export', type: 'export', title: 'Export' },
                  { id: 'color-controls', type: 'color-controls', title: 'Coloring' },
                ],
                activeIndex: 1,
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
  panelZoom: {
    'clip-properties': 1,
    'color-controls': 1,
    export: 1,
    'ai-studio': 1,
  },
};

// Resolve Video keeps media full-height on the left and preserves the authored
// inspector width at native 100% panel scale.
export const RESOLVE_VIDEO_EDIT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'resolve-video-root-split',
    direction: 'horizontal',
    ratio: 0.335889,
    children: [
      {
        kind: 'tab-group',
        id: 'left-group',
        panels: [
          { id: 'media', type: 'media', title: 'Media' },
          { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
          { id: 'transitions', type: 'transitions', title: 'Transitions' },
        ],
        activeIndex: 0,
      },
      {
        kind: 'split',
        id: 'resolve-video-main-split',
        direction: 'vertical',
        ratio: 0.568499,
        children: [
          {
            kind: 'split',
            id: 'center-right-split',
            direction: 'horizontal',
            ratio: 0.56,
            children: [
              {
                kind: 'tab-group',
                id: 'preview-group',
                panels: [{ id: 'preview', type: 'preview', title: 'Preview' }],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'right-group',
                panels: [
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'color-controls', type: 'color-controls', title: 'Coloring' },
                  { id: 'export', type: 'export', title: 'Export' },
                ],
                activeIndex: 0,
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
    ],
  },
  floatingPanels: [],
  panelZoom: { 'clip-properties': 1, 'color-controls': 1, export: 1, 'ai-studio': 1 },
};

export function getVideoEditLayoutForTheme(theme: ThemeMode): DockLayout {
  return theme === 'resolve' ? RESOLVE_VIDEO_EDIT_LAYOUT : DEFAULT_LAYOUT;
}

// Touch-first editing layout: large full-width preview, compact supporting
// panels in the middle, and a full-width timeline anchored at the bottom.
export const MOBILE_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'mobile-root-split',
    direction: 'vertical',
    ratio: 0.36,
    children: [
      {
        kind: 'tab-group',
        id: 'preview-group',
        panels: [{ id: 'preview', type: 'preview', title: 'Preview' }],
        activeIndex: 0,
      },
      {
        kind: 'split',
        id: 'mobile-lower-split',
        direction: 'vertical',
        ratio: 0.49,
        children: [
          {
            kind: 'split',
            id: 'mobile-tools-split',
            direction: 'horizontal',
            ratio: 0.44,
            children: [
              {
                kind: 'tab-group',
                id: 'left-group',
                panels: [
                  { id: 'media', type: 'media', title: 'Media' },
                  { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
                  { id: 'transitions', type: 'transitions', title: 'Transitions' },
                ],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'right-group',
                panels: [
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'export', type: 'export', title: 'Export' },
                  { id: 'color-controls', type: 'color-controls', title: 'Coloring' },
                ],
                activeIndex: 1,
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
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    'color-controls': 1,
    export: 1,
    'ai-studio': 1,
  },
};

// Portrait-composition mobile layout: Preview and the complete compact tool
// tab set share the upper row; Timeline stays full-width at the bottom.
export const VERTICAL_MOBILE_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'mobile-v-root-split',
    direction: 'vertical',
    ratio: 0.62,
    children: [
      {
        kind: 'split',
        id: 'mobile-v-top-split',
        direction: 'horizontal',
        ratio: 0.42,
        children: [
          {
            kind: 'tab-group',
            id: 'mobile-v-preview-group',
            panels: [{ id: 'preview', type: 'preview', title: 'Preview' }],
            activeIndex: 0,
          },
          {
            kind: 'tab-group',
            id: 'mobile-v-tools-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
              { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
              { id: 'transitions', type: 'transitions', title: 'Transitions' },
              { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
              { id: 'export', type: 'export', title: 'Export' },
              { id: 'color-controls', type: 'color-controls', title: 'Coloring' },
            ],
            activeIndex: 0,
          },
        ],
      },
      {
        kind: 'tab-group',
        id: 'mobile-v-timeline-group',
        panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
        activeIndex: 0,
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    'color-controls': 1,
    export: 1,
    'ai-studio': 1,
  },
};

const AUDIO_EDIT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'root-split',
    direction: 'vertical',
    ratio: 0.61,
    children: [
      {
        kind: 'tab-group',
        id: 'timeline-group',
        panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
        activeIndex: 0,
      },
      {
        kind: 'split',
        id: 'audio-edit-bottom-split',
        direction: 'horizontal',
        ratio: 0.14,
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
              { id: 'discover', type: 'discover', title: 'Discover' },
              { id: 'transitions', type: 'transitions', title: 'Transitions' },
            ],
            activeIndex: 0,
          },
          {
            kind: 'split',
            id: 'audio-edit-mixer-properties-split',
            direction: 'horizontal',
            ratio: 0.8,
            children: [
              {
                kind: 'tab-group',
                id: 'audio-mixer-group',
                panels: [
                  { id: 'audio-mixer', type: 'audio-mixer', title: 'Audio Mixer' },
                ],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'right-group',
                panels: [
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'export', type: 'export', title: 'Export' },
                  { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
                ],
                activeIndex: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    export: 1,
    discover: 1,
    'audio-mixer': 1,
  },
};

const THREE_D_EDIT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: '3d-edit-root-split',
    direction: 'horizontal',
    ratio: 0.77,
    children: [
      {
        kind: 'split',
        id: '3d-edit-left-split',
        direction: 'vertical',
        ratio: 0.74,
        children: [
          {
            kind: 'split',
            id: '3d-edit-preview-rows',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              {
                kind: 'split',
                id: '3d-edit-preview-top-row',
                direction: 'horizontal',
                ratio: 0.5,
                children: [
                  {
                    kind: 'tab-group',
                    id: '3d-edit-front-group',
                    panels: [{ id: '3d-preview-front', type: 'preview', title: 'Preview', data: FACTORY_3D_EDIT_PREVIEW_DEFAULTS['3d-preview-front'] }],
                    activeIndex: 0,
                  },
                  {
                    kind: 'tab-group',
                    id: '3d-edit-side-group',
                    panels: [{ id: '3d-preview-side', type: 'preview', title: 'Preview', data: FACTORY_3D_EDIT_PREVIEW_DEFAULTS['3d-preview-side'] }],
                    activeIndex: 0,
                  },
                ],
              },
              {
                kind: 'split',
                id: '3d-edit-preview-bottom-row',
                direction: 'horizontal',
                ratio: 0.5,
                children: [
                  {
                    kind: 'tab-group',
                    id: '3d-edit-top-group',
                    panels: [{ id: '3d-preview-top', type: 'preview', title: 'Preview', data: FACTORY_3D_EDIT_PREVIEW_DEFAULTS['3d-preview-top'] }],
                    activeIndex: 0,
                  },
                  {
                    kind: 'tab-group',
                    id: '3d-edit-perspective-group',
                    panels: [{ id: '3d-preview-perspective', type: 'preview', title: 'Preview', data: FACTORY_3D_EDIT_PREVIEW_DEFAULTS['3d-preview-perspective'] }],
                    activeIndex: 0,
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
      {
        kind: 'split',
        id: '3d-edit-right-split',
        direction: 'vertical',
        ratio: 0.62,
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
              { id: 'discover', type: 'discover', title: 'Discover' },
              { id: 'transitions', type: 'transitions', title: 'Transitions' },
            ],
            activeIndex: 0,
          },
          {
            kind: 'tab-group',
            id: 'right-group',
            panels: [
              { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
              { id: 'export', type: 'export', title: 'Export' },
              { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
            ],
            activeIndex: 1,
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    export: 1,
    discover: 1,
  },
};

const COLOR_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'color-root-split',
    direction: 'vertical',
    ratio: 0.5,
    children: [
      {
        kind: 'split',
        id: 'color-viewer-nodes-split',
        direction: 'horizontal',
        ratio: 0.62,
        children: [
          {
            kind: 'tab-group',
            id: 'color-preview-group',
            panels: [{
              id: 'color-preview',
              type: 'preview',
              title: 'Preview',
              data: { source: { type: 'activeComp' }, showTransport: true },
            }],
            activeIndex: 0,
          },
          {
            kind: 'tab-group',
            id: 'color-nodes-group',
            panels: [{ id: 'color-nodes', type: 'color-nodes', title: 'Color Nodes' }],
            activeIndex: 0,
          },
        ],
      },
      {
        kind: 'split',
        id: 'color-lower-split',
        direction: 'vertical',
        ratio: 0.28,
        children: [
          {
            kind: 'split',
            id: 'color-navigation-split',
            direction: 'vertical',
            ratio: 0.55,
            children: [
              {
                kind: 'tab-group',
                id: 'color-clips-group',
                panels: [{ id: 'color-clips', type: 'color-clips', title: 'Clips' }],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'color-timeline-group',
                panels: [{ id: 'color-timeline', type: 'color-timeline', title: 'Mini Timeline' }],
                activeIndex: 0,
              },
            ],
          },
          {
            kind: 'split',
            id: 'color-tools-split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              {
                kind: 'tab-group',
                id: 'color-controls-group',
                panels: [{ id: 'color-controls', type: 'color-controls', title: 'Color Controls' }],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'color-analysis-group',
                panels: [
                  { id: 'color-scopes', type: 'color-scopes', title: 'Scopes' },
                  { id: 'color-keyframes', type: 'color-keyframes', title: 'Keyframes' },
                ],
                activeIndex: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'color-controls': 1,
    'color-scopes': 1,
  },
};

const START_LAYOUT: DockLayout = {
  root: {
    kind: 'tab-group',
    id: 'start-group',
    panels: [{ id: 'start', type: 'start', title: 'Chat' }],
    activeIndex: 0,
  },
  floatingPanels: [],
  panelZoom: {
    start: 1,
  },
};

const VIDEO_EDIT_TIMELINE_LAYOUT: SavedDockTimelineLayout = {
  audioDisplayMode: 'detailed',
  audioLayerAdvancedMode: true,
  audioFocusMode: false,
  trackFocusMode: 'balanced',
  trackHeaderWidth: 210,
  timelineSplitRatio: null,
  trackTypeHeights: {
    video: 70,
    audio: 48,
  },
  trackTypeVisibility: {
    video: true,
    audio: true,
  },
  trackTypeCounts: {
    video: 2,
    audio: 1,
  },
  trackTypeLayouts: {
    video: [
      { height: 70, visible: true },
      { height: 70, visible: true },
    ],
    audio: [
      { height: 48, visible: true },
    ],
  },
};

const AUDIO_EDIT_TIMELINE_LAYOUT: SavedDockTimelineLayout = {
  audioDisplayMode: 'detailed',
  audioLayerAdvancedMode: true,
  audioFocusMode: true,
  trackFocusMode: 'audio',
  trackHeaderWidth: 210,
  timelineSplitRatio: null,
  trackTypeHeights: {
    video: 40,
    audio: 96,
  },
  trackTypeVisibility: {
    video: true,
    audio: true,
  },
  trackTypeCounts: {
    video: 2,
    audio: 1,
  },
  trackTypeLayouts: {
    video: [
      { height: 40, visible: true },
      { height: 40, visible: true },
    ],
    audio: [
      { height: 96, visible: true },
    ],
  },
};

export const FACTORY_SAVED_DOCK_LAYOUTS: SavedDockLayout[] = [
  {
    id: FACTORY_VIDEO_EDIT_LAYOUT_ID,
    name: 'Video',
    layout: DEFAULT_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 5,
    favorite: true,
    factory: true,
  },
  MEDIUM_SAVED_DOCK_LAYOUT,
  {
    id: FACTORY_MOBILE_LAYOUT_ID,
    name: 'Mobile',
    layout: MOBILE_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 5,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
    name: 'Mobile',
    layout: VERTICAL_MOBILE_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 5,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_AUDIO_EDIT_LAYOUT_ID,
    name: 'Audio',
    layout: AUDIO_EDIT_LAYOUT,
    timeline: AUDIO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 5,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_3D_EDIT_LAYOUT_ID,
    name: '3D',
    layout: THREE_D_EDIT_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 2,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_COLOR_LAYOUT_ID,
    name: 'Color',
    layout: COLOR_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 3,
    favorite: true,
    factory: true,
  },
  LIVE_SAVED_DOCK_LAYOUT,
  {
    id: FACTORY_START_LAYOUT_ID,
    name: 'Chat',
    layout: START_LAYOUT,
    createdAt: 0,
    updatedAt: 1,
    favorite: true,
    factory: true,
  },
];

export const DEFAULT_DRAG_STATE: DockDragState = {
  isDragging: false,
  draggedPanel: null,
  sourceGroupId: null,
  sourceFloatingId: null,
  dropTarget: null,
  dragOffset: { x: 0, y: 0 },
  currentPos: { x: 0, y: 0 },
  lastDropCommitted: false,
};
