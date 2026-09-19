// Lifecycle tests for the touch goo blob pool: swell overshoot on touch-down,
// rubber-band follow with velocity stretch, release/cancel decay, and the
// pointer cap. Pure spring math — timestamps are driven by the test.

import { describe, expect, it } from 'vitest';

import type { GooBlob } from '../../src/components/dock/goo/gooRenderer';
import {
  TOUCH_BLOB_RADIUS_PX,
  TOUCH_MAX_BLOBS,
  createTouchBlobPool,
  stepTouchBlobPool,
  touchPoolAlive,
  touchPoolCancel,
  touchPoolDown,
  touchPoolMove,
  touchPoolUp,
  type TouchBlobPool,
} from '../../src/components/common/touchGoo/touchBlobPool';

const DT = 1 / 120;

function run(
  pool: TouchBlobPool,
  startNow: number,
  seconds: number,
  onStep?: (blobs: GooBlob[]) => void,
): { blobs: GooBlob[]; now: number } {
  let now = startNow;
  let blobs: GooBlob[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    now += DT * 1000;
    blobs = stepTouchBlobPool(pool, now, DT);
    onStep?.(blobs);
  }
  return { blobs, now };
}

describe('touchBlobPool', () => {
  it('swells past the resting radius once on touch-down, then settles', () => {
    const pool = createTouchBlobPool();
    touchPoolDown(pool, 1, 100, 100, 0);

    let maxRadius = 0;
    run(pool, 0, 0.3, (blobs) => {
      maxRadius = Math.max(maxRadius, blobs[0]?.radius ?? 0);
    });
    expect(maxRadius).toBeGreaterThan(TOUCH_BLOB_RADIUS_PX + 2);

    const { blobs } = run(pool, 300, 0.4);
    expect(blobs).toHaveLength(1);
    // Breathing keeps it moving a little around the resting size while held.
    expect(blobs[0].radius).toBeGreaterThan(TOUCH_BLOB_RADIUS_PX - 4);
    expect(blobs[0].radius).toBeLessThan(TOUCH_BLOB_RADIUS_PX + 4);
    expect(blobs[0].hw).toBe(blobs[0].radius);
    expect(blobs[0].hh).toBe(blobs[0].radius);
  });

  it('trails a moved target with lag, stretches along the motion, converges', () => {
    const pool = createTouchBlobPool();
    touchPoolDown(pool, 1, 100, 100, 0);
    let state = run(pool, 0, 1);

    touchPoolMove(pool, 1, 300, 100);
    let maxAlong = 1;
    state = run(pool, state.now, 0.05, (blobs) => {
      maxAlong = Math.max(maxAlong, blobs[0]?.stretch?.along ?? 1);
    });
    // Rubber band: shortly after the jump the blob is still on its way.
    expect(state.blobs[0].cx).toBeGreaterThan(100);
    expect(state.blobs[0].cx).toBeLessThan(295);

    state = run(pool, state.now, 1.5, (blobs) => {
      maxAlong = Math.max(maxAlong, blobs[0]?.stretch?.along ?? 1);
    });
    expect(maxAlong).toBeGreaterThan(1.05);
    expect(Math.abs(state.blobs[0].cx - 300)).toBeLessThan(2);
    expect(state.blobs[0].stretch?.along ?? 1).toBeLessThan(1.03);
  });

  it('drains the pool after release and after cancel', () => {
    const pool = createTouchBlobPool();
    touchPoolDown(pool, 1, 50, 50, 0);
    touchPoolDown(pool, 2, 200, 50, 0);
    const settled = run(pool, 0, 0.5);

    touchPoolUp(pool, 1, settled.now);
    touchPoolCancel(pool, 2, settled.now);
    expect(touchPoolAlive(pool)).toBe(true);

    run(pool, settled.now, 1);
    expect(touchPoolAlive(pool)).toBe(false);
  });

  it('ignores pointers beyond the blob cap but keeps tracked ones updatable', () => {
    const pool = createTouchBlobPool();
    for (let id = 0; id < TOUCH_MAX_BLOBS + 3; id++) {
      touchPoolDown(pool, id, id * 10, 0, 0);
    }
    expect(pool.blobs.size).toBe(TOUCH_MAX_BLOBS);

    touchPoolMove(pool, 0, 500, 500);
    expect(pool.blobs.get(0)?.targetX).toBe(500);
    // Untracked overflow pointer stays absent.
    expect(pool.blobs.has(TOUCH_MAX_BLOBS + 1)).toBe(false);
  });
});
