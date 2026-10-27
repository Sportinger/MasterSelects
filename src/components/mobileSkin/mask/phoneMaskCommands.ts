// Mask commands of the phone skin: find the mask the phone can edit on a clip and write a shape
// through the timeline store's own addMask / updateMask / removeMask (the actions the desktop mask
// panel uses). Every write sets the full mask state, so it can run again inside a fresh transaction.

import { parseMaskProperty } from '../../../types/animationProperties';
import { useTimelineStore } from '../../../stores/timeline';
import type { ClipMask } from '../../../types/masks';
import type { TimelineClip } from '../../../types/timeline';
import { buildPhoneMaskPatch, readPhoneMask, type PhoneMaskParams, type PhoneMaskShape } from './phoneMaskGeometry';

export interface PhoneMaskInventory {
  /** The mask the phone edits, with its shape and parameters, or null when the clip has none yet. */
  editable: { mask: ClipMask; shape: PhoneMaskShape; params: PhoneMaskParams } | null;
  /** Masks the phone leaves alone (pen paths, edited paths, animated masks). The crop mask is not counted. */
  custom: ClipMask[];
  /** True when the first phone-shaped mask is animated (keyframes), so the phone must not edit it. */
  animated: boolean;
}

function isAnimated(clipId: string, maskId: string): boolean {
  const keyframes = useTimelineStore.getState().clipKeyframes.get(clipId) ?? [];
  return keyframes.some((keyframe) => parseMaskProperty(keyframe.property)?.maskId === maskId);
}

export function readPhoneMaskInventory(clip: TimelineClip, aspect: number): PhoneMaskInventory {
  const masks = (clip.masks ?? []).filter((mask) => mask.purpose !== 'crop');
  let editable: PhoneMaskInventory['editable'] = null;
  let animated = false;
  const custom: ClipMask[] = [];
  for (const mask of masks) {
    const parsed: ReturnType<typeof readPhoneMask> = editable ? null : readPhoneMask(mask, aspect);
    if (parsed && isAnimated(clip.id, mask.id)) {
      animated = true;
      custom.push(mask);
    } else if (parsed) {
      editable = { mask, ...parsed };
    } else {
      custom.push(mask);
    }
  }
  return { editable, custom, animated };
}

export type PhoneMaskDraft = { shape: 'none' } | { shape: PhoneMaskShape; params: PhoneMaskParams };

/**
 * Writes `draft` onto the clip. `ref.maskId` is the phone mask (existing or created by an earlier
 * write of the same sheet); it is updated when a mask is created or removed.
 */
export function writePhoneMaskDraft(clipId: string, ref: { maskId: string | null }, draft: PhoneMaskDraft, aspect: number): void {
  const store = useTimelineStore.getState();
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('The clip no longer exists.');
  const existing = ref.maskId ? clip.masks?.find((mask) => mask.id === ref.maskId) : undefined;
  if (draft.shape === 'none') {
    if (existing) store.removeMask(clipId, existing.id);
    ref.maskId = null;
    return;
  }
  const maskId = existing?.id ?? store.addMask(clipId, { closed: true, mode: 'add' });
  ref.maskId = maskId;
  // Vertex ids carry the mask id: the editor keys vertex selection and edge feathers by them.
  useTimelineStore.getState().updateMask(clipId, maskId, buildPhoneMaskPatch(draft.shape, draft.params, aspect, maskId));
}
