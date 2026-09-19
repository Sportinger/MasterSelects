import { describe, expect, it } from 'vitest';

import { getPanelMenuGroups } from '../../src/components/dock/tabPane/panelMenuGroups';
import {
  PANEL_CONFIGS,
  PANEL_PICKER_HIDDEN_TYPES,
  type PanelType,
} from '../../src/types/dock';

describe('dock panel menu groups', () => {
  it('places every picker-visible panel in exactly one category', () => {
    const visiblePanelTypes = (Object.keys(PANEL_CONFIGS) as PanelType[]).filter(
      type => !PANEL_PICKER_HIDDEN_TYPES.includes(type),
    );
    const groups = getPanelMenuGroups(visiblePanelTypes);
    const groupedPanelTypes = groups.flatMap(group => group.types);

    expect(groupedPanelTypes).toHaveLength(visiblePanelTypes.length);
    expect(new Set(groupedPanelTypes).size).toBe(visiblePanelTypes.length);
    expect(groupedPanelTypes).toEqual(expect.arrayContaining(visiblePanelTypes));
  });

  it('keeps related editor surfaces together', () => {
    const groups = getPanelMenuGroups(Object.keys(PANEL_CONFIGS) as PanelType[]);

    expect(groups.find(group => group.label === 'Color')?.types).toEqual(
      expect.arrayContaining(['color-controls', 'color-keyframes']),
    );
    expect(groups.find(group => group.label === 'Live')?.types).toEqual(
      expect.arrayContaining(['go-live', 'stream-chat', 'stream-analytics']),
    );
  });

  it('keeps newly registered panels discoverable in an Other category', () => {
    const groups = getPanelMenuGroups(['preview', 'scene-description']);

    expect(groups.at(-1)).toEqual({
      label: 'Other',
      types: ['scene-description'],
    });
  });
});
