import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import type { NodeGraph } from '../../src/types/nodeGraph';
import {
  buildCompositionGraph, compositionGroupId, compositionMediaId,
  type CompositionGraphMediaInfo, type CompositionGraphProjectionInput,
} from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import {
  getNodeHeight, getNodePortStartY, getNodeSummarySegments,
} from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const piece = (id: string, inPoint: number, outPoint: number, overrides: Partial<TimelineClip> = {}) =>
  createMockClip({ id, name: `Piece ${id}`, mediaFileId: 'shared', trackId: 'video',
    inPoint, outPoint, duration: outPoint - inPoint, ...overrides });

function input(clips: TimelineClip[], duration?: number, collapsed = false): CompositionGraphProjectionInput {
  return {
    compositionId: 'main', compositionName: 'Main', clips,
    tracks: [createMockTrack({ id: 'video' }), createMockTrack({ id: 'audio', type: 'audio' })],
    media: new Map(clips.map(clip => {
      const id = compositionMediaId(clip);
      const info: CompositionGraphMediaInfo = { id, name: `Source ${id}`, duration,
        kind: clip.isComposition ? 'composition' : 'video' };
      return [id, info];
    })),
    state: { version: 1, layout: { nodes: {}, collapsed: { [compositionGroupId.media()]: collapsed } } },
  };
}

function mediaNode(graph: NodeGraph, mediaId = 'shared') {
  return [...graph.nodes, ...(graph.expandedNodes ?? [])].find(node =>
    node.binding?.kind === 'composition-media' && node.binding.mediaId === mediaId)!;
}

describe('composition media source segments', () => {
  it('projects trimmed source time independently of speed, reverse and timeline placement', () => {
    const clips = [piece('trim', 10, 30, { startTime: 120 }),
      piece('reverse', 10, 30, { reversed: true, speed: 2, duration: 10 }),
      piece('negative', 10, 30, { speed: -0.5, duration: 40 })];
    const original = input(clips, 100);
    const before = JSON.stringify(original);
    const node = mediaNode(buildCompositionGraph(original));
    expect(node.summary?.segments).toHaveLength(3);
    for (const segment of node.summary!.segments!) {
      expect(segment.start).toBe(0.1);
      expect(segment.end).toBe(0.3);
      expect(segment.id).toBe(`piece:${segment.clipId}`);
      expect(segment.label).toBe(`Piece ${segment.clipId} (10-30 s)`);
    }
    expect(JSON.stringify(original)).toBe(before);
  });

  it('clamps source boundaries and keeps zero-length ranges finite', () => {
    const node = mediaNode(buildCompositionGraph(input([
      piece('outside', -10, 120), piece('end', 100, 100), piece('invalid', NaN, Infinity),
    ], 100)));
    const ranges = new Map(node.summary!.segments!.map(segment => [segment.clipId, segment]));
    expect(ranges.get('outside')).toMatchObject({ start: 0, end: 1 });
    expect(ranges.get('end')).toMatchObject({ start: 1, end: 1 });
    expect(ranges.get('invalid')).toMatchObject({ start: 0, end: 0 });
  });

  it('assigns overlapping intervals separate lanes and reuses lanes at touching edges', () => {
    const node = mediaNode(buildCompositionGraph(input([
      piece('c', 20, 40), piece('b', 10, 30), piece('a', 0, 20),
    ], 100)));
    expect(node.summary!.segments!.map(({ clipId, lane }) => [clipId, lane])).toEqual([
      ['a', 0], ['b', 1], ['c', 0],
    ]);
  });

  it.each([undefined, 0, -10, NaN, Infinity])('uses maximum outPoint when duration is unknown (%s)', duration => {
    const node = mediaNode(buildCompositionGraph(input([piece('early', 5, 10), piece('late', 15, 20)], duration)));
    expect(node.summary?.segments).toMatchObject([
      { clipId: 'early', start: 0.25, end: 0.5 }, { clipId: 'late', start: 0.75, end: 1 },
    ]);
    expect(node.params?.duration).toBeUndefined();
    expect(node.summary?.badges).toContain('Unknown length');
  });

  it('uses known natural duration even if only a later piece has metadata', () => {
    const node = mediaNode(buildCompositionGraph(input([
      piece('early', 5, 10), piece('late', 15, 20, { source: { type: 'video', naturalDuration: 40 } }),
    ])));
    expect(node.params?.duration).toBe(40);
    expect(node.summary!.segments![1]).toMatchObject({ start: 0.375, end: 0.5 });
    const empty = mediaNode(buildCompositionGraph(input([piece('empty', 0, 0)])));
    expect(empty.summary!.segments![0]).toMatchObject({ start: 0, end: 0 });
  });

  it('treats a nested composition as its own media source', () => {
    const node = mediaNode(buildCompositionGraph(input([
      piece('nested-a', 4, 12, { isComposition: true, compositionId: 'nested' }),
      piece('nested-b', 12, 20, { isComposition: true, compositionId: 'nested', reversed: true }),
    ], 40)), 'comp:nested');
    expect(node.summary?.segments).toMatchObject([
      { clipId: 'nested-a', start: 0.1, end: 0.3 }, { clipId: 'nested-b', start: 0.3, end: 0.5 },
    ]);
  });

  it('deduplicates linked audio while preserving the bundled media cable', () => {
    const graph = buildCompositionGraph(input([
      piece('v', 2, 6, { linkedClipId: 'a' }),
      piece('a', 2, 6, { linkedClipId: 'v', trackId: 'audio', source: { type: 'audio' } }),
    ], 10));
    const node = mediaNode(graph);
    expect(node.summary?.segments?.map(segment => segment.clipId).toSorted()).toEqual(['v']);
    expect(node.outputs).toHaveLength(1);
    expect(graph.nodes.find(candidate => candidate.binding?.kind === 'composition-clip')?.binding)
      .toMatchObject({ clipId: 'v', linkedClipId: 'a' });
  });

  it('keeps the collapsed Media proxy and its hidden cards free of segment work', () => {
    const graph = buildCompositionGraph(input([piece('a', 0, 10)], 100, true));
    expect(graph.nodes.find(node => node.id === `${compositionGroupId.media()}:proxy`)?.summary?.segments).toBeUndefined();
    expect(mediaNode(graph).summary?.segments).toBeUndefined();
  });

  it('caps full source lanes at four and makes every overflow piece an independent compact target', () => {
    const node = mediaNode(buildCompositionGraph(input(Array.from({ length: 15 }, (_, i) => piece(String(i), 0, 100)), 100)));
    const bar = getNodeSummarySegments(node)!;
    expect(bar.lanes).toBe(4);
    expect(bar.segments.filter(segment => segment.compact)).toHaveLength(11);
    expect(bar.segments).toHaveLength(15);
    expect(getNodeSummarySegments(node)).toBe(bar);
    expect(getNodePortStartY(node)).toBeGreaterThan(bar.y + bar.height);
    expect(getNodeHeight(node)).toBeGreaterThan(getNodePortStartY(node) + node.outputs.length * 32);
    for (const [index, segment] of bar.segments.entries()) {
      expect(segment.width).toBeGreaterThanOrEqual(12);
      for (const other of bar.segments.slice(index + 1)) {
        expect(segment.x + segment.width <= other.x || other.x + other.width <= segment.x
          || segment.y + segment.height <= other.y || other.y + other.height <= segment.y).toBe(true);
      }
    }
  });

  it('keeps tiny adjacent cuts individually hittable, including the source end', () => {
    const node = mediaNode(buildCompositionGraph(input([
      piece('tiny-a', 0, 0.01), piece('tiny-b', 0.01, 0.02), piece('end', 100, 100),
    ], 100)));
    const bar = getNodeSummarySegments(node)!;
    expect(bar.segments[0].y).not.toBe(bar.segments[1].y);
    for (const segment of bar.segments) {
      expect(segment.width).toBeGreaterThanOrEqual(12);
      expect(segment.x + segment.width).toBeLessThanOrEqual(bar.x + bar.width);
      expect(segment.rangeX + segment.rangeWidth).toBeLessThanOrEqual(bar.x + bar.width);
    }
  });
});
