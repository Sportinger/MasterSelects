import type { LayerSourceRect } from '../../../types/layers';
import type { ClipTransform } from '../../../types/timelineCore';
import { getEffectiveScale } from '../../../utils/transformScale';

const MAX_MASK_DIMENSION = 8192;
const PERSPECTIVE_DISTANCE = 2;
const EPSILON = 1e-8;

export type MatAnyoneMaskRaster = {
  width: number;
  height: number;
  values: Uint8Array | Uint8ClampedArray;
};

export type MatAnyoneMaskGeometry = {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  transform: ClipTransform;
  sourceRect?: LayerSourceRect;
};

type Point2 = { x: number; y: number };
type Point3 = { x: number; y: number; z: number };

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function rotateLikeCompositor(point: Point3, transform: ClipTransform): Point3 {
  const rotationX = -degreesToRadians(transform.rotation.x);
  const rotationY = -degreesToRadians(transform.rotation.y);
  const rotationZ = degreesToRadians(transform.rotation.z);

  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const afterX = {
    x: point.x,
    y: point.y * cosX - point.z * sinX,
    z: point.y * sinX + point.z * cosX,
  };

  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const afterY = {
    x: afterX.x * cosY + afterX.z * sinY,
    y: afterX.y,
    z: -afterX.x * sinY + afterX.z * cosY,
  };

  const cosZ = Math.cos(rotationZ);
  const sinZ = Math.sin(rotationZ);
  return {
    x: afterY.x * cosZ - afterY.y * sinZ,
    y: afterY.x * sinZ + afterY.y * cosZ,
    z: afterY.z,
  };
}

/**
 * Inverts the compositor's external-video transform for one source UV.
 * Keeping this equation in sync with externalCompositeShader.ts is important:
 * the mask is drawn in composition space, while MatAnyone2 consumes raw frames.
 */
export function mapSourceUvToPreviewUv(
  sourceUv: Point2,
  geometry: MatAnyoneMaskGeometry,
): Point2 | null {
  const sourceRect = geometry.sourceRect ?? { x: 0, y: 0, width: 1, height: 1 };
  if (sourceRect.width <= 0 || sourceRect.height <= 0) return null;

  const transitionUv = {
    x: (sourceUv.x - sourceRect.x) / sourceRect.width,
    y: (sourceUv.y - sourceRect.y) / sourceRect.height,
  };
  if (
    transitionUv.x < 0 || transitionUv.x > 1
    || transitionUv.y < 0 || transitionUv.y > 1
  ) {
    return null;
  }

  const outputAspect = geometry.outputWidth / geometry.outputHeight;
  const sourceAspect = geometry.sourceWidth / geometry.sourceHeight;
  if (!Number.isFinite(outputAspect) || outputAspect <= 0 || !Number.isFinite(sourceAspect) || sourceAspect <= 0) {
    return null;
  }

  const positioned = {
    x: transitionUv.x - 0.5 + transformNumber(geometry.transform.position.x, 0),
    y: transitionUv.y - 0.5 + transformNumber(geometry.transform.position.y, 0),
  };
  const aspectRatio = sourceAspect / outputAspect;
  const beforeAspect = aspectRatio > 1
    ? { x: positioned.x, y: positioned.y / aspectRatio }
    : { x: positioned.x * aspectRatio, y: positioned.y };
  const scale = getEffectiveScale(geometry.transform.scale);
  if (Math.abs(scale.x) < EPSILON || Math.abs(scale.y) < EPSILON) return null;

  const projected = {
    x: beforeAspect.x * scale.x,
    y: beforeAspect.y * scale.y / outputAspect,
  };

  // The compositor rotates a plane whose initial z is position.z, then applies
  // perspective. Inverting the two projective equations gives this 2x2 solve.
  const basisX = rotateLikeCompositor({ x: 1, y: 0, z: 0 }, geometry.transform);
  const basisY = rotateLikeCompositor({ x: 0, y: 1, z: 0 }, geometry.transform);
  const basisZ = rotateLikeCompositor({ x: 0, y: 0, z: 1 }, geometry.transform);
  const initialZ = transformNumber(geometry.transform.position.z, 0);
  const constant = {
    x: basisZ.x * initialZ,
    y: basisZ.y * initialZ,
    z: basisZ.z * initialZ,
  };
  const qx = projected.x;
  const qy = projected.y;
  const d = PERSPECTIVE_DISTANCE;
  const a11 = basisX.x + qx * basisX.z / d;
  const a12 = basisY.x + qx * basisY.z / d;
  const a21 = basisX.y + qy * basisX.z / d;
  const a22 = basisY.y + qy * basisY.z / d;
  const b1 = qx - constant.x - qx * constant.z / d;
  const b2 = qy - constant.y - qy * constant.z / d;
  const determinant = a11 * a22 - a12 * a21;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < EPSILON) return null;

  const planeX = (b1 * a22 - a12 * b2) / determinant;
  const planeY = (a11 * b2 - b1 * a21) / determinant;
  const preview = {
    x: planeX + 0.5,
    y: planeY * outputAspect + 0.5,
  };
  return Number.isFinite(preview.x) && Number.isFinite(preview.y) ? preview : null;
}

function transformNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fitMaskDimensions(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_MASK_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function remapPreviewMaskToSource(
  previewMask: MatAnyoneMaskRaster,
  geometry: MatAnyoneMaskGeometry,
): { width: number; height: number; data: Uint8ClampedArray } {
  if (previewMask.values.length !== previewMask.width * previewMask.height) {
    throw new Error('Mask pixel count does not match its dimensions.');
  }

  const target = fitMaskDimensions(geometry.sourceWidth, geometry.sourceHeight);
  const rgba = new Uint8ClampedArray(target.width * target.height * 4);

  for (let y = 0; y < target.height; y += 1) {
    const sourceY = (y + 0.5) / target.height;
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = (x + 0.5) / target.width;
      const previewUv = mapSourceUvToPreviewUv({ x: sourceX, y: sourceY }, geometry);
      let value = 0;
      if (previewUv && previewUv.x >= 0 && previewUv.x <= 1 && previewUv.y >= 0 && previewUv.y <= 1) {
        const previewX = Math.min(previewMask.width - 1, Math.floor(previewUv.x * previewMask.width));
        const previewY = Math.min(previewMask.height - 1, Math.floor(previewUv.y * previewMask.height));
        value = previewMask.values[previewY * previewMask.width + previewX] > 0 ? 255 : 0;
      }
      const offset = (y * target.width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }

  return { width: target.width, height: target.height, data: rgba };
}

export async function createSourceSpaceMaskPng(
  previewMask: MatAnyoneMaskRaster,
  geometry: MatAnyoneMaskGeometry,
): Promise<Blob> {
  const sourceMask = remapPreviewMaskToSource(previewMask, geometry);
  const canvas = document.createElement('canvas');
  canvas.width = sourceMask.width;
  canvas.height = sourceMask.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not create the source-mask canvas.');
  const imageData = context.createImageData(sourceMask.width, sourceMask.height);
  imageData.data.set(sourceMask.data);
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the source mask as PNG.');
  return blob;
}

export function readPaintMask(canvas: HTMLCanvasElement): MatAnyoneMaskRaster {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not read the painted mask.');
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const values = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = rgba[index * 4];
  }
  return { width: canvas.width, height: canvas.height, values };
}
