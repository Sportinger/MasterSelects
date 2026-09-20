import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockStore } from '../../src/stores/dockStore';
import type { HoveredDockTabTarget } from '../../src/types/dock';

describe('dock pointer hover updates', () => {
  beforeEach(() => useDockStore.setState({ hoveredTabTarget: null }));
  afterEach(() => vi.restoreAllMocks());

  it('does not notify the editor or persist layouts for repeated mouse movement in one pane', () => {
    const target: HoveredDockTabTarget = { kind: 'panel', panelId: 'nodes', groupId: 'main' };
    useDockStore.getState().setHoveredTabTarget(target);
    const changed = vi.fn();
    const unsubscribe = useDockStore.subscribe(changed);
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    try {
      for (let i = 0; i < 100; i++) useDockStore.getState().setHoveredTabTarget({ ...target });
      useDockStore.getState().clearHoveredTabTarget('another-panel');
      expect(changed).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
      useDockStore.getState().clearHoveredTabTarget('nodes');
      expect(changed).toHaveBeenCalledTimes(1);
      persist.mockClear();
      useDockStore.getState().clearHoveredTabTarget();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(persist).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('retains real changes of panel, group, kind and composition', () => {
    const targets: HoveredDockTabTarget[] = [
      { kind: 'panel', panelId: 'nodes', groupId: 'main' },
      { kind: 'panel', panelId: 'preview', groupId: 'main' },
      { kind: 'panel', panelId: 'preview', groupId: 'floating' },
      { kind: 'timeline-composition', panelId: 'preview', groupId: 'floating', compositionId: 'a' },
      { kind: 'timeline-composition', panelId: 'preview', groupId: 'floating', compositionId: 'b' },
    ];
    const changed = vi.fn();
    const unsubscribe = useDockStore.subscribe(changed);
    try {
      for (const target of targets) {
        useDockStore.getState().setHoveredTabTarget(target);
        expect(useDockStore.getState().hoveredTabTarget).toEqual(target);
      }
      expect(changed).toHaveBeenCalledTimes(targets.length);
    } finally { unsubscribe(); }
  });
});
