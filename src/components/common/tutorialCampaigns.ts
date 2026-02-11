import type { PanelType } from '../../types/dock';

// === Campaign Step ===
export interface CampaignStep {
  // Panel to spotlight (SVG mask cutout)
  panelGroupId?: string;    // data-group-id of the panel to spotlight
  panelType?: PanelType;    // Auto-activate this panel tab before step

  // Element to highlight with ring (optional, for element-level steps)
  selector?: string;        // CSS selector for element highlight ring

  // Content
  title: string;
  description: string;
  tooltipPosition: 'top' | 'bottom' | 'left' | 'right';
}

// === Campaign Category ===
export type CampaignCategory = 'basics' | 'editing' | 'creative' | 'output';

export const CATEGORY_LABELS: Record<CampaignCategory, string> = {
  basics: 'Basics',
  editing: 'Editing',
  creative: 'Creative Tools',
  output: 'Output & Analysis',
};

export const CATEGORY_ORDER: CampaignCategory[] = ['basics', 'editing', 'creative', 'output'];

// === Campaign Definition ===
export interface TutorialCampaign {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: CampaignCategory;
  steps: CampaignStep[];
}

// ============================================================
// CAMPAIGN DEFINITIONS
// ============================================================

const interfaceOverview: TutorialCampaign = {
  id: 'interface-overview',
  title: 'Interface Overview',
  description: 'Learn the main panels and layout of the editor.',
  icon: '🖥️',
  category: 'basics',
  steps: [
    {
      panelGroupId: 'timeline-group',
      panelType: 'timeline',
      title: 'Timeline',
      description: 'Arrange and edit your clips on tracks. Drag to move, trim edges, add keyframes and transitions.',
      tooltipPosition: 'top',
    },
    {
      panelGroupId: 'preview-group',
      panelType: 'preview',
      title: 'Preview',
      description: 'Live preview of your composition. Play, pause, and scrub through your project in real-time.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'left-group',
      panelType: 'media',
      title: 'Media',
      description: 'Import and organize your media files. Drag clips from here onto the Timeline to start editing.',
      tooltipPosition: 'right',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Properties',
      description: 'Adjust transforms, effects, and masks for the selected clip. Select a clip in the Timeline to get started.',
      tooltipPosition: 'left',
    },
  ],
};

const timelineControls: TutorialCampaign = {
  id: 'timeline-controls',
  title: 'Timeline Controls',
  description: 'Master the timeline playback and navigation tools.',
  icon: '⏱️',
  category: 'basics',
  steps: [
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-controls',
      title: 'Playback',
      description: 'Play, Stop and Loop — control the playback of your composition. Use Space to toggle play/pause.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-time',
      title: 'Timecode',
      description: 'Shows the current position and total duration. Click on the duration to change it.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-zoom',
      title: 'Tools & Zoom',
      description: 'Snapping, Cut Tool, Zoom and Fit — control the timeline view. Press C for the cut tool.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-inout-controls',
      title: 'In/Out Points',
      description: 'Set In (I) and Out (O) points to define the export range. Press X to clear them.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-tracks-controls',
      title: 'Tracks',
      description: 'Add video, audio, or text tracks. Each track type has its own controls.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-navigator',
      title: 'Navigator',
      description: 'Scroll and zoom the timeline. Drag the edges to zoom in and out.',
      tooltipPosition: 'top',
    },
  ],
};

const previewPlayback: TutorialCampaign = {
  id: 'preview-playback',
  title: 'Preview & Playback',
  description: 'Understand the preview canvas and playback options.',
  icon: '▶️',
  category: 'basics',
  steps: [
    {
      panelGroupId: 'preview-group',
      panelType: 'preview',
      title: 'Preview Canvas',
      description: 'Your composition renders here in real-time using WebGPU. Every change is instantly visible.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'preview-group',
      selector: '.preview-controls',
      panelType: 'preview',
      title: 'Preview Controls',
      description: 'Play/pause, composition selector, quality settings, and edit mode toggle.',
      tooltipPosition: 'top',
    },
    {
      panelGroupId: 'preview-group',
      selector: '.preview-quality-dropdown-wrapper',
      panelType: 'preview',
      title: 'Preview Quality',
      description: 'Switch between Full, Half, and Quarter resolution for better performance on heavy compositions.',
      tooltipPosition: 'top',
    },
    {
      panelGroupId: 'preview-group',
      selector: '.preview-comp-dropdown-wrapper',
      panelType: 'preview',
      title: 'Composition Selector',
      description: 'Switch between open compositions. Each preview window can show a different composition.',
      tooltipPosition: 'top',
    },
  ],
};

const mediaImport: TutorialCampaign = {
  id: 'media-import',
  title: 'Media & Import',
  description: 'Import, organize, and manage your media files.',
  icon: '📁',
  category: 'editing',
  steps: [
    {
      panelGroupId: 'left-group',
      panelType: 'media',
      title: 'Media Panel',
      description: 'Your project\'s media library. All imported files, compositions, and folders are organized here.',
      tooltipPosition: 'right',
    },
    {
      panelGroupId: 'left-group',
      selector: '.add-dropdown-trigger',
      panelType: 'media',
      title: 'Add Button',
      description: 'Import media files, create new compositions, add folders, or create solid color clips.',
      tooltipPosition: 'right',
    },
    {
      panelGroupId: 'left-group',
      selector: '.media-panel-header',
      panelType: 'media',
      title: 'Media Columns',
      description: 'Sort your media by name, duration, resolution, codec, or file size. Click column headers to sort.',
      tooltipPosition: 'right',
    },
    {
      panelGroupId: 'timeline-group',
      panelType: 'timeline',
      title: 'Drag to Timeline',
      description: 'Drag media files from the Media panel onto a timeline track. Video goes on video tracks, audio on audio tracks.',
      tooltipPosition: 'top',
    },
  ],
};

const clipEditing: TutorialCampaign = {
  id: 'clip-editing',
  title: 'Editing Clips',
  description: 'Cut, trim, move, and arrange clips on the timeline.',
  icon: '✂️',
  category: 'editing',
  steps: [
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-tracks-controls',
      title: 'Track Management',
      description: 'Add tracks with the + buttons. Video tracks hold visuals, audio tracks hold sound, text tracks hold titles.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.playhead',
      title: 'Playhead',
      description: 'The red playhead shows the current time. Drag it to scrub, or press Space to play from its position.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-zoom',
      title: 'Cut Tool',
      description: 'Press C to activate the cut tool and split clips at the playhead. Alt+Click disables snapping while cutting.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.add-marker-btn',
      title: 'Markers',
      description: 'Drag the M button onto the ruler to create markers. Use them to mark important points in your timeline.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-inout-controls',
      title: 'Selection & Export Range',
      description: 'Use I/O keys to set in/out points for the export range. Shift+Click to select multiple clips.',
      tooltipPosition: 'bottom',
    },
  ],
};

const audioMixing: TutorialCampaign = {
  id: 'audio-mixing',
  title: 'Audio Mixing',
  description: 'Work with audio tracks, EQ, and volume controls.',
  icon: '🔊',
  category: 'editing',
  steps: [
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-tracks-controls',
      title: 'Audio Tracks',
      description: 'Add audio tracks with the + button. Audio clips show waveforms and can be trimmed like video clips.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Audio Properties',
      description: 'Select an audio or video clip to see its Audio tab in Properties. Adjust volume and add EQ.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-controls',
      title: 'JKL Playback',
      description: 'Use J/K/L keys for shuttle playback: J = reverse, K = pause, L = forward. Tap L repeatedly for faster speeds.',
      tooltipPosition: 'bottom',
    },
  ],
};

const keyframesAnimation: TutorialCampaign = {
  id: 'keyframes-animation',
  title: 'Keyframes & Animation',
  description: 'Animate properties over time with keyframes and curves.',
  icon: '💎',
  category: 'creative',
  steps: [
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Transform Properties',
      description: 'Select a clip to see Transform properties: Position, Scale, Rotation, and Opacity. Each can be animated.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.transform-tab-compact',
      panelType: 'clip-properties',
      title: 'Keyframe Toggles',
      description: 'Click the diamond icons next to each property to add a keyframe at the current time. Move the playhead and change the value for animation.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-navigator',
      title: 'Curve Editor',
      description: 'Expand a track in the timeline to see the keyframe curve editor. Drag bezier handles to shape the animation curve.',
      tooltipPosition: 'top',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Easing Modes',
      description: 'Right-click keyframes to choose easing: Linear, Ease In, Ease Out, Ease In-Out, or Custom Bezier.',
      tooltipPosition: 'left',
    },
  ],
};

const effectsColor: TutorialCampaign = {
  id: 'effects-color',
  title: 'Effects & Color',
  description: 'Apply GPU effects, blend modes, and color corrections.',
  icon: '🎨',
  category: 'creative',
  steps: [
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Effects Tab',
      description: 'Select a clip, then open the Effects tab in Properties. Here you can add and configure GPU effects.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.effects-tab',
      panelType: 'clip-properties',
      title: 'Add Effects',
      description: 'Use the dropdown to add effects: Color correction, Blur, Distortion, Stylize, and Keying. Stack multiple effects.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.transform-tab-compact',
      panelType: 'clip-properties',
      title: 'Blend Modes',
      description: 'In the Transform tab, change the blend mode. 37 modes available: Multiply, Screen, Overlay, Add, and more.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'preview-group',
      panelType: 'preview',
      title: 'Real-time Preview',
      description: 'All effects render in real-time on the GPU. Use the bypass toggle on each effect for A/B comparison.',
      tooltipPosition: 'left',
    },
  ],
};

const textTitles: TutorialCampaign = {
  id: 'text-titles',
  title: 'Text & Titles',
  description: 'Create text overlays with fonts, styles, and effects.',
  icon: '✏️',
  category: 'creative',
  steps: [
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-tracks-controls',
      title: 'Add Text Track',
      description: 'Click the "T" button to add a text track. Text clips appear as editable overlays on the timeline.',
      tooltipPosition: 'bottom',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Text Properties',
      description: 'Select a text clip to edit its content, choose from 50 Google Fonts, set size, weight, and color.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Text Styling',
      description: 'Add stroke outlines, drop shadows, and adjust alignment. All text renders via GPU for full compositing support.',
      tooltipPosition: 'left',
    },
  ],
};

const masksCompositing: TutorialCampaign = {
  id: 'masks-compositing',
  title: 'Masks & Compositing',
  description: 'Create shape masks with the pen tool and feathering.',
  icon: '🎭',
  category: 'creative',
  steps: [
    {
      panelGroupId: 'right-group',
      panelType: 'clip-properties',
      title: 'Masks Tab',
      description: 'Select a clip and open the Masks tab. Add masks to reveal or hide parts of the clip.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.masks-tab',
      panelType: 'clip-properties',
      title: 'Shape Tools',
      description: 'Choose Rectangle, Ellipse, or Pen tool. Click-drag on the preview to draw a mask shape.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.masks-tab',
      panelType: 'clip-properties',
      title: 'Mask Modes',
      description: 'Set mask mode to Add, Subtract, or Intersect. Adjust feathering for soft edges and use expansion to grow/shrink.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'preview-group',
      panelType: 'preview',
      title: 'Mask Editing',
      description: 'With edit mode (Tab), directly manipulate mask vertices in the preview. Select points to move or delete them.',
      tooltipPosition: 'left',
    },
  ],
};

const exportDelivery: TutorialCampaign = {
  id: 'export-delivery',
  title: 'Export & Delivery',
  description: 'Render your project with different codecs and settings.',
  icon: '📤',
  category: 'output',
  steps: [
    {
      panelGroupId: 'right-group',
      panelType: 'export',
      title: 'Export Panel',
      description: 'Open the Export panel to render your composition. Choose between WebCodecs Fast, Precise, or FFmpeg modes.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.export-form',
      panelType: 'export',
      title: 'Export Settings',
      description: 'Select encoder mode, codec (H.264, VP9, ProRes), resolution (up to 4K), and quality preset.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      selector: '.export-start-btn',
      panelType: 'export',
      title: 'Start Export',
      description: 'Click Export to begin rendering. Progress shows on the timeline. Use In/Out points to export a specific range.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'timeline-group',
      selector: '.timeline-inout-controls',
      title: 'Export Range',
      description: 'Set In (I) and Out (O) points to export only a portion of your timeline. Clear with X.',
      tooltipPosition: 'bottom',
    },
  ],
};

const videoScopes: TutorialCampaign = {
  id: 'video-scopes',
  title: 'Video Scopes',
  description: 'Analyze color and exposure with professional monitoring tools.',
  icon: '📊',
  category: 'output',
  steps: [
    {
      panelGroupId: 'right-group',
      panelType: 'scope-histogram',
      title: 'Histogram',
      description: 'The histogram shows the distribution of brightness values. Use it to check exposure and avoid clipping.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'scope-vectorscope',
      title: 'Vectorscope',
      description: 'The vectorscope shows color saturation and hue. Useful for skin tone correction and color matching.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'scope-waveform',
      title: 'Waveform Monitor',
      description: 'The waveform shows luminance levels from left to right. Ensure highlights stay below 100% and shadows above 0%.',
      tooltipPosition: 'left',
    },
  ],
};

const slotGrid: TutorialCampaign = {
  id: 'slot-grid',
  title: 'Slot Grid (Live)',
  description: 'Resolume-style grid for live performance and VJ sets.',
  icon: '🎛️',
  category: 'output',
  steps: [
    {
      panelGroupId: 'timeline-group',
      panelType: 'timeline',
      title: 'Slot Grid',
      description: 'The Slot Grid provides a Resolume-style 4x12 grid for live playback. Toggle it from the View menu or timeline.',
      tooltipPosition: 'top',
    },
    {
      panelGroupId: 'timeline-group',
      panelType: 'timeline',
      title: 'Layers A-D',
      description: 'Four independent layers (A-D) run simultaneously with wall-clock time. Each row represents one layer.',
      tooltipPosition: 'top',
    },
    {
      panelGroupId: 'timeline-group',
      panelType: 'timeline',
      title: 'Column Activation',
      description: 'Click a column header to activate all slots in that column at once. Click individual slots for single playback.',
      tooltipPosition: 'top',
    },
  ],
};

const downloadPanel: TutorialCampaign = {
  id: 'download-panel',
  title: 'Downloads',
  description: 'Download videos from YouTube, TikTok, Instagram, and more.',
  icon: '⬇️',
  category: 'editing',
  steps: [
    {
      panelGroupId: 'right-group',
      panelType: 'download',
      title: 'Download Panel',
      description: 'Search and download videos from YouTube and other platforms. Open via View menu > Downloads.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'download',
      title: 'Search & Quality',
      description: 'Search by keyword or paste a URL. Choose video quality before downloading. H.264 is preferred for compatibility.',
      tooltipPosition: 'left',
    },
    {
      panelGroupId: 'right-group',
      panelType: 'download',
      title: 'Add to Timeline',
      description: 'Downloaded videos are saved to your project folder. Drag them from the Media panel to the Timeline.',
      tooltipPosition: 'left',
    },
  ],
};

// ============================================================
// ALL CAMPAIGNS
// ============================================================

export const TUTORIAL_CAMPAIGNS: TutorialCampaign[] = [
  // Basics
  interfaceOverview,
  timelineControls,
  previewPlayback,
  // Editing
  mediaImport,
  clipEditing,
  audioMixing,
  downloadPanel,
  // Creative
  keyframesAnimation,
  effectsColor,
  textTitles,
  masksCompositing,
  // Output
  exportDelivery,
  videoScopes,
  slotGrid,
];

export function getCampaignById(id: string): TutorialCampaign | undefined {
  return TUTORIAL_CAMPAIGNS.find(c => c.id === id);
}

export function getCampaignsByCategory(category: CampaignCategory): TutorialCampaign[] {
  return TUTORIAL_CAMPAIGNS.filter(c => c.category === category);
}
