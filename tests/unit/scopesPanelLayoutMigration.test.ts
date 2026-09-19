import { describe, expect, it } from 'vitest';

import { cleanupPersistedLayout } from '../../src/stores/dockStore/layoutPersistence';
import type { DockLayout, ScopesPanelData } from '../../src/types/dock';

function legacyScopesLayout(activeIndex: number): DockLayout {
  return {
    root: {
      kind: 'tab-group',
      id: 'legacy-scopes',
      panels: [
        { id: 'legacy-waveform', type: 'scope-waveform', title: 'Waveform' },
        { id: 'legacy-histogram', type: 'scope-histogram', title: 'Histogram' },
        { id: 'legacy-vectorscope', type: 'scope-vectorscope', title: 'Vectorscope' },
        { id: 'export', type: 'export', title: 'Export' },
      ],
      activeIndex,
    },
    floatingPanels: [],
  };
}

describe('unified scopes layout migration', () => {
  it('collapses legacy scope tabs and preserves the active scope mode', () => {
    const layout = cleanupPersistedLayout(legacyScopesLayout(1));

    expect(layout.root.kind).toBe('tab-group');
    if (layout.root.kind !== 'tab-group') return;

    expect(layout.root.panels.map(panel => panel.type)).toEqual(['color-scopes', 'export']);
    expect(layout.root.panels[0]).toMatchObject({ id: 'legacy-histogram', title: 'Scopes' });
    expect((layout.root.panels[0].data as ScopesPanelData).scopeMode).toBe('histogram');
    expect(layout.root.activeIndex).toBe(0);
  });

  it('keeps a non-scope active tab selected while consolidating the scopes', () => {
    const layout = cleanupPersistedLayout(legacyScopesLayout(3));

    expect(layout.root.kind).toBe('tab-group');
    if (layout.root.kind !== 'tab-group') return;

    expect(layout.root.panels.map(panel => panel.type)).toEqual(['color-scopes', 'export']);
    expect((layout.root.panels[0].data as ScopesPanelData).scopeMode).toBe('waveform');
    expect(layout.root.activeIndex).toBe(1);
  });
});
