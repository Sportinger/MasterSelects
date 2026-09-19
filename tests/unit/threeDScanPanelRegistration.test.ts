import { describe, expect, it } from 'vitest';
import { VIEW_CORE_PANEL_TYPES } from '../../src/components/common/toolbar/viewPanelConfig';
import { BUILT_IN_PANEL_TYPES, VALID_PANEL_TYPES } from '../../src/stores/dockStore/panelRegistry';
import { PANEL_CONFIGS, WIP_PANEL_TYPES } from '../../src/types/dock';

describe('3D Scan panel registration', () => {
  it('registers a normal dockable panel', () => {
    expect(PANEL_CONFIGS['3d-scan']).toMatchObject({
      type: '3d-scan',
      title: '3D Scan',
      minWidth: 320,
    });
    expect(BUILT_IN_PANEL_TYPES).toContain('3d-scan');
    expect(VALID_PANEL_TYPES.has('3d-scan')).toBe(true);
    expect(VIEW_CORE_PANEL_TYPES).toContain('3d-scan');
    expect(WIP_PANEL_TYPES).not.toContain('3d-scan');
  });
});
