import { describe, expect, it } from 'vitest';

import { DockTabDoubleTouchTracker } from '../../src/components/dock/tabPane/DockTabDoubleTouchTracker';

const touch = (
  panelId: string,
  pointerId: number,
  clientX = 100,
  clientY = 20,
) => ({
  button: 0,
  clientX,
  clientY,
  isPrimary: true,
  panelId,
  pointerId,
  pointerType: 'touch',
});

describe('DockTabDoubleTouchTracker', () => {
  it('recognizes two short taps on the same panel tab', () => {
    const tracker = new DockTabDoubleTouchTracker();

    tracker.pointerDown(touch('scopes', 1));
    expect(tracker.pointerUp(touch('scopes', 1), 100)).toBe(false);
    tracker.pointerDown(touch('scopes', 2, 104, 22));
    expect(tracker.pointerUp(touch('scopes', 2, 104, 22), 380)).toBe(true);
  });

  it('does not treat another tab or a moved touch as a double tap', () => {
    const tracker = new DockTabDoubleTouchTracker();

    tracker.pointerDown(touch('scopes', 1));
    tracker.pointerUp(touch('scopes', 1), 100);
    tracker.pointerDown(touch('preview', 2));
    expect(tracker.pointerUp(touch('preview', 2), 200)).toBe(false);

    tracker.pointerDown(touch('preview', 3));
    expect(tracker.pointerUp(touch('preview', 3, 130, 20), 300)).toBe(false);
    tracker.pointerDown(touch('preview', 4));
    expect(tracker.pointerUp(touch('preview', 4), 350)).toBe(false);
  });

  it('ignores mouse double clicks', () => {
    const tracker = new DockTabDoubleTouchTracker();
    const mouse = { ...touch('scopes', 1), pointerType: 'mouse' };

    tracker.pointerDown(mouse);
    expect(tracker.pointerUp(mouse, 100)).toBe(false);
    tracker.pointerDown({ ...mouse, pointerId: 2 });
    expect(tracker.pointerUp({ ...mouse, pointerId: 2 }, 200)).toBe(false);
  });
});
