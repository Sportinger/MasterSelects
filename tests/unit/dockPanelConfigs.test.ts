import { describe, expect, it } from 'vitest';
import {
  AI_PANEL_TYPES,
  PANEL_CONFIGS,
  SCOPE_PANEL_TYPES,
  WIP_PANEL_TYPES,
  type PanelType,
} from '../../src/types/dock';

describe('dock panel configs', () => {
  it('registers the Audio Mixer as a stable core panel', () => {
    const panelType: PanelType = 'audio-mixer';

    expect(PANEL_CONFIGS[panelType]).toMatchObject({
      type: 'audio-mixer',
      title: 'Audio Mixer',
      closable: false,
    });
    expect(WIP_PANEL_TYPES).not.toContain(panelType);
    expect(AI_PANEL_TYPES).not.toContain(panelType);
    expect(SCOPE_PANEL_TYPES).not.toContain(panelType);
  });

  it('registers History as a stable core panel', () => {
    const panelType: PanelType = 'history';

    expect(PANEL_CONFIGS[panelType]).toMatchObject({
      type: 'history',
      title: 'History',
      closable: false,
    });
    expect(WIP_PANEL_TYPES).not.toContain(panelType);
    expect(AI_PANEL_TYPES).not.toContain(panelType);
    expect(SCOPE_PANEL_TYPES).not.toContain(panelType);
  });

  it('excludes retired dock panel ids from the active panel contract', () => {
    const activePanelTypes = Object.keys(PANEL_CONFIGS);
    const retiredPanelTypes = ['ai-video', 'youtube', 'download'];

    retiredPanelTypes.forEach((type) => {
      expect(activePanelTypes).not.toContain(type);
      expect(AI_PANEL_TYPES as readonly string[]).not.toContain(type);
      expect(SCOPE_PANEL_TYPES as readonly string[]).not.toContain(type);
      expect(WIP_PANEL_TYPES as readonly string[]).not.toContain(type);
    });
  });
});
