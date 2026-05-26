import { describe, expect, it } from 'vitest';
import type { DockLayout, DockPanel, DockTabGroup } from '../../src/types/dock';
import {
  adjustDropTargetForMovedPanel,
  calculateRootEdgeDropPosition,
  insertPanelAtTarget,
  removePanel,
} from '../../src/utils/dockLayout';

const createPanel = (id: string): DockPanel => ({
  id,
  type: 'media',
  title: id,
});

const createGroup = (id: string, panelIds: string[]): DockTabGroup => ({
  kind: 'tab-group',
  id,
  panels: panelIds.map(createPanel),
  activeIndex: 0,
});

const createLayout = (): DockLayout => ({
  root: {
    kind: 'split',
    id: 'root-split',
    direction: 'vertical',
    ratio: 0.6,
    children: [
      createGroup('top-group', ['preview']),
      createGroup('bottom-group', ['timeline']),
    ],
  },
  floatingPanels: [],
  panelZoom: {},
});

const createTabLayout = (): DockLayout => ({
  root: createGroup('tabs', ['a', 'b', 'c', 'd', 'e']),
  floatingPanels: [],
  panelZoom: {},
});

const rootRect = {
  left: 100,
  top: 50,
  right: 900,
  bottom: 650,
  width: 800,
  height: 600,
} as DOMRect;

describe('dockLayout root edge drops', () => {
  it('wraps the full dock root when inserting at a root edge', () => {
    const layout = createLayout();
    const panel = createPanel('downloads');

    const nextLayout = insertPanelAtTarget(layout, panel, {
      groupId: layout.root.id,
      position: 'left',
      scope: 'root-edge',
    });

    expect(nextLayout.root.kind).toBe('split');
    if (nextLayout.root.kind !== 'split') return;

    expect(nextLayout.root.direction).toBe('horizontal');
    expect(nextLayout.root.ratio).toBeCloseTo(0.22);
    expect(nextLayout.root.children[0]).toMatchObject({
      kind: 'tab-group',
      panels: [{ id: 'downloads' }],
    });
    expect(nextLayout.root.children[1]).toBe(layout.root);
  });

  it('uses the trailing side of the root split for right and bottom edge drops', () => {
    const layout = createLayout();
    const panel = createPanel('export');

    const nextLayout = insertPanelAtTarget(layout, panel, {
      groupId: layout.root.id,
      position: 'bottom',
      scope: 'root-edge',
    });

    expect(nextLayout.root.kind).toBe('split');
    if (nextLayout.root.kind !== 'split') return;

    expect(nextLayout.root.direction).toBe('vertical');
    expect(nextLayout.root.ratio).toBeCloseTo(0.78);
    expect(nextLayout.root.children[0]).toBe(layout.root);
    expect(nextLayout.root.children[1]).toMatchObject({
      kind: 'tab-group',
      panels: [{ id: 'export' }],
    });
  });

  it('keeps normal pane edge drops scoped to the target tab group', () => {
    const layout = createLayout();
    const panel = createPanel('properties');

    const nextLayout = insertPanelAtTarget(layout, panel, {
      groupId: 'top-group',
      position: 'right',
    });

    expect(nextLayout.root.kind).toBe('split');
    if (nextLayout.root.kind !== 'split') return;

    expect(nextLayout.root.id).toBe('root-split');
    expect(nextLayout.root.children[0]).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
    });
  });

  it('detects the nearest outer dock edge and ignores the center', () => {
    expect(calculateRootEdgeDropPosition(rootRect, 104, 300)).toBe('left');
    expect(calculateRootEdgeDropPosition(rootRect, 500, 54)).toBe('top');
    expect(calculateRootEdgeDropPosition(rootRect, 896, 300)).toBe('right');
    expect(calculateRootEdgeDropPosition(rootRect, 500, 646)).toBe('bottom');
    expect(calculateRootEdgeDropPosition(rootRect, 500, 300)).toBeNull();
  });

  it('adjusts tab insertion when moving a panel later in the same group', () => {
    const layout = createTabLayout();
    const panel = createPanel('b');
    const adjustedTarget = adjustDropTargetForMovedPanel(layout.root, 'b', 'tabs', {
      groupId: 'tabs',
      position: 'center',
      tabInsertIndex: 3,
    });

    let nextLayout = removePanel(layout, 'b', 'tabs');
    nextLayout = insertPanelAtTarget(nextLayout, panel, adjustedTarget);

    expect(adjustedTarget.tabInsertIndex).toBe(2);
    expect(nextLayout.root).toMatchObject({
      kind: 'tab-group',
      panels: [
        { id: 'a' },
        { id: 'c' },
        { id: 'b' },
        { id: 'd' },
        { id: 'e' },
      ],
    });
  });
});
