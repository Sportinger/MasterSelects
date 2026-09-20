import { describe, expect, it } from 'vitest';
import { spacePreviewNodes } from '../../src/components/panels/nodes/canvas/spacePreviewNodes';
import { getNodeHeight, NODE_WIDTH } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

describe('preview-aware node placement', () => {
  it.each([9 / 16, 16 / 9, 1])('keeps a newly created grid of portrait/landscape viewers disjoint (%f)', ratio => {
    const nodes = Array.from({ length: 128 }, (_, i) => ({ ...connectionFixture.nodes[0], id: String(i),
      layout: { x: (i % 16) * 160, y: Math.floor(i / 16) * 210 }, preview: { enabled: true, requested: true, key: String(i), aspectRatio: ratio } }));
    const placed = spacePreviewNodes(nodes);
    for (let i = 0; i < placed.length; i++) for (const other of placed.slice(i + 1)) {
      const a = placed[i];
      expect(a.layout.x + NODE_WIDTH <= other.layout.x || other.layout.x + NODE_WIDTH <= a.layout.x
        || a.layout.y + getNodeHeight(a) <= other.layout.y || other.layout.y + getNodeHeight(other) <= a.layout.y).toBe(true);
    }
    expect(Math.max(...placed.map(n => n.layout.x))).toBeLessThan(4000);
    expect(Math.max(...placed.map(n => n.layout.y))).toBeLessThan(4500);
    expect(nodes[1].layout.x).toBe(160);
    expect(spacePreviewNodes(placed)).toEqual(placed);
  });
  it('reserves space for new nodes while keeping a spaced manual layout unchanged', () => {
    const nodes = connectionFixture.nodes.map((node, i) => ({ ...node, layout: { x: i * 300, y: 0 } }));
    expect(spacePreviewNodes(nodes)).toEqual(nodes);
    const created = [...nodes, { ...nodes[0], id: 'new' }];
    expect(new Set(spacePreviewNodes(created).map(n => `${n.layout.x}:${n.layout.y}`)).size).toBe(created.length);
  });
});
