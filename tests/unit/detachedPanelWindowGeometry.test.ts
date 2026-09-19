import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDetachedPanelWindowFeatures,
  getDetachedPanelWindowBounds,
  resolveDetachedPanelInitialBounds,
} from '../../src/components/dock/detachedPanelWindowGeometry';
import type { BrowserWindowPanel } from '../../src/types/dock';

afterEach(() => {
  document.body.replaceChildren();
});

function panel(overrides: Partial<BrowserWindowPanel> = {}): BrowserWindowPanel {
  return {
    id: 'window-timeline-test',
    panel: { id: 'timeline', type: 'timeline', title: 'Timeline' },
    returnGroupId: 'timeline-group',
    ...overrides,
  };
}

describe('detached panel window geometry', () => {
  it('starts at the exact rendered size of the dock pane being detached', () => {
    const pane = document.createElement('div');
    pane.className = 'dock-tab-pane';
    pane.dataset.groupId = 'timeline-group';
    pane.getBoundingClientRect = () => ({ width: 642.4, height: 318.6 } as DOMRect);
    document.body.appendChild(pane);

    const bounds = resolveDetachedPanelInitialBounds(panel(), document);
    const features = buildDetachedPanelWindowFeatures(bounds, window);

    expect(bounds.size).toEqual({ width: 642, height: 319 });
    expect(features).toContain('width=642');
    expect(features).toContain('height=319');
    expect(features).toContain('resizable=yes');
  });

  it('keeps persisted popup bounds instead of remeasuring a dock pane', () => {
    const bounds = resolveDetachedPanelInitialBounds(panel({
      size: { width: 480, height: 270 },
      position: { left: 31, top: 42 },
    }), document);

    expect(buildDetachedPanelWindowFeatures(bounds, window)).toContain('width=480,height=270,left=31,top=42');
  });

  it('persists resized content dimensions without adding browser chrome', () => {
    const popup = {
      closed: false,
      innerWidth: 701,
      innerHeight: 411,
      outerWidth: 719,
      outerHeight: 498,
      screenX: 90,
      screenY: 55,
    } as Window;

    expect(getDetachedPanelWindowBounds(popup)).toEqual({
      width: 701,
      height: 411,
      left: 90,
      top: 55,
    });
  });
});
