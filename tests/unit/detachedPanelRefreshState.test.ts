import { describe, expect, it } from 'vitest';

import {
  applyDetachedPanelRefreshState,
  rememberDetachedPanelForRefresh,
  takeDetachedPanelsForRefresh,
} from '../../src/components/dock/detachedPanelRefreshState';
import type { BrowserWindowPanel, DockLayout } from '../../src/types/dock';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const timelineWindow: BrowserWindowPanel = {
  id: 'window-timeline-refresh',
  panel: { id: 'timeline', type: 'timeline', title: 'Timeline' },
  returnGroupId: 'timeline-group',
};

describe('detached panel refresh state', () => {
  it('hands the latest detached bounds across one refresh', () => {
    const storage = createMemoryStorage();

    rememberDetachedPanelForRefresh(timelineWindow, {
      width: 920,
      height: 480,
      left: 210,
      top: 115,
    }, storage);

    expect(takeDetachedPanelsForRefresh(storage)).toEqual([{
      ...timelineWindow,
      size: { width: 920, height: 480 },
      position: { left: 210, top: 115 },
    }]);
    expect(takeDetachedPanelsForRefresh(storage)).toEqual([]);
  });

  it('removes a refreshed detached panel from the restored dock layout', () => {
    const layout: DockLayout = {
      root: {
        kind: 'tab-group',
        id: 'timeline-group',
        activeIndex: 1,
        panels: [
          { id: 'media', type: 'media', title: 'Media' },
          timelineWindow.panel,
        ],
      },
      floatingPanels: [],
    };

    const restored = applyDetachedPanelRefreshState(layout, [], [timelineWindow]);

    expect(restored.browserWindowPanels).toEqual([timelineWindow]);
    expect(restored.layout.root).toMatchObject({
      kind: 'tab-group',
      panels: [{ id: 'media' }],
    });
  });
});
