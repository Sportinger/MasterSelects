import { afterEach, describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import type { NodeGraph } from '../../src/types/nodeGraph';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { chainCutEffect, detachChainEffect } from '../../src/services/nodeGraph/clipEffectChain';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const imageGraph = (extra: EffectOperatorGraph['nodes'] = []): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image',
  nodes: [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} }, { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }, ...extra],
  edges: [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' }],
  layout: { frame: { x: 0, y: 0 }, output: { x: 900, y: 0 } },
});

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }));

describe('free-standing nodes', () => {
  it('lets loose nodes stay unwired without pausing an image graph', () => {
    const graph = imageGraph([{ id: 'loose', operator: 'math.add.scalar', operatorVersion: 1, bindings: {} }]);
    graph.layout.loose = { x: 400, y: 400 };
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), [0.1, 0.2, 0.3, 1])).toEqual([0.1, 0.2, 0.3, 1]);
  });

  it('still requires every input on the path to the output', () => {
    const graph = imageGraph([{ id: 'sample', operator: 'image.sample', operatorVersion: 1, bindings: {} }]);
    graph.edges = [{ id: 'sample-output', from: 'sample', output: 'image', to: 'output', input: 'image' }];
    graph.layout.sample = { x: 400, y: 0 };
    expect(validateEffectGraph(graph).join(' ')).toMatch(/connect/);
  });

  it('frees the effect a cut chain cable feeds, or the last one before the output', () => {
    const graph = { nodes: [
      { id: 'source', binding: { kind: 'clip-source' } }, { id: 'effect-a', binding: { kind: 'clip-effect', effectId: 'a' } },
      { id: 'effect-b', binding: { kind: 'clip-effect', effectId: 'b' } }, { id: 'output', binding: { kind: 'clip-output' } },
    ], edges: [], groups: [] } as unknown as NodeGraph;
    const cable = (from: string, to: string) => ({ id: `${from}-${to}`, fromNodeId: from, fromPortId: 'output', toNodeId: to, toPortId: 'input', type: 'texture' as const });
    expect(chainCutEffect(graph, cable('source', 'effect-a'))).toBe('a');
    expect(chainCutEffect(graph, cable('effect-a', 'effect-b'))).toBe('b');
    expect(chainCutEffect(graph, cable('effect-b', 'output'))).toBe('b');
    expect(chainCutEffect(graph, { ...cable('effect-a', 'effect-b'), type: 'number' as never })).toBeUndefined();
  });

  it('keeps a freed effect out of rendering until it is enabled again, which re-attaches it', () => {
    const clip = createMockClip({ id: 'c', effects: [{ id: 'a', type: 'invert', name: 'invert', enabled: true, params: {} }] });
    useTimelineStore.setState({ clips: [detachChainEffect(clip, 'a')], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
    expect(useTimelineStore.getState().clips[0].effects[0]).toMatchObject({ detached: true, enabled: false });
    useTimelineStore.getState().setClipEffectEnabled('c', 'a', false);
    expect(useTimelineStore.getState().clips[0].effects[0].detached).toBe(true);
    useTimelineStore.getState().setClipEffectEnabled('c', 'a', true);
    expect(useTimelineStore.getState().clips[0].effects[0]).toMatchObject({ enabled: true });
    expect(useTimelineStore.getState().clips[0].effects[0].detached).toBeUndefined();
  });
});
