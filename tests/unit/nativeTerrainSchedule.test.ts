import { describe, expect, it } from 'vitest';
import { footstepCandidates } from '../../src/effects/tracking/footstepCandidates';
import { upcomingDecisions } from '../../src/effects/tracking/footstepDecisions';
import { buildNativeTerrainSchedule } from '../../src/services/planarTracking/nativeTerrainSchedule';
import type { DenseTerrainMesh, TerrainFootstep } from '../../src/types/terrainTracking';

const steps: TerrainFootstep[] = Array.from({ length: 4 }, (_, index) => ({
  id: `step-${index}`,
  name: `Step ${index}`,
  placement: {
    x: 0,
    y: 0,
    width: .08,
    height: .17,
    rotation: 0,
    contactTime: 2 + index,
    side: index % 2 ? 'right' : 'left',
  },
}));

const mesh: DenseTerrainMesh = {
  positions: [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0],
  indices: [0, 1, 2, 1, 3, 2],
  origin: [0, 0, 0],
  axisX: [1, 0, 0],
  axisY: [0, 1, 0],
  normal: [0, 0, 1],
  size: [2, 2],
};

describe('native terrain authoring schedule', () => {
  it('keeps the analysis plate visible while exposing its 700 ms build separately', () => {
    const events = buildNativeTerrainSchedule({ steps, sourceStart: 0, sourceEnd: 8 });
    expect(events[0]).toMatchObject({
      kind: 'analysis-banner',
      sourceStart: 0,
      sourceEnd: 8,
      buildDuration: .7,
      title: 'ANALYSING TERRAIN',
      cardTitle: 'CONTACT SEARCH',
    });
  });

  it('authors every accepted landing from the original winner launch through contact', () => {
    const events = buildNativeTerrainSchedule({ steps, sourceStart: 0, sourceEnd: 8 });
    const accepted = events.filter(event => event.kind === 'accepted-step');
    expect(accepted).toHaveLength(steps.length);
    expect(accepted.map(event => event.step)).toEqual(steps);
    expect(accepted.every(event => (
      event.sourceStart >= event.decisionStart
      && event.sourceStart < event.lockTime!
      && event.lockTime! < event.sourceEnd
      && event.sourceEnd === event.step.placement.contactTime
      && event.confidence! >= .89
      && event.confidence! < .98
    ))).toBe(true);
    const original = upcomingDecisions(steps, .7, 0, .7)[0];
    const winner = footstepCandidates({
      ...original,
      age: original.scanDuration - 1e-9,
      locked: false,
    }).find(candidate => candidate.index === 0)!;
    expect(accepted[0].sourceStart).toBe(original.start + winner.launch);
    expect(accepted[0].lockTime).toBe(original.start + original.scanDuration);
  });

  it('preserves staggered exact rejection times and lock cancellation fades', () => {
    const events = buildNativeTerrainSchedule({ steps, sourceStart: 0, sourceEnd: 8 });
    const alternatives = events.filter(event => event.kind === 'rejected-alternative');
    expect(alternatives.length).toBeGreaterThan(steps.length * 2);
    expect(new Set(alternatives.map(event => event.sourceStart)).size).toBeGreaterThan(4);
    expect(alternatives.some(event => event.outcome === 'rejected' && event.rejectTime !== null)).toBe(true);
    expect(alternatives.some(event => event.outcome === 'cancelled' && event.rejectTime === null)).toBe(true);
    for (const event of alternatives) {
      expect(event.sourceStart).toBeLessThan(event.sourceEnd);
      expect(event.fadeOutStart).toBeGreaterThanOrEqual(event.sourceStart);
      expect(event.fadeOutEnd).toBe(event.sourceEnd);
      if (event.rejectTime !== null) {
        expect(event.rejectTime).toBeGreaterThan(event.sourceStart);
        expect(event.rejectTime).toBeLessThan(event.sourceEnd);
      }
    }
  });

  it('continues rejecting without a winner at the end and keeps placements inside mesh bounds', () => {
    const events = buildNativeTerrainSchedule({ steps, sourceStart: 0, sourceEnd: 42, denseMesh: mesh });
    const search = events.filter(event => event.kind === 'ongoing-search' && event.sourceStart >= 38);
    expect(search.length).toBeGreaterThan(2);
    expect(search.every(event => event.sourceStart >= 38 && event.lockTime === null)).toBe(true);
    expect(new Set(search.map(event => event.searchSlot))).toEqual(new Set([0, 1]));
    for (const event of search) {
      expect(event.step).toBe(steps.at(-1));
      expect(event.rejectTime).not.toBeNull();
      expect(event.placement.x - event.placement.width / 2).toBeGreaterThan(-1);
      expect(event.placement.x + event.placement.width / 2).toBeLessThan(1);
      expect(event.placement.y - event.placement.height / 2).toBeGreaterThan(-1);
      expect(event.placement.y + event.placement.height / 2).toBeLessThan(1);
    }
  });

  it('materializes the brief third-contact probe and the pre-landing closing search', () => {
    const quick = buildNativeTerrainSchedule({ steps, sourceStart: 0, sourceEnd: 8, denseMesh: mesh });
    expect(quick.some(event => event.kind === 'ongoing-search' && event.sourceStart < 2)).toBe(true);

    const closingSteps = steps.map((step, index) => ({
      ...step,
      placement: { ...step.placement, contactTime: 39 + index * 2 },
    }));
    const closing = buildNativeTerrainSchedule({
      steps: closingSteps,
      sourceStart: 0,
      sourceEnd: 47,
      denseMesh: mesh,
    }).filter(event => event.kind === 'ongoing-search');
    expect(closing.some(event => event.sourceStart >= 38 && event.sourceStart < 45)).toBe(true);
    expect(closing.every(event => event.candidateIndex > 0 && event.lockTime === null)).toBe(true);
  });

  it('matches the scenic shader reveal and tail timings including the greater-than drop', () => {
    const events = buildNativeTerrainSchedule({
      steps,
      sourceStart: 0,
      sourceEnd: 8,
      interlude: { start: 3, end: 5.5, dropMeters: 300, dropGreaterThan: true },
    });
    expect(events.find(event => event.kind === 'wonderful-banner')).toMatchObject({
      sourceStart: 3.08,
      sourceEnd: 5.95,
      revealEnd: 3.25,
      fadeStart: 5.65,
      title: 'WONDERFUL',
    });
    expect(events.find(event => event.kind === 'danger-banner')).toMatchObject({
      sourceStart: 4.3,
      sourceEnd: 5.95,
      revealEnd: 4.45,
      fadeStart: 5.65,
      title: 'DANGER >300 METER',
    });
  });

  it('is deterministic, source-sorted and leaves terrain inputs untouched', () => {
    const before = structuredClone(steps);
    const input = { steps, sourceStart: 0, sourceEnd: 42, denseMesh: mesh };
    const first = buildNativeTerrainSchedule(input);
    const second = buildNativeTerrainSchedule(input);
    expect(second).toEqual(first);
    expect(first.every((event, index) => index === 0 || first[index - 1].sourceStart <= event.sourceStart)).toBe(true);
    expect(steps).toEqual(before);
  });
});
