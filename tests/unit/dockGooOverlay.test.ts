import { describe, expect, it } from 'vitest';

import {
  GOO_FOLLOW_DAMPING,
  GOO_FOLLOW_STIFFNESS,
  createRectSpring,
  createSpring,
  stepRectSpring,
  stepSpring,
} from '../../src/components/dock/goo/gooSprings';
import {
  computePaneZone,
  computeRootEdgeZone,
  computeTabSlotZone,
} from '../../src/components/dock/goo/gooZones';

describe('gooSprings', () => {
  it('converges a scalar spring onto its target', () => {
    const spring = createSpring(0);
    for (let i = 0; i < 600; i++) {
      stepSpring(spring, 100, GOO_FOLLOW_STIFFNESS, GOO_FOLLOW_DAMPING, 1 / 120);
    }
    expect(spring.value).toBeCloseTo(100, 1);
    expect(Math.abs(spring.velocity)).toBeLessThan(0.5);
  });

  it('converges a rect spring onto its target rect', () => {
    const rect = createRectSpring({ cx: 0, cy: 0, hw: 10, hh: 10 });
    const target = { cx: 400, cy: 300, hw: 120, hh: 80 };
    for (let i = 0; i < 600; i++) {
      stepRectSpring(rect, target, GOO_FOLLOW_STIFFNESS, GOO_FOLLOW_DAMPING, 1 / 120);
    }
    expect(rect.cx.value).toBeCloseTo(target.cx, 1);
    expect(rect.cy.value).toBeCloseTo(target.cy, 1);
    expect(rect.hw.value).toBeCloseTo(target.hw, 1);
    expect(rect.hh.value).toBeCloseTo(target.hh, 1);
  });
});

describe('gooZones', () => {
  const pane = { left: 0, top: 0, width: 1000, height: 600 };

  it('mirrors the left drop-overlay CSS geometry', () => {
    const zone = computePaneZone(pane, 'left');
    // CSS: top 34px, bottom 12px, left 12px, width calc(50% - 18px)
    expect(zone.hw).toBeCloseTo((1000 / 2 - 18) / 2);
    expect(zone.cx).toBeCloseTo(12 + (1000 / 2 - 18) / 2);
    expect(zone.hh).toBeCloseTo((600 - 34 - 12) / 2);
    expect(zone.cy).toBeCloseTo(34 + (600 - 34 - 12) / 2);
  });

  it('mirrors the right drop-overlay CSS geometry', () => {
    const zone = computePaneZone(pane, 'right');
    const width = 1000 / 2 - 18;
    expect(zone.cx).toBeCloseTo(1000 - 12 - width / 2);
    expect(zone.hw).toBeCloseTo(width / 2);
  });

  it('mirrors the bottom drop-overlay CSS geometry', () => {
    const zone = computePaneZone(pane, 'bottom');
    const height = 600 / 2 - 20;
    expect(zone.cy).toBeCloseTo(600 - 12 - height / 2);
    expect(zone.hh).toBeCloseTo(height / 2);
    expect(zone.hw).toBeCloseTo((1000 - 24) / 2);
  });

  it('caps the center zone like the CSS min() rules', () => {
    const zone = computePaneZone(pane, 'center');
    // 56% of 1000 = 560 caps at 460; 42% of 600 = 252 stays under 260
    expect(zone.hw * 2).toBeCloseTo(460);
    expect(zone.hh * 2).toBeCloseTo(252);
    expect(zone.cx).toBeCloseTo(500);
    expect(zone.cy).toBeCloseTo(300);
  });

  it('positions tab slots on the slot grid used by the slots overlay', () => {
    // 3 panels -> 4 slots of 22px with 7px gaps, centered in the pane
    const zone = computeTabSlotZone(pane, 3, 2);
    const rowWidth = 4 * 22 + 3 * 7;
    expect(zone.cx).toBeCloseTo(500 - rowWidth / 2 + 2 * 29 + 11);
    expect(zone.cy).toBeCloseTo(300);
    expect(zone.hw).toBeCloseTo(11);
  });

  it('mirrors the root-edge strip geometry', () => {
    const container = { left: 0, top: 0, width: 2000, height: 1000 };
    const zone = computeRootEdgeZone(container, 'left');
    // width min(28%, 340px) -> 340 for a 2000px container
    expect(zone.hw).toBeCloseTo(170);
    expect(zone.cx).toBeCloseTo(8 + 170);
    expect(zone.hh).toBeCloseTo((1000 - 16) / 2);
  });
});
