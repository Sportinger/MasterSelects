import type { CampaignCategory } from '../tutorialCampaigns';
import type {
  GuidedScenario,
  GuidedScenarioStep,
  GuidedTargetRef,
} from '../../../services/guidedActions';
import type { DropPosition } from '../../../types/dock';
import {
  TUTORIAL_CLIP_TARGET_ID,
  TUTORIAL_MEDIA_TARGET_ID,
  TUTORIAL_VIDEO_TRACK_TARGET_ID,
} from './timelineTutorialSandbox';

export type InteractiveCursorDemo =
  | {
      kind: 'drag-between';
      from: GuidedTargetRef;
      to: GuidedTargetRef;
      dropPosition?: DropPosition;
    }
  | {
      kind: 'resize-edge';
      target: GuidedTargetRef;
      distance?: number;
    }
  | {
      kind: 'corner-orbit';
      target: GuidedTargetRef;
      radius?: number;
    }
  | {
      kind: 'timeline-media-drop';
      from: GuidedTargetRef;
      to: GuidedTargetRef;
    }
  | {
      kind: 'timeline-scrub';
      from: GuidedTargetRef;
      to: GuidedTargetRef;
      fromTime: number;
      toTime: number;
    }
  | {
      kind: 'timeline-playback';
      target: GuidedTargetRef;
    }
  | {
      kind: 'timeline-clip-move';
      from: GuidedTargetRef;
      to: GuidedTargetRef;
      fromTime: number;
      toTime: number;
    }
  | {
      kind: 'timeline-clip-trim';
      target: GuidedTargetRef;
      fromDuration: number;
      toDuration: number;
      distance: number;
    };

export interface InteractiveCampaignStep extends GuidedScenarioStep {
  cursorDemo?: InteractiveCursorDemo;
}

export interface InteractiveCampaign extends GuidedScenario {
  category: CampaignCategory;
  description: string;
  icon: string;
  steps: InteractiveCampaignStep[];
}

export const STARTUP_GUIDED_TUTORIAL_ID = 'workspace-basics';
export const PANEL_LAYOUT_TUTORIAL_ID = 'panel-layout';
export const TIMELINE_BASICS_TUTORIAL_ID = 'timeline-basics';

/**
 * The guided chain grows in small, independently replayable chapters. Each
 * chapter only teaches UI that is already available in the editor.
 */
export const INTERACTIVE_CAMPAIGNS: InteractiveCampaign[] = [
  {
    id: STARTUP_GUIDED_TUTORIAL_ID,
    title: 'Workspace Basics',
    description: 'Meet the four main areas of the editor.',
    icon: 'G',
    category: 'basics',
    defaultMode: 'demo',
    animationBudgetMs: 900,
    metadata: {
      presentation: 'panel-overview',
    },
    steps: [
      {
        id: 'workspace-media',
        title: 'Media',
        body: 'Your source material lives here. Import, organize, generate, and download media before placing it in an edit.',
        target: { kind: 'panel', panel: 'media' },
        showHighlight: false,
      },
      {
        id: 'workspace-preview',
        title: 'Preview',
        body: 'This is the visual result of the current composition. Changes from the Timeline appear here.',
        target: { kind: 'panel', panel: 'preview' },
        showHighlight: false,
      },
      {
        id: 'workspace-timeline',
        title: 'Timeline',
        body: 'This is where the edit takes shape. Arrange clips on tracks, move through time, and build the sequence here.',
        target: { kind: 'panel', panel: 'timeline' },
        showHighlight: false,
      },
      {
        id: 'workspace-properties',
        title: 'Properties',
        body: 'Properties shows the controls for what you select. Choose a clip, track, transition, or the master output to edit its settings here.',
        target: { kind: 'panel', panel: 'clip-properties' },
        showHighlight: false,
      },
    ],
  },
  {
    id: PANEL_LAYOUT_TUTORIAL_ID,
    title: 'Panel Layout',
    description: 'Move panels and resize the panes around them.',
    icon: 'L',
    category: 'basics',
    defaultMode: 'demo',
    animationBudgetMs: 900,
    metadata: {
      presentation: 'panel-overview',
    },
    steps: [
      {
        id: 'layout-panes',
        title: 'Panels live in panes',
        body: 'Each region is a pane. A pane can contain one or more panels, shown as tabs along its top edge.',
        focusPanel: 'clip-properties',
        target: { kind: 'panel', panel: 'clip-properties' },
        showHighlight: false,
      },
      {
        id: 'layout-move-panel',
        title: 'Move a panel',
        body: 'Press and briefly hold a panel tab, then drag it. The panel moves with its tab.',
        focusPanel: 'clip-properties',
        target: { kind: 'dom', id: 'panel-tab:clip-properties' },
        showHighlight: false,
        cursorDemo: {
          kind: 'drag-between',
          from: { kind: 'dom', id: 'panel-tab:clip-properties' },
          to: { kind: 'panel', panel: 'preview' },
          dropPosition: 'center',
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Hold + drag',
              detail: 'Move the panel tab',
            },
          },
        ],
      },
      {
        id: 'layout-dock-panel',
        title: 'Rearrange the panes',
        body: 'Drop the tab in the center to join this pane, or on one of its sides to create a new pane. The blue docking zones appear while you drag.',
        focusPanel: 'preview',
        target: { kind: 'panel', panel: 'preview' },
        showHighlight: false,
        cursorDemo: {
          kind: 'drag-between',
          from: { kind: 'dom', id: 'panel-tab:clip-properties' },
          to: { kind: 'panel', panel: 'preview' },
          dropPosition: 'right',
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Drop',
              detail: 'Center or edge',
            },
          },
        ],
      },
      {
        id: 'layout-resize-edge',
        title: 'Resize at an edge',
        body: 'Drag a divider between two panes to give one more room and the other less. The divider has a generous invisible grab area.',
        target: { kind: 'dom', id: 'dock-resize:any' },
        showHighlight: false,
        cursorDemo: {
          kind: 'resize-edge',
          target: { kind: 'dom', id: 'dock-resize:any' },
          distance: 86,
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Drag',
              detail: 'Resize both panes',
            },
          },
        ],
      },
      {
        id: 'layout-resize-corner',
        title: 'Resize from a corner',
        body: 'Where two dividers meet, drag the corner to resize in both directions at once.',
        target: { kind: 'dom', id: 'dock-resize-corner:any' },
        showHighlight: false,
        cursorDemo: {
          kind: 'corner-orbit',
          target: { kind: 'dom', id: 'dock-resize-corner:any' },
          radius: 84,
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Drag corner',
              detail: 'Resize width + height',
            },
          },
        ],
      },
    ],
  },
  {
    id: TIMELINE_BASICS_TUTORIAL_ID,
    title: 'Timeline Basics',
    description: 'Build a first edit with a safe temporary clip.',
    icon: 'T',
    category: 'basics',
    defaultMode: 'demo',
    animationBudgetMs: 900,
    metadata: {
      presentation: 'panel-overview',
    },
    steps: [
      {
        id: 'timeline-add-media',
        title: 'Add media to the Timeline',
        body: 'This blue Tutorial Clip is temporary. Drag media from the Media panel onto a video track to begin an edit.',
        focusPanel: 'media',
        target: { kind: 'mediaItem', itemId: TUTORIAL_MEDIA_TARGET_ID },
        showHighlight: false,
        cursorDemo: {
          kind: 'timeline-media-drop',
          from: { kind: 'mediaItem', itemId: TUTORIAL_MEDIA_TARGET_ID },
          to: {
            kind: 'timelineTime',
            trackId: TUTORIAL_VIDEO_TRACK_TARGET_ID,
            time: 1,
          },
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Hold + drag',
              detail: 'Drop onto a video track',
            },
          },
        ],
      },
      {
        id: 'timeline-scrub',
        title: 'Move through time',
        body: 'Drag across the Timeline ruler to move the playhead. The Preview shows the frame at the current time.',
        focusPanel: 'timeline',
        target: { kind: 'dom', id: 'timeline-ruler' },
        showHighlight: false,
        cursorDemo: {
          kind: 'timeline-scrub',
          from: {
            kind: 'timelineTime',
            surface: 'ruler',
            time: 1,
          },
          to: {
            kind: 'timelineTime',
            surface: 'ruler',
            time: 4.5,
          },
          fromTime: 1,
          toTime: 4.5,
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Drag',
              detail: 'Scrub the playhead',
            },
          },
        ],
      },
      {
        id: 'timeline-playback',
        title: 'Play and pause',
        body: 'The Play button starts the composition at the playhead. Click the same button again to pause.',
        focusPanel: 'timeline',
        target: { kind: 'button', id: 'timeline-play' },
        showHighlight: false,
        cursorDemo: {
          kind: 'timeline-playback',
          target: { kind: 'button', id: 'timeline-play' },
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Click',
              detail: 'Play, then pause',
            },
          },
        ],
      },
      {
        id: 'timeline-move-clip',
        title: 'Select and move a clip',
        body: 'Click a clip to select it. Drag its body left or right to place it at a different time; Properties follows the selection.',
        focusPanel: 'timeline',
        target: { kind: 'timelineClip', clipId: TUTORIAL_CLIP_TARGET_ID },
        showHighlight: false,
        cursorDemo: {
          kind: 'timeline-clip-move',
          from: { kind: 'timelineClip', clipId: TUTORIAL_CLIP_TARGET_ID },
          to: {
            kind: 'timelineTime',
            trackId: TUTORIAL_VIDEO_TRACK_TARGET_ID,
            // The cursor holds the clip at its center. A five-second clip that
            // starts at 3s therefore ends the drag with its grab point at 5.5s.
            time: 5.5,
          },
          fromTime: 1,
          toTime: 3,
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Hold + drag',
              detail: 'Move the selected clip',
            },
          },
        ],
      },
      {
        id: 'timeline-trim-clip',
        title: 'Trim the clip',
        body: 'Drag either clip edge to shorten or extend it. Trimming changes what plays without deleting the source media.',
        focusPanel: 'timeline',
        target: {
          kind: 'timelineTrimHandle',
          clipId: TUTORIAL_CLIP_TARGET_ID,
          edge: 'end',
        },
        showHighlight: false,
        cursorDemo: {
          kind: 'timeline-clip-trim',
          target: {
            kind: 'timelineTrimHandle',
            clipId: TUTORIAL_CLIP_TARGET_ID,
            edge: 'end',
          },
          fromDuration: 5,
          toDuration: 3.5,
          distance: -108,
        },
        actions: [
          {
            type: 'showInputGesture',
            gesture: {
              kind: 'mouse-left',
              label: 'Drag edge',
              detail: 'Shorten or extend',
            },
          },
        ],
      },
    ],
  },
];

export function getNextInteractiveCampaign(
  campaignId: string,
): InteractiveCampaign | null {
  const currentIndex = INTERACTIVE_CAMPAIGNS.findIndex((campaign) => (
    campaign.id === campaignId
  ));
  if (currentIndex < 0) return null;
  return INTERACTIVE_CAMPAIGNS[currentIndex + 1] ?? null;
}

export function isInteractiveCampaignId(campaignId: string): boolean {
  return INTERACTIVE_CAMPAIGNS.some((campaign) => campaign.id === campaignId);
}
