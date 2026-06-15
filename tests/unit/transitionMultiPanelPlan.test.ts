import { describe, expect, it } from 'vitest';

import { createTransitionMultiPanelPlan } from '../../src/services/layerBuilder/transitionMultiPanelPlan';

describe('transition multi-panel planner', () => {
  it('creates stable panel ids, z order, and normalized source rects', () => {
    const plan = createTransitionMultiPanelPlan({
      rows: 2,
      columns: 3,
      progress: 0.5,
      order: 'row-major',
    });

    expect(plan.map((panel) => panel.id)).toEqual([
      'panel:0:0',
      'panel:0:1',
      'panel:0:2',
      'panel:1:0',
      'panel:1:1',
      'panel:1:2',
    ]);
    expect(plan.map((panel) => panel.orderIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.map((panel) => panel.zIndex)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(plan[4].sourceRect).toEqual({
      x: 1 / 3,
      y: 1 / 2,
      width: 1 / 3,
      height: 1 / 2,
    });
  });

  it('changes random ordering by seed while keeping the same panel geometry', () => {
    const first = createTransitionMultiPanelPlan({
      rows: 3,
      columns: 3,
      progress: 0.7,
      order: 'random',
      seed: 7,
    });
    const repeat = createTransitionMultiPanelPlan({
      rows: 3,
      columns: 3,
      progress: 0.7,
      order: 'random',
      seed: 7,
    });
    const nextSeed = createTransitionMultiPanelPlan({
      rows: 3,
      columns: 3,
      progress: 0.7,
      order: 'random',
      seed: 8,
    });

    expect(repeat.map((panel) => panel.orderIndex)).toEqual(first.map((panel) => panel.orderIndex));
    expect(nextSeed.map((panel) => panel.orderIndex)).not.toEqual(first.map((panel) => panel.orderIndex));
    expect(nextSeed.map((panel) => panel.sourceRect)).toEqual(first.map((panel) => panel.sourceRect));
  });

  it('supports center, edge, and magnetic ordering strategies', () => {
    const centerOut = createTransitionMultiPanelPlan({
      rows: 3,
      columns: 3,
      progress: 1,
      order: 'center-out',
    });
    const edgeIn = createTransitionMultiPanelPlan({
      rows: 3,
      columns: 3,
      progress: 1,
      order: 'edge-in',
    });
    const magnetic = createTransitionMultiPanelPlan({
      rows: 3,
      columns: 3,
      progress: 1,
      order: 'magnetic',
      magneticPoint: { x: 1, y: 0 },
    });

    expect(centerOut.find((panel) => panel.id === 'panel:1:1')?.orderIndex).toBe(0);
    expect(edgeIn.find((panel) => panel.id === 'panel:1:1')?.orderIndex).toBe(8);
    expect(magnetic.find((panel) => panel.id === 'panel:0:2')?.orderIndex).toBe(0);
  });

  it('applies deterministic staggered panel progress', () => {
    const plan = createTransitionMultiPanelPlan({
      rows: 1,
      columns: 4,
      progress: 0.5,
      order: 'row-major',
      stagger: 0.6,
    });

    expect(plan.map((panel) => Number(panel.progress.toFixed(3)))).toEqual([
      0.5,
      0.375,
      0.167,
      0,
    ]);
  });

  it('clamps unsafe input without creating unbounded panel grids', () => {
    const plan = createTransitionMultiPanelPlan({
      rows: 1000,
      columns: Number.NaN,
      progress: 2,
      order: 'column-major',
    });

    expect(plan).toHaveLength(32);
    expect(plan.every((panel) => panel.progress === 1)).toBe(true);
  });
});
