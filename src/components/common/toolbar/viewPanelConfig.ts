import {
  AI_PANEL_TYPES,
  PANEL_CONFIGS,
  SCOPE_PANEL_TYPES,
  WIP_PANEL_TYPES,
  type PanelConfig,
  type PanelType,
} from '../../../types/dock';

const VIEW_CORE_PANEL_TYPE_ORDER: PanelType[] = [
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
];

export const VIEW_CORE_PANEL_TYPES = VIEW_CORE_PANEL_TYPE_ORDER.filter((type) => (
  !SCOPE_PANEL_TYPES.includes(type)
  && !WIP_PANEL_TYPES.includes(type)
  && !AI_PANEL_TYPES.includes(type)
));

export const VIEW_WIP_ONLY_PANEL_TYPES = WIP_PANEL_TYPES.filter((type) => (
  !AI_PANEL_TYPES.includes(type)
));

const PANEL_CONFIG_LOOKUP = PANEL_CONFIGS as Partial<Record<PanelType, PanelConfig>>;

function createFallbackPanelConfig(type: PanelType): PanelConfig {
  return {
    type,
    title: type
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    closable: false,
  };
}

export function getViewPanelConfig(type: PanelType): PanelConfig {
  return PANEL_CONFIG_LOOKUP[type] ?? createFallbackPanelConfig(type);
}
