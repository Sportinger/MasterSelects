import { describe, expect, it } from 'vitest';
import { footstepCandidates, placeAnalysisCard, endingCandidateShift } from '../../src/effects/tracking/footstepCandidates';
import type { FootstepDecision } from '../../src/effects/tracking/footstepDecisions';

const decision = { seed: .72, scanDuration: 2, age: 0, locked: false } as FootstepDecision;
describe('rolling footstep search', () => {
  it('rejects faster at the ending and reduces replacement lanes without creating a winner', () => {
    let early = 0, late = 0, red = 0, samples = 0;
    for (let endingAge = .01; endingAge < 2.6; endingAge += .02) {
      const active = footstepCandidates({ ...decision, age: 48 + endingAge, searchOnly: true, endingAge });
      expect(active.every(c => c.index !== 0 && c.blueDuration < .9)).toBe(true);
      if (endingAge < .8) early += active.length;
      if (endingAge > 1.8) late += active.length;
      red += active.filter(c => c.rejected).length;
      samples += active.length;
    }
    expect(late).toBeLessThan(early / 2);
    expect(red / samples).toBeGreaterThan(.3);
    expect(footstepCandidates({ ...decision, age: 50.5, searchOnly: true, endingAge: 2.5 }).length).toBeLessThanOrEqual(1);
  });
  it('keeps rejecting and launching independent ending probes without a winner', () => {
    const rejected = new Set<string>(), launched = new Set<string>();
    for (let age = 48; age < 51; age += .025) {
      const active = footstepCandidates({ ...decision, age, searchOnly: true });
      // Brief all-red moments are allowed; the rolling search must stay active.
      expect(active.length).toBeGreaterThan(0);
      expect(active.every(c => c.index !== 0)).toBe(true);
      for (const c of active) {
        if (c.rejected) rejected.add(`${c.index}:${c.spatialSeed}`);
        if (c.age < .05) launched.add(`${c.index}:${c.spatialSeed}`);
      }
    }
    expect(rejected.size).toBeGreaterThan(3);
    expect(launched.size).toBeGreaterThanOrEqual(3);
  });
  it('keeps ending footprints within the observed patch even when the search anchor is outside it', () => {
    const bounds = [-.11, -.33, .35, .58];
    const placement = { x: .026, y: -.5, width: .083, height: .175, rotation: 0 };
    for (let index = 0; index < 6; index++) {
      const shift = endingCandidateShift(.72, index, placement, bounds);
      const x = placement.x + shift[0] * placement.width;
      const y = placement.y + shift[1] * placement.height;
      expect(x - placement.width / 2).toBeGreaterThan(bounds[0]);
      expect(x + placement.width / 2).toBeLessThan(bounds[0] + bounds[2]);
      expect(y - placement.height / 2).toBeGreaterThan(bounds[1]);
      expect(y + placement.height / 2).toBeLessThan(bounds[1] + bounds[3]);
    }
  });
  it('separates cards whose projected anchors coincide', () => {
    const placed: number[][] = [];
    for (let i = 0; i < 6; i++) placeAnalysisCard([.2, .6], placed, .45);
    expect(placed.every(origin => origin[1] + .092 * .52 < .45)).toBe(true);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      expect(Math.abs(placed[i][0] - placed[j][0]) >= .37 * .52
        || Math.abs(placed[i][1] - placed[j][1]) >= .092 * .52).toBe(true);
    }
  });
  it('starts options throughout the scan with independent durations and rejections', () => {
    const seen = new Map<number, ReturnType<typeof footstepCandidates>[number]>();
    for (let age = 0; age < 2; age += .01) {
      for (const candidate of footstepCandidates({ ...decision, age })) seen.set(candidate.index, candidate);
    }
    const alternatives = [...seen.values()].filter(c => c.index !== 0);
    expect(alternatives.length).toBeGreaterThanOrEqual(3);
    expect(new Set(alternatives.map(c => c.launch)).size).toBe(alternatives.length);
    expect(new Set(alternatives.map(c => c.blueDuration)).size).toBe(alternatives.length);
    expect(new Set(alternatives.map(c => c.rejectAt)).size).toBe(alternatives.length);
    expect(Math.max(...alternatives.map(c => c.launch))).toBeGreaterThan(1);
    expect(alternatives.some(c => c.rejectAt < 2)).toBe(true);
    expect(alternatives.some(c => c.rejectAt > 2)).toBe(true);
    expect(seen.get(0)?.rejected).toBe(false);
  });
  it('fades pending blue choices after lock without turning them red', () => {
    const atLock = footstepCandidates({ ...decision, age: 2, locked: true });
    expect(atLock.some(c => !c.rejected)).toBe(true);
    const fading = footstepCandidates({ ...decision, age: 2.1, locked: true });
    for (const candidate of fading) {
      expect(candidate.rejected).toBe(candidate.rejectAt < 2);
      expect(candidate.opacity).toBeLessThanOrEqual(.5 + 1e-8);
    }
    expect(fading.some(c => c.index === 0)).toBe(false);
    expect(footstepCandidates({ ...decision, age: 2.21, locked: true })).toEqual([]);
  });
});
