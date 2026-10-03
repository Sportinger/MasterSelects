import { describe, expect, it } from 'vitest';
import type { BeatDistributeRule } from '../../src/types/compositionGraph';
import type { TimelineStore } from '../../src/stores/timeline/types';
import { synchronizeCompositionRules } from '../../src/stores/timeline/compositionRuleSynchronization';
import { compositionRuleSplitWarning } from '../../src/services/compositionRules/beatRuleOwnership';
import { beatRuleSourceRevision } from '../../src/services/compositionRules/beatRuleSource';
import { createDefaultTempoMap } from '../../src/timeline/tempo/rulerDefaults';
import { createMockClip } from '../helpers/mockData';

function fixture() {
  const clips = [createMockClip({ id: 'one', trackId: 'v', startTime: 1 }), createMockClip({ id: 'two', trackId: 'v', startTime: 6 })];
  const state = { clips, duration: 30, tempoMap: createDefaultTempoMap() } as TimelineStore;
  const rule: BeatDistributeRule = {
    id: 'rule', operator: 'beat-distribute', schemaVersion: 1, label: 'Beats',
    members: [{ memberId: 'm1', clipId: 'one' }, { memberId: 'm2', clipId: 'two' }],
    params: { firstBeat: 0, beatStep: 1, offset: 1, targetTrackId: 'v' },
    beatSnapshot: [0, 5, 10], source: { kind: 'tempo-map' }, status: { state: 'ok' },
    sourceRevision: beatRuleSourceRevision({ kind: 'tempo-map' }, state)!,
  };
  state.compositionGraph = { version: 1, rules: { rule } };
  return { state, rule };
}
const nextRule = (patch: Partial<TimelineStore>) => patch.compositionGraph!.rules!.rule as BeatDistributeRule;

describe('composition rule ownership guard', () => {
  it('records a manual move as actual minus base time without mutating the old definition', () => {
    const { state, rule } = fixture();
    const clips = state.clips.map(clip => clip.id === 'one' ? { ...clip, startTime: 3.5 } : clip);
    const patch = synchronizeCompositionRules(state, { clips });
    expect(nextRule(patch).members[0].correction).toEqual({ startOffset: 2.5 });
    expect(rule.members[0].correction).toBeUndefined();
    expect(patch.clips).toBe(clips);
  });

  it('records track overrides and clears the override when returned to the target', () => {
    const { state } = fixture();
    const first = synchronizeCompositionRules(state, { clips: state.clips.map(clip => ({ ...clip, trackId: 'other' })) });
    expect(nextRule(first).members[0].correction).toEqual({ trackId: 'other' });
    const second = synchronizeCompositionRules({ ...state, ...first }, { clips: state.clips });
    expect(nextRule(second).members[0].correction).toEqual({});
  });

  it('removes deleted members and rebases surviving positions, retaining an empty rule', () => {
    const { state } = fixture();
    const patch = synchronizeCompositionRules(state, { clips: state.clips.slice(1) });
    expect(nextRule(patch).members).toEqual([{ memberId: 'm2', clipId: 'two', correction: { startOffset: 5 } }]);
    expect(nextRule(synchronizeCompositionRules(state, { clips: [] })).members).toEqual([]);
  });

  it('leaves explicitly supplied composition graph patches untouched', () => {
    const { state } = fixture();
    const patch = { clips: [], compositionGraph: { version: 1 as const } };
    expect(synchronizeCompositionRules(state, patch)).toBe(patch);
    const restore = { clips: [], compositionGraph: undefined };
    expect(synchronizeCompositionRules(state, restore)).toBe(restore);
  });

  it('returns the original patch immediately when no rules exist', () => {
    const patch = { clips: [] };
    expect(synchronizeCompositionRules({} as TimelineStore, patch)).toBe(patch);
    expect(synchronizeCompositionRules({ compositionGraph: { version: 1, rules: {} } } as TimelineStore, patch)).toBe(patch);
  });

  it('keeps locked and unknown rules verbatim', () => {
    const { state, rule } = fixture();
    rule.status = { state: 'locked', reason: 'Unsupported schema' };
    const unknown = { id: 'future', operator: 'future', schemaVersion: 2, members: [{ clipId: 'one' }] };
    state.compositionGraph!.rules!.future = unknown;
    const patch = { clips: [] };
    expect(synchronizeCompositionRules(state, patch)).toBe(patch);
  });

  it('marks changed sources stale without moving the stored projection', () => {
    const { state } = fixture();
    // Composition length alone is not part of the tempo-map identity; a tempo change is.
    expect(synchronizeCompositionRules(state, { duration: 50 }).compositionGraph).toBeUndefined();
    const tempoMap = { events: state.tempoMap.events.map(event => ({ ...event, bpm: event.bpm + 1 })) };
    const patch = synchronizeCompositionRules(state, { tempoMap });
    expect(nextRule(patch).status.state).toBe('stale');
    expect(patch.clips).toBeUndefined();
  });

  it('blocks split of a governed clip or its linked counterpart and does not govern copies', () => {
    const { state } = fixture();
    const linked = createMockClip({ id: 'audio', linkedClipId: 'one' });
    const copy = { ...state.clips[0], id: 'copy', linkedClipId: undefined };
    const clips = [...state.clips, linked, copy];
    expect(compositionRuleSplitWarning(state.compositionGraph, clips, ['one'])?.code).toBe('unsupported');
    expect(compositionRuleSplitWarning(state.compositionGraph, clips, ['audio'])?.message).toContain('Release');
    expect(compositionRuleSplitWarning(state.compositionGraph, clips, ['audio'], false)).toBeUndefined();
    expect(compositionRuleSplitWarning(state.compositionGraph, clips, ['copy'])).toBeUndefined();
    const patch = synchronizeCompositionRules(state, { clips });
    const retained = (patch.compositionGraph ?? state.compositionGraph)!.rules!.rule as BeatDistributeRule;
    expect(retained.members.map(member => member.clipId)).not.toContain('copy');
  });
});
