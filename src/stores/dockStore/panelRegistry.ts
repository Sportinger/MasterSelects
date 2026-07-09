import type { PanelConfig, PanelType } from '../../types/dock';
import { PANEL_CONFIGS } from '../../types/dock';

export const BUILT_IN_PANEL_TYPES: PanelType[] = [
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
  'multicam',
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
export const FACTORY_DOCK_LAYOUT_IDS = new Set([FACTORY_VIDEO_EDIT_LAYOUT_ID, FACTORY_AUDIO_EDIT_LAYOUT_ID]);
export const FACTORY_DOCK_LAYOUT_NAMES = new Map<string, string>([
  [FACTORY_VIDEO_EDIT_LAYOUT_ID, 'VIDEO EDIT'],
  [FACTORY_AUDIO_EDIT_LAYOUT_ID, 'AUDIO EDIT'],
]);
export const FACTORY_DOCK_LAYOUT_NAME_TO_ID = new Map<string, string>(
  Array.from(FACTORY_DOCK_LAYOUT_NAMES.entries()).map(([id, name]) => [name.toLowerCase(), id]),
);
export const CAN_EDIT_FACTORY_DOCK_LAYOUTS = import.meta.env.DEV;

