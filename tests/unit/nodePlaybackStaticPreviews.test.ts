import { describe, expect, it } from 'vitest';
import { playbackStaticNodes } from '../../src/components/panels/nodes/previews/playbackStaticPreviews';
import type { NodeGraphEdge, NodeGraphNode } from '../../src/types/nodeGraph';

const node = (id: string, operatorId: string, extra: Partial<NodeGraphNode> = {}): NodeGraphNode => ({
  id, operatorId, kind: 'effect', runtime: 'builtin', label: id, inputs: [], outputs: [], layout: { x: 0, y: 0 },
  binding: { kind: 'effect-operator', effectId: 'fx', nodeId: id, operator: operatorId }, ...extra,
} as NodeGraphNode);
const edge = (from: string, to: string): NodeGraphEdge => ({ id: `${from}-${to}`, fromNodeId: from, fromPortId: 'value', toNodeId: to, toPortId: 'a', type: 'number' } as NodeGraphEdge);

describe('playback static node readouts', () => {
  const nodes = [node('freq', 'values.number'), node('amp', 'values.number'), node('scaled', 'math.multiply.scalar'),
    node('frame', 'image.frame'), node('pixel', 'convert.image-to-vec4'), node('mixed', 'math.add.scalar')];
  const edges = [edge('freq', 'scaled'), edge('amp', 'scaled'), edge('frame', 'pixel'), edge('pixel', 'mixed'), edge('scaled', 'mixed')];

  it('freezes pure math fed only by constants and keeps media-dependent readouts live', () => {
    expect([...playbackStaticNodes(nodes, edges, new Set())].toSorted()).toEqual(['amp', 'freq', 'scaled']);
  });

  it('treats keyframed values and everything downstream of them as live', () => {
    expect([...playbackStaticNodes(nodes, edges, new Set(['effect.fx.freq_value']))]).toEqual(['amp']);
  });

  it('treats values as live when a keyframed param of their effect cannot be matched to a node', () => {
    expect(playbackStaticNodes(nodes, edges, new Set(['effect.fx.gain'])).size).toBe(0);
    expect([...playbackStaticNodes(nodes, edges, new Set(['effect.other.gain']))].toSorted()).toEqual(['amp', 'freq', 'scaled']);
  });

  it('keeps animated and cyclic nodes live', () => {
    const animated = [node('a', 'values.number', { animation: { clipId: 'c', channels: [{ nodeId: 'a', channelId: 'v', property: 'opacity' }] } })];
    expect(playbackStaticNodes(animated, [], new Set()).size).toBe(0);
    const cycle = [node('x', 'math.add.scalar'), node('y', 'math.add.scalar')];
    expect(playbackStaticNodes(cycle, [edge('x', 'y'), edge('y', 'x')], new Set()).size).toBe(0);
  });
});
