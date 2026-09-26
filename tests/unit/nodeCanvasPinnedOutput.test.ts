import { afterEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { handleCreateImageNodeGraph, handleEditOperatorGraph } from '../../src/services/aiTools/handlers/operatorGraph';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { reconcileCanvasPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import type { NodeCanvasPlacement } from '../../src/types/nodeGraph';

const initial = useTimelineStore.getState();
const clipId = 'pinned-output';
const chain: Array<[string, string, Record<string, string>?]> = [
  ['split', 'vector.split.rgba', { image: 'frame' }],
  ['keyColor', 'values.color'],
  ['keyRgb', 'convert.vec4-to-rgb', { value: 'keyColor' }],
  ['delta', 'math.subtract.rgb', { a: 'split.rgb', b: 'keyRgb' }],
  ['exponent', 'values.number'],
  ['exponentRgb', 'convert.scalar-to-rgb', { value: 'exponent' }],
  ['squared', 'math.power.rgb', { a: 'delta', b: 'exponentRgb' }],
  ['distance', 'color.luminance-rec709.rgb', { rgb: 'squared' }],
  ['threshold', 'values.number'],
  ['softness', 'values.number'],
  ['low', 'math.subtract.scalar', { a: 'threshold', b: 'softness' }],
  ['high', 'math.add.scalar', { a: 'threshold', b: 'softness' }],
  ['matte', 'math.smoothstep.scalar', { edge0: 'low', edge1: 'high', value: 'distance' }],
  ['alpha', 'convert.scalar-to-alpha', { value: 'matte' }],
  ['keyed', 'vector.combine.rgba', { rgb: 'split.rgb', alpha: 'alpha' }],
];

describe('pinned clip output during effect growth', () => {
  afterEach(() => useTimelineStore.setState(initial));

  it('moves a pinned output aside instead of pushing the re-flowing effect frame below it', async () => {
    const clip = createMockClip({ id: clipId, source: { type: 'video' }, effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
    const effectId = ((await handleCreateImageNodeGraph({ clipId })).data as { effectId: string }).effectId;
    let placement: NodeCanvasPlacement | undefined;
    const layout = () => {
      const current = useTimelineStore.getState().clips[0];
      const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current, [current]);
      placement = reconcileCanvasPlacement(graph, placement);
      const members = graph.groups!.find(group => group.id === `effect:${effectId}`)!.nodeIds.map(id => placement!.nodes[id]);
      return { top: Math.min(...members.map(point => point.y)), right: Math.max(...members.map(point => point.x)), output: placement.nodes.output };
    };
    layout();
    // A manual drag pins the clip output; Arrange releases only the effect's own cards.
    placement = { ...placement!, pinned: { output: true } };
    for (const [nodeId, operatorId, inputs] of chain) {
      expect((await handleEditOperatorGraph({ clipId, effectId, action: 'add', nodeId, operatorId, ...(inputs ? { inputs } : {}) })).success).toBe(true);
      layout();
    }
    const before = layout();
    // Wiring the output reflows the frame without adding a card, so the pin is not released by a reflow.
    expect((await handleEditOperatorGraph({ clipId, effectId, action: 'connect', fromNodeId: 'keyed', toNodeId: 'output' })).success).toBe(true);
    const after = layout();
    expect(after.top).toBe(before.top);
    expect(after.output.x).toBeGreaterThan(after.right);
  });
});
