// Writes a planned animation into the editor through its keyframe actions (addKeyframe,
// updateKeyframe, removeKeyframe), the same actions the desktop keyframe lanes and AI tools use.
// The write is a diff from the store's current keys to the COMPLETE desired set of the managed
// properties, so repeating it is harmless (an absolute write, as the phone edit session requires).

import { resolveTransformPositionUnitMode } from '../../../services/properties/propertyAuthoring';
import { useTimelineStore } from '../../../stores/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import {
  EMPTY_PHONE_ANIMATION, isPhoneManagedProperty, mergePhoneAnimationChoice, planPhoneAnimation, recognizePhoneAnimation,
  type PhoneAnimationChoice, type PhoneAnimationPart, type PhoneAnimationPlan, type PhoneDesiredKey, type PhoneRecognizedKeys,
} from './phoneAnimationPresets';

const TIME_EPSILON = 1e-5;

function sameKey(key: Keyframe, want: PhoneDesiredKey): boolean {
  return Object.is(key.value, want.value) && key.easing === want.easing && !!key.hold === !!want.hold
    && JSON.stringify(key.handleIn ?? null) === JSON.stringify(want.handleIn ?? null)
    && JSON.stringify(key.handleOut ?? null) === JSON.stringify(want.handleOut ?? null)
    && (key.rotationInterpolation ?? null) === (want.rotationInterpolation ?? null);
}

function detailFields(want: PhoneDesiredKey) {
  return {
    hold: want.hold, handleIn: want.handleIn, handleOut: want.handleOut, rotationInterpolation: want.rotationInterpolation,
  };
}

/** Makes the clip's managed keys equal to `desired` (other properties stay untouched). */
export function writePhoneDesiredKeys(clipId: string, desired: readonly PhoneDesiredKey[]): void {
  const state = useTimelineStore.getState();
  const current = (state.clipKeyframes.get(clipId) ?? []).filter((key) => isPhoneManagedProperty(key.property));
  const unused = [...desired];
  for (const key of current) {
    const index = unused.findIndex((want) => want.property === key.property && Math.abs(want.time - key.time) < TIME_EPSILON);
    if (index < 0) { useTimelineStore.getState().removeKeyframe(key.id); continue; }
    const [want] = unused.splice(index, 1);
    if (!sameKey(key, want)) useTimelineStore.getState().updateKeyframe(key.id, { value: want.value, easing: want.easing, ...detailFields(want) });
  }
  for (const want of unused) {
    useTimelineStore.getState().addKeyframe(clipId, want.property, want.value, want.time, want.easing);
    if (want.hold || want.handleIn || want.handleOut || want.rotationInterpolation) {
      const added = (useTimelineStore.getState().clipKeyframes.get(clipId) ?? [])
        .find((key) => key.property === want.property && Math.abs(key.time - want.time) < TIME_EPSILON);
      if (added) useTimelineStore.getState().updateKeyframe(added.id, detailFields(want));
    }
  }
}

/** One clip the animation sheet edits, captured when the sheet opened. */
export interface PhoneAnimationTarget {
  clipId: string;
  clipName: string;
  clipDuration: number;
  isText: boolean;
  transform: TimelineClip['transform'];
  /** Keys at open minus the recognised preset keys: what a new preset is planned on. */
  baseKeys: Keyframe[];
  recognized: PhoneAnimationChoice;
  /** The recognised keys per part, kept verbatim (easing, handles) while that part is unchanged. */
  recognizedKeys: PhoneRecognizedKeys['keys'];
}

export interface PhoneAnimationTargets {
  targets: PhoneAnimationTarget[];
  /** Selected clips the sheet cannot animate (audio, 3D), with the reason shown in the sheet. */
  skipped: { clipId: string; name: string; reason: string }[];
}

export function phoneAnimationSkipReason(clip: TimelineClip, trackType: string | undefined, locked: boolean): string | null {
  if (trackType !== 'video') return 'audio clips have no picture to animate (use Volume for fades)';
  if (locked) return 'its track is locked';
  if (resolveTransformPositionUnitMode(clip) !== 'composition-pixels') return '3D and camera clips move in scene units; animate them in the full editor';
  return null;
}

/** The selected clips (primary first) split into animatable targets and skipped ones. */
export function capturePhoneAnimationTargets(): PhoneAnimationTargets {
  const state = useTimelineStore.getState();
  const selected = state.clips.filter((clip) => state.selectedClipIds.has(clip.id))
    .toSorted((a, b) => Number(b.id === state.primarySelectedClipId) - Number(a.id === state.primarySelectedClipId));
  const targets: PhoneAnimationTarget[] = [];
  const skipped: PhoneAnimationTargets['skipped'] = [];
  for (const clip of selected) {
    const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
    const reason = phoneAnimationSkipReason(clip, track?.type, track?.locked === true);
    if (reason) { skipped.push({ clipId: clip.id, name: clip.name, reason }); continue; }
    const keys = state.clipKeyframes.get(clip.id) ?? [];
    const recognition = recognizePhoneAnimation(keys, clip.duration, {
      mode: clip.textProperties?.revealMode, cursor: clip.textProperties?.revealCursor,
    });
    const keysOf = (ids: readonly string[]) => structuredClone(keys.filter((key) => ids.includes(key.id)));
    targets.push({
      clipId: clip.id, clipName: clip.name, clipDuration: clip.duration,
      isText: clip.source?.type === 'text' && !!clip.textProperties,
      transform: structuredClone(clip.transform),
      baseKeys: keys.filter((key) => !recognition.keyIds.has(key.id)),
      recognized: recognition.choice,
      recognizedKeys: {
        in: keysOf(recognition.partKeyIds.in), out: keysOf(recognition.partKeyIds.out), reveal: keysOf(recognition.partKeyIds.reveal),
      },
    });
  }
  return { targets, skipped };
}

const ALL_PARTS: ReadonlySet<PhoneAnimationPart> = new Set(['in', 'out', 'reveal']);

/**
 * The plan of one target. `touched` names the parts the user changed in the sheet: only those come
 * from `choice`, the target keeps its own recognised other parts (a secondary clip's existing In
 * survives an Out-only edit). Without `touched`, the whole choice applies.
 */
export function planForTarget(
  target: PhoneAnimationTarget, choice: PhoneAnimationChoice, touched: ReadonlySet<PhoneAnimationPart> = ALL_PARTS,
): PhoneAnimationPlan {
  const merged = mergePhoneAnimationChoice(target.recognized, choice, touched);
  // Reveal only applies to text clips; other clips in a mixed selection ignore it.
  const effective = target.isText ? merged : { ...merged, reveal: null };
  return planPhoneAnimation({
    baseKeys: target.baseKeys, clipDuration: target.clipDuration, transform: target.transform, choice: effective,
    recognized: { choice: target.recognized, keys: target.recognizedKeys },
  });
}

/** Absolute write of the touched parts of `choice` to every target (inside the caller's transaction). */
export function writePhoneAnimation(
  targets: readonly PhoneAnimationTarget[], choice: PhoneAnimationChoice = EMPTY_PHONE_ANIMATION,
  touched: ReadonlySet<PhoneAnimationPart> = ALL_PARTS,
): void {
  for (const target of targets) {
    if (!useTimelineStore.getState().clips.some((clip) => clip.id === target.clipId)) continue;
    const plan = planForTarget(target, choice, touched);
    writePhoneDesiredKeys(target.clipId, plan.desired);
    const reveal = plan.choice.reveal;
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === target.clipId);
    if (reveal && clip?.textProperties && (clip.textProperties.revealMode !== reveal.mode || !!clip.textProperties.revealCursor !== reveal.cursor)) {
      useTimelineStore.getState().updateTextProperties(target.clipId, { revealMode: reveal.mode, revealCursor: reveal.cursor });
    }
  }
}
