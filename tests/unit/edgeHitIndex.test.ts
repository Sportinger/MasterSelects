import { describe, expect, it } from 'vitest';
import { createEdgeHitIndex } from '../../src/components/panels/nodes/canvas/edgeHitIndex';

describe('canvas cable hit index', () => {
  const index = createEdgeHitIndex([
    { id: 'upper', from: { x: 0, y: 0 }, to: { x: 400, y: 0 } },
    { id: 'lower', from: { x: 0, y: 20 }, to: { x: 400, y: 20 } },
  ]);

  it('finds a cable under a point within tolerance only', () => {
    expect(index.query({ x: 200, y: 2 }, { x: 200, y: 2 }, 4)).toBe('upper');
    expect(index.query({ x: 200, y: 200 }, { x: 200, y: 200 }, 4)).toBeNull();
  });

  it('detects cables a fast sweep jumped across and reports the latest one crossed', () => {
    expect(index.query({ x: 200, y: -30 }, { x: 200, y: 10 }, 1)).toBe('upper');
    expect(index.query({ x: 200, y: -30 }, { x: 200, y: 60 }, 1)).toBe('lower');
    expect(index.query({ x: 200, y: 60 }, { x: 200, y: -30 }, 1)).toBe('upper');
  });
});
