// Writes of the crop & transform sheet, through the same store actions as the desktop inspector:
// the crop is the inspector's semantic crop mask (addMask / updateMask / removeMask with
// buildResolveCropMaskPatch), the transform goes through setPropertyValue (keyframe-aware, so an
// animated property gets a keyframe at the playhead exactly like a desktop edit).

import { isVideoInspectorSectionEnabled } from '../../../services/videoInspector/sectionBypass';
import { useTimelineStore } from '../../../stores/timeline';
import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
import {
  buildResolveCropMaskPatch, isResolveCropMask, readResolveCropValues, RESOLVE_CROP_MASK_NAME, type ResolveCropValues,
} from '../../panels/properties/transformTab/resolveCropMask';
import type { TimelineClip } from '../../../types/timeline';
import type { PhoneSize } from './phoneClipTarget';
import { isPhoneCropEmpty, phoneTransformPropertyValue, type PhoneTransformKey, type PhoneTransformValues } from './phoneCropGeometry';

export function readPhoneCrop(clip: TimelineClip, source: PhoneSize): { values: ResolveCropValues; enabled: boolean } {
  const mask = clip.masks?.find(isResolveCropMask);
  const sectionEnabled = isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'cropping');
  return { values: readResolveCropValues(mask, source.width, source.height), enabled: sectionEnabled && mask?.enabled !== false };
}

/** Sets the crop absolutely; an empty crop removes the crop mask (like the inspector's reset). */
export function writePhoneCrop(clipId: string, values: ResolveCropValues, source: PhoneSize): void {
  const store = useTimelineStore.getState();
  const clip = store.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('The clip no longer exists.');
  const existing = clip.masks?.find(isResolveCropMask);
  if (isPhoneCropEmpty(values) && values.softness <= 0) {
    if (existing) store.removeMask(clipId, existing.id);
    return;
  }
  const sectionEnabled = isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'cropping');
  const maskId = existing?.id ?? store.addMask(clipId, {
    name: RESOLVE_CROP_MASK_NAME, purpose: 'crop', mode: 'intersect', closed: true, enabled: sectionEnabled, visible: false,
  });
  useTimelineStore.getState().updateMask(clipId, maskId, {
    ...buildResolveCropMaskPatch(maskId, values, source.width, source.height),
    enabled: sectionEnabled,
  });
}

/** Transform properties a node graph drives; the sheet greys them out instead of writing into the void. */
export function phoneNodeDrivenTransformKeys(clip: TimelineClip, keys: readonly PhoneTransformKey[]): Set<PhoneTransformKey> {
  return new Set(keys.filter((key) => isParameterNodeDriven(clip, key)));
}

/** Writes the touched transform keys with their absolute values. */
export function writePhoneTransform(clipId: string, values: PhoneTransformValues, keys: ReadonlySet<PhoneTransformKey>, comp: PhoneSize): void {
  const store = useTimelineStore.getState();
  if (!store.clips.some((candidate) => candidate.id === clipId)) throw new Error('The clip no longer exists.');
  for (const key of keys) store.setPropertyValue(clipId, key, phoneTransformPropertyValue(key, values, comp));
}
