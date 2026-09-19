import type { DockLayout, SavedDockLayout, SavedDockTimelineLayout } from '../../types/dock';
import { FACTORY_LIVE_LAYOUT_ID } from './panelRegistry';

// LIVE workspace: two layer-isolated preview monitors and stream controls on
// the left, program output with analytics and scene switching in the center,
// and platform chat on the right.
export const LIVE_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'live-root-split',
    direction: 'horizontal',
    ratio: 0.846,
    children: [
      {
        kind: 'split',
        id: 'live-main-split',
        direction: 'horizontal',
        ratio: 0.279,
        children: [
          {
            kind: 'split',
            id: 'live-left-split',
            direction: 'vertical',
            ratio: 0.24,
            children: [
              {
                kind: 'tab-group',
                id: 'live-preview-video-2-group',
                panels: [
                  {
                    id: 'preview-live-video-2',
                    type: 'preview',
                    title: 'Preview',
                    data: { source: { type: 'layer-index', compositionId: null, layerIndex: 0 } },
                  },
                ],
                activeIndex: 0,
              },
              {
                kind: 'split',
                id: 'live-left-lower-split',
                direction: 'vertical',
                ratio: 0.32,
                children: [
                  {
                    kind: 'tab-group',
                    id: 'live-preview-video-1-group',
                    panels: [
                      {
                        id: 'preview-live-video-1',
                        type: 'preview',
                        title: 'Preview',
                        data: { source: { type: 'layer-index', compositionId: null, layerIndex: 1 } },
                      },
                    ],
                    activeIndex: 0,
                  },
                  {
                    kind: 'tab-group',
                    id: 'live-controls-group',
                    panels: [
                      { id: 'live-go-live', type: 'go-live', title: 'Go Live' },
                      { id: 'media', type: 'media', title: 'Media' },
                      { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                    ],
                    activeIndex: 2,
                  },
                ],
              },
            ],
          },
          {
            kind: 'split',
            id: 'live-center-split',
            direction: 'vertical',
            ratio: 0.468,
            children: [
              {
                kind: 'tab-group',
                id: 'preview-group',
                panels: [
                  {
                    id: 'preview',
                    type: 'preview',
                    title: 'Program',
                    data: { source: { type: 'activeComp' } },
                  },
                ],
                activeIndex: 0,
              },
              {
                kind: 'split',
                id: 'live-center-lower-split',
                direction: 'vertical',
                ratio: 0.425,
                children: [
                  {
                    kind: 'tab-group',
                    id: 'live-analytics-group',
                    panels: [
                      { id: 'live-analytics', type: 'stream-analytics', title: 'Analytics' },
                    ],
                    activeIndex: 0,
                  },
                  {
                    kind: 'tab-group',
                    id: 'timeline-group',
                    panels: [
                      {
                        id: 'live-timeline',
                        type: 'timeline',
                        title: 'Timeline',
                        data: { timelineSurfaceMode: 'slot-grid' },
                      },
                    ],
                    activeIndex: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: 'tab-group',
        id: 'live-chat-group',
        panels: [
          { id: 'live-stream-chat', type: 'stream-chat', title: 'Stream Chat' },
        ],
        activeIndex: 0,
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
  },
};

// Compact strip: the timeline here is a scene switcher, not an editing surface.
const LIVE_TIMELINE_LAYOUT: SavedDockTimelineLayout = {
  audioDisplayMode: 'detailed',
  audioLayerAdvancedMode: false,
  audioFocusMode: false,
  trackFocusMode: 'balanced',
  trackHeaderWidth: 132,
  timelineSplitRatio: null,
  trackTypeHeights: { video: 40, audio: 32 },
  trackTypeVisibility: { video: true, audio: true },
  trackTypeCounts: { video: 2, audio: 1 },
  trackTypeLayouts: {
    video: [
      { height: 40, visible: true },
      { height: 40, visible: true },
    ],
    audio: [{ height: 32, visible: true }],
  },
};

export const LIVE_SAVED_DOCK_LAYOUT: SavedDockLayout = {
  id: FACTORY_LIVE_LAYOUT_ID,
  name: 'Live',
  layout: LIVE_LAYOUT,
  timeline: LIVE_TIMELINE_LAYOUT,
  createdAt: 0,
  updatedAt: 2,
  favorite: true,
  factory: true,
};
