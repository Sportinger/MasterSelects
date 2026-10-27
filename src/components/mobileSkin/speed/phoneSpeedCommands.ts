// Speed commands of the phone skin. They use the same store actions as the desktop speed controls
// (setClipSpeed, setClipPreservesPitch, toggleClipReverse) and retime menu (setClipTimeRemap), so
// the clip's length follows the speed exactly as on the desktop and a linked audio clip follows its
// video. applyPhoneSpeedState is ABSOLUTE: it brings the clip to the desired state from whatever
// state it is in, so the sheet's edit session can re-apply it safely.

import { useTimelineStore } from '../../../stores/timeline';
import { CLIP_SPEED_MAX_MULTIPLIER, CLIP_SPEED_MIN_MULTIPLIER } from '../../../stores/timeline/helpers/linkedClipSpeed';
import type { TimelineClip } from '../../../types/timeline';
import { buildPhoneSpeedCurveWarp, identifyPhoneSpeedCurve, type PhoneSpeedCurveId } from './phoneSpeedCurves';

export const PHONE_SPEED_MIN = CLIP_SPEED_MIN_MULTIPLIER;
export const PHONE_SPEED_MAX = CLIP_SPEED_MAX_MULTIPLIER;
export const PHONE_SPEED_CHIPS: readonly number[] = [0.1, 0.25, 0.5, 1, 2, 4, 10];
/** Outside this range the browser preview cannot keep up; exports stay exact (same hint as the desktop). */
export const PHONE_SPEED_PREVIEW_RANGE = { min: 0.25, max: 4 } as const;

export type PhoneSpeedCurveChoice = 'keep' | 'none' | PhoneSpeedCurveId;

export interface PhoneSpeedSnapshot {
  clipId: string;
  name: string;
  /** Signed speed (negative plays backward, desktop convention). */
  speed: number;
  preservesPitch: boolean;
  reversed: boolean;
  remapKind: 'freeze' | 'loop' | 'warp' | null;
  /** The phone preset that made the clip's warp, when it was one. */
  curve: PhoneSpeedCurveId | null;
  hasSpeedKeyframes: boolean;
  duration: number;
}

export interface PhoneSpeedDesired {
  /** Speed magnitude; the clip keeps its sign (direction). */
  magnitude: number;
  preservesPitch: boolean;
  reversed: boolean;
  /** 'keep' leaves the clip's retime untouched; 'none' removes it; a preset replaces it. */
  curve: PhoneSpeedCurveChoice;
}

/** Why this clip has no speed on the phone, or null when it has. Same rule as the desktop's temporal sections. */
export function phoneSpeedUnavailableReason(clip: Pick<TimelineClip, 'source'> | undefined): string | null {
  if (!clip) return 'Select a video or audio clip first.';
  const type = clip.source?.type;
  if (type === 'video' || type === 'audio') return null;
  return `Speed changes how fast footage plays, so it needs a video or audio clip. This is a ${type ?? 'generated'} clip, which has no footage to speed up; change its length with the trim handles instead.`;
}

export interface PhoneSpeedTarget {
  /** The clip the sheet retimes: the primary selection, else the first selected clip (its linked audio or video follows it). */
  clip: TimelineClip | undefined;
  /** Other selected clips the sheet leaves unchanged (the target's linked partner is not one of them). */
  leftOut: TimelineClip[];
}

/** The speed sheet's target and the selected clips it does NOT change, so the sheet can say so. */
export function phoneSpeedTarget(): PhoneSpeedTarget {
  const state = useTimelineStore.getState();
  const id = state.primarySelectedClipId && state.selectedClipIds.has(state.primarySelectedClipId)
    ? state.primarySelectedClipId
    : [...state.selectedClipIds][0];
  const clip = id ? state.clips.find((item) => item.id === id) : undefined;
  if (!clip) return { clip: undefined, leftOut: [] };
  const followsTarget = (other: TimelineClip) => other.id === clip.id || other.id === clip.linkedClipId || other.linkedClipId === clip.id;
  const leftOut = state.clips.filter((other) => state.selectedClipIds.has(other.id) && !followsTarget(other));
  return { clip, leftOut };
}

/** The sheet's line about selected clips it leaves alone, or null when the selection is just the target. */
export function phoneSpeedLeftOutNote(target: PhoneSpeedTarget): string | null {
  const count = target.leftOut.length;
  if (!target.clip || count === 0) return null;
  const others = count === 1 ? `the other selected clip (${target.leftOut[0].name})` : `the other ${count} selected clips`;
  return `Only this clip changes; ${others} ${count === 1 ? 'keeps its' : 'keep their'} speed. Select a clip on its own to change it.`;
}

function isBackward(speed: number, reversed: boolean): boolean {
  return (speed < 0) !== reversed;
}

export function readPhoneSpeedSnapshot(clip: TimelineClip): PhoneSpeedSnapshot {
  const state = useTimelineStore.getState();
  const speed = clip.speed ?? 1;
  const reversed = clip.reversed === true;
  const warp = clip.timeRemap?.kind === 'warp' ? clip.timeRemap : undefined;
  return {
    clipId: clip.id,
    name: clip.name,
    speed,
    preservesPitch: clip.preservesPitch !== false,
    reversed,
    remapKind: clip.timeRemap?.kind ?? null,
    curve: identifyPhoneSpeedCurve({
      duration: clip.duration, inPoint: clip.inPoint, outPoint: clip.outPoint, backward: isBackward(speed, reversed),
    }, warp),
    hasSpeedKeyframes: state.hasKeyframes(clip.id, 'speed'),
    duration: clip.duration,
  };
}

/** Rounds a speed for display and storage: 0.01x steps below 2x, 0.1x above. */
export function roundPhoneSpeed(speed: number): number {
  const clamped = Math.min(PHONE_SPEED_MAX, Math.max(PHONE_SPEED_MIN, speed));
  return clamped < 2 ? Math.round(clamped * 100) / 100 : Math.round(clamped * 10) / 10;
}

/** Slider position 0..1000 on a logarithmic scale from 0.1x to 10x (1x sits in the middle). */
export const PHONE_SPEED_SLIDER_STEPS = 1000;
export function phoneSpeedToSlider(speed: number): number {
  const clamped = Math.min(PHONE_SPEED_MAX, Math.max(PHONE_SPEED_MIN, speed));
  return Math.round((PHONE_SPEED_SLIDER_STEPS * Math.log(clamped / PHONE_SPEED_MIN)) / Math.log(PHONE_SPEED_MAX / PHONE_SPEED_MIN));
}
export function phoneSliderToSpeed(position: number): number {
  const raw = PHONE_SPEED_MIN * (PHONE_SPEED_MAX / PHONE_SPEED_MIN) ** (position / PHONE_SPEED_SLIDER_STEPS);
  // Snap to a chip within 4 % so the common speeds are easy to hit with a thumb.
  const chip = PHONE_SPEED_CHIPS.find((value) => Math.abs(raw / value - 1) < 0.04);
  return chip ?? roundPhoneSpeed(raw);
}

export function formatPhoneSpeed(speed: number): string {
  const text = speed < 1 ? speed.toFixed(2).replace(/0$/, '') : speed < 2 ? speed.toFixed(2).replace(/\.?0+$/, '') : speed.toFixed(1).replace(/\.0$/, '');
  return `${text}x`;
}

/** Brings the clip to `desired` through the editor's speed actions. Returns the problems the editor reported. */
export function applyPhoneSpeedState(original: PhoneSpeedSnapshot, desired: PhoneSpeedDesired): string[] {
  const clipId = original.clipId;
  const store = () => useTimelineStore.getState();
  const current = () => store().clips.find((clip) => clip.id === clipId);
  const problems: string[] = [];
  let clip = current();
  if (!clip) return ['The clip no longer exists.'];
  const lockedReason = 'The clip sits on a locked track; unlock the track in the full editor to change its speed.';

  if ((clip.reversed === true) !== desired.reversed) {
    store().toggleClipReverse(clipId);
    if ((current()?.reversed === true) !== desired.reversed) problems.push(lockedReason);
  }
  clip = current()!;
  if ((clip.preservesPitch !== false) !== desired.preservesPitch) store().setClipPreservesPitch(clipId, desired.preservesPitch);

  const magnitude = Math.min(PHONE_SPEED_MAX, Math.max(PHONE_SPEED_MIN, desired.magnitude));
  if (magnitude !== desired.magnitude) problems.push(`Speed is limited to ${PHONE_SPEED_MIN}x–${PHONE_SPEED_MAX}x; it was set to ${formatPhoneSpeed(magnitude)}.`);
  const signed = (original.speed < 0 ? -1 : 1) * magnitude;

  if (desired.curve === 'keep') {
    clip = current()!;
    const now = original.hasSpeedKeyframes
      ? store().getInterpolatedSpeed(clipId, store().playheadPosition - clip.startTime)
      : clip.speed ?? 1;
    if (Math.abs(now - signed) > 1e-9 && !store().setClipSpeed(clipId, signed)) problems.push(lockedReason);
    return problems;
  }

  clip = current()!;
  if (clip.timeRemap && !store().setClipTimeRemap(clipId, null)) problems.push(lockedReason);
  if (!store().setClipSpeed(clipId, signed)) problems.push(lockedReason);
  if (desired.curve === 'none') return [...new Set(problems)];

  clip = current()!;
  const warp = buildPhoneSpeedCurveWarp({
    duration: clip.duration, inPoint: clip.inPoint, outPoint: clip.outPoint, backward: isBackward(signed, desired.reversed),
  }, desired.curve);
  if (!warp) problems.push('This clip has no footage range to put a speed curve on.');
  else if (!store().setClipTimeRemap(clipId, warp)) problems.push(lockedReason);
  return [...new Set(problems)];
}
