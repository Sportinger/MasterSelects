import { describe, expect, it } from 'vitest';

import { buildMaskBoundsResizeUpdates } from '../../src/components/preview/maskOverlay/maskBoundsGeometry';
import type { ClipMask, MaskVertex } from '../../src/types/masks';

function vertex(id: string, x: number, y: number): MaskVertex {
  return {
    id,
    x,
    y,
    handleIn: { x: -0.1, y: -0.2 },
    handleOut: { x: 0.1, y: 0.2 },
    handleMode: 'mirrored',
  };
}

function mask(): ClipMask {
  return {
    id: 'mask-a',
    name: 'Mask',
    vertices: [
      vertex('top-left', 0.2, 0.25),
      vertex('top-right', 0.8, 0.25),
      vertex('bottom-right', 0.8, 0.75),
      vertex('bottom-left', 0.2, 0.75),
    ],
    closed: true,
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

describe('mask bounds resize geometry', () => {
  it('scales every vertex and bezier handle from the opposite corner', () => {
    const updates = buildMaskBoundsResizeUpdates(mask(), 'topLeft', { x: -0.4, y: -0.25 }, false);
    expect(updates).not.toBeNull();

    const byId = new Map(updates!.map(update => [update.id, update.updates]));
    expect(byId.get('bottom-right')).toMatchObject({ x: 0.8, y: 0.75 });
    expect(byId.get('top-left')?.x).toBeCloseTo(-0.4);
    expect(byId.get('top-left')?.y).toBeCloseTo(-0.25);
    expect(byId.get('top-left')?.handleIn?.x).toBeCloseTo(-0.2);
    expect(byId.get('top-left')?.handleIn?.y).toBeCloseTo(-0.4);
    expect(byId.get('top-left')?.handleOut?.x).toBeCloseTo(0.2);
    expect(byId.get('top-left')?.handleOut?.y).toBeCloseTo(0.4);
  });

  it('uses one scale factor when Shift preserves the aspect ratio', () => {
    const updates = buildMaskBoundsResizeUpdates(mask(), 'topLeft', { x: -0.4, y: 0 }, true);
    const topLeft = updates?.find(update => update.id === 'top-left')?.updates;
    expect(topLeft?.x).toBeCloseTo(-0.4);
    expect(topLeft?.y).toBeCloseTo(-0.25);
  });
});
