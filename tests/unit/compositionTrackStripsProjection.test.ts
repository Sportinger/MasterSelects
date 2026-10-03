import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildCompositionGraph, compositionNodeId } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { compositionTrackStripView, trackStripGroupId } from '../../src/services/nodeGraph/composition/compositionTrackStripView';
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

  it('projects transition duration/offset as a strip marker, revealing only the selected transition and its A/B links', () => {
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
    expect(compositionTrackStripView(graph).nodes.some(node => node.id === 'comp:transition:join')).toBe(false);
    const selected = compositionTrackStripView(graph, { selectedNodeIds: new Set(['comp:transition:join']) });
    expect(selected.nodes.some(node => node.id === 'comp:transition:join')).toBe(true);
    expect(selected.edges.filter(edge => edge.toNodeId === 'comp:transition:join').map(edge => edge.toPortId).toSorted()).toEqual(['a', 'b']);
    expect(selected.nodes.find(node => node.id === 'comp:transition:join')!.binding).not.toHaveProperty('compositionId');
    // A picked transition stays shown with both clips while another node is grabbed in the graph.
    const kept = compositionTrackStripView(graph, { revealedNodeIds: new Set(['comp:transition:join']), selectedNodeIds: new Set(['comp:clip:left']) });
    expect(kept.nodes.some(node => node.id === 'comp:transition:join')).toBe(true);
    expect(kept.edges.filter(edge => edge.toNodeId === 'comp:transition:join')).toHaveLength(2);
  });

  it('keeps stable full-projection IDs, folds clips by default, reveals expanded or timeline-picked references but never on graph selection', () => {
    const graph = baseline(30), before = JSON.stringify(graph);
    const folded = compositionTrackStripView(graph);
    expect(folded.nodes.filter(node => node.binding?.kind === 'composition-clip')).toHaveLength(0);
    const fullIds = new Set(graph.nodes.map(node => node.id));
    expect(folded.expandedNodes!.filter(node => node.binding?.kind === 'composition-clip')).toHaveLength(30);
    // Selecting a clip highlights its segment only: no card appears, so the overview does not shift.
    for (const options of [
      { selectedClipIds: new Set(['reference-audio-0']) },
      { selectedNodeIds: new Set(['comp:clip:reference-video-0']) },
    ]) {
      const view = compositionTrackStripView(graph, options);
      expect(view.nodes.find(node => node.id === 'comp:clip:reference-video-0')).toBeUndefined();
      expect(view.nodes.map(node => node.layout)).toEqual(folded.nodes.map(node => node.layout));
    }
    // A timeline pick reveals the card (linked audio pick reveals its video reference too).
    for (const revealedClipIds of [new Set(['reference-video-0']), new Set(['reference-audio-0'])]) {
      expect(compositionTrackStripView(graph, { revealedClipIds }).nodes.find(node => node.id === 'comp:clip:reference-video-0')).toBeDefined();
    }
    const expanded = compositionTrackStripView(graph, { expandedClipIds: new Set(['reference-video-0']) });
    expect(expanded.nodes.find(node => node.id === 'comp:clip:reference-video-0')).toBeDefined();
    expect(expanded.nodes.every(node => fullIds.has(node.id))).toBe(true);
    const selectedSegment = compositionTrackStripView(graph, { selectedClipIds: new Set(['reference-video-0']) }).nodes
      .find(node => node.id === 'comp:track:reference-video-track-0')!.summary!.segments!.find(segment => segment.clipId === 'reference-video-0');
    expect(selectedSegment?.selected).toBe(true);
    const expandedTrack = compositionTrackStripView(graph, { collapsed: { [trackStripGroupId('reference-video-track-0')]: false } });
    expect(expandedTrack.nodes.filter(node => node.binding?.kind === 'composition-clip')).toHaveLength(10);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('stacks an open Slice → Speed → Place chain in its clip column without overlap and keeps buses to the right', () => {
    const fixture = createCompositionReferenceTimeline({ clipCount: 30, trackCount: 3 });
    const clips = fixture.clips as TimelineClip[];
    const videoIds = clips.filter(clip => clip.source?.type === 'video').map(clip => clip.id);
    const graph = buildCompositionGraph({ compositionId: 'baseline', compositionName: 'Baseline', clips, tracks: fixture.tracks,
      duration: fixture.duration, media: new Map(), expandedTimeChains: new Set(videoIds) });
    const view = compositionTrackStripView(graph, { revealedClipIds: new Set(videoIds), nodeHeight: getNodeHeight });
    const cards = view.nodes.filter(node => node.binding?.kind === 'composition-clip' || node.binding?.kind === 'composition-time-chain');
    expect(view.nodes.filter(node => node.binding?.kind === 'composition-time-chain')).toHaveLength(videoIds.length * 3);
    // Real painted card sizes: the earlier fixed 110 px assumption hid a vertical overlap.
    const box = (node: typeof cards[number]) => ({ x: node.layout.x, y: node.layout.y, w: getNodeWidth(node), h: getNodeHeight(node) });
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = box(cards[i]), b = box(cards[j]);
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${cards[i].id} overlaps ${cards[j].id}`).toBe(false);
    }
    for (const id of videoIds) {
      const column = ['slice', 'speed', 'place'].map(stage => view.nodes.find(node => node.id === compositionNodeId.timeChain(id, stage as 'slice'))!);
      const reference = view.nodes.find(node => node.id === compositionNodeId.clip(id))!;
      expect(new Set([reference, ...column].map(node => node.layout.x)).size).toBe(1);
      expect(column.map(node => node.layout.y)).toEqual(column.map(node => node.layout.y).toSorted((a, b) => a - b));
    }
    // No card reaches into the next track's strip.
    for (const card of cards) {
      const below = view.nodes.filter(node => node.binding?.kind === 'composition-track' && node.layout.y > card.layout.y)
        .map(node => node.layout.y);
      if (below.length) expect(card.layout.y + getNodeHeight(card)).toBeLessThanOrEqual(Math.min(...below));
    }
    const rightmost = Math.max(...cards.map(node => node.layout.x + getNodeWidth(node)));
    for (const id of [compositionNodeId.videoStack(), compositionNodeId.audioMaster()]) {
      expect(view.nodes.find(node => node.id === id)!.layout.x).toBeGreaterThan(rightmost);
    }
  });

  it.each([30, 300, 1000])('bundles %i pairs with linear projection visits and constant visible topology', count => {
    const graph = baseline(count), counters = { nodes: 0, edges: 0, segments: 0 };
    const view = compositionTrackStripView(graph, { counters });
    expect(view.nodes).toHaveLength(10);
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
