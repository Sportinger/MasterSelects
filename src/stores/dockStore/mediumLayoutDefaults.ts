import type { DockLayout, SavedDockLayout, SavedDockTimelineLayout } from '../../types/dock';
import { FACTORY_MEDIUM_EDIT_LAYOUT_ID } from './panelRegistry';

export const MEDIUM_EDIT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'medium-root-split',
    direction: 'horizontal',
    ratio: 0.305,
    children: [
      {
        kind: 'tab-group',
        id: 'medium-ai-group',
        panels: [{ id: 'medium-ai-studio', type: 'ai-studio', title: 'AI' }],
        activeIndex: 0,
      },
      {
        kind: 'split',
        id: 'medium-workspace-split',
        direction: 'vertical',
        ratio: 0.69,
        children: [
          {
            kind: 'split',
            id: 'medium-viewer-split',
            direction: 'horizontal',
            ratio: 0.17,
            children: [
              {
                kind: 'tab-group',
                id: 'medium-assets-group',
                panels: [
                  { id: 'medium-media', type: 'media', title: 'My Assets' },
                  { id: 'medium-discover', type: 'discover', title: 'Library' },
                ],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'medium-preview-group',
                panels: [{ id: 'medium-preview', type: 'preview', title: 'Viewer' }],
                activeIndex: 0,
              },
            ],
          },
          {
            kind: 'tab-group',
            id: 'medium-timeline-group',
            panels: [{ id: 'medium-timeline', type: 'timeline', title: 'Timeline' }],
            activeIndex: 0,
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'medium-ai-studio': 1,
    'medium-discover': 1,
  },
};

const MEDIUM_EDIT_TIMELINE_LAYOUT: SavedDockTimelineLayout = {
  audioDisplayMode: 'detailed',
  audioLayerAdvancedMode: false,
  audioFocusMode: false,
  trackFocusMode: 'balanced',
  trackHeaderWidth: 164,
  timelineSplitRatio: null,
  trackTypeHeights: { video: 58, audio: 42 },
  trackTypeVisibility: { video: true, audio: true },
  trackTypeCounts: { video: 2, audio: 1 },
  trackTypeLayouts: {
    video: [
      { height: 58, visible: true },
      { height: 58, visible: true },
    ],
    audio: [{ height: 42, visible: true }],
  },
};

export const MEDIUM_SAVED_DOCK_LAYOUT: SavedDockLayout = {
  id: FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  name: 'Medium',
  layout: MEDIUM_EDIT_LAYOUT,
  timeline: MEDIUM_EDIT_TIMELINE_LAYOUT,
  createdAt: 0,
  updatedAt: 1,
  favorite: true,
  factory: true,
};
