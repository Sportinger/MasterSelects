import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeatDistributeRule } from '../../src/types/compositionGraph';
import { createClipAudioAnalysisJobState } from '../../src/services/audio/clipAudioAnalysisJobs';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createDefaultTempoMap } from '../../src/timeline/tempo/rulerDefaults';
import { beatRuleSourceRevision } from '../../src/services/compositionRules/beatRuleSource';
import { projectCompositionGraphView, COMPOSITION_GRAPH_MAX_CHARACTERS,
  type CompositionGraphViewInput } from '../../src/services/aiTools/handlers/compositionGraphView';
import { compositionRuleHandlers } from '../../src/services/aiTools/handlers/compositionRules';
import { compositionRuleToolDefinitions } from '../../src/services/aiTools/definitions/compositionRules';
import { checkToolAccess, getToolPolicy } from '../../src/services/aiTools/policy';
import { ATOMIC_EDITOR_TOOL_DEFINITIONS } from '../../src/services/aiTools/editorToolCatalog';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(), media: vi.fn(),
  generateBeatOnsetForClip: vi.fn(),
  createBeatRule: vi.fn(), updateBeatRuleParams: vi.fn(), setBeatRuleSource: vi.fn(), refreshBeatRuleSource: vi.fn(),
  reorderBeatRuleMembers: vi.fn(), resetBeatRuleMemberCorrection: vi.fn(), releaseBeatRuleMember: vi.fn(), materializeBeatRule: vi.fn(),
}));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: mocks.timeline } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: mocks.media } }));
vi.mock('../../src/stores/timeline/revisionMiddleware', () => ({ getTimelineRevision: () => 7 }));
vi.mock('../../src/services/compositionRules/beatRuleActions', () => mocks);

const actions = ['createBeatRule', 'updateBeatRuleParams', 'setBeatRuleSource', 'refreshBeatRuleSource',
  'reorderBeatRuleMembers', 'resetBeatRuleMemberCorrection', 'releaseBeatRuleMember', 'materializeBeatRule'] as const;
const success = { success: true, ruleId: 'rule', changedClipIds: ['a'], conflicts: [], warnings: [] };
let state: CompositionGraphViewInput;

function fixture(): CompositionGraphViewInput {
  const input: CompositionGraphViewInput = {
    clips: [createMockClip({ id: 'b', name: 'Second', startTime: 5, duration: 1, trackId: 'v', mediaFileId: 'media' }),
      createMockClip({ id: 'a', name: 'First', startTime: 0, duration: 1, trackId: 'v', mediaFileId: 'media' })],
    tracks: [createMockTrack({ id: 'v' })], tempoMap: createDefaultTempoMap(), duration: 20,
    compositionId: 'comp', media: new Map([['media', { name: 'Source', duration: 30 }]]),
  };
  const rule: BeatDistributeRule = {
    id: 'rule', operator: 'beat-distribute', schemaVersion: 1, label: 'Beat arrangement',
    members: [{ memberId: 'ma', clipId: 'a' }, { memberId: 'mb', clipId: 'b', correction: { startOffset: 0.25 } }],
    params: { firstBeat: 0, beatStep: 1, offset: 0, targetTrackId: 'v' }, source: { kind: 'tempo-map' },
    beatSnapshot: [0, 1, 2], sourceRevision: beatRuleSourceRevision({ kind: 'tempo-map' }, input)!, status: { state: 'ok' },
  };
  input.compositionGraph = { version: 1, rules: { rule } };
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  state = fixture();
  mocks.timeline.mockImplementation(() => ({ ...state, generateBeatOnsetForClip: mocks.generateBeatOnsetForClip }));
  mocks.generateBeatOnsetForClip.mockResolvedValue(undefined);
  mocks.media.mockReturnValue({ files: [{ id: 'media', name: 'Source', duration: 30 }], compositions: [], activeCompositionId: 'comp' });
  for (const action of actions) mocks[action].mockReturnValue(success);
});

describe('bounded composition graph inspection', () => {
  it('is deterministic, uses timeline IDs, and leaves the entire input untouched', () => {
    const before = JSON.stringify(state);
    const view = projectCompositionGraphView(state);
    expect(view).toEqual(projectCompositionGraphView(state));
    expect(view.clips.map(clip => clip.id)).toEqual(['a', 'b']);
    expect(view.clips[1]).toMatchObject({ ruleId: 'rule', memberId: 'mb', correction: { startOffset: 0.25 } });
    expect(view.media).toEqual([{ mediaId: 'media', name: 'Source', duration: 30, pieceCount: 2 }]);
    expect(view.rules[0]).toMatchObject({ beatCount: 3, stale: false });
    expect(view.rules[0]).not.toHaveProperty('beatSnapshot');
    view.clips[1].correction!.startOffset = 99;
    expect(JSON.stringify(state)).toBe(before);
  });

  it('shows recipe transitions without materializing any project state', async () => {
    state.compositionGraph = undefined;
    state.clips[1].transitionOut = { id: 'transition', type: 'crossfade', duration: 0.5, linkedClipId: 'b' };
    const before = JSON.stringify(state);
    const response = await compositionRuleHandlers.getCompositionGraph({});
    expect(response).toMatchObject({ success: true, data: { transitions: [{ id: 'transition', hasComposition: false,
      outgoingClipId: 'a', incomingClipId: 'b' }], rules: [] } });
    expect(JSON.stringify(state)).toBe(before);
    for (const action of actions) expect(mocks[action]).not.toHaveBeenCalled();
  });

  it('filters half-open overlapping ranges and reports clip truncation and complete media piece counts', () => {
    const limited = projectCompositionGraphView(state, { limit: 1 });
    expect(limited.clips.map(clip => clip.id)).toEqual(['a']);
    expect(limited.truncation).toMatchObject({ truncated: true, omitted: { clips: 1 }, matchingClipCount: 2 });
    expect(limited.media[0].pieceCount).toBe(2);
    expect(projectCompositionGraphView(state, { timeRange: { start: 1, end: 6 } }).clips.map(clip => clip.id)).toEqual(['b']);
    expect(projectCompositionGraphView(state, { trackIds: ['absent'] }).clips).toEqual([]);
  });

  it('bounds clips, members, unknown rule payloads, and the complete serialized response', () => {
    state.clips = Array.from({ length: 1100 }, (_, index) => createMockClip({ id: `clip-${index}`, name: 'x'.repeat(2000), startTime: index }));
    const rule = state.compositionGraph!.rules!.rule as BeatDistributeRule;
    rule.members = state.clips.map(clip => ({ memberId: `member-${clip.id}`, clipId: clip.id }));
    state.compositionGraph!.rules!.future = { id: 'future', operator: 'future', schemaVersion: 9, payload: 'secret'.repeat(100000) };
    const defaultView = projectCompositionGraphView(state);
    expect(defaultView.clips.length).toBeLessThanOrEqual(200);
    const view = projectCompositionGraphView(state, { limit: 1000 });
    expect(view.clips.length).toBeLessThanOrEqual(1000);
    expect(view.truncation.truncated).toBe(true);
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(COMPOSITION_GRAPH_MAX_CHARACTERS);
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(view.rules.reduce((total, item) => total + (item.members?.length ?? 0), 0)).toBeLessThanOrEqual(1000);
  });

  it('calculates staleness without changing the persisted status', () => {
    state.tempoMap = { events: state.tempoMap.events.map(event => ({ ...event, bpm: event.bpm + 1 })) };
    expect(projectCompositionGraphView(state).rules[0].stale).toBe(true);
    expect((state.compositionGraph!.rules!.rule as BeatDistributeRule).status.state).toBe('ok');
  });

  it('projects compact beat availability and active progress without artifact IDs or state changes', () => {
    const clip = state.clips[0];
    clip.audioState = { sourceAnalysisRefs: { beatGridId: 'source-grid' }, processedAnalysisRefs: { beatGridId: 'processed-grid' } };
    clip.audioAnalysisJob = { ...createClipAudioAnalysisJobState({ kind: 'beat-onset-analysis', label: 'Beat/Onset',
      artifactKinds: ['beat-grid', 'onset-map'], processed: true }), phase: 'analyzing', progress: 45 };
    const before = JSON.stringify(state);
    const view = projectCompositionGraphView(state);
    expect(view.clips.find(item => item.id === 'b')?.beatGrid).toEqual({ source: true, processed: true, analyzing: 45 });
    expect(view.clips.find(item => item.id === 'a')?.beatGrid).toEqual({});
    expect(JSON.stringify(view.clips)).not.toContain('source-grid');
    expect(JSON.stringify(state)).toBe(before);
    for (const phase of ['complete', 'cancelled', 'failed'] as const) {
      clip.audioAnalysisJob.phase = phase;
      expect(projectCompositionGraphView(state).clips.find(item => item.id === 'b')?.beatGrid).not.toHaveProperty('analyzing');
    }
    clip.audioAnalysisJob.phase = 'analyzing';
    clip.audioAnalysisJob.kind = 'audio-intelligence';
    expect(projectCompositionGraphView(state).clips.find(item => item.id === 'b')?.beatGrid).not.toHaveProperty('analyzing');
    clip.audioAnalysisJob.kind = 'beat-onset-analysis';
    clip.audioAnalysisJob.progress = 0;
    expect(projectCompositionGraphView(state).clips.find(item => item.id === 'b')?.beatGrid.analyzing).toBe(0);
  });

  it('rejects invalid bounds, extra keys, and nonfinite times', async () => {
    for (const args of [{ limit: 1001 }, { limit: NaN }, { timeRange: { start: 2, end: 1 } },
      { timeRange: { start: 0, end: Infinity } }, { trackIds: ['v', 'v'] }, { materialize: true }]) {
      expect((await compositionRuleHandlers.getCompositionGraph(args)).success).toBe(false);
    }
  });
});

describe('atomic beat rule tool delegation', () => {
  it('creates from ordered IDs and resolves the current artifact identity internally', async () => {
    state.clips[0].audioState = { sourceAnalysisRefs: { beatGridId: 'artifact' } } as NonNullable<typeof state.clips[0]['audioState']>;
    const args = { clipIds: ['a'], source: { kind: 'clip-beat-grid', clipId: 'b', provenance: 'source' }, params: { offset: 0.5 } };
    const result = await compositionRuleHandlers.createBeatRule(args);
    expect(result).toMatchObject({ success: true, data: { ...success, stateRevisionBefore: 7, stateRevisionAfter: 7 } });
    expect(mocks.createBeatRule).toHaveBeenCalledExactlyOnceWith({ ...args, label: undefined,
      source: { ...args.source, artifactId: 'artifact' } });
  });

  it.each([
    [{ params: { beatStep: 2 } }, 'updateBeatRuleParams', { beatStep: 2 }],
    [{ memberOrder: ['mb', 'ma'] }, 'reorderBeatRuleMembers', ['mb', 'ma']],
    [{ source: { kind: 'tempo-map' } }, 'setBeatRuleSource', { kind: 'tempo-map' }],
    [{ refreshSource: true }, 'refreshBeatRuleSource', undefined],
    [{ resetCorrection: 'mb' }, 'resetBeatRuleMemberCorrection', 'mb'],
  ] as const)('delegates exactly one update %j', async (change, action, value) => {
    expect((await compositionRuleHandlers.updateBeatRule({ ruleId: 'rule', ...change })).success).toBe(true);
    expect(mocks[action]).toHaveBeenCalledTimes(1);
    expect(mocks[action].mock.calls[0]).toEqual(value === undefined ? ['rule'] : ['rule', value]);
    for (const other of actions.filter(name => name !== action)) expect(mocks[other]).not.toHaveBeenCalled();
  });

  it('rejects ambiguous or malformed changes before any action', async () => {
    for (const change of [{}, { params: { offset: 1 }, refreshSource: true }, { params: {} },
      { params: { beatStep: 0 } }, { params: { offset: Infinity } }, { refreshSource: false },
      { memberOrder: ['ma', 'ma'] }, { source: { kind: 'tempo-map', extra: true } }]) {
      expect((await compositionRuleHandlers.updateBeatRule({ ruleId: 'rule', ...change })).success).toBe(false);
    }
    for (const action of actions) expect(mocks[action]).not.toHaveBeenCalled();
  });

  it('releases one member and materializes through the shared actions', async () => {
    await compositionRuleHandlers.releaseBeatRuleMember({ ruleId: 'rule', memberId: 'mb' });
    await compositionRuleHandlers.materializeBeatRule({ ruleId: 'rule' });
    expect(mocks.releaseBeatRuleMember).toHaveBeenCalledExactlyOnceWith('rule', 'mb');
    expect(mocks.materializeBeatRule).toHaveBeenCalledExactlyOnceWith('rule');
    expect((await compositionRuleHandlers.releaseBeatRuleMember({ ruleId: 'rule', memberIds: ['ma', 'mb'] })).success).toBe(false);
  });

  it('preserves structured domain conflicts for every mutation family', async () => {
    const conflict = { success: false, ruleId: 'rule', changedClipIds: [],
      conflicts: [{ code: 'locked', message: 'Track locked.', clipId: 'a', memberId: 'ma' },
        { code: 'overlap', message: 'Clips overlap.', clipId: 'b', memberId: 'mb' }], warnings: ['Preserved.'] };
    for (const action of actions) mocks[action].mockReturnValue(conflict);
    const results = await Promise.all([
      compositionRuleHandlers.createBeatRule({ clipIds: ['a'], source: { kind: 'tempo-map' } }),
      compositionRuleHandlers.updateBeatRule({ ruleId: 'rule', params: { offset: 1 } }),
      compositionRuleHandlers.releaseBeatRuleMember({ ruleId: 'rule', memberId: 'ma' }),
      compositionRuleHandlers.materializeBeatRule({ ruleId: 'rule' }),
    ]);
    for (const result of results) expect(result).toMatchObject({ success: false,
      error: 'locked: Track locked. | overlap: Clips overlap.', data: conflict });
  });
});

describe('background clip beat analysis', () => {
  it('dispatches audio analysis without waiting for completion and returns preexisting artifact IDs', async () => {
    state.clips[0].source = { type: 'audio' };
    state.clips[0].audioState = { sourceAnalysisRefs: { beatGridId: 'source-grid' }, processedAnalysisRefs: { beatGridId: 'processed-grid' } };
    let complete!: () => void;
    mocks.generateBeatOnsetForClip.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    const result = await compositionRuleHandlers.startClipBeatAnalysis({ clipId: 'b', force: true });
    expect(mocks.generateBeatOnsetForClip).toHaveBeenCalledExactlyOnceWith('b', { force: true });
    expect(result).toEqual({ success: true, data: { started: true, clipId: 'b', analyzedClipId: 'b',
      alreadyAvailable: { source: 'source-grid', processed: 'processed-grid' } } });
    complete();
  });

  it.each(['video', 'audio'] as const)('targets linked audio with a link stored on the %s clip', async (linkOwner) => {
    state.clips[0].source = { type: 'video' };
    state.clips[1].source = { type: 'audio' };
    if (linkOwner === 'video') state.clips[0].linkedClipId = 'a';
    else state.clips[1].linkedClipId = 'b';
    const result = await compositionRuleHandlers.startClipBeatAnalysis({ clipId: 'b' });
    expect(mocks.generateBeatOnsetForClip).toHaveBeenCalledExactlyOnceWith('a', { force: undefined });
    expect(result).toMatchObject({ success: true, data: { started: true, clipId: 'b', analyzedClipId: 'a',
      message: expect.stringContaining('linked audio') } });
  });

  it('rejects missing, non-audio and invalid requests without dispatch', async () => {
    state.clips[0].source = { type: 'video' };
    state.clips[0].linkedClipId = 'a'; // The linked clip has no audio source.
    for (const args of [{ clipId: 'absent' }, { clipId: 'a' }, { clipId: 'b' },
      { clipId: 'b', force: 'yes' }, { clipId: 'b', extra: true }, {}]) {
      expect((await compositionRuleHandlers.startClipBeatAnalysis(args)).success).toBe(false);
    }
    expect(mocks.generateBeatOnsetForClip).not.toHaveBeenCalled();
  });

  it('handles background rejection without turning dispatch into an awaited analysis', async () => {
    state.clips[0].source = { type: 'audio' };
    mocks.generateBeatOnsetForClip.mockRejectedValue(new Error('Analysis failed'));
    expect((await compositionRuleHandlers.startClipBeatAnalysis({ clipId: 'b', force: false })).success).toBe(true);
    expect(mocks.generateBeatOnsetForClip).toHaveBeenCalledExactlyOnceWith('b', { force: false });
  });
});

describe('composition graph tool policy and atomic catalog', () => {
  it('registers all six definitions as ordinary atomic tools with no sensitive or filesystem access', () => {
    for (const definition of compositionRuleToolDefinitions) {
      const name = definition.function.name;
      expect(ATOMIC_EDITOR_TOOL_DEFINITIONS.some(tool => tool.function.name === name)).toBe(true);
      expect(compositionRuleHandlers).toHaveProperty(name);
      expect(getToolPolicy(name)).toMatchObject({ readOnly: name === 'getCompositionGraph',
        riskLevel: ['getCompositionGraph', 'startClipBeatAnalysis'].includes(name) ? 'low' : 'medium', localFileAccess: false, sensitiveDataAccess: false,
        allowedCallers: expect.arrayContaining(['chat', 'devBridge', 'kernel', 'console', 'internal']) });
      expect(checkToolAccess(name, 'kernel').allowed).toBe(true);
      expect(checkToolAccess(name, 'chat', { executionMode: 'read-only' }).allowed).toBe(name === 'getCompositionGraph');
      expect(definition.function.parameters.additionalProperties).toBe(false);
    }
  });
});
