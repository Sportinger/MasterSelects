import { describe, expect, it } from 'vitest';
import type { NodeGraphNode } from '../../src/services/nodeGraph';
import {
  NODE_MARQUEE_DRAG_THRESHOLD,
  nodesIntersectingMarquee,
  normalizedNodeMarquee,
} from '../../src/components/panels/nodes/canvas/useNodeMarqueeSelection';

const node = (id: string, x: number, y: number): NodeGraphNode => ({
  id,
  kind: 'effect',
  label: id,
  runtime: 'builtin',
  layout: { x, y },
  inputs: [],
  outputs: [],
});

describe('node workspace right-drag marquee geometry', () => {
  it('normalizes drags in every direction', () => {
    expect(normalizedNodeMarquee(90, 70, 20, 10)).toEqual({ left: 20, top: 10, width: 70, height: 60 });
  });

  it('selects every node whose card intersects the marquee', () => {
    const selected = nodesIntersectingMarquee(
      [node('inside', 20, 20), node('edge', 190, 40), node('outside', 400, 400)],
      { left: 0, top: 0, width: 200, height: 160 },
    );
    expect(selected).toEqual(['inside', 'edge']);
  });

  it('defines a non-zero screen-pixel threshold so right-click remains a context click', () => {
    expect(NODE_MARQUEE_DRAG_THRESHOLD).toBeGreaterThan(0);
  });
});
