import type { PanelConfig, PanelType } from '../../types/dock';
import { PANEL_CONFIGS } from '../../types/dock';

export const BUILT_IN_PANEL_TYPES: PanelType[] = [
  'start',
  'preview',
  'multi-preview',
  'timeline',
  'curves',
  'clip-properties',
  'history',
  'stats',
  'audio-mixer',
  'node-workspace',
  'color-nodes',
  'color-controls',
  'color-clips',
  'color-timeline',
  'color-scopes',
  'color-keyframes',
  'media',
  '3d-scan',
  'discover',
  'annotations',
  'documents',
  'ai-studio',
  'export',
  'midi-mapping',
  'capture',
  'go-live',
  'slot-grid',
  'stream-chat',
  'stream-analytics',
  'story',
  'ai-segment',
  'scene-description',
  'transitions',
  'scope-waveform',
  'scope-histogram',
  'scope-vectorscope',
];
export const VALID_PANEL_TYPES = new Set(BUILT_IN_PANEL_TYPES);
const PANEL_CONFIG_LOOKUP = PANEL_CONFIGS as Partial<Record<PanelType, PanelConfig>>;
export function getPanelConfig(type: PanelType): PanelConfig {
  return PANEL_CONFIG_LOOKUP[type] ?? {
    type,
    title: type
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    closable: false,
  };
}
export const FACTORY_VIDEO_EDIT_LAYOUT_ID = 'factory-video-edit';
export const FACTORY_MOBILE_LAYOUT_ID = 'factory-mobile';
export const FACTORY_VERTICAL_MOBILE_LAYOUT_ID = 'factory-mobile-vertical';
export const FACTORY_AUDIO_EDIT_LAYOUT_ID = 'factory-audio-edit';
export const FACTORY_3D_EDIT_LAYOUT_ID = 'factory-3d-edit';
export const FACTORY_COLOR_LAYOUT_ID = 'factory-color';
export const FACTORY_MEDIUM_EDIT_LAYOUT_ID = 'factory-medium-edit';
export const FACTORY_START_LAYOUT_ID = 'factory-start';
export const FACTORY_LIVE_LAYOUT_ID = 'factory-live';
export const START_LAYOUT_REVEAL_DURATION_MS = 400;
export const START_LAYOUT_OUTRO_DURATION_MS = 400;
export const START_CHAT_EXIT_DURATION_MS = 120;
export const START_EDITOR_REVEAL_DURATION_MS = (
  START_LAYOUT_REVEAL_DURATION_MS - START_CHAT_EXIT_DURATION_MS
);
export const START_CHROME_EXIT_DELAY_MS = 120;
export const START_CHROME_TRANSITION_DURATION_MS = 160;
export const FACTORY_DOCK_LAYOUT_IDS = new Set([
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_LIVE_LAYOUT_ID,
]);
export const FACTORY_DOCK_LAYOUT_NAMES = new Map<string, string>([
  [FACTORY_VIDEO_EDIT_LAYOUT_ID, 'Video'],
  [FACTORY_MOBILE_LAYOUT_ID, 'Mobile'],
  [FACTORY_VERTICAL_MOBILE_LAYOUT_ID, 'Mobile'],
  [FACTORY_AUDIO_EDIT_LAYOUT_ID, 'Audio'],
  [FACTORY_3D_EDIT_LAYOUT_ID, '3D'],
  [FACTORY_COLOR_LAYOUT_ID, 'Color'],
  [FACTORY_MEDIUM_EDIT_LAYOUT_ID, 'Medium'],
  [FACTORY_START_LAYOUT_ID, 'Chat'],
  [FACTORY_LIVE_LAYOUT_ID, 'Live'],
]);
export const FACTORY_DOCK_LAYOUT_NAME_TO_ID = new Map<string, string>(
  [
    ...Array.from(FACTORY_DOCK_LAYOUT_NAMES.entries()).map(([id, name]) => [name.toLowerCase(), id] as const),
    ['mobile', FACTORY_MOBILE_LAYOUT_ID] as const,
    ['video edit', FACTORY_VIDEO_EDIT_LAYOUT_ID] as const,
    ['audio edit', FACTORY_AUDIO_EDIT_LAYOUT_ID] as const,
    ['3d edit', FACTORY_3D_EDIT_LAYOUT_ID] as const,
    ['color edit', FACTORY_COLOR_LAYOUT_ID] as const,
    ['v mobile', FACTORY_VERTICAL_MOBILE_LAYOUT_ID] as const,
  ],
);
export const CAN_EDIT_FACTORY_DOCK_LAYOUTS = import.meta.env.DEV;
