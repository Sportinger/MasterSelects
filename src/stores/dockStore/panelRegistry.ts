import type { PanelConfig, PanelType } from '../../types/dock';
import { PANEL_CONFIGS } from '../../types/dock';

export const BUILT_IN_PANEL_TYPES: PanelType[] = [
  'start',
  'preview',
  'multi-preview',
  'timeline',
  'clip-properties',
  'history',
  'audio-mixer',
  'node-workspace',
  'media',
  'export',
  'midi-mapping',
  'capture',
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
export const FACTORY_AUDIO_EDIT_LAYOUT_ID = 'factory-audio-edit';
export const FACTORY_3D_EDIT_LAYOUT_ID = 'factory-3d-edit';
export const FACTORY_START_LAYOUT_ID = 'factory-start';
export const START_LAYOUT_REVEAL_DURATION_MS = 3000;
export const START_LAYOUT_OUTRO_DURATION_MS = 3600;
export const START_CHAT_EXIT_DURATION_MS = 480;
export const START_EDITOR_REVEAL_DURATION_MS = (
  START_LAYOUT_REVEAL_DURATION_MS - START_CHAT_EXIT_DURATION_MS
);
export const START_CHROME_EXIT_DELAY_MS = 1000;
export const START_CHROME_TRANSITION_DURATION_MS = 1000;
export const FACTORY_DOCK_LAYOUT_IDS = new Set([
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
]);
export const FACTORY_DOCK_LAYOUT_NAMES = new Map<string, string>([
  [FACTORY_VIDEO_EDIT_LAYOUT_ID, 'VIDEO EDIT'],
  [FACTORY_AUDIO_EDIT_LAYOUT_ID, 'AUDIO EDIT'],
  [FACTORY_3D_EDIT_LAYOUT_ID, '3D EDIT'],
  [FACTORY_START_LAYOUT_ID, 'START'],
]);
export const FACTORY_DOCK_LAYOUT_NAME_TO_ID = new Map<string, string>(
  Array.from(FACTORY_DOCK_LAYOUT_NAMES.entries()).map(([id, name]) => [name.toLowerCase(), id]),
);
export const CAN_EDIT_FACTORY_DOCK_LAYOUTS = import.meta.env.DEV;

