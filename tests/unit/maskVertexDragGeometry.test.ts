import { describe, expect, it } from 'vitest';

import { buildAngleLockedQuadVertexUpdates } from '../../src/components/preview/useMaskVertexDrag';
import type { ClipMask } from '../../src/types/masks';

function vertex(id: string, x: number, y: number) {
  return {
    id,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none' as const,
  };
}

function quadMask(closed = true): ClipMask {
  return {
    id: 'mask-a',
    name: 'Quad',
    vertices: [
      vertex('v0', 0, 0),
      vertex('v1', 1, 0),
      vertex('v2', 1, 1),
      vertex('v3', 0, 1),
    ],
    closed,
    opacity: 1,
    feather: 0,
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: true,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
  };
}

describe('mask vertex drag geometry', () => {
  it('preserves adjacent edge angles when moving a single quad corner', () => {
    const updates = buildAngleLockedQuadVertexUpdates(quadMask(), 'v1', { x: 2, y: 0.25 });
    expect(updates).toEqual([
      { id: 'v1', updates: { x: 2, y: 0.25 } },
      { id: 'v0', updates: { x: 0, y: 0.25 } },
      { id: 'v2', updates: { x: 2, y: 1 } },
    ]);
  });

  it('does not angle-lock open or non-quad masks', () => {
    expect(buildAngleLockedQuadVertexUpdates(quadMask(false), 'v1', { x: 2, y: 0.25 })).toBeNull();

    const triangle = quadMask();
    triangle.vertices = triangle.vertices.slice(0, 3);
    expect(buildAngleLockedQuadVertexUpdates(triangle, 'v1', { x: 2, y: 0.25 })).toBeNull();
  });
});
