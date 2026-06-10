import type { CSSProperties } from 'react';

import type { DockPanel, PanelType } from '../../../types/dock';

export const HOLD_DURATION = 500;
export const TAB_INSERT_HOT_ZONE_PX = 36;
export const TAB_SLOT_SIZE_PX = 22;
export const TAB_SLOT_GAP_PX = 7;

export interface AudioMixerTabStats {
  label: string;
  title: string;
}

export interface DynamicTabTitleInput {
  panel: DockPanel;
  selectedSlotName: string | null;
  selectedPropertiesName: string | null;
  audioMixerTabStats: AudioMixerTabStats;
}

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 2) + '..';
};

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
);

export const calculateTabInsertIndex = (
  mouseX: number,
  paneRect: DOMRect,
  panelCount: number,
): number => {
  const slotCount = panelCount + 1;
  if (slotCount <= 1 || paneRect.width <= 0) return 0;

  const rowWidth = slotCount * TAB_SLOT_SIZE_PX + (slotCount - 1) * TAB_SLOT_GAP_PX;
  const slotStep = TAB_SLOT_SIZE_PX + TAB_SLOT_GAP_PX;
  const firstSlotCenterX = paneRect.left + paneRect.width / 2 - rowWidth / 2 + TAB_SLOT_SIZE_PX / 2;
  const rawIndex = Math.round((mouseX - firstSlotCenterX) / slotStep);

  return Math.max(0, Math.min(slotCount - 1, rawIndex));
};

export const getTimelineTabBarStyle = (
  hasTimelinePanel: boolean,
  openCompositionCount: number,
  slotGridProgress: number,
): CSSProperties | undefined => {
  if (!hasTimelinePanel || openCompositionCount <= 0 || slotGridProgress <= 0) {
    return undefined;
  }

  return {
    height: `${Math.round((1 - slotGridProgress) * 26)}px`,
    minHeight: 0,
    opacity: 1 - slotGridProgress,
    overflow: 'hidden',
  };
};

export const getDynamicTabTitle = ({
  panel,
  selectedSlotName,
  selectedPropertiesName,
  audioMixerTabStats,
}: DynamicTabTitleInput): { tabTitle: string; tabTooltip: string } => {
  if (panel.type === 'clip-properties' && (selectedSlotName || selectedPropertiesName)) {
    const label = selectedSlotName || selectedPropertiesName || panel.title;
    return {
      tabTitle: truncateText(label, 18),
      tabTooltip: label,
    };
  }

  if (panel.type === 'audio-mixer') {
    return {
      tabTitle: audioMixerTabStats.label,
      tabTooltip: audioMixerTabStats.title,
    };
  }

  return {
    tabTitle: panel.title,
    tabTooltip: panel.title,
  };
};

export const clampMenuPosition = (
  clientX: number,
  clientY: number,
  maxWidth: number,
  maxHeight: number,
): { x: number; y: number } => {
  const maxMenuX = Math.max(8, window.innerWidth - maxWidth);
  const maxMenuY = Math.max(8, window.innerHeight - maxHeight);

  return {
    x: Math.max(8, Math.min(clientX, maxMenuX)),
    y: Math.max(8, Math.min(clientY, maxMenuY)),
  };
};

export const sortAddMenuPanelTypes = (
  panelTypes: PanelType[],
  multiInstancePanelTypes: PanelType[],
): PanelType[] => (
  [...panelTypes].sort((a, b) => (
    (multiInstancePanelTypes.includes(a) ? 0 : 1) - (multiInstancePanelTypes.includes(b) ? 0 : 1)
  ))
);
