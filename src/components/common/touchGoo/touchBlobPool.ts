// Pure spring state machine for the global touch goo layer: one blob per
// active touch pointer with swell-in overshoot on touch-down, rubber-band
// follow, velocity squash/stretch, hold breathing, and release/cancel decay.
// No DOM or WebGL here — the caller supplies timestamps — so the feel
// constants stay unit-testable like gooSprings.

import type { GooBlob } from '../../dock/goo/gooRenderer';
import { createSpring, stepSpring, type Spring } from '../../dock/goo/gooSprings';

export const TOUCH_BLOB_RADIUS_PX = 23;
export const TOUCH_FOLLOW_STIFFNESS = 420;
// Slightly underdamped: the blob trails the finger and settles with one
// soft wobble — the rubber-band feel.
export const TOUCH_FOLLOW_DAMPING = 26;
export const TOUCH_SWELL_STIFFNESS = 330;
// Underdamped on purpose: touch-down visibly bulges past the resting size
// once before settling.
export const TOUCH_SWELL_DAMPING = 14;
export const TOUCH_RELEASE_STIFFNESS = 420;
export const TOUCH_RELEASE_DAMPING = 30;
// Cancel wobbles through zero a couple of times on the way out.
export const TOUCH_CANCEL_DAMPING = 11;
export const TOUCH_BREATHE_DELAY_MS = 420;
export const TOUCH_BREATHE_HZ = 1.05;
export const TOUCH_BREATHE_AMP_PX = 1.7;
export const TOUCH_STRETCH_MAX = 0.55;
export const TOUCH_STRETCH_FULL_SPEED = 1600; // px/s where stretch saturates
export const TOUCH_MAX_BLOBS = 10;

const RELEASE_TIMEOUT_MS = 600;
const DEAD_RADIUS_PX = 1.1;
const STRETCH_MIN_SPEED = 60;

export type TouchBlobPhase = 'live' | 'release' | 'cancel';

export interface TouchBlob {
  pointerId: number;
  phase: TouchBlobPhase;
  x: Spring;
  y: Spring;
  radius: Spring;
  targetX: number;
  targetY: number;
  downAt: number;
  phaseAt: number;
  dirX: number;
  dirY: number;
  stretch: number;
}

export interface TouchBlobPool {
  blobs: Map<number, TouchBlob>;
}

export const createTouchBlobPool = (): TouchBlobPool => ({ blobs: new Map() });

export const touchPoolDown = (
  pool: TouchBlobPool,
  pointerId: number,
  x: number,
  y: number,
  now: number,
): void => {
  if (pool.blobs.size >= TOUCH_MAX_BLOBS && !pool.blobs.has(pointerId)) return;
  const radius = createSpring(TOUCH_BLOB_RADIUS_PX * 0.3);
  radius.velocity = 340;
  pool.blobs.set(pointerId, {
    pointerId,
    phase: 'live',
    x: createSpring(x),
    y: createSpring(y),
    radius,
    targetX: x,
    targetY: y,
    downAt: now,
    phaseAt: now,
    dirX: 1,
    dirY: 0,
    stretch: 0,
  });
};

export const touchPoolMove = (
  pool: TouchBlobPool,
  pointerId: number,
  x: number,
  y: number,
): void => {
  const blob = pool.blobs.get(pointerId);
  if (!blob || blob.phase !== 'live') return;
  blob.targetX = x;
  blob.targetY = y;
};

export const touchPoolUp = (pool: TouchBlobPool, pointerId: number, now: number): void => {
  const blob = pool.blobs.get(pointerId);
  if (!blob || blob.phase !== 'live') return;
  blob.phase = 'release';
  blob.phaseAt = now;
};

export const touchPoolCancel = (pool: TouchBlobPool, pointerId: number, now: number): void => {
  const blob = pool.blobs.get(pointerId);
  if (!blob || blob.phase !== 'live') return;
  blob.phase = 'cancel';
  blob.phaseAt = now;
  blob.radius.velocity = -170;
};

export const touchPoolAlive = (pool: TouchBlobPool): boolean => pool.blobs.size > 0;

/** Steps every blob by dt (seconds) and returns the frame's render blobs. */
export const stepTouchBlobPool = (pool: TouchBlobPool, now: number, dt: number): GooBlob[] => {
  const out: GooBlob[] = [];
  for (const blob of pool.blobs.values()) {
    stepSpring(blob.x, blob.targetX, TOUCH_FOLLOW_STIFFNESS, TOUCH_FOLLOW_DAMPING, dt);
    stepSpring(blob.y, blob.targetY, TOUCH_FOLLOW_STIFFNESS, TOUCH_FOLLOW_DAMPING, dt);

    if (blob.phase === 'live') {
      let target = TOUCH_BLOB_RADIUS_PX;
      const held = now - blob.downAt;
      if (held > TOUCH_BREATHE_DELAY_MS) {
        // Slow breathing under a resting finger: the surface stays alive
        // without drawing attention.
        target += Math.sin(
          ((held - TOUCH_BREATHE_DELAY_MS) / 1000) * Math.PI * 2 * TOUCH_BREATHE_HZ,
        ) * TOUCH_BREATHE_AMP_PX;
      }
      stepSpring(blob.radius, target, TOUCH_SWELL_STIFFNESS, TOUCH_SWELL_DAMPING, dt);
    } else {
      const damping = blob.phase === 'cancel' ? TOUCH_CANCEL_DAMPING : TOUCH_RELEASE_DAMPING;
      stepSpring(blob.radius, 0, TOUCH_RELEASE_STIFFNESS, damping, dt);
      const settled = Math.abs(blob.radius.value) < DEAD_RADIUS_PX
        && Math.abs(blob.radius.velocity) < 40;
      if (settled || now - blob.phaseAt > RELEASE_TIMEOUT_MS) {
        pool.blobs.delete(blob.pointerId);
        continue;
      }
    }

    // Velocity squash/stretch: lengthen along the motion, thin sideways,
    // easing back as the finger slows.
    const vx = blob.x.velocity;
    const vy = blob.y.velocity;
    const speed = Math.hypot(vx, vy);
    let stretchTarget = 0;
    if (blob.phase === 'live' && speed > STRETCH_MIN_SPEED) {
      stretchTarget = Math.min((speed - STRETCH_MIN_SPEED) / TOUCH_STRETCH_FULL_SPEED, 1)
        * TOUCH_STRETCH_MAX;
      const blend = Math.min(dt * 14, 1);
      blob.dirX += (vx / speed - blob.dirX) * blend;
      blob.dirY += (vy / speed - blob.dirY) * blend;
      const len = Math.hypot(blob.dirX, blob.dirY) || 1;
      blob.dirX /= len;
      blob.dirY /= len;
    }
    blob.stretch += (stretchTarget - blob.stretch) * Math.min(dt * 10, 1);

    const r = Math.max(blob.radius.value, 0);
    // A cancel wobble can dip below visibility while still animating.
    if (r < 0.5) continue;
    out.push({
      cx: blob.x.value,
      cy: blob.y.value,
      hw: r,
      hh: r,
      radius: r,
      stretch: {
        dirX: blob.dirX,
        dirY: blob.dirY,
        along: 1 + blob.stretch,
        perp: 1 / (1 + blob.stretch * 0.65),
      },
    });
  }
  return out;
};
