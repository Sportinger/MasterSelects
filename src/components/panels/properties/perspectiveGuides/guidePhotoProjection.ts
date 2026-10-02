import type { ClipTransform } from '../../../../types/timelineCore';
import { canvasPlacement } from '../../../../utils/photoCanvasPlacement';
import { getEffectiveScale } from '../../../../utils/transformScale';
import { rotationDegreesToRadians } from '../../../../utils/rotationUnits';

export function guidePhotoProjection(sourceWidth: number, sourceHeight: number,
  composition?: { width: number; height: number }, transform?: ClipTransform) {
  const size = composition ?? { width: sourceWidth, height: sourceHeight };
  const inverse = transform ? canvasPlacement({ ...transform, scale: getEffectiveScale(transform.scale),
    rotation: rotationDegreesToRadians(transform.rotation) }, sourceWidth, sourceHeight, size.width, size.height)
    : [1, 0, 0, 0, 1, 0];
  const [a,b,c,d,e,f] = inverse, determinant = a*e-b*d;
  const forward = [e/determinant, -b/determinant, (b*f-e*c)/determinant,
    -d/determinant, a/determinant, (d*c-a*f)/determinant];
  return { size, inverse, forward,
    sourcePoint: (x: number, y: number): [number,number] => [a*x+b*y+c, d*x+e*y+f],
    canvasPoint: (x: number, y: number): [number,number] => [
      (forward[0]*x+forward[1]*y+forward[2])*size.width,
      (forward[3]*x+forward[4]*y+forward[5])*size.height],
  };
}
