import type { PanelType } from '../../../types/dock';

export interface PanelMenuGroup {
  label: string;
  types: readonly PanelType[];
}

const PANEL_MENU_GROUP_DEFINITIONS: readonly PanelMenuGroup[] = [
  {
    label: 'Editing',
    types: [
      'preview',
      'multi-preview',
      'timeline',
      'curves',
      'media',
      'clip-properties',
      'history',
      'annotations',
      'stats',
      'transitions',
    ],
  },
  {
    label: 'Color',
    types: [
      'color-nodes',
      'color-controls',
      'color-clips',
      'color-timeline',
      'color-scopes',
      'color-keyframes',
    ],
  },
  {
    label: 'Scopes',
    types: ['scope-waveform', 'scope-histogram', 'scope-vectorscope'],
  },
  {
    label: 'Audio',
    types: ['audio-mixer', 'midi-mapping'],
  },
  {
    label: 'AI',
    types: ['node-workspace', 'discover', 'ai-studio', 'story', 'ai-segment'],
  },
  {
    label: '3D',
    types: ['3d-scan'],
  },
  {
    label: 'Live',
    types: ['go-live', 'slot-grid', 'stream-chat', 'stream-analytics'],
  },
  {
    label: 'Capture & Output',
    types: ['capture', 'export'],
  },
];

export function getPanelMenuGroups(panelTypes: readonly PanelType[]): PanelMenuGroup[] {
  const availableTypes = new Set(panelTypes);
  const groupedTypes = new Set<PanelType>();
  const groups = PANEL_MENU_GROUP_DEFINITIONS.flatMap((group) => {
    const types = group.types.filter((type) => availableTypes.has(type));
    types.forEach((type) => groupedTypes.add(type));
    return types.length > 0 ? [{ ...group, types }] : [];
  });
  const uncategorizedTypes = panelTypes.filter((type) => !groupedTypes.has(type));

  return uncategorizedTypes.length > 0
    ? [...groups, { label: 'Other', types: uncategorizedTypes }]
    : groups;
}
