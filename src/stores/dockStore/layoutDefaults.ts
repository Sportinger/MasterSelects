import type { DockDragState, DockLayout, SavedDockLayout, SavedDockTimelineLayout } from '../../types/dock';
import { FACTORY_3D_EDIT_LAYOUT_ID, FACTORY_AUDIO_EDIT_LAYOUT_ID, FACTORY_VIDEO_EDIT_LAYOUT_ID } from './panelRegistry';

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
                  { id: 'history', type: 'history', title: 'History' },
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
    export: 1,
    history: 1,
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
                  { id: 'history', type: 'history', title: 'History' },
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
    'clip-properties': 1,
    history: 1,
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
                    panels: [{ id: '3d-preview-front', type: 'preview', title: 'Preview', data: { initialEditMode: true, initialEditCameraView: 'front' } }],
                    activeIndex: 0,
                  },
                  {
                    kind: 'tab-group',
                    id: '3d-edit-side-group',
                    panels: [{ id: '3d-preview-side', type: 'preview', title: 'Preview', data: { initialEditMode: true, initialEditCameraView: 'side' } }],
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
                    panels: [{ id: '3d-preview-top', type: 'preview', title: 'Preview', data: { initialEditMode: true, initialEditCameraView: 'top' } }],
                    activeIndex: 0,
                  },
                  {
                    kind: 'tab-group',
                    id: '3d-edit-perspective-group',
                    panels: [{ id: '3d-preview-perspective', type: 'preview', title: 'Preview', data: { initialEditMode: true, initialEditCameraView: 'camera' } }],
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
            panels: [{ id: 'media', type: 'media', title: 'Media' }],
            activeIndex: 0,
          },
          {
            kind: 'tab-group',
            id: 'right-group',
            panels: [
              { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
              { id: 'export', type: 'export', title: 'Export' },
              { id: 'history', type: 'history', title: 'History' },
            ],
            activeIndex: 0,
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    export: 1,
    history: 1,
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
    name: 'VIDEO EDIT',
    layout: DEFAULT_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 4,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_AUDIO_EDIT_LAYOUT_ID,
    name: 'AUDIO EDIT',
    layout: AUDIO_EDIT_LAYOUT,
    timeline: AUDIO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 3,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_3D_EDIT_LAYOUT_ID,
    name: '3D EDIT',
    layout: THREE_D_EDIT_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 2,
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
};
