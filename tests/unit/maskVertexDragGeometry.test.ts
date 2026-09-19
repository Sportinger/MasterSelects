import { describe, expect, it } from 'vitest';

import {
  buildAngleLockedQuadVertexUpdates,
  buildEllipseResizeVertexUpdates,
  buildGlobalMaskScaleVertexUpdates,
  shouldResizeMaskShape,
} from '../../src/components/preview/useMaskVertexDrag';
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

function ellipseMask(): ClipMask {
  const mask = quadMask();
  const k = 0.5523;
  mask.name = 'Ellipse';
  mask.vertices = [
    { ...vertex('v0', 0.5, 0.25), handleIn: { x: -0.4 * k, y: 0 }, handleOut: { x: 0.4 * k, y: 0 }, handleMode: 'mirrored' },
    { ...vertex('v1', 0.9, 0.5), handleIn: { x: 0, y: -0.25 * k }, handleOut: { x: 0, y: 0.25 * k }, handleMode: 'mirrored' },
    { ...vertex('v2', 0.5, 0.75), handleIn: { x: 0.4 * k, y: 0 }, handleOut: { x: -0.4 * k, y: 0 }, handleMode: 'mirrored' },
    { ...vertex('v3', 0.1, 0.5), handleIn: { x: 0, y: 0.25 * k }, handleOut: { x: 0, y: -0.25 * k }, handleMode: 'mirrored' },
  ];
  return mask;
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

  it('does not apply straight-corner locking to a curved four-point mask', () => {
    expect(buildAngleLockedQuadVertexUpdates(ellipseMask(), 'v1', { x: 1, y: 0.5 })).toBeNull();
  });

  it('resizes a four-point ellipse from the opposite point and keeps its bezier geometry smooth', () => {
    const updates = buildEllipseResizeVertexUpdates(ellipseMask(), 'v1', { x: 1.1, y: 0.6 });
    expect(updates).not.toBeNull();

    const byId = new Map(updates!.map(update => [update.id, update.updates]));
    expect(byId.get('v1')).toMatchObject({ x: 1.1, y: 0.6, handleMode: 'mirrored' });
    expect(byId.get('v3')).toMatchObject({ handleMode: 'mirrored' });
    expect(byId.get('v3')?.x).toBeCloseTo(0.1);
    expect(byId.get('v3')?.y).toBeCloseTo(0.5);
    expect(byId.get('v0')?.x).toBeCloseTo(0.6);
    expect(byId.get('v0')?.y).toBeCloseTo(0.3);
    expect(byId.get('v2')?.x).toBeCloseTo(0.6);
    expect(byId.get('v2')?.y).toBeCloseTo(0.8);
    expect(byId.get('v0')?.handleOut?.x).toBeCloseTo(0.27615);
    expect(byId.get('v0')?.handleOut?.y).toBeCloseTo(0.027615);
    expect(byId.get('v1')?.handleOut?.x).toBeCloseTo(0);
    expect(byId.get('v1')?.handleOut?.y).toBeCloseTo(0.138075);
  });

  it('only requests shape-preserving movement while Ctrl/Cmd is held', () => {
    expect(shouldResizeMaskShape({ ctrlKey: false, metaKey: false })).toBe(false);
    expect(shouldResizeMaskShape({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(shouldResizeMaskShape({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  it('can globally scale an arbitrary mask shape around its center', () => {
    const mask = quadMask();
    mask.vertices = [
      vertex('v0', 0, 0),
      vertex('v1', 2, 0),
      vertex('v2', 1.5, 1),
    ];
    const updates = buildGlobalMaskScaleVertexUpdates(mask, 'v1', { x: 3, y: -0.5 });
    expect(updates).not.toBeNull();

    const byId = new Map(updates!.map(update => [update.id, update.updates]));
    expect(byId.get('v0')?.x).toBeCloseTo(-1);
    expect(byId.get('v0')?.y).toBeCloseTo(-0.5);
    expect(byId.get('v1')?.x).toBeCloseTo(3);
    expect(byId.get('v1')?.y).toBeCloseTo(-0.5);
  });
});
