/**
 * Coordinate frames for Motion parenting (pick whip).
 *
 * A parented child's stored position is an offset in its parent's local
 * space. Parent `rotation.z` must turn that offset rigidly in *visible* space
 * and in the same direction the renderer turns the layers themselves:
 *
 * - 2D clips store positions as normalized composition half extents
 *   (`x / (width / 2)`, `y / (height / 2)`) with +Y pointing down. One stored X
 *   unit is `width / height` times as long on screen as one stored Y unit, and
 *   the compositor (`src/shaders/composite.wgsl`, mirrored by the preview
 *   overlay math) draws a positive `rotation.z` counter-clockwise on screen.
 * - Effective-3D clips store isotropic scene units with +Y up, where a
 *   positive `rotation.z` is counter-clockwise as well.
 *
 * Rotating the stored values directly would skew offsets on every non-square
 * composition and turn 2D offsets clockwise while the layers turn
 * counter-clockwise.
 */

export interface CompositionPixelSize {
  readonly width: number;
  readonly height: number;
}

export interface ParentPositionFrame {
  /** Visible length of one stored X unit divided by that of one stored Y unit. */
  readonly xUnitScale: number;
  /** Screen direction of stored +Y. */
  readonly yAxis: 'down' | 'up';
}

/** Isotropic, Y-up scene units used by effective-3D clips. */
export const SCENE_PARENT_POSITION_FRAME: ParentPositionFrame = Object.freeze({
  xUnitScale: 1,
  yAxis: 'up',
});

export function isValidCompositionPixelSize(size: unknown): size is CompositionPixelSize {
  if (!size || typeof size !== 'object') return false;
  const { width, height } = size as Partial<CompositionPixelSize>;
  return typeof width === 'number' && Number.isFinite(width) && width > 0
    && typeof height === 'number' && Number.isFinite(height) && height > 0;
}

/** The valid pixel size of a composition-like record, or `undefined`. */
export function compositionPixelSizeOf(
  composition: { readonly width?: number; readonly height?: number } | null | undefined,
): CompositionPixelSize | undefined {
  return isValidCompositionPixelSize(composition)
    ? { width: composition.width, height: composition.height }
    : undefined;
}

/**
 * Frame of 2D composition positions. Without a valid size the composition is
 * treated as square: the rotation direction stays right, but the aspect cannot
 * be corrected, so every caller that owns a composition must pass its size.
 */
export function createCompositionParentPositionFrame(
  size: CompositionPixelSize | null | undefined,
): ParentPositionFrame {
  return {
    xUnitScale: isValidCompositionPixelSize(size) ? size.width / size.height : 1,
    yAxis: 'down',
  };
}

/**
 * Rotates a stored position offset by `degrees` of parent `rotation.z` in
 * visible space and returns it in stored units again. The exact inverse is the
 * same call with `-degrees`.
 */
export function rotateParentPositionOffset(
  offset: { readonly x: number; readonly y: number },
  degrees: number,
  frame: ParentPositionFrame,
): { x: number; y: number } {
  if (degrees === 0) return { x: offset.x, y: offset.y };
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const ySign = frame.yAxis === 'up' ? 1 : -1;
  const visibleX = offset.x * frame.xUnitScale;
  const visibleY = offset.y * ySign;
  return {
    x: (visibleX * cosine - visibleY * sine) / frame.xUnitScale,
    y: (visibleX * sine + visibleY * cosine) * ySign,
  };
}
