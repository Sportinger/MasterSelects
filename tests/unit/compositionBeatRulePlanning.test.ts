import { describe, expect, it, vi } from 'vitest';
import type { BeatDistributeRule, BeatRuleSource } from '../../src/types/compositionGraph';
import { planBeatDistribution } from '../../src/services/compositionRules/beatRulePlanning';
import { resolveBeatRuleSource } from '../../src/services/compositionRules/beatRuleSource';
import { createDefaultTempoMap } from '../../src/timeline/tempo/rulerDefaults';
import { createMockClip, createMockTrack } from '../helpers/mockData';

vi.mock('../../src/services/audio/timelineBeatOnsetCache', () => ({
  loadTimelineBeatGrid: vi.fn(async (id: string) => id === 'missing' ? null : ({
    beats: [0, 2, 3, 6, 8, 9].map(time => ({ time, strength: 1, confidence: 1 })),
  })),
}));

const tracks = [createMockTrack({ id: 'v' }), createMockTrack({ id: 'other' }), createMockTrack({ id: 'a', type: 'audio' })];
const clips = () => [
  createMockClip({ id: 'one', trackId: 'v', startTime: 20, duration: 0.25, outPoint: 0.25 }),
  createMockClip({ id: 'two', trackId: 'v', startTime: 30, duration: 0.25, outPoint: 0.25 }),
];
function rule(): BeatDistributeRule {
  return {
    id: 'rule', operator: 'beat-distribute', schemaVersion: 1, label: 'Beats',
    members: [{ memberId: 'm1', clipId: 'one' }, { memberId: 'm2', clipId: 'two', correction: { startOffset: 0.2, trackId: 'other' } }],
    params: { firstBeat: 1, beatStep: 2, offset: 0.1, targetTrackId: 'v' },
    source: { kind: 'tempo-map' }, beatSnapshot: [0, 1, 2, 3, 4], sourceRevision: 'snapshot', status: { state: 'ok' },
  };
}

describe('pure beat distribution planning', () => {
  it('is deterministic, applies beat index, step, offset and member corrections without mutating input', () => {
    const definition = rule(), input = clips();
    const before = JSON.stringify({ definition, input });
    const first = planBeatDistribution(definition, input, tracks);
    expect(first).toEqual(planBeatDistribution(definition, input, tracks));
    expect(first.conflicts).toEqual([]);
    expect(first.placements[0]).toEqual({ memberId: 'm1', clipId: 'one', startTime: 1.1, trackId: 'v' });
    expect(first.placements[1].startTime).toBeCloseTo(3.3);
    expect(first.placements[1].trackId).toBe('other');
    expect(JSON.stringify({ definition, input })).toBe(before);
  });

  it('rejects too few beats without returning applicable placements', () => {
    const result = planBeatDistribution({ ...rule(), beatSnapshot: [0, 1] }, clips(), tracks);
    expect(result.placements).toEqual([]);
    expect(result.conflicts[0].code).toBe('too-few-beats');
  });

  it('rejects overlap with stationary clips and between members, but allows touching edges', () => {
    const definition = rule();
    definition.members[1].correction = undefined;
    const input = clips();
    expect(planBeatDistribution(definition, [...input, createMockClip({ id: 'obstacle', trackId: 'v', startTime: 1, duration: 1 })], tracks).conflicts.some(c => c.code === 'overlap')).toBe(true);
    input[0].duration = 3;
    expect(planBeatDistribution(definition, input, tracks).placements).toEqual([]);
    input[0].duration = 2;
    expect(planBeatDistribution(definition, input, tracks).conflicts).toEqual([]);
  });

  it('rejects transition members, missing members, locks, and invalid parameters', () => {
    const input = clips();
    input[0].transitionOut = { type: 'crossfade', duration: 1 } as NonNullable<typeof input[0]['transitionOut']>;
    expect(planBeatDistribution(rule(), input, tracks).conflicts.some(c => c.code === 'transition')).toBe(true);
    expect(planBeatDistribution(rule(), input.slice(1), tracks).conflicts.some(c => c.code === 'missing-clip')).toBe(true);
    expect(planBeatDistribution(rule(), clips(), tracks.map(t => ({ ...t, locked: true }))).conflicts.some(c => c.code === 'locked')).toBe(true);
    const locked = { ...rule(), status: { state: 'locked' as const, reason: 'New schema' } };
    expect(planBeatDistribution(locked, clips(), tracks).conflicts[0].code).toBe('rule-locked');
    const invalid = rule(); invalid.params.beatStep = 0;
    expect(planBeatDistribution(invalid, clips(), tracks).conflicts[0].code).toBe('invalid');
  });

  it('carries stable member identity and correction through reorder', () => {
    const original = rule(), member = original.members[1];
    const result = planBeatDistribution({ ...original, members: [member, original.members[0]] }, clips(), tracks);
    expect(result.conflicts).toEqual([]);
    expect(result.placements[0]).toMatchObject({ memberId: 'm2', clipId: 'two', trackId: 'other' });
    expect(result.placements[0].startTime).toBeCloseTo(1.3);
    expect(member.correction).toEqual({ startOffset: 0.2, trackId: 'other' });
  });

  it('checks linked audio tracks for locks, transitions and overlaps', () => {
    const input = clips(); input[0].linkedClipId = 'audio';
    const audio = createMockClip({ id: 'audio', trackId: 'a', source: { type: 'audio' }, startTime: 20, duration: 0.25 });
    const obstacle = createMockClip({ id: 'obstacle', trackId: 'a', startTime: 1, duration: 1 });
    expect(planBeatDistribution(rule(), [...input, audio, obstacle], tracks).conflicts.some(c => c.code === 'overlap' && c.clipId === 'audio')).toBe(true);
    expect(planBeatDistribution(rule(), [...input, audio], tracks.map(t => t.id === 'a' ? { ...t, locked: true } : t)).conflicts.some(c => c.code === 'locked')).toBe(true);
  });
});

describe('beat source resolution', () => {
  it('maps trimmed source beats through speed and reverse, excluding outside beats', async () => {
    const source: BeatRuleSource = { kind: 'clip-beat-grid', clipId: 'source', artifactId: 'grid', provenance: 'source' };
    const clip = createMockClip({ id: 'source', startTime: 10, inPoint: 2, outPoint: 8, duration: 3, speed: 2,
      audioState: { sourceAnalysisRefs: { beatGridId: 'grid' } } });
    const state = { clips: [clip], tempoMap: createDefaultTempoMap(), duration: 20 };
    expect((await resolveBeatRuleSource(source, state))?.beatSnapshot).toEqual([10, 10.5, 12, 13]);
    const reversed = await resolveBeatRuleSource(source, { ...state, clips: [{ ...clip, reversed: true }] });
    expect(reversed?.beatSnapshot).toEqual([10, 11, 12.5, 13]);
    expect(reversed?.sourceRevision).not.toBe((await resolveBeatRuleSource(source, state))?.sourceRevision);
  });

  it('uses tempo map beats beyond the composition length and detects missing source', async () => {
    const state = { clips: [], tempoMap: createDefaultTempoMap(), duration: 3 };
    const snapshot = (await resolveBeatRuleSource({ kind: 'tempo-map' }, state))?.beatSnapshot ?? [];
    expect(snapshot.slice(0, 4)).toEqual([0, 1, 2, 3]);
    // A rule may extend the composition; the snapshot keeps a generous horizon instead of stopping at its length.
    expect(snapshot.at(-1)).toBe(600);
    expect(await resolveBeatRuleSource({ kind: 'clip-beat-grid', clipId: 'missing', artifactId: 'missing', provenance: 'source' }, state)).toBeNull();
  });
});
