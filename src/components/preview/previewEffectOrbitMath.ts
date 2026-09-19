const EFFECT_ORBIT_DRAG_SENSITIVITY = 0.25;
const EFFECT_ORBIT_DOLLY_SENSITIVITY = 0.0015;

export function resolvePreviewEffectOrbitDragAngles(
  yaw: number,
  tilt: number,
  deltaX: number,
  deltaY: number,
): { yaw: number; tilt: number } {
  return {
    yaw: yaw + deltaX * EFFECT_ORBIT_DRAG_SENSITIVITY,
    tilt: tilt + deltaY * EFFECT_ORBIT_DRAG_SENSITIVITY,
  };
}

export function resolvePreviewEffectOrbitDollyDistance(distance: number, deltaY: number): number {
  return distance * Math.exp(deltaY * EFFECT_ORBIT_DOLLY_SENSITIVITY);
}
