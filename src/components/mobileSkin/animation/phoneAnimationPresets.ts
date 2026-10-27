// Animation presets of the phone skin, built from the editor's own transform/opacity keyframes.
// The editor has no clip animation preset model (only keyframes, plus the AI hook-motion program),
// so an In / Out / Combo preset IS a small set of ordinary keyframes: what the phone writes opens
// unchanged in the desktop keyframe lanes and exports exactly like hand-made keys.
//
// Pure module: generation, planning (the complete desired key set of the managed properties) and
// recognition of a preset in existing keys, so reopening the sheet shows what the clip has.
//
// Units: transform.position is stored normalized (1 = half the composition), so ±2 moves a
// full-frame layer exactly one composition width/height; +y is down. Scale is a factor, rotation
// in degrees, opacity 0..1.

import type { AnimatableProperty, EasingType } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipTransform } from '../../../types/timelineCore';
import { getValueFromTransform, interpolateKeyframes } from '../../../utils/keyframeInterpolation';

export const PHONE_ANIMATION_PROPERTIES = [
  'opacity', 'position.x', 'position.y', 'scale.x', 'scale.y', 'rotation.z',
] as const satisfies readonly AnimatableProperty[];
export type PhoneAnimationProperty = typeof PHONE_ANIMATION_PROPERTIES[number];
export const PHONE_REVEAL_PROPERTY = 'text.reveal' as const;

export const PHONE_ANIMATION_MIN_DURATION = 0.1;
export const PHONE_ANIMATION_DEFAULT_DURATION = 0.5;
const TIME_EPSILON = 1e-4;
const VALUE_EPSILON = 1e-4;

type ValueOf = (settled: number) => number;
/** One property's keys inside the window: fraction 0 = the "away" end, 1 = the settled end. */
interface PresetTrack { property: PhoneAnimationProperty; frames: readonly (readonly [number, ValueOf])[] }
export interface PhoneAnimationPresetDefinition { id: string; label: string; tracks: readonly PresetTrack[] }

const settledAt: ValueOf = (settled) => settled;
const fade: PresetTrack = { property: 'opacity', frames: [[0, () => 0], [1, settledAt]] };
const shift = (property: 'position.x' | 'position.y', offset: number): PresetTrack => ({
  property, frames: [[0, (settled) => settled + offset], [1, settledAt]],
});
const scaleTo = (factor: number): PresetTrack[] => (['scale.x', 'scale.y'] as const).map((property) => ({
  property, frames: [[0, (settled: number) => settled * factor], [1, settledAt]] as const,
}));
const pop: PresetTrack[] = [
  ...(['scale.x', 'scale.y'] as const).map((property) => ({
    property, frames: [[0, (settled: number) => settled * 0.3], [0.7, (settled: number) => settled * 1.12], [1, settledAt]] as const,
  })),
  { property: 'opacity', frames: [[0, () => 0], [0.4, settledAt]] },
];
const spin = (degrees: number): PresetTrack[] => [
  { property: 'rotation.z', frames: [[0, (settled) => settled + degrees], [1, settledAt]] },
  ...scaleTo(0.5),
  fade,
];

export const PHONE_IN_PRESETS: readonly PhoneAnimationPresetDefinition[] = [
  { id: 'fade', label: 'Fade in', tracks: [fade] },
  { id: 'left', label: 'From left', tracks: [shift('position.x', -2)] },
  { id: 'right', label: 'From right', tracks: [shift('position.x', 2)] },
  { id: 'top', label: 'From top', tracks: [shift('position.y', -2)] },
  { id: 'bottom', label: 'From bottom', tracks: [shift('position.y', 2)] },
  { id: 'zoom-in', label: 'Zoom in', tracks: [...scaleTo(0.5), fade] },
  { id: 'zoom-out', label: 'Zoom out', tracks: [...scaleTo(1.6), fade] },
  { id: 'spin', label: 'Spin in', tracks: spin(-180) },
  { id: 'pop', label: 'Pop', tracks: pop },
];

export const PHONE_OUT_PRESETS: readonly PhoneAnimationPresetDefinition[] = [
  { id: 'fade', label: 'Fade out', tracks: [fade] },
  { id: 'left', label: 'To left', tracks: [shift('position.x', -2)] },
  { id: 'right', label: 'To right', tracks: [shift('position.x', 2)] },
  { id: 'top', label: 'To top', tracks: [shift('position.y', -2)] },
  { id: 'bottom', label: 'To bottom', tracks: [shift('position.y', 2)] },
  { id: 'zoom-in', label: 'Zoom in', tracks: [...scaleTo(1.6), fade] },
  { id: 'zoom-out', label: 'Zoom out', tracks: [...scaleTo(0.5), fade] },
  { id: 'spin', label: 'Spin out', tracks: spin(180) },
  { id: 'pop', label: 'Pop', tracks: pop },
];

/** A combo is an In and an Out preset with one duration each side. */
export const PHONE_COMBO_PRESETS: readonly { id: string; label: string; in: string; out: string }[] = [
  { id: 'fade-in-out', label: 'Fade in & out', in: 'fade', out: 'fade' },
  { id: 'slide-through', label: 'Slide through', in: 'right', out: 'left' },
  { id: 'rise-fall', label: 'Rise & fall', in: 'bottom', out: 'bottom' },
  { id: 'pulse', label: 'Grow & shrink', in: 'zoom-in', out: 'zoom-out' },
  { id: 'spin-in-out', label: 'Spin in & out', in: 'spin', out: 'spin' },
  { id: 'pop-in-out', label: 'Pop in & out', in: 'pop', out: 'pop' },
];

export const PHONE_REVEAL_MODES = [
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'decode', label: 'Decode' },
  { id: 'fade', label: 'Fade' },
  { id: 'rise', label: 'Rise' },
] as const;
export type PhoneRevealMode = typeof PHONE_REVEAL_MODES[number]['id'];

export interface PhoneAnimationSide { preset: string; duration: number }
export interface PhoneRevealChoice { mode: PhoneRevealMode; duration: number; cursor: boolean }
export interface PhoneAnimationChoice {
  in: PhoneAnimationSide | null;
  out: PhoneAnimationSide | null;
  /** Set when in/out came from a combo (the sheet shows the Combo tab selected). */
  combo: string | null;
  /** Character reveal of a text clip (text.reveal keyframes). */
  reveal: PhoneRevealChoice | null;
}

export const EMPTY_PHONE_ANIMATION: PhoneAnimationChoice = { in: null, out: null, combo: null, reveal: null };

export type PhoneAnimationPart = 'in' | 'out' | 'reveal';

/**
 * The choice one clip of a multi-selection gets: the parts the user touched in the sheet come from
 * `choice`, every other part stays what that clip already had (`base`, its recognised choice).
 * A combo survives only when both its sides come from the same source.
 */
export function mergePhoneAnimationChoice(
  base: PhoneAnimationChoice, choice: PhoneAnimationChoice, touched: ReadonlySet<PhoneAnimationPart>,
): PhoneAnimationChoice {
  const pick = <K extends PhoneAnimationPart>(part: K) => (touched.has(part) ? choice[part] : base[part]);
  const combo = touched.has('in') && touched.has('out') ? choice.combo
    : !touched.has('in') && !touched.has('out') ? base.combo : null;
  return { in: pick('in'), out: pick('out'), combo, reveal: pick('reveal') };
}

/** Keys of each part the sheet recognised when it opened (kept verbatim while the part is unchanged). */
export interface PhoneRecognizedKeys {
  choice: PhoneAnimationChoice;
  keys: Readonly<Record<PhoneAnimationPart, readonly Keyframe[]>>;
}

/** A keyframe the plan wants, without id (base keys keep their authored easing and handles). */
export interface PhoneDesiredKey {
  property: AnimatableProperty;
  time: number;
  value: number;
  easing: EasingType;
  hold?: boolean;
  handleIn?: Keyframe['handleIn'];
  handleOut?: Keyframe['handleOut'];
  rotationInterpolation?: Keyframe['rotationInterpolation'];
}

export function findPhonePreset(side: 'in' | 'out', id: string): PhoneAnimationPresetDefinition | undefined {
  return (side === 'in' ? PHONE_IN_PRESETS : PHONE_OUT_PRESETS).find((preset) => preset.id === id);
}

function windowTime(side: 'in' | 'out', fraction: number, duration: number, clipDuration: number): number {
  return side === 'in' ? fraction * duration : clipDuration - fraction * duration;
}

/** Keys of one preset side, given the settled value of each property at the window's inner edge. */
export function buildPhonePresetKeys(
  side: 'in' | 'out', preset: PhoneAnimationPresetDefinition, duration: number, clipDuration: number,
  settled: (property: PhoneAnimationProperty) => number,
): PhoneDesiredKey[] {
  const keys: PhoneDesiredKey[] = [];
  for (const track of preset.tracks) {
    const value = settled(track.property);
    const sorted = track.frames
      .map(([fraction, of]) => ({ time: windowTime(side, fraction, duration, clipDuration), value: of(value) }))
      .toSorted((a, b) => a.time - b.time);
    sorted.forEach((key, index) => keys.push({
      property: track.property, time: key.time, value: key.value,
      easing: index === sorted.length - 1 ? 'linear' : side === 'in' ? 'ease-out' : 'ease-in',
    }));
  }
  return keys;
}

/** Fits In + Out into the clip; says when it had to shorten one (never silently). */
export function fitPhoneAnimationDurations(choice: PhoneAnimationChoice, clipDuration: number): { choice: PhoneAnimationChoice; clamped: boolean } {
  const limit = Math.max(PHONE_ANIMATION_MIN_DURATION, clipDuration);
  const fit = (side: PhoneAnimationSide | null, max: number) => side ? { ...side, duration: Math.max(PHONE_ANIMATION_MIN_DURATION, Math.min(max, side.duration)) } : null;
  let inSide = fit(choice.in, limit);
  let outSide = fit(choice.out, limit);
  if (inSide && outSide && inSide.duration + outSide.duration > limit + TIME_EPSILON) {
    if (choice.combo) {
      inSide = { ...inSide, duration: limit / 2 };
      outSide = { ...outSide, duration: limit / 2 };
    } else {
      outSide = { ...outSide, duration: Math.max(PHONE_ANIMATION_MIN_DURATION, limit - inSide.duration) };
      inSide = { ...inSide, duration: limit - outSide.duration };
    }
  }
  const reveal = choice.reveal ? { ...choice.reveal, duration: Math.max(PHONE_ANIMATION_MIN_DURATION, Math.min(limit, choice.reveal.duration)) } : null;
  const clamped = (choice.in?.duration ?? 0) !== (inSide?.duration ?? 0) || (choice.out?.duration ?? 0) !== (outSide?.duration ?? 0)
    || (choice.reveal?.duration ?? 0) !== (reveal?.duration ?? 0);
  return { choice: { ...choice, in: inSide, out: outSide, reveal }, clamped };
}

function toDesired(key: Keyframe): PhoneDesiredKey {
  return {
    property: key.property, time: key.time, value: key.value, easing: key.easing,
    ...(key.hold ? { hold: true } : {}),
    ...(key.handleIn ? { handleIn: key.handleIn } : {}),
    ...(key.handleOut ? { handleOut: key.handleOut } : {}),
    ...(key.rotationInterpolation ? { rotationInterpolation: key.rotationInterpolation } : {}),
  };
}

const MANAGED: ReadonlySet<string> = new Set([...PHONE_ANIMATION_PROPERTIES, PHONE_REVEAL_PROPERTY]);
export function isPhoneManagedProperty(property: string): boolean { return MANAGED.has(property); }

export interface PhoneAnimationPlan {
  /** The complete desired key set of the managed properties (others are never touched). */
  desired: PhoneDesiredKey[];
  /** Existing keys inside a preset window that the preset replaces (shown in the sheet). */
  replaced: number;
  clamped: boolean;
  choice: PhoneAnimationChoice;
}

/**
 * Desired keys for `choice`. `baseKeys` are the clip's keys when the sheet opened, minus the keys of
 * the preset the sheet recognised there (so switching presets replaces it instead of stacking).
 */
export function planPhoneAnimation(input: {
  baseKeys: readonly Keyframe[]; clipDuration: number; transform: ClipTransform; choice: PhoneAnimationChoice;
  /** The recognised preset keys: a part whose preset and duration did not change keeps them as authored. */
  recognized?: PhoneRecognizedKeys;
}): PhoneAnimationPlan {
  const { baseKeys, clipDuration, transform, recognized } = input;
  const { choice, clamped } = fitPhoneAnimationDurations(input.choice, clipDuration);
  const sides = ([['in', choice.in], ['out', choice.out]] as const)
    .map(([side, pick]) => (pick ? { side, pick, preset: findPhonePreset(side, pick.preset) } : null))
    .filter((entry): entry is { side: 'in' | 'out'; pick: PhoneAnimationSide; preset: PhoneAnimationPresetDefinition } => !!entry?.preset);

  const inWindow = (key: Keyframe) => sides.some(({ side, pick, preset }) => preset.tracks.some((track) => track.property === key.property)
    && (side === 'in' ? key.time <= pick.duration + TIME_EPSILON : key.time >= clipDuration - pick.duration - TIME_EPSILON))
    || (choice.reveal !== null && key.property === PHONE_REVEAL_PROPERTY && key.time <= choice.reveal.duration + TIME_EPSILON);
  const managedBase = baseKeys.filter((key) => MANAGED.has(key.property));
  const kept = managedBase.filter((key) => !inWindow(key));
  const replaced = managedBase.length - kept.length;

  const sample = (property: PhoneAnimationProperty, time: number) => interpolateKeyframes(kept as Keyframe[], property, time, getValueFromTransform(transform, property));
  const merged = new Map<string, PhoneDesiredKey>();
  const put = (key: PhoneDesiredKey) => merged.set(`${key.property}@${key.time.toFixed(5)}`, key);
  kept.forEach((key) => put(toDesired(key)));
  // An unchanged part keeps its existing keys, with their hand-made easing and bezier handles.
  const unchangedSide = (side: 'in' | 'out', pick: PhoneAnimationSide) => {
    const had = recognized?.choice[side];
    return !!had && had.preset === pick.preset && Math.abs(had.duration - pick.duration) < TIME_EPSILON && recognized!.keys[side].length > 0;
  };
  const unchangedReveal = !!choice.reveal && !!recognized?.choice.reveal && recognized.keys.reveal.length > 0
    && Math.abs(recognized.choice.reveal.duration - choice.reveal.duration) < TIME_EPSILON;
  for (const { side, pick } of sides) if (unchangedSide(side, pick)) recognized!.keys[side].forEach((key) => put(toDesired(key)));
  for (const { side, pick, preset } of sides) {
    if (unchangedSide(side, pick)) continue;
    const edge = side === 'in' ? pick.duration : clipDuration - pick.duration;
    buildPhonePresetKeys(side, preset, pick.duration, clipDuration, (property) => sample(property, edge)).forEach(put);
  }
  if (unchangedReveal) {
    recognized!.keys.reveal.forEach((key) => put(toDesired(key)));
  } else if (choice.reveal) {
    put({ property: PHONE_REVEAL_PROPERTY, time: 0, value: 0, easing: 'linear' });
    put({ property: PHONE_REVEAL_PROPERTY, time: choice.reveal.duration, value: 1, easing: 'linear' });
  }
  const desired = [...merged.values()].toSorted((a, b) => a.time - b.time || a.property.localeCompare(b.property));
  return { desired, replaced, clamped, choice };
}

// ---------------------------------------------------------------------------
// Recognition: which preset do the clip's keys already hold?
// ---------------------------------------------------------------------------

export interface PhoneAnimationRecognition {
  choice: PhoneAnimationChoice;
  /** Ids of the keys that belong to the recognised presets (excluded from the plan's base). */
  keyIds: Set<string>;
  /** The same ids per part (In and Out may share a settled key). */
  partKeyIds: Record<PhoneAnimationPart, string[]>;
}

function matchSide(side: 'in' | 'out', keys: readonly Keyframe[], clipDuration: number): { pick: PhoneAnimationSide; ids: string[] } | null {
  const managed = keys.filter((key) => MANAGED.has(key.property));
  const durations = [...new Set(managed.map((key) => (side === 'in' ? key.time : clipDuration - key.time)))]
    .filter((duration) => duration > TIME_EPSILON && duration <= clipDuration + TIME_EPSILON);
  let best: { pick: PhoneAnimationSide; ids: string[] } | null = null;
  for (const preset of side === 'in' ? PHONE_IN_PRESETS : PHONE_OUT_PRESETS) {
    for (const duration of durations) {
      // Each track settles at its last frame (Pop's opacity settles before the window ends).
      const settled = new Map<string, number>();
      for (const track of preset.tracks) {
        const edge = windowTime(side, Math.max(...track.frames.map(([fraction]) => fraction)), duration, clipDuration);
        const hit = managed.find((key) => key.property === track.property && Math.abs(key.time - edge) < TIME_EPSILON);
        if (hit && !settled.has(track.property)) settled.set(track.property, hit.value);
      }
      if (preset.tracks.some((track) => !settled.has(track.property))) continue;
      const wanted = buildPhonePresetKeys(side, preset, duration, clipDuration, (property) => settled.get(property)!);
      // A track whose keys do not move (e.g. opacity 0 -> 0) is not this preset.
      const still = preset.tracks.some((track) => {
        const values = wanted.filter((want) => want.property === track.property).map((want) => want.value);
        return Math.max(...values) - Math.min(...values) < VALUE_EPSILON;
      });
      if (still) continue;
      const ids: string[] = [];
      const all = wanted.every((want) => {
        const hit = managed.find((key) => key.property === want.property && Math.abs(key.time - want.time) < TIME_EPSILON
          && Math.abs(key.value - want.value) < VALUE_EPSILON);
        if (hit) ids.push(hit.id);
        return !!hit;
      });
      if (all && (!best || ids.length > best.ids.length)) best = { pick: { preset: preset.id, duration }, ids };
    }
  }
  return best;
}

export function recognizePhoneAnimation(keys: readonly Keyframe[], clipDuration: number, reveal?: { mode?: string; cursor?: boolean }): PhoneAnimationRecognition {
  const inMatch = matchSide('in', keys, clipDuration);
  // In and Out may share their settled key (a combo that fills the clip), so Out sees every key.
  const outMatch = matchSide('out', keys, clipDuration);
  const keyIds = new Set([...(inMatch?.ids ?? []), ...(outMatch?.ids ?? [])]);
  const combo = inMatch && outMatch && Math.abs(inMatch.pick.duration - outMatch.pick.duration) < TIME_EPSILON
    ? PHONE_COMBO_PRESETS.find((candidate) => candidate.in === inMatch.pick.preset && candidate.out === outMatch.pick.preset)?.id ?? null
    : null;
  const revealKeys = keys.filter((key) => key.property === PHONE_REVEAL_PROPERTY);
  const start = revealKeys.find((key) => Math.abs(key.time) < TIME_EPSILON && Math.abs(key.value) < VALUE_EPSILON);
  const end = revealKeys.find((key) => key.time > TIME_EPSILON && Math.abs(key.value - 1) < VALUE_EPSILON);
  let revealChoice: PhoneRevealChoice | null = null;
  if (start && end) {
    const mode = PHONE_REVEAL_MODES.some((candidate) => candidate.id === reveal?.mode) ? reveal!.mode as PhoneRevealMode : 'typewriter';
    revealChoice = { mode, duration: end.time, cursor: reveal?.cursor === true };
    keyIds.add(start.id);
    keyIds.add(end.id);
  }
  const partKeyIds = { in: inMatch?.ids ?? [], out: outMatch?.ids ?? [], reveal: start && end ? [start.id, end.id] : [] };
  return { choice: { in: inMatch?.pick ?? null, out: outMatch?.pick ?? null, combo, reveal: revealChoice }, keyIds, partKeyIds };
}
