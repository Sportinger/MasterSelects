import type { DockLayout, SavedDockLayout } from '../../types/dock';
import { FACTORY_IMAGE_EDIT_LAYOUT_ID } from './panelRegistry';

// Image workspace: the preview is the canvas (2D edit mode, transparency grid),
// layers and the shared inspector sit on the right, media and AI on the left,
// and the Tools strip runs down the left edge like Photoshop's toolbar.
// There is no timeline: a still composition has no time to edit.
export const IMAGE_EDIT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'image-tools-split',
    direction: 'horizontal',
    ratio: 0.03,
    children: [
      {
        kind: 'tab-group',
        id: 'image-tools-group',
        panels: [{ id: 'tools', type: 'tools', title: 'Tools' }],
        activeIndex: 0,
      },
      {
        kind: 'split',
        id: 'image-root-split',
        direction: 'horizontal',
        ratio: 0.2,
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
              { id: 'ai-studio', type: 'ai-studio', title: 'AI Studio' },
              { id: 'ai-segment', type: 'ai-segment', title: 'AI Segment' },
            ],
            activeIndex: 0,
          },
          {
            kind: 'split',
            id: 'image-main-split',
            direction: 'horizontal',
            ratio: 0.7,
            children: [
              {
                kind: 'tab-group',
                id: 'preview-group',
                panels: [
                  {
                    id: 'image-preview',
                    type: 'preview',
                    title: 'Preview',
                    data: { initialEditMode: true, showTransparencyGrid: true, showRulers: true },
                  },
                ],
                activeIndex: 0,
              },
              {
                kind: 'split',
                id: 'image-right-split',
                direction: 'vertical',
                ratio: 0.42,
                children: [
                  {
                    kind: 'tab-group',
                    id: 'image-layers-group',
                    panels: [
                      { id: 'layers', type: 'layers', title: 'Layers' },
                      { id: 'history', type: 'history', title: 'History' },
                    ],
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
            ],
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: { 'clip-properties': 1, 'color-controls': 1, export: 1, 'ai-studio': 1 },
};

export const IMAGE_SAVED_DOCK_LAYOUT: SavedDockLayout = {
  id: FACTORY_IMAGE_EDIT_LAYOUT_ID,
  name: 'Image',
  layout: IMAGE_EDIT_LAYOUT,
  createdAt: 0,
  updatedAt: 2,
  favorite: true,
  factory: true,
};
