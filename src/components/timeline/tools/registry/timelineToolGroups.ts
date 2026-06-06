import type { ShortcutActionId } from '../../../../services/shortcutTypes';
import type { TimelineToolGroupId, TimelineToolId } from '../../../../stores/timeline/types';
import { TIMELINE_TOOL_GROUP_ICONS, type TimelineToolIcon } from '../toolIcons';

export interface TimelineToolGroupDefinition {
  id: TimelineToolGroupId;
  label: string;
  tooltipLabel: string;
  icon: TimelineToolIcon;
  defaultToolId: TimelineToolId;
  tools: TimelineToolId[];
  shortcutActionId?: ShortcutActionId;
}

export const TIMELINE_TOOL_GROUPS: TimelineToolGroupDefinition[] = [
  {
    id: 'selection',
    label: 'Selection',
    tooltipLabel: 'Selection tools',
    icon: TIMELINE_TOOL_GROUP_ICONS.selection,
    defaultToolId: 'select',
    tools: ['select', 'track-select-forward', 'track-select-backward', 'track-select-forward-all', 'range-select'],
    shortcutActionId: 'tool.selectionGroup',
  },
  {
    id: 'cut',
    label: 'Cut',
    tooltipLabel: 'Cut tools',
    icon: TIMELINE_TOOL_GROUP_ICONS.cut,
    defaultToolId: 'blade',
    tools: [
      'blade',
      'blade-all-tracks',
      'glue',
      'split-at-playhead',
      'split-all-at-playhead',
      'trim-start-to-playhead',
      'trim-end-to-playhead',
      'ripple-trim-start-to-playhead',
      'ripple-trim-end-to-playhead',
      'ripple-delete',
      'delete-gap',
      'lift-range',
      'extract-range',
    ],
    shortcutActionId: 'tool.cutToggle',
  },
  {
    id: 'trim',
    label: 'Trim',
    tooltipLabel: 'Trim tools',
    icon: TIMELINE_TOOL_GROUP_ICONS.trim,
    defaultToolId: 'edge-trim',
    tools: ['edge-trim', 'ripple-trim', 'rolling-edit', 'slip', 'slide', 'rate-stretch'],
    shortcutActionId: 'tool.trimGroup',
  },
  {
    id: 'placement',
    label: 'Place',
    tooltipLabel: 'Placement tools',
    icon: TIMELINE_TOOL_GROUP_ICONS.placement,
    defaultToolId: 'position-overwrite',
    tools: ['position-overwrite', 'insert', 'overwrite', 'replace', 'fit-to-fill', 'append-at-end', 'place-on-top', 'ripple-overwrite'],
    shortcutActionId: 'tool.placementGroup',
  },
  {
    id: 'navigation',
    label: 'Navigate',
    tooltipLabel: 'Navigate and mark tools',
    icon: TIMELINE_TOOL_GROUP_ICONS.navigation,
    defaultToolId: 'hand',
    tools: ['hand', 'zoom', 'marker', 'in-point', 'out-point', 'pen-keyframe', 'midi-draw'],
    shortcutActionId: 'tool.navigationGroup',
  },
];

export const TIMELINE_TOOL_GROUP_BY_ID = Object.fromEntries(
  TIMELINE_TOOL_GROUPS.map((group) => [group.id, group]),
) as Record<TimelineToolGroupId, TimelineToolGroupDefinition>;
