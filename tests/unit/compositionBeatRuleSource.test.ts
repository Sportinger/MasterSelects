import { describe, expect, it } from 'vitest';
import type { BeatDistributeRule, BeatRuleSource } from '../../src/types/compositionGraph';
import type { NodeGraph } from '../../src/types/nodeGraph';
import {
  beatRuleSourceRevision, listBeatRuleSourceOptions, mapBeatGridToTimeline, resolveBeatRuleSource,
} from '../../src/services/compositionRules/beatRuleSource';
import { projectCompositionRules } from '../../src/services/nodeGraph/composition/compositionGraphRules';
import { compositionNode, compositionPort } from '../../src/services/nodeGraph/composition/compositionGraphPrimitives';
import { createDefaultTempoMap } from '../../src/timeline/tempo/rulerDefaults';
import { createMockClip } from '../helpers/mockData';

const beats = [0, 2, 3, 6, 8, 9, NaN, Infinity].map(time => ({ time }));
const source: BeatRuleSource = { kind: 'clip-beat-grid', clipId: 'audio', artifactId: 'grid', provenance: 'source' };
const audioClip = () => createMockClip({ id: 'audio', source: { type: 'audio' }, startTime: 10,
  inPoint: 2, outPoint: 8, duration: 6, audioState: { sourceAnalysisRefs: { beatGridId: 'grid' } } });

describe('beat source timeline mapping', () => {
  it('applies trim and placement, dropping out-of-window and nonfinite beats without mutation', () => {
    const clip = audioClip();
    const before = JSON.stringify({ clip, beats });
    expect(mapBeatGridToTimeline(beats, clip)).toEqual([10, 11, 14, 16]);
    expect(JSON.stringify({ clip, beats })).toBe(before);
  });

  it('maps 2x speed and reverse into sorted timeline seconds, including window endpoints', () => {
    const clip = { ...audioClip(), speed: 2, duration: 3 };
    expect(mapBeatGridToTimeline(beats, clip)).toEqual([10, 10.5, 12, 13]);
    expect(mapBeatGridToTimeline(beats, { ...clip, reversed: true })).toEqual([10, 11, 12.5, 13]);
    expect(mapBeatGridToTimeline(beats, { ...clip, speed: -2 })).toEqual([10, 11, 12.5, 13]);
  });

  it('places processed grids in clip-local seconds without re-applying trim, speed or reverse', () => {
    const clip = { ...audioClip(), speed: 2, duration: 3, reversed: true };
    expect(mapBeatGridToTimeline([{ time: 0 }, { time: 1.5 }, { time: 3 }, { time: 3.5 }, { time: -1 }], clip, 'processed'))
      .toEqual([10, 11.5, 13]);
  });

  it.each([
    { startTime: 11 }, { duration: 3 }, { inPoint: 3 }, { outPoint: 7 }, { speed: 2 }, { reversed: true },
  ])('invalidates source revision for timing changes: %j', patch => {
    const clip = audioClip();
    const state = { clips: [clip], tempoMap: createDefaultTempoMap(), duration: 30 };
    expect(beatRuleSourceRevision(source, { ...state, clips: [{ ...clip, ...patch }] }))
      .not.toBe(beatRuleSourceRevision(source, state));
  });

  it('invalidates a replaced artifact and reports a missing source', () => {
    const clip = audioClip();
    const state = { clips: [clip], tempoMap: createDefaultTempoMap(), duration: 30 };
    expect(beatRuleSourceRevision(source, { ...state, clips: [{ ...clip, audioState: { sourceAnalysisRefs: { beatGridId: 'new' } } }] }))
      .not.toBe(beatRuleSourceRevision(source, state));
    expect(beatRuleSourceRevision(source, { ...state, clips: [] })).toBeUndefined();
  });

  it('keeps a tempo-map revision when the composition grows, e.g. because the rule itself extended it', async () => {
    const tempo: BeatRuleSource = { kind: 'tempo-map' };
    const state = { clips: [], tempoMap: createDefaultTempoMap(), duration: 70 };
    expect(beatRuleSourceRevision(tempo, { ...state, duration: 83 })).toBe(beatRuleSourceRevision(tempo, state));
    const resolved = await resolveBeatRuleSource(tempo, state);
    expect(resolved!.beatSnapshot.at(-1)!).toBeGreaterThanOrEqual(599);
  });
});

describe('beat source choices', () => {
  it('includes tempo, analyzed provenance, and unanalyzed audio and embedded video candidates', () => {
    const clip = audioClip();
    clip.audioState = { ...clip.audioState, processedAnalysisRefs: { beatGridId: 'processed' } };
    const options = listBeatRuleSourceOptions([clip,
      createMockClip({ id: 'new-audio', source: { type: 'audio' } }),
      createMockClip({ id: 'video', source: { type: 'video' } }),
      createMockClip({ id: 'image', source: { type: 'image' } }),
    ]);
    expect(options.map(option => option.value)).toEqual(['tempo-map', 'audio:source', 'audio:processed', 'new-audio:unanalyzed', 'video:unanalyzed']);
    expect(options[1]).toMatchObject({ label: 'Clip audio (source)', source });
    expect(options[2]).toMatchObject({ label: 'Clip audio (processed)', source: { provenance: 'processed', artifactId: 'processed' } });
    expect(options[3]).toMatchObject({ label: 'Clip new-audio (not analyzed)', analysisClipId: 'new-audio' });
    expect(options[3].source).toBeUndefined();
  });

  it.each(['both', 'video', 'audio'])('prefers linked audio for %s-direction links', direction => {
    const audio = { ...audioClip(), audioState: undefined, linkedClipId: direction === 'video' ? undefined : 'video' };
    const video = createMockClip({ id: 'video', source: { type: 'video' }, linkedClipId: direction === 'audio' ? undefined : 'audio' });
    expect(listBeatRuleSourceOptions([video, audio]).map(option => option.value)).toEqual(['tempo-map', 'audio:unanalyzed']);
  });

  it('turns an unanalyzed draft into a usable artifact option from updated refs', () => {
    const clip = { ...audioClip(), audioState: undefined };
    expect(listBeatRuleSourceOptions([clip])[1].source).toBeUndefined();
    expect(listBeatRuleSourceOptions([audioClip()])[1].source).toEqual(source);
  });
});

describe('beat analysis source cable', () => {
  function project(paired: boolean, missing = false) {
    const rule: BeatDistributeRule = { id: 'rule', operator: 'beat-distribute', schemaVersion: 1, label: 'Beats',
      source, sourceRevision: 'revision', beatSnapshot: [10, 11], status: { state: 'ok' }, members: [],
      params: { firstBeat: 0, beatStep: 1, offset: 0, targetTrackId: 'track' } };
    const clip = compositionNode(undefined, 'clip-node', 'Audio source',
      { kind: 'composition-clip', clipId: paired ? 'video' : 'audio', ...(paired ? { linkedClipId: 'audio' } : {}) },
      { x: 0, y: 0 }, [], [compositionPort(paired ? 'audio' : 'clip', 'Audio', 'clip', 'output')]);
    const graph: NodeGraph = { id: 'graph', owner: { kind: 'composition', id: 'comp', name: 'Comp' }, nodes: missing ? [] : [clip], edges: [] };
    projectCompositionRules({ compositionId: 'comp', compositionName: 'Comp', clips: [], tracks: [], media: new Map(),
      state: { version: 1, rules: { rule } } }, graph, new Map(missing ? [] : [['audio', clip]]), 0);
    return graph;
  }

  it.each([false, true])('connects the correct clip participant with a read-only reference (paired=%s)', paired => {
    const graph = project(paired);
    const beatSource = graph.nodes.find(node => node.binding?.kind === 'composition-beat-source')!;
    expect(beatSource.inputs).toContainEqual(expect.objectContaining({ id: 'audio', label: 'Audio', type: 'clip', metadata: expect.objectContaining({ readOnly: true }) }));
    expect(graph.edges.filter(edge => edge.toNodeId === beatSource.id)).toEqual([expect.objectContaining({
      fromNodeId: 'clip-node', fromPortId: paired ? 'audio' : 'clip', toPortId: 'audio', type: 'clip', readOnly: true,
    })]);
  });

  it('keeps a missing source stale without inventing a source node or cable', () => {
    const graph = project(false, true);
    const beatSource = graph.nodes.find(node => node.binding?.kind === 'composition-beat-source')!;
    expect(beatSource.summary?.badges).toContain('Stale');
    expect(graph.edges.filter(edge => edge.toNodeId === beatSource.id)).toEqual([]);
  });
});
