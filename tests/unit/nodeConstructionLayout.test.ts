import { describe, expect, it } from 'vitest';
import { flowGroupLayout } from '../../src/components/panels/nodes/canvas/flowGroupLayout';
import type { NodeGraphEdge } from '../../src/types/nodeGraph';

const blocks = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, nodeIds: [`n${i}`], x: 0, y: 0, width: 184, height: 220 }));
const edge = (from: number, to: number) => ({ id: `${from}-${to}`, fromNodeId: `n${from}`, toNodeId: `n${to}` }) as NodeGraphEdge;
describe('incremental node construction layout', () => {
  it('puts even two unconnected processing nodes beside each other and grows a compact grid', () => {
    const pair = flowGroupLayout(blocks.slice(0, 2), [], new Set());
    expect(pair[0].y).toBe(pair[1].y);
    expect(pair[1].x).toBeGreaterThan(pair[0].x + pair[0].width);
    const grid = flowGroupLayout(blocks, [], new Set());
    expect(new Set(grid.map(block => block.x)).size).toBeGreaterThan(1);
    expect(new Set(grid.map(block => block.y)).size).toBeGreaterThan(1);
    const width = Math.max(...grid.map(block => block.x + block.width));
    const height = Math.max(...grid.map(block => block.y + block.height));
    expect(width / height).toBeGreaterThan(0.5);
    expect(width / height).toBeLessThan(2);
  });
  it('returns connected steps to left-to-right flow, preserving fixed positions', () => {
    const input = blocks.map(block => block.id === 'n8' ? { ...block, x: 4000, y: 900 } : block);
    const result = flowGroupLayout(input, [edge(0, 1), edge(1, 2)], new Set(['n8']));
    expect(result[0].x).toBeLessThan(result[1].x);
    expect(result[1].x).toBeLessThan(result[2].x);
    expect(result[8]).toEqual(input[8]);
    for (const a of result) for (const b of result) if (a.id !== b.id) {
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  });
});
