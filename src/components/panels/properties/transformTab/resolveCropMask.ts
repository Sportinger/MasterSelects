import type { ClipMask, MaskVertex } from '../../../../types/masks';

export const RESOLVE_CROP_MASK_NAME = 'Crop';

export interface ResolveCropValues {
  bottom: number;
  left: number;
  right: number;
  softness: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function safeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function isResolveCropMask(mask: ClipMask): boolean {
  return mask.purpose === 'crop';
}

export function readResolveCropValues(
  mask: ClipMask | undefined,
  sourceWidth: number,
  sourceHeight: number,
): ResolveCropValues {
  if (!mask || mask.vertices.length < 4) {
    return { bottom: 0, left: 0, right: 0, softness: 0, top: 0 };
  }

  const width = safeDimension(sourceWidth);
  const height = safeDimension(sourceHeight);
  const offsetX = mask.position?.x ?? 0;
  const offsetY = mask.position?.y ?? 0;
  const xs = mask.vertices.map(vertex => vertex.x + offsetX);
  const ys = mask.vertices.map(vertex => vertex.y + offsetY);
  const minX = clamp(Math.min(...xs), 0, 1);
  const maxX = clamp(Math.max(...xs), 0, 1);
  const minY = clamp(Math.min(...ys), 0, 1);
  const maxY = clamp(Math.max(...ys), 0, 1);

  return {
    left: minX * width,
    right: (1 - maxX) * width,
    top: minY * height,
    bottom: (1 - maxY) * height,
    softness: Math.max(0, mask.feather ?? 0),
  };
}

function cornerVertex(id: string, x: number, y: number): MaskVertex {
  return {
    id,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

export function buildResolveCropMaskPatch(
  maskId: string,
  values: ResolveCropValues,
  sourceWidth: number,
  sourceHeight: number,
): Partial<ClipMask> {
  const width = safeDimension(sourceWidth);
  const height = safeDimension(sourceHeight);
  const left = clamp(values.left, 0, Math.max(0, width - values.right));
  const right = clamp(values.right, 0, Math.max(0, width - left));
  const top = clamp(values.top, 0, Math.max(0, height - values.bottom));
  const bottom = clamp(values.bottom, 0, Math.max(0, height - top));
  const x1 = left / width;
  const x2 = 1 - right / width;
  const y1 = top / height;
  const y2 = 1 - bottom / height;

  return {
    name: RESOLVE_CROP_MASK_NAME,
    purpose: 'crop',
    mode: 'intersect',
    inverted: false,
    opacity: 1,
    feather: Math.max(0, values.softness),
    featherQuality: 50,
    closed: true,
    position: { x: 0, y: 0 },
    rotation: 0,
    visible: false,
    vertices: [
      cornerVertex(`${maskId}-tl`, x1, y1),
      cornerVertex(`${maskId}-tr`, x2, y1),
      cornerVertex(`${maskId}-br`, x2, y2),
      cornerVertex(`${maskId}-bl`, x1, y2),
    ],
  };
}
