import { describe, expect, it } from 'vitest';
import {
  AI_PANEL_TYPES,
  DEPRECATED_PANEL_TYPES,
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

  it('keeps the old AI Generative panel only as a migration target', () => {
    expect(DEPRECATED_PANEL_TYPES).toContain('ai-video');
    expect(AI_PANEL_TYPES).not.toContain('ai-video');
    expect(PANEL_CONFIGS['ai-video']).toMatchObject({
      type: 'ai-video',
      title: 'AI Generative',
    });
  });
});
