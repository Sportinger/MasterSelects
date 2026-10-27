// Every desktop panel the phone can show, grouped for the "All tools" sheet. A phone panel is the
// desktop panel itself (DockPanelContent) inside a phone frame, so nothing of the desktop is left out:
// sheet panels open under the preview (M3), workspace panels open in the landscape editor frame (M4).
// A workspace panel without its own landscape editor opens in the tall panel sheet instead.
// Panels that need hardware or a second screen stay listed, greyed, with their reason.

import type { PanelType } from '../../../types/dock';
import type { PhoneMilestone } from '../contracts';
import type { PhoneWorkspaceId } from '../workspace/phoneWorkspaceCatalog';

export type PhonePanelPresentation = 'sheet' | 'workspace';

export interface PhonePanelEntry {
  type: PanelType;
  title: string;
  group: 'Edit' | 'Media & project' | 'Colour' | 'Audio' | 'AI & analysis' | 'Live & output';
  presentation: PhonePanelPresentation;
  milestone: PhoneMilestone;
  /** The landscape editor a workspace panel opens in; without one it opens in the panel sheet. */
  workspace?: PhoneWorkspaceId;
  /** Why the panel stays greyed on a phone even when its milestone has shipped (absolute exceptions). */
  phoneLimit?: string;
}

export const PHONE_PANELS: readonly PhonePanelEntry[] = [
  { type: 'clip-properties', title: 'Properties', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'transitions', title: 'Transitions', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'layers', title: 'Layers', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'tools', title: 'Tools', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'history', title: 'History', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'annotations', title: 'Annotations', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'story', title: 'Story', group: 'Edit', presentation: 'sheet', milestone: 'M3' },
  { type: 'curves', title: 'Curves', group: 'Edit', presentation: 'workspace', milestone: 'M4', workspace: 'curves' },
  { type: 'node-workspace', title: 'Nodes', group: 'Edit', presentation: 'workspace', milestone: 'M4', workspace: 'nodes' },
  { type: 'multi-preview', title: 'Multi Preview', group: 'Edit', presentation: 'workspace', milestone: 'M4', workspace: 'multicam' },
  { type: 'media', title: 'Media', group: 'Media & project', presentation: 'sheet', milestone: 'M3' },
  { type: 'discover', title: 'Discover', group: 'Media & project', presentation: 'sheet', milestone: 'M3' },
  { type: 'documents', title: 'Notebook', group: 'Media & project', presentation: 'sheet', milestone: 'M3' },
  { type: 'export', title: 'Export (all options)', group: 'Media & project', presentation: 'sheet', milestone: 'M3' },
  { type: 'stats', title: 'Stats', group: 'Media & project', presentation: 'sheet', milestone: 'M3' },
  { type: '3d-scan', title: '3D Scan', group: 'Media & project', presentation: 'workspace', milestone: 'M4' },
  { type: 'color-controls', title: 'Color Controls', group: 'Colour', presentation: 'workspace', milestone: 'M4', workspace: 'color' },
  { type: 'color-nodes', title: 'Color Nodes', group: 'Colour', presentation: 'workspace', milestone: 'M4', workspace: 'color' },
  { type: 'color-keyframes', title: 'Color Keyframes', group: 'Colour', presentation: 'workspace', milestone: 'M4' },
  { type: 'color-scopes', title: 'Scopes', group: 'Colour', presentation: 'workspace', milestone: 'M4', workspace: 'color' },
  { type: 'scope-waveform', title: 'Waveform', group: 'Colour', presentation: 'workspace', milestone: 'M4' },
  { type: 'scope-histogram', title: 'Histogram', group: 'Colour', presentation: 'workspace', milestone: 'M4' },
  { type: 'scope-vectorscope', title: 'Vectorscope', group: 'Colour', presentation: 'workspace', milestone: 'M4' },
  { type: 'audio-mixer', title: 'Audio Mixer', group: 'Audio', presentation: 'workspace', milestone: 'M4', workspace: 'mixer' },
  { type: 'midi-mapping', title: 'MIDI Mapping', group: 'Audio', presentation: 'sheet', milestone: 'M3' },
  { type: 'ai-studio', title: 'AI Studio', group: 'AI & analysis', presentation: 'sheet', milestone: 'M3' },
  { type: 'ai-segment', title: 'AI Segment', group: 'AI & analysis', presentation: 'sheet', milestone: 'M3' },
  { type: 'scene-description', title: 'AI Scene Description', group: 'AI & analysis', presentation: 'sheet', milestone: 'M3' },
  { type: 'capture', title: 'Capture', group: 'Live & output', presentation: 'sheet', milestone: 'M3' },
  { type: 'go-live', title: 'Go Live', group: 'Live & output', presentation: 'sheet', milestone: 'M3' },
  { type: 'stream-chat', title: 'Stream Chat', group: 'Live & output', presentation: 'sheet', milestone: 'M3' },
  { type: 'stream-analytics', title: 'Stream Analytics', group: 'Live & output', presentation: 'sheet', milestone: 'M3' },
  { type: 'slot-grid', title: 'Slot Grid', group: 'Live & output', presentation: 'workspace', milestone: 'M4' },
];

export function getPhonePanel(type: PanelType): PhonePanelEntry | undefined {
  return PHONE_PANELS.find((entry) => entry.type === type);
}
