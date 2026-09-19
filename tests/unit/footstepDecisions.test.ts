import { describe, expect, it } from 'vitest';
import { upcomingDecisions } from '../../src/effects/tracking/footstepDecisions';
import type { TerrainFootstep } from '../../src/types/terrainTracking';

const steps: TerrainFootstep[] = Array.from({ length: 8 }, (_, i) => ({
  id: `step-${i}`, name: `Step ${i}`, placement: {
    x: 0, y: 0, width: 1, height: 2, rotation: 0,
    contactTime: i + 1, side: i % 2 ? 'right' : 'left',
  },
}));

describe('source-time decision choreography', () => {
  it('waits for the authored HUD build before starting the first analysis', () => {
    expect(upcomingDecisions(steps, .699, 0, .7)).toEqual([]);
    expect(upcomingDecisions(steps, .7, 0, .7)[0].start).toBe(.7);
    expect(upcomingDecisions(steps, .7, 0, .7)[0].locked).toBe(false);
  });
  it('keeps only two nearby future contacts and replaces the landed contact at its exact time', () => {
    expect(upcomingDecisions(steps, .5, 0).map(d => d.step.id)).toEqual(['step-0', 'step-1']);
    expect(upcomingDecisions(steps, 1, 0).map(d => d.step.id)).toEqual(['step-1', 'step-2']);
    expect(upcomingDecisions(steps, 8, 0)).toEqual([]);
  });
  it('allows a brief two-green overlap, capped at 0.3 seconds before landing', () => {
    for (let time = 0; time < 8; time += .025) {
      const decisions = upcomingDecisions(steps, time, 0);
      expect(decisions.filter(d => d.locked).length).toBeLessThanOrEqual(2);
      if (decisions[1]?.locked) {
        expect(time).toBeGreaterThanOrEqual(decisions[0].step.placement.contactTime! - .3);
      }
    }
    expect(upcomingDecisions(steps, .69, 0)[1].locked).toBe(false);
    expect(upcomingDecisions(steps, .85, 0).slice(0, 2).every(d => d.locked)).toBe(true);
    expect(upcomingDecisions(steps, 1, 0)[0].locked).toBe(true);
  });
  it('locks before landing and reproduces state when seeking backwards', () => {
    const before = upcomingDecisions(steps, 3.8, 0);
    upcomingDecisions(steps, 6.2, 0);
    expect(upcomingDecisions(steps, 3.8, 0)).toEqual(before);
    for (const decision of before.filter(d => !d.searchOnly)) {
      expect(decision.start + decision.scanDuration).toBeLessThan(decision.step.placement.contactTime!);
      expect(decision.confidence).toBeGreaterThanOrEqual(.89);
      expect(decision.confidence).toBeLessThan(.98);
    }
  });
  it('searches from the opening frame while retaining a short analysis before the first lock', () => {
    const opening = steps.map(s => ({ ...s, placement: { ...s.placement, contactTime: s.placement.contactTime! + 2.2 } }));
    const initial = upcomingDecisions(opening, 0, 0);
    expect(initial).toHaveLength(2);
    expect(initial.every(d => d.start === 0 && !d.locked)).toBe(true);
    expect(upcomingDecisions(opening, .3, 0)[0].age).toBeCloseTo(.3);
    expect(upcomingDecisions(opening, 1.55, 0)[0].locked).toBe(false);
    expect(upcomingDecisions(opening, 1.65, 0)[0].locked).toBe(true);
    expect(upcomingDecisions(opening, -1, 0)).toEqual([]);
  });
  it('advances analysis beyond both locked footprints without reopening either', () => {
    const decisions = upcomingDecisions(steps, .85, 0);
    expect(decisions.filter(d => d.locked)).toHaveLength(2);
    const search = decisions.find(d => d.searchOnly)!;
    expect(search).toBeDefined();
    expect(search.locked).toBe(false);
    expect(search.isNext).toBe(false);
    expect(search.step.id).toBe(steps[2].id);
    expect(search.step.placement.y).toBeLessThan(steps[2].placement.y);
    expect(decisions.filter(d => d.locked).every(d => d.step.id !== search.step.id)).toBe(true);
    expect(search.age).toBeLessThan(search.scanDuration * .9);
  });
  it('does not search a distant contact or reuse the final locked footprint', () => {
    const distant = steps.map((step, i) => i < 2 ? step : ({ ...step, placement: { ...step.placement, contactTime: i + 20 } }));
    expect(upcomingDecisions(distant, .85, 0).some(d => d.searchOnly)).toBe(false);
    expect(upcomingDecisions(steps, 7.8, 0).some(d => d.searchOnly)).toBe(false);
  });
  it('keeps two independent inspections active during the slower closing stretch', () => {
    const slow = steps.slice(0, 4).map((step, i) => ({ ...step, placement: { ...step.placement, contactTime: 39 + i * 2 } }));
    for (const time of [38.1, 39.2, 41.8, 45.5, 49]) {
      const decisions = upcomingDecisions(slow, time, 0);
      expect(decisions.filter(d => !d.locked)).toHaveLength(2);
      expect(decisions.filter(d => d.searchOnly).every(d => !d.locked && !d.isNext)).toBe(true);
    }
    const ending = upcomingDecisions(slow, 49, 0);
    expect(ending.every(d => d.searchOnly)).toBe(true);
    expect(ending[0].step.placement.y).toBeLessThan(slow[3].placement.y);
    expect(ending[0].age).not.toBe(ending[1].age);
  });
  it('honors per-foot lock timing for delayed overlaps and an authored double lock', () => {
    const authored = steps.map((step, i) => ({ ...step, placement: { ...step.placement,
      lockTime: i === 1 ? 1.2 : undefined } }));
    expect(upcomingDecisions(authored, .9, 0)[1].locked).toBe(false);
    expect(upcomingDecisions(authored, 1.21, 0)[0].locked).toBe(true);
    const rock = steps.slice(0, 2).map((step, i) => ({ ...step, placement: { ...step.placement,
      contactTime: 42.167 + i * 1.333, lockTime: 40.95 + i * .23 } }));
    expect(upcomingDecisions(rock, 41.02, 0).filter(d => d.locked)).toHaveLength(1);
    expect(upcomingDecisions(rock, 41.2, 0).filter(d => d.locked)).toHaveLength(2);
  });
  it('retains authored gaps without inventing contacts', () => {
    const gap = steps.map((s, i) => ({ ...s, placement: { ...s.placement, contactTime: i + (i > 3 ? 20 : 1) } }));
    expect(upcomingDecisions(gap, 10, 0)).toEqual([]);
    expect(upcomingDecisions(gap, NaN, 0)).toEqual([]);
  });
});
