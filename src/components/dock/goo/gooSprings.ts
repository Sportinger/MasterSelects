// Damped-spring integration for the goo drag overlay. Pure math so the feel
// constants stay unit-testable without DOM or WebGL.

export interface Spring {
  value: number;
  velocity: number;
}

export interface RectSpringTarget {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

export interface RectSpring {
  cx: Spring;
  cy: Spring;
  hw: Spring;
  hh: Spring;
}

export const GOO_FOLLOW_STIFFNESS = 340;
export const GOO_FOLLOW_DAMPING = 27;
export const GOO_ZONE_STIFFNESS = 230;
export const GOO_ZONE_DAMPING = 25;
export const GOO_MERGE_STIFFNESS = 150;
export const GOO_MERGE_DAMPING = 21;
export const GOO_SETTLE_STIFFNESS = 420;
export const GOO_SETTLE_DAMPING = 30;
export const GOO_SCALE_STIFFNESS = 300;
// Underdamped on purpose: the squash pulse when the goo latches onto a drop
// zone should visibly overshoot once.
export const GOO_SCALE_DAMPING = 17;

export const createSpring = (value: number): Spring => ({ value, velocity: 0 });

export const stepSpring = (
  spring: Spring,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): void => {
  const accel = -stiffness * (spring.value - target) - damping * spring.velocity;
  spring.velocity += accel * dt;
  spring.value += spring.velocity * dt;
};

export const createRectSpring = (target: RectSpringTarget): RectSpring => ({
  cx: createSpring(target.cx),
  cy: createSpring(target.cy),
  hw: createSpring(target.hw),
  hh: createSpring(target.hh),
});

export const stepRectSpring = (
  rect: RectSpring,
  target: RectSpringTarget,
  stiffness: number,
  damping: number,
  dt: number,
): void => {
  stepSpring(rect.cx, target.cx, stiffness, damping, dt);
  stepSpring(rect.cy, target.cy, stiffness, damping, dt);
  stepSpring(rect.hw, target.hw, stiffness, damping, dt);
  stepSpring(rect.hh, target.hh, stiffness, damping, dt);
};
