import type { ClipMask } from '../../types/masks';

export interface TimelineMaskEditPreview {
  ownerId: string;
  clipId: string;
  mask: ClipMask;
}

export function applyMaskEditPreview(
  clipId: string,
  masks: ClipMask[] | undefined,
  preview: TimelineMaskEditPreview | null | undefined,
): ClipMask[] | undefined {
  if (!masks || preview?.clipId !== clipId) return masks;

  let changed = false;
  const previewedMasks = masks.map((mask) => {
    if (mask.id !== preview.mask.id) return mask;
    changed = true;
    return preview.mask;
  });
  return changed ? previewedMasks : masks;
}
