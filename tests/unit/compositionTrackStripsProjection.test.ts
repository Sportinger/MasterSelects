import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildCompositionGraph, compositionNodeId } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { LANE_PITCH, LANE_WIDTH, compositionTrackStripView, describeClipLane, trackStripGroupId } from '../../src/services/nodeGraph/composition/compositionTrackStripView';
import { createCompositionReferenceTimeline } from '../../src/services/nodeGraph/composition/compositionReferenceTimeline';
import { getNodeHeight, getNodeSummarySegments, getNodeWidth, getPortCenter, getGraphBounds } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { nodeDomVisible } from '../../src/components/panels/nodes/canvas/nodeDomVisibility';
import { hitSummarySegment } from '../../src/components/panels/nodes/canvas/hitSummarySegment';

const baseline = (count: number) => {
  const fixture = createCompositionReferenceTimeline({ clipCount: count, trackCount: 3 });
  return buildCompositionGraph({ compositionId: 'baseline', compositionName: 'Baseline', clips: fixture.clips as TimelineClip[],
    tracks: fixture.tracks, duration: fixture.duration, media: new Map() });
};
const tracks = [createMockTrack({ id: 'a', type: 'audio' }), createMockTrack({ id: 'v', type: 'video' }), createMockTrack({ id: 'v2', type: 'video' })];
const project = (clips: TimelineClip[]) => buildCompositionGraph({ compositionId: 'main', compositionName: 'Main', clips, tracks, duration: 20, media: new Map() });

describe('composition track strips', () => {
  it('shares origin and scale in timeline order, with exact time geometry and simultaneous alignment', () => {
    const graph = project([createMockClip({ id: 'v', trackId: 'v', startTime: 4, duration: 3 }),
      createMockClip({ id: 'a', trackId: 'a', startTime: 4, duration: 6 })]);
    const strips = graph.nodes.filter(node => node.binding?.kind === 'composition-track');
    expect(new Set(strips.map(node => node.layout.x)).size).toBe(1);
    expect(new Set(strips.map(node => node.summary!.timeAxis!.pixelsPerSecond)).size).toBe(1);
    expect(strips.toSorted((a, b) => a.layout.y - b.layout.y).map(node => node.id)).toEqual(['comp:track:v', 'comp:track:v2', 'comp:track:a']);
    const segments = strips.flatMap(node => getNodeSummarySegments(node)!.segments);
    expect(segments[0].x).toBe(segments[1].x);
    for (const node of strips) for (const segment of getNodeSummarySegments(node)!.segments) {
      const duration = segment.clipId === 'v' ? 3 : 6;
      expect(segment.x - 10).toBeCloseTo(4 * node.summary!.timeAxis!.pixelsPerSecond);
      expect(segment.width).toBeCloseTo(duration * node.summary!.timeAxis!.pixelsPerSecond);
    }
    const strip = strips[0];
    expect(getNodeWidth(strip)).toBe(1620);
    expect(getPortCenter(strip, 'output', 'output').x).toBe(strip.layout.x + 1620 - 12.5);
    expect(nodeDomVisible(strip, { left: strip.layout.x + 1500, right: strip.layout.x + 1600, top: 0, bottom: 2000 })).toBe(true);
    expect(getGraphBounds({ ...graph, nodes: [strip] }).right).toBe(strip.layout.x + 1620);
  });

  it('projects transition duration/offset as a strip marker and as a lane row between its two clips', () => {
    const graph = project([
      createMockClip({ id: 'left', trackId: 'v', startTime: 0, duration: 5, transitionOut: { id: 'join', type: 'crossfade', duration: 2, offset: 0.5, linkedClipId: 'right' } }),
      createMockClip({ id: 'right', trackId: 'v', startTime: 5, duration: 5 }),
    ]);
    const strip = graph.nodes.find(node => node.id === 'comp:track:v')!;
    const marker = getNodeSummarySegments(strip)!.segments.find(segment => segment.transitionId)!;
    // The axis spans the used content (not the composition length); read its scale from the strip.
    const pps = strip.summary!.timeAxis!.pixelsPerSecond;
    expect(marker.x - 10).toBeCloseTo(4.5 * pps);
    expect(marker.width).toBeCloseTo(2 * pps);
    expect(hitSummarySegment([strip], strip.layout.x + marker.x + marker.width / 2, strip.layout.y + marker.y + marker.height / 2, 0.4)?.segmentId).toBe(marker.id);
    const view = compositionTrackStripView(graph, { nodeHeight: getNodeHeight });
    const row = (id: string) => view.nodes.find(node => node.id === id)!;
    const join = row('comp:transition:join');
    expect(join.summary?.laneRow).toMatchObject({ tone: 'transition', index: '⇄' });
    expect(join.summary!.laneRow!.text).toContain('2.0 s between clips 1 → 2');
    expect(join.binding).not.toHaveProperty('compositionId');
    // Lane order reads like the timeline: outgoing clip, transition, incoming clip.
    expect([row('comp:clip:left'), join, row('comp:clip:right')].map(node => node.layout.y))
      .toEqual([0, 1, 2].map(index => row('comp:clip:left').layout.y + index * LANE_PITCH));
    // Rows carry no cables; the strip shows the timing.
    expect(view.edges.some(edge => [edge.fromNodeId, edge.toNodeId].includes(join.id))).toBe(false);
  });

  it('keeps stable full-projection IDs and shows every clip as a lane row; selection never moves rows', () => {
    const graph = baseline(30), before = JSON.stringify(graph);
    const view = compositionTrackStripView(graph, { nodeHeight: getNodeHeight });
    const lanes = view.nodes.filter(node => node.binding?.kind === 'composition-clip');
    expect(lanes).toHaveLength(30);
    expect(lanes.every(node => node.summary?.laneRow && !node.inputs.length && !node.outputs.length)).toBe(true);
    expect(lanes.every(node => getNodeHeight(node) === 40 && getNodeWidth(node) === LANE_WIDTH)).toBe(true);
    const fullIds = new Set(graph.nodes.map(node => node.id));
    expect(view.nodes.every(node => fullIds.has(node.id))).toBe(true);
    for (const options of [{ selectedClipIds: new Set(['reference-audio-0']) }, { selectedNodeIds: new Set(['comp:clip:reference-video-0']) }]) {
      expect(compositionTrackStripView(graph, { ...options, nodeHeight: getNodeHeight }).nodes.map(node => node.layout)).toEqual(view.nodes.map(node => node.layout));
    }
    // An open lane keeps its seams for the embedded processing graph (a linked audio id opens its video lane).
    const expanded = compositionTrackStripView(graph, { expandedClipIds: new Set(['reference-audio-0']), nodeHeight: getNodeHeight });
    expect(expanded.nodes.find(node => node.id === 'comp:clip:reference-video-0')!.outputs.length).toBeGreaterThan(0);
    const selectedSegment = compositionTrackStripView(graph, { selectedClipIds: new Set(['reference-video-0']) }).nodes
      .find(node => node.id === 'comp:track:reference-video-track-0')!.summary!.segments!.find(segment => segment.clipId === 'reference-video-0');
    expect(selectedSegment?.selected).toBe(true);
    // Folding a strip hides its lanes.
    const folded = compositionTrackStripView(graph, { collapsed: { [trackStripGroupId('reference-video-track-0')]: true } });
    expect(folded.nodes.filter(node => node.binding?.kind === 'composition-clip')).toHaveLength(20);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('stacks lanes under their strip in time order without overlap and names source, range, effects and target', () => {
    const fixture = createCompositionReferenceTimeline({ clipCount: 30, trackCount: 3 });
    const clips = fixture.clips as TimelineClip[];
    const graph = buildCompositionGraph({ compositionId: 'baseline', compositionName: 'Baseline', clips, tracks: fixture.tracks,
      duration: fixture.duration, media: new Map() });
    const view = compositionTrackStripView(graph, { nodeHeight: getNodeHeight });
    const strips = view.nodes.filter(node => node.binding?.kind === 'composition-track').toSorted((a, b) => a.layout.y - b.layout.y);
    const cards = view.nodes.filter(node => node.binding?.kind === 'composition-clip' || node.binding?.kind === 'composition-track');
    const box = (node: typeof cards[number]) => ({ x: node.layout.x, y: node.layout.y, w: getNodeWidth(node), h: getNodeHeight(node) });
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = box(cards[i]), b = box(cards[j]);
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${cards[i].id} overlaps ${cards[j].id}`).toBe(false);
    }
    strips.forEach((strip, index) => {
      const next = strips[index + 1]?.layout.y ?? Infinity;
      const lanes = view.nodes.filter(node => node.binding?.kind === 'composition-clip' && compositionNodeId.track(String(node.params?.trackId)) === strip.id);
      expect(lanes.every(node => node.layout.y > strip.layout.y && node.layout.y + 40 <= next)).toBe(true);
      expect(new Set(lanes.map(node => node.layout.x))).toEqual(new Set(lanes.length ? [strip.layout.x + 10] : []));
      const ordered = lanes.toSorted((a, b) => a.layout.y - b.layout.y);
      expect(ordered.map(node => Number(node.params?.startTime))).toEqual(ordered.map(node => Number(node.params?.startTime)).toSorted((a, b) => a - b));
      expect(ordered.map(node => node.summary!.laneRow!.index)).toEqual(ordered.map((_, i) => String(i + 1)));
    });
    const clip = clips.find(candidate => candidate.source?.type === 'video')!;
    const lane = view.nodes.find(node => node.id === compositionNodeId.clip(clip.id))!;
    const trackLabel = (id: string) => strips.find(strip => strip.id === compositionNodeId.track(id))!.label;
    expect(lane.summary!.laneRow!.text).toBe(`${clip.name} ▸ ${clip.inPoint.toFixed(1)}–${clip.outPoint.toFixed(1)} s · 1× ▸ no effects ▸ `
      + `${trackLabel(clip.trackId)} @ ${clip.startTime.toFixed(1)} s`
      + (lane.params?.audioTrackId ? ` + audio ▸ ${trackLabel(String(lane.params.audioTrackId))} @ ${clip.startTime.toFixed(1)} s` : ''));
    const rightmost = Math.max(...cards.filter(node => node.summary?.laneRow).map(node => node.layout.x + getNodeWidth(node)));
    for (const id of [compositionNodeId.videoStack(), compositionNodeId.audioMaster()]) {
      expect(view.nodes.find(node => node.id === id)!.layout.x).toBeGreaterThan(rightmost);
    }
  });

  it.each([30, 300, 1000])('bundles %i pairs with linear projection visits and constant cable topology', count => {
    const graph = baseline(count), counters = { nodes: 0, edges: 0, segments: 0 };
    const view = compositionTrackStripView(graph, { counters });
    // One row per clip pair and per transition (3); rows carry no cables, so the cable count stays constant.
    expect(view.nodes).toHaveLength(13 + count);
    expect(view.edges).toHaveLength(14);
    expect(counters).toEqual({ nodes: graph.nodes.length, edges: graph.edges.length, segments: count * 2 + 3 });
    expect(counters.nodes + counters.edges + counters.segments).toBeLessThan(count * 7 + 40);
    for (const edge of view.edges) {
      expect(view.nodes.find(node => node.id === edge.fromNodeId)?.outputs.some(port => port.id === edge.fromPortId)).toBe(true);
      expect(view.nodes.find(node => node.id === edge.toNodeId)?.inputs.some(port => port.id === edge.toPortId)).toBe(true);
    }
    if (count === 30) {
      expect(graph.nodes).toHaveLength(43); expect(graph.edges).toHaveLength(107);
      console.log(`S1 30-pair / 3-track-pair fixture: ${graph.nodes.length} nodes / ${graph.edges.length} links -> ${view.nodes.length} visible nodes / ${view.edges.length} links`);
    }
  });

  it('names retime, reverse, effects and masks in the lane text', () => {
    const graph = project([
      createMockClip({ id: 'looped', trackId: 'v', startTime: 1, duration: 2, inPoint: 3, outPoint: 5, timeRemap: { kind: 'loop' } as TimelineClip['timeRemap'],
        effects: [{ id: 'e1' }, { id: 'e2' }] as TimelineClip['effects'], masks: [{ id: 'm1' }] as TimelineClip['masks'] }),
      createMockClip({ id: 'back', trackId: 'v2', startTime: 4, duration: 2, reversed: true }),
    ]);
    const name = (id: string) => graph.nodes.find(node => node.id === `comp:track:${id}`)?.label ?? id;
    const text = (id: string) => describeClipLane(graph.nodes.find(node => node.id === `comp:clip:${id}`)!, name);
    expect(text('looped')).toContain('3.0–5.0 s · Loop ▸ 2 effects · 1 mask ▸ ');
    expect(text('back')).toContain(' · reverse ▸ no effects ▸ ');
  });

  it('keeps independent video/audio source bundles on the correct tracks', () => {
    const graph = project([
      createMockClip({ id: 'v', trackId: 'v', mediaFileId: 'video', linkedClipId: 'a' }),
      createMockClip({ id: 'a', trackId: 'a', mediaFileId: 'audio', linkedClipId: 'v', source: { type: 'audio' } }),
    ]);
    const view = compositionTrackStripView(graph);
    const mediaLinks = view.edges.filter(edge => edge.fromNodeId === 'comp:media:proxy');
    expect(mediaLinks.map(edge => [edge.fromPortId, edge.toNodeId])).toEqual([
      ['media:video', compositionNodeId.track('v')], ['media:audio', compositionNodeId.track('a')],
    ]);
  });
  it('bundles rule relationships per member track and highlights rule/correction segments', () => {
    const clips = [createMockClip({ id: 'one', trackId: 'v', startTime: 0, duration: 2 }),
      createMockClip({ id: 'two', trackId: 'v', startTime: 2, duration: 2 })];
    const graph = buildCompositionGraph({ compositionId: 'rules', compositionName: 'Rules', clips, tracks, media: new Map(),
      state: { version: 1, rules: { beat: { id: 'beat', schemaVersion: 1, operator: 'beat-distribute', label: 'Beat rule',
        source: { kind: 'tempo-map' }, sourceRevision: 'r1', beatSnapshot: [0, 2], status: { state: 'ok' },
        params: { firstBeat: 0, beatStep: 1, offset: 0, targetTrackId: 'v' },
        members: [{ memberId: 'm1', clipId: 'one', correction: { startOffset: 0.1 } }, { memberId: 'm2', clipId: 'two' }] } } } });
    const view = compositionTrackStripView(graph), track = view.nodes.find(node => node.id === 'comp:track:v')!;
    expect(track.summary!.segments!.every(segment => segment.highlighted)).toBe(true);
    expect(track.summary!.segments![0].badges).toContain('Correction');
    expect(view.edges.filter(edge => edge.fromNodeId === 'comp:rule:beat' && edge.toNodeId === track.id)).toHaveLength(1);
    expect(view.edges.filter(edge => edge.toNodeId === 'comp:rule:beat' && edge.fromNodeId === track.id)).toHaveLength(1);
    expect(view.edges.some(edge => edge.fromNodeId.startsWith('comp:clip:') || edge.toNodeId.startsWith('comp:clip:'))).toBe(false);
  });

});
