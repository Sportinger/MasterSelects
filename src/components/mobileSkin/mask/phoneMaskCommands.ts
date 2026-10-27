// Mask commands of the phone skin: find the mask the phone can edit on a clip and write a shape
// through the timeline store's own addMask / updateMask / removeMask (the actions the desktop mask
// panel uses). Every write sets the full mask state, so it can run again inside a fresh transaction.

import { parseMaskProperty } from '../../../types/animationProperties';
import { useTimelineStore } from '../../../stores/timeline';
import type { ClipMask } from '../../../types/masks';
import type { TimelineClip } from '../../../types/timeline';
import { buildPhoneMaskPatch, readPhoneMask, type PhoneMaskParams, type PhoneMaskShape } from './phoneMaskGeometry';
import { PHONE_PEN_MASK_NAME, toPhonePenMaskPatch, type PhonePenPath } from './phonePenModel';

export interface PhoneMaskInventory {
  /** The mask the phone edits, with its shape and parameters, or null when the clip has none yet. */
  editable: { mask: ClipMask; shape: PhoneMaskShape; params: PhoneMaskParams } | null;
  /** Masks the phone leaves alone (pen paths, edited paths, animated masks). The crop mask is not counted. */
  custom: ClipMask[];
  /** True when the first phone-shaped mask is animated (keyframes), so the phone must not edit it. */
  animated: boolean;
  /** A pen path the phone can keep editing (drawn here or a plain one from the desktop pen), when no shape mask is editable. */
  pen: { mask: ClipMask; path: PhonePenPath; feather: number; inverted: boolean } | null;
}

/**
 * Reads a pen mask back into a phone pen path, or null when the phone could not keep it exactly: a
 * moved or rotated path, broken (non-mirrored) handles, per-edge feathers or settings the sheet does
 * not show. Such paths stay untouched and are listed as masks from the full editor.
 */
export function readPhonePenMask(mask: ClipMask): PhonePenPath | null {
  if (mask.name !== PHONE_PEN_MASK_NAME || mask.purpose === 'crop' || mask.mode !== 'add') return null;
  if ((mask.opacity ?? 1) !== 1 || mask.enabled === false || mask.compositeEnabled === false) return null;
  if (mask.edgeFeathers && Object.keys(mask.edgeFeathers).length > 0) return null;
  if ((mask.featherOffset ?? 0) !== 0 || (mask.featherBalance ?? 0) !== 0) return null;
  if ((mask.rotation ?? 0) !== 0 || (mask.position?.x ?? 0) !== 0 || (mask.position?.y ?? 0) !== 0) return null;
  const mirrored = mask.vertices.every((vertex) => Math.abs(vertex.handleIn.x + vertex.handleOut.x) < 1e-6
    && Math.abs(vertex.handleIn.y + vertex.handleOut.y) < 1e-6);
  if (!mirrored) return null;
  // Keep the vertex ids (the editor keys selection by them): `${maskId}-pN` back to `pN`, others renumbered.
  let nextId = 1;
  const taken = new Set<string>();
  const ids = mask.vertices.map((vertex) => {
    const own = vertex.id.startsWith(`${mask.id}-`) ? vertex.id.slice(mask.id.length + 1) : '';
    const match = /^p(\d+)$/.exec(own);
    if (match && !taken.has(own)) { nextId = Math.max(nextId, Number(match[1]) + 1); taken.add(own); return own; }
    return null;
  });
  const points = mask.vertices.map((vertex, index) => {
    let id = ids[index];
    if (!id) { id = `p${nextId}`; nextId += 1; }
    return { id, x: vertex.x, y: vertex.y, handleX: vertex.handleOut.x, handleY: vertex.handleOut.y };
  });
  return { points, closed: mask.closed, nextId };
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
  let pen: PhoneMaskInventory['pen'] = null;
  if (!editable) {
    const index = custom.findIndex((mask) => !isAnimated(clip.id, mask.id) && readPhonePenMask(mask) !== null);
    if (index >= 0) {
      const mask = custom[index];
      pen = { mask, path: readPhonePenMask(mask)!, feather: Math.max(0, mask.feather ?? 0), inverted: Boolean(mask.inverted) };
      custom.splice(index, 1);
    }
  }
  return { editable, custom, animated, pen };
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

/**
 * Writes the pen path onto the clip (`path` null or without points removes the pen mask). `ref.maskId`
 * is the pen mask of this sheet; it is updated when the mask is created or removed.
 */
export function writePhonePenDraft(
  clipId: string, ref: { maskId: string | null }, path: PhonePenPath | null, look: { feather: number; inverted: boolean },
): void {
  const store = useTimelineStore.getState();
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('The clip no longer exists.');
  const existing = ref.maskId ? clip.masks?.find((mask) => mask.id === ref.maskId) : undefined;
  if (!path || path.points.length === 0) {
    if (existing) store.removeMask(clipId, existing.id);
    ref.maskId = null;
    return;
  }
  const maskId = existing?.id ?? store.addMask(clipId, { name: PHONE_PEN_MASK_NAME, closed: false, mode: 'add' });
  ref.maskId = maskId;
  useTimelineStore.getState().updateMask(clipId, maskId, toPhonePenMaskPatch(path, maskId, look));
}
