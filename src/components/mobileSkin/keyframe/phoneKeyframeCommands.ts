// Keyframe commands of the phone skin: the transport diamond (add the clip's current transform +
// opacity at the playhead, or remove the keys there) and the helpers of the 'keyframe' sheet
// (keyed properties, previous/next key, labels). Everything goes through the editor's keyframe
// actions (addKeyframe, removeKeyframe, getInterpolatedTransform), the same ones the desktop
// keyframe lanes use, so the result opens unchanged at /editor.

import { TEXT_NUMERIC_PARAMETERS, parseTextProperty } from '../../../services/text/textAnimation';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { getValueFromTransform } from '../../../utils/keyframeInterpolation';
import { runPhoneEditBatch } from '../actions/phoneClipEditActions';
import type { PhoneActionResult } from '../contracts';

/** What the diamond keys: the clip's 2D transform and opacity. */
export const PHONE_KEYFRAME_PROPERTIES = [
  'position.x', 'position.y', 'scale.x', 'scale.y', 'rotation.z', 'opacity',
] as const satisfies readonly AnimatableProperty[];

/** Same tolerance as the editor's getKeyframeAtTime (addKeyframe merges keys this close). */
export const PHONE_KEYFRAME_TIME_TOLERANCE = 0.01;

const PROPERTY_LABELS: Record<string, string> = {
  opacity: 'Opacity', 'position.x': 'Position X', 'position.y': 'Position Y', 'position.z': 'Position Z',
  'scale.all': 'Scale', 'scale.x': 'Scale X', 'scale.y': 'Scale Y', 'scale.z': 'Scale Z',
  'rotation.x': 'Rotation X', 'rotation.y': 'Rotation Y', 'rotation.z': 'Rotation', speed: 'Speed',
  'anchor.x': 'Anchor X', 'anchor.y': 'Anchor Y', 'anchor.z': 'Anchor Z',
};

/** A short human label for any keyframe property path. */
export function phoneKeyframePropertyLabel(property: string, clip?: Pick<TimelineClip, 'effects'>): string {
  if (PROPERTY_LABELS[property]) return PROPERTY_LABELS[property];
  const text = parseTextProperty(property);
  if (text) return `Text ${TEXT_NUMERIC_PARAMETERS[text].label.toLowerCase()}`;
  if (property.startsWith('effect.')) {
    const [, effectId, ...rest] = property.split('.');
    const effect = clip?.effects?.find((candidate) => candidate.id === effectId);
    return `${effect?.name ?? 'Effect'} · ${rest.join('.')}`;
  }
  if (property.startsWith('mask.')) return `Mask · ${property.split('.').slice(2).join('.')}`;
  return property;
}

export type PhoneKeyframeTarget =
  | { ok: true; clip: TimelineClip }
  | { ok: false; reason: string };

/** The clip the diamond and sheet work on: the primary selected clip (or the first selected one). */
export function resolvePhoneKeyframeTarget(state = useTimelineStore.getState()): PhoneKeyframeTarget {
  const selected = state.clips.filter((clip) => state.selectedClipIds.has(clip.id));
  const clip = selected.find((candidate) => candidate.id === state.primarySelectedClipId) ?? selected[0];
  if (!clip) return { ok: false, reason: 'Select a clip first, then tap the diamond to key its position, scale, rotation and opacity at the playhead.' };
  const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
  if (track?.type !== 'video') return { ok: false, reason: 'Audio clips have no picture to key. Volume keyframes come with the audio tools.' };
  if (track.locked) return { ok: false, reason: 'This clip is on a locked track. Unlock the track in the full editor to change its keyframes.' };
  if (state.isExporting) return { ok: false, reason: 'Keyframes cannot change while an export is running.' };
  return { ok: true, clip };
}

/** Clip-local time of the playhead, or null when the playhead is outside the clip. */
export function phoneClipLocalTime(clip: Pick<TimelineClip, 'startTime' | 'duration'>, playhead: number): number | null {
  const local = playhead - clip.startTime;
  return local < -1e-6 || local > clip.duration + 1e-6 ? null : Math.max(0, Math.min(clip.duration, local));
}

export function phoneKeysAt(keys: readonly Keyframe[], localTime: number): Keyframe[] {
  return keys.filter((key) => Math.abs(key.time - localTime) < PHONE_KEYFRAME_TIME_TOLERANCE);
}

/** Diamond state for a clip at the playhead: 'on' when any keyframe of the clip sits there. */
export function phoneDiamondState(keys: readonly Keyframe[], clip: Pick<TimelineClip, 'startTime' | 'duration'>, playhead: number): 'on' | 'off' | 'outside' {
  const local = phoneClipLocalTime(clip, playhead);
  if (local === null) return 'outside';
  return phoneKeysAt(keys, local).length > 0 ? 'on' : 'off';
}

/**
 * The diamond: with keys at the playhead it removes them all (one undo step); otherwise it adds
 * one key per transform property with the value the clip shows there (one undo step).
 */
export function togglePhoneKeyframeAtPlayhead(): PhoneActionResult {
  const target = resolvePhoneKeyframeTarget();
  if (!target.ok) return { ok: false, message: target.reason };
  const { clip } = target;
  const state = useTimelineStore.getState();
  const local = phoneClipLocalTime(clip, state.playheadPosition);
  if (local === null) return { ok: false, message: 'Move the playhead onto the selected clip to key it there.' };
  const existing = phoneKeysAt(state.clipKeyframes.get(clip.id) ?? [], local);
  if (existing.length > 0) {
    return runPhoneEditBatch('Remove keyframes', () => {
      for (const key of existing) useTimelineStore.getState().removeKeyframe(key.id);
      const left = phoneKeysAt(useTimelineStore.getState().clipKeyframes.get(clip.id) ?? [], local);
      return left.length === 0
        ? { ok: true, message: `Removed ${existing.length} keyframe${existing.length === 1 ? '' : 's'}` }
        : { ok: false, message: 'Some keyframes could not be removed.' };
    });
  }
  const transform = state.getInterpolatedTransform(clip.id, local);
  return runPhoneEditBatch('Add keyframe', () => {
    for (const property of PHONE_KEYFRAME_PROPERTIES) {
      useTimelineStore.getState().addKeyframe(clip.id, property, getValueFromTransform(transform, property), local);
    }
    const added = phoneKeysAt(useTimelineStore.getState().clipKeyframes.get(clip.id) ?? [], local).length;
    return added >= PHONE_KEYFRAME_PROPERTIES.length
      ? { ok: true, message: 'Keyframe added' }
      : { ok: false, message: 'The editor did not accept the keyframe (is the track locked?).' };
  });
}

export interface PhoneKeyedProperty {
  property: AnimatableProperty;
  label: string;
  keys: Keyframe[];
}

/** The clip's keyed properties, transform first, each with its keys in time order. */
export function listPhoneKeyedProperties(keys: readonly Keyframe[], clip?: Pick<TimelineClip, 'effects'>): PhoneKeyedProperty[] {
  const groups = new Map<AnimatableProperty, Keyframe[]>();
  for (const key of keys) groups.set(key.property, [...(groups.get(key.property) ?? []), key]);
  const order = (property: string) => {
    const index = (PHONE_KEYFRAME_PROPERTIES as readonly string[]).indexOf(property);
    return index < 0 ? PHONE_KEYFRAME_PROPERTIES.length : index;
  };
  return [...groups.entries()]
    .map(([property, list]) => ({ property, label: phoneKeyframePropertyLabel(property, clip), keys: list.toSorted((a, b) => a.time - b.time) }))
    .toSorted((a, b) => order(a.property) - order(b.property) || a.label.localeCompare(b.label));
}

/** Distinct key times of the clip before/after `local` (clip-local seconds), or null. */
export function adjacentPhoneKeyTime(keys: readonly Keyframe[], local: number, direction: -1 | 1): number | null {
  const times = [...new Set(keys.map((key) => key.time))].toSorted((a, b) => a - b);
  if (direction > 0) return times.find((time) => time > local + PHONE_KEYFRAME_TIME_TOLERANCE) ?? null;
  return times.toReversed().find((time) => time < local - PHONE_KEYFRAME_TIME_TOLERANCE) ?? null;
}
