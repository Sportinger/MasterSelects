import { describe, expect, it } from 'vitest';
describe('replicator placement', () => {
  it('moves the layer by the bounds center in composition-normalized units', async () => {
    const { applyMotionRenderPlacement } = await import('../../src/engine/motion/MotionTypes');
    const layer = { position: { x: 0.1, y: -0.2, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0 } as never;
    const size = { width: 280, height: 40, replicator: { boundsCenterX: 120, boundsCenterY: 0 } } as never;
    const placed = applyMotionRenderPlacement(layer, size, { width: 3440, height: 1440 }) as unknown as { position: { x: number; y: number } };
    expect(placed.position.x).toBeCloseTo(0.1 + 120 / 1720, 6);
    expect(placed.position.y).toBeCloseTo(-0.2, 6);
    const rotated = applyMotionRenderPlacement({ ...(layer as object), rotation: 90 } as never, size, { width: 3440, height: 1440 }) as unknown as { position: { x: number; y: number } };
    expect(rotated.position.x).toBeCloseTo(0.1, 6);
    expect(rotated.position.y).toBeCloseTo(-0.2 + 120 / 720, 6);
  });
});
