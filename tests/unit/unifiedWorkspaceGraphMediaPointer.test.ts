import { describe, expect, it } from 'vitest';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildCompositionGraph, compositionGroupId } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { getNodeSummarySegments } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { hitSummarySegment } from '../../src/components/panels/nodes/canvas/hitSummarySegment';

describe('media segment pointer geometry at readable workspace zoom', () => {
  for (const zoom of [0.4, 0.5, 0.6]) it(`hits each linked-pair segment at ${zoom * 100}%`, () => {
    const clips = Array.from({ length: 4 }, (_, i) => [
      createMockClip({ id: `v${i}`, trackId: 'v', mediaFileId: 'm', linkedClipId: `a${i}`, inPoint: i * 5, outPoint: (i + 1) * 5 }),
      createMockClip({ id: `a${i}`, trackId: 'a', mediaFileId: 'm', linkedClipId: `v${i}`, inPoint: i * 5, outPoint: (i + 1) * 5, source: { type: 'audio' } }),
    ]).flat();
    const graph = buildCompositionGraph({ compositionId: 'main', compositionName: 'Main', clips,
      tracks: [createMockTrack({ id: 'v', type: 'video' }), createMockTrack({ id: 'a', type: 'audio' })],
      media: new Map([['m', { id: 'm', name: 'Source', duration: 20, kind: 'video' }]]),
      state: { version: 1, layout: { nodes: {}, collapsed: { [compositionGroupId.media()]: false } } } });
    const media = graph.nodes.find(node => node.binding?.kind === 'composition-media')!;
    const segments = getNodeSummarySegments(media)!.segments;
    expect(segments).toHaveLength(4);
    for (const segment of segments) {
      const screenX = 100 + (media.layout.x + segment.x + segment.width / 2) * zoom;
      const screenY = 80 + (media.layout.y + segment.y + segment.height / 2) * zoom;
      const hit = hitSummarySegment(graph.nodes, (screenX - 100) / zoom, (screenY - 80) / zoom, zoom);
      expect(hit?.segmentId).toBe(segment.id);
      expect(hit?.nodeId).toBe(media.id);
      expect(graph.nodes.some(node => node.binding?.kind === 'composition-clip' && node.binding.clipId === segment.clipId)).toBe(true);
    }
  });
});
