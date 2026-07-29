import { useMediaStore } from '../../../stores/mediaStore';

/**
 * Position keyframes are authored in pixels but stored normalized.
 *
 * The store keeps `transform.position` in normalized units; the properties
 * panel renders them as pixels via `value * (comp / 2)`
 * (`transformTab/transformValues.ts`). `addKeyframe` used to write its raw
 * argument straight into the store, so a keyframe meant as "113 px" landed as
 * normalized 113 and displayed as 61020 px — a factor of `compHeight / 2` off.
 *
 * These helpers mirror the panel's convention exactly, so a pixel value handed
 * to `addKeyframe` reads back as the same pixel value in the UI and in
 * `getKeyframes`.
 */

/** Half-extent per axis, matching the properties panel. */
function positionDivisor(property: string): number | undefined {
  const composition = useMediaStore.getState().getActiveComposition();
  const compWidth = composition?.width ?? 1920;
  const compHeight = composition?.height ?? 1080;

  switch (property) {
    case 'position.x':
      return compWidth / 2;
    case 'position.y':
      return compHeight / 2;
    // Z shares the horizontal half-extent in the panel.
    case 'position.z':
      return compWidth / 2;
    default:
      return undefined;
  }
}

/** Pixels → normalized, for values on their way into the store. */
export function keyframeValueToStore(property: string, value: number): number {
  const divisor = positionDivisor(property);
  if (divisor === undefined || divisor === 0) {
    return value;
  }
  return value / divisor;
}

/** Normalized → pixels, for values on their way back to a caller. */
export function keyframeValueFromStore(property: string, value: number): number {
  const divisor = positionDivisor(property);
  if (divisor === undefined) {
    return value;
  }
  return value * divisor;
}

/** True when the property is expressed in pixels at the tool boundary. */
export function isPixelKeyframeProperty(property: string): boolean {
  return positionDivisor(property) !== undefined;
}
