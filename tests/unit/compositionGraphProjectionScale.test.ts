import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { buildCompositionGraph, compositionGroupId } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { createCompositionReferenceTimeline } from '../../src/services/nodeGraph/composition/compositionReferenceTimeline';
import { getCompositionGraphMetrics, measureCompositionProjection, resetCompositionGraphMetrics } from '../../src/services/nodeGraph/composition/compositionGraphMetrics';

describe('composition projection reference scale', () => {
  it.each([30, 300, 1000])('projects %i video/audio pairs deterministically with collapsed chains', clipCount => {
    const fixture = createCompositionReferenceTimeline({ clipCount, trackCount: 3, mediaDuration: 60 });
    const before = JSON.stringify(fixture);
    expect(fixture).toEqual(createCompositionReferenceTimeline({ clipCount, trackCount: 3, mediaDuration: 60 }));
    expect(fixture.clips).toHaveLength(clipCount * 2);
    expect(fixture.clips.every(clip => !('file' in clip))).toBe(true);
    expect(fixture.clips.some(clip => clip.speed !== 1)).toBe(true);
    expect(fixture.clips.some(clip => clip.reversed)).toBe(true);
    expect(fixture.transitionCount).toBe(3);
    const input = {
      compositionId: 'reference', compositionName: 'Reference', tracks: fixture.tracks,
      // Projection never reads File. Keep this test-only cast here, not in the pure fixture.
      clips: fixture.clips as TimelineClip[], duration: fixture.duration,
      media: new Map([[fixture.mediaFileId, { id: fixture.mediaFileId, name: 'Reference video',
        duration: fixture.mediaDuration, kind: 'video' as const }]]),
    };
    const start = performance.now();
    const graph = buildCompositionGraph(input);
    const elapsedMs = performance.now() - start;
    console.log(`[composition projection] video=${clipCount} records=${fixture.clips.length} nodes=${graph.nodes.length} edges=${graph.edges.length} ms=${elapsedMs.toFixed(2)}`);
    expect(graph).toEqual(buildCompositionGraph(input));
    expect(JSON.stringify(fixture)).toBe(before);
    expect(graph.groups?.find(group => group.id === compositionGroupId.media())).toMatchObject({
      collapsed: true, collapsedByDefault: true, nodeIds: [`${compositionGroupId.media()}:proxy`],
    });
    expect(graph.groups?.filter(group => group.id !== compositionGroupId.media()).every(group => group.collapsed)).toBe(true);
    expect(graph.nodes.filter(node => node.binding?.kind === 'composition-clip')).toHaveLength(clipCount);
    expect([...(graph.expandedNodes ?? []), ...graph.nodes].some(node => node.binding?.kind === 'composition-time-chain')).toBe(false);
    // One card per pair, all tracks, one media proxy, three buses/output, plus recipe transitions.
    expect(graph.nodes.length).toBe(clipCount + fixture.tracks.length + 4 + fixture.transitionCount);
    expect(graph.edges.length).toBeLessThanOrEqual(3 * clipCount + fixture.tracks.length + 3 * fixture.transitionCount + 2);
    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(graph.nodes.length);
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    for (const edge of graph.edges) {
      expect(nodes.has(edge.fromNodeId)).toBe(true);
      expect(nodes.has(edge.toNodeId)).toBe(true);
      expect(nodes.get(edge.fromNodeId)?.binding?.kind === 'composition-clip'
        && nodes.get(edge.toNodeId)?.binding?.kind === 'composition-clip').toBe(false);
    }
    if (clipCount === 1000) expect(elapsedMs).toBeLessThan(2000);
  });

  it('records successful projections without changing results, exposing mutable counters, or rebuilding on reads', () => {
    resetCompositionGraphMetrics();
    const graph = { nodes: [{}], edges: [{}, {}] };
    expect(measureCompositionProjection(() => graph)).toBe(graph);
    const snapshot = getCompositionGraphMetrics();
    expect(snapshot).toMatchObject({ count: 1, nodeCount: 1, edgeCount: 2 });
    expect(snapshot.lastMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.totalMs).toBe(snapshot.lastMs);
    snapshot.count = 99;
    expect(getCompositionGraphMetrics().count).toBe(1);
    expect(() => measureCompositionProjection(() => { throw new Error('failed projection'); })).toThrow('failed projection');
    expect(getCompositionGraphMetrics().count).toBe(1);
    resetCompositionGraphMetrics();
    expect(getCompositionGraphMetrics()).toEqual({ count: 0, lastMs: 0, totalMs: 0, maxMs: 0, nodeCount: 0, edgeCount: 0 });
  });
});
