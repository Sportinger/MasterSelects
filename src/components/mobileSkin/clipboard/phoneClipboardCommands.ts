// Attribute clipboard of the phone skin: copy a clip's effects (with their animation), its colour
// grade (with its animation) and its other keyframes, then paste any of them onto several clips.
// Everything runs through the editor's own clipboard actions (copyClipEffects / pasteClipEffects,
// copyClipColor / pasteClipColor, copyKeyframes / pasteKeyframes), the same ones the desktop clip
// context menu and keyboard shortcuts use, so the result opens unchanged in the full editor.
// The phone only remembers WHAT was copied (a serializable summary) to label the paste controls.

import { create } from 'zustand';

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

type TimelineStoreState = ReturnType<typeof useTimelineStore.getState>;

const log = Logger.create('PhoneClipboard');

export type PhoneAttributeGroup = 'effects' | 'colour' | 'animation';
export const PHONE_ATTRIBUTE_GROUPS: readonly PhoneAttributeGroup[] = ['effects', 'colour', 'animation'];

export const PHONE_ATTRIBUTE_LABELS: Record<PhoneAttributeGroup, string> = {
  effects: 'Effects',
  colour: 'Colour grade',
  animation: 'Animation',
};

/** Keys that belong to the effects group (effect.<id>.<param>) or the colour group (color.*). */
export function phoneAttributeGroupOfKey(property: string): PhoneAttributeGroup {
  if (property.startsWith('effect.')) return 'effects';
  if (property.startsWith('color.')) return 'colour';
  return 'animation';
}

export interface PhoneAttributeSummary {
  effects: number;
  effectKeys: number;
  /** True when the clip carries a colour grade (or colour keys); pasting a grade replaces the target's. */
  colourGraded: boolean;
  colourKeys: number;
  /** Keyframes outside effects and colour (transform, opacity, text, mask, audio …). */
  animationKeys: number;
}

export function summarizePhoneAttributes(clip: Pick<TimelineClip, 'effects' | 'colorCorrection'>, keys: readonly Keyframe[]): PhoneAttributeSummary {
  const effectIds = new Set((clip.effects ?? []).map((effect) => effect.id));
  let effectKeys = 0, colourKeys = 0, animationKeys = 0;
  for (const key of keys) {
    const group = phoneAttributeGroupOfKey(key.property);
    if (group === 'effects') { if (effectIds.has(key.property.split('.')[1] ?? '')) effectKeys += 1; }
    else if (group === 'colour') colourKeys += 1;
    else animationKeys += 1;
  }
  // A clip without colorCorrection never had a grade; one with it may still sit at the defaults.
  const colourGraded = colourKeys > 0 || clip.colorCorrection !== undefined;
  return { effects: clip.effects?.length ?? 0, effectKeys, colourGraded, colourKeys, animationKeys };
}

/** What the phone last copied: a serializable summary, the data itself sits in the editor's clipboard. */
export interface PhoneCopiedAttributes {
  sourceClipId: string;
  sourceName: string;
  trackType: TimelineTrack['type'];
  groups: PhoneAttributeGroup[];
  effects: number;
  effectKeys: number;
  colourKeys: number;
  animationKeys: number;
  /** Clip-local time of the earliest copied animation key: pasted keys land at the same local times. */
  animationStart: number;
  /** Clip-local time of the latest copied animation key (a shorter target clamps keys past its end). */
  animationEnd: number;
}

interface PhoneClipboardState {
  copied: PhoneCopiedAttributes | null;
  /** The group the sheet starts with when it is opened from Effects or Adjust; null = all groups. */
  focus: PhoneAttributeGroup | null;
  setCopied: (copied: PhoneCopiedAttributes | null) => void;
  setFocus: (focus: PhoneAttributeGroup | null) => void;
}

export const usePhoneClipboardStore = create<PhoneClipboardState>((set) => ({
  copied: null,
  focus: null,
  setCopied: (copied) => set({ copied }),
  setFocus: (focus) => set({ focus }),
}));

/** The clip the sheet copies from: the primary selected clip, else the first selected one. */
export function phoneClipboardSource(state = useTimelineStore.getState()): TimelineClip | null {
  const selected = state.clips.filter((clip) => state.selectedClipIds.has(clip.id));
  return selected.find((clip) => clip.id === state.primarySelectedClipId) ?? selected[0] ?? null;
}

export interface PhonePasteCandidate {
  clip: TimelineClip;
  /** Null when the clip can take the paste; otherwise why not (shown greyed in the list). */
  reason: string | null;
}

/**
 * Every clip of the open composition on the same kind of track as the copied clip, in timeline
 * order. Clips on locked tracks stay in the list, greyed with the reason, never hidden.
 */
export function phonePasteCandidates(
  trackType: TimelineTrack['type'] | null,
  state: Pick<TimelineStoreState, 'clips' | 'tracks'> = useTimelineStore.getState(),
): PhonePasteCandidate[] {
  if (!trackType) return [];
  const tracks = new Map(state.tracks.map((track) => [track.id, track]));
  const order = (clip: TimelineClip) => state.tracks.findIndex((track) => track.id === clip.trackId);
  return state.clips
    .filter((clip) => tracks.get(clip.trackId)?.type === trackType)
    .toSorted((a, b) => a.startTime - b.startTime || order(a) - order(b))
    .map((clip) => ({
      clip,
      reason: tracks.get(clip.trackId)?.locked ? 'On a locked track: unlock the track to paste onto this clip.' : null,
    }));
}

export type PhoneClipboardResult = { ok: true; message: string } | { ok: false; message: string };

/** Copies the chosen groups of `clipId` into the editor's clipboard. Changes nothing in the project. */
export function copyPhoneAttributes(clipId: string, groups: readonly PhoneAttributeGroup[]): PhoneClipboardResult {
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return { ok: false, message: 'The clip to copy from no longer exists.' };
  if (groups.length === 0) return { ok: false, message: 'Pick what to copy first: effects, colour grade or animation.' };
  const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
  const keys = state.clipKeyframes.get(clipId) ?? [];
  const summary = summarizePhoneAttributes(clip, keys);
  if (groups.includes('effects')) state.copyClipEffects(clipId);
  if (groups.includes('colour')) state.copyClipColor(clipId);
  const animation = keys.filter((key) => phoneAttributeGroupOfKey(key.property) === 'animation');
  if (groups.includes('animation')) {
    if (animation.length === 0) return { ok: false, message: `${clip.name} has no animation to copy. Key it with the diamond first.` };
    state.copyKeyframes(animation.map((key) => key.id));
  }
  const copied: PhoneCopiedAttributes = {
    sourceClipId: clipId,
    sourceName: clip.name,
    trackType: track?.type ?? 'video',
    groups: [...groups],
    effects: summary.effects,
    effectKeys: summary.effectKeys,
    colourKeys: summary.colourKeys,
    animationKeys: groups.includes('animation') ? animation.length : 0,
    animationStart: animation.length ? Math.min(...animation.map((key) => key.time)) : 0,
    animationEnd: animation.length ? Math.max(...animation.map((key) => key.time)) : 0,
  };
  usePhoneClipboardStore.getState().setCopied(copied);
  log.info('Copied attributes', { clipId, groups });
  return { ok: true, message: `Copied ${groups.map((group) => PHONE_ATTRIBUTE_LABELS[group].toLowerCase()).join(', ')} of ${clip.name}` };
}

/** Groups of the last copy the editor's clipboard still holds (another copy may have replaced one). */
export function phonePastableGroups(
  copied: PhoneCopiedAttributes | null,
  state: Pick<TimelineStoreState, 'clipboardEffects' | 'clipboardColor' | 'clipboardKeyframes'> = useTimelineStore.getState(),
): PhoneAttributeGroup[] {
  if (!copied) return [];
  return copied.groups.filter((group) => {
    if (group === 'effects') return state.clipboardEffects?.sourceClipId === copied.sourceClipId;
    if (group === 'colour') return state.clipboardColor?.sourceClipId === copied.sourceClipId;
    return (state.clipboardKeyframes?.length ?? 0) > 0 && state.clipboardKeyframes?.[0]?.clipId === copied.sourceClipId;
  });
}

/**
 * Pastes the chosen groups onto every target. Effects and colour REPLACE the target's stack/grade
 * (with their animation); animation keys land at the same clip-local times as on the source and
 * replace keys of the same property in that range. Runs inside the caller's edit session.
 */
export function pastePhoneAttributes(targetIds: readonly string[], groups: readonly PhoneAttributeGroup[]): PhoneClipboardResult {
  const copied = usePhoneClipboardStore.getState().copied;
  if (!copied) return { ok: false, message: 'Nothing copied yet. Copy from a clip first.' };
  const state = useTimelineStore.getState();
  const allowed = new Set(phonePasteCandidates(copied.trackType, state).filter((entry) => entry.reason === null).map((entry) => entry.clip.id));
  const targets = targetIds.filter((id) => allowed.has(id));
  if (targets.length === 0) return { ok: false, message: 'Pick at least one clip to paste onto (clips on locked tracks cannot change).' };
  const pastable = new Set(phonePastableGroups(copied, state));
  const chosen = groups.filter((group) => pastable.has(group));
  if (chosen.length === 0) return { ok: false, message: 'The copied attributes were replaced by another copy. Copy again.' };
  if (chosen.includes('effects')) useTimelineStore.getState().pasteClipEffects([...targets]);
  if (chosen.includes('colour')) useTimelineStore.getState().pasteClipColor([...targets]);
  if (chosen.includes('animation')) useTimelineStore.getState().pasteKeyframes({ targetClipIds: targets, clipLocalTime: copied.animationStart });
  log.info('Pasted attributes', { targets: targets.length, groups: chosen });
  const message = `Pasted ${chosen.map((group) => PHONE_ATTRIBUTE_LABELS[group].toLowerCase()).join(', ')} onto ${targets.length} clip${targets.length === 1 ? '' : 's'}`;
  if (!chosen.includes('animation')) return { ok: true, message };
  // The editor clamps keys past a target's end to that end: say so instead of hiding it.
  const short = useTimelineStore.getState().clips.filter((clip) => targets.includes(clip.id) && clip.duration + 1e-6 < copied.animationEnd);
  return short.length === 0
    ? { ok: true, message }
    : { ok: true, message: `${message}. ${short.map((clip) => clip.name).join(', ')} ${short.length === 1 ? 'is' : 'are'} shorter than the animation: keys past the end sit at the end` };
}

/** Opens the Copy & paste sheet focused on one group (from Effects or Adjust, after they committed). */
export function openPhoneClipboard(focus: PhoneAttributeGroup | null): void {
  usePhoneClipboardStore.getState().setFocus(focus);
  usePhoneUiStore.getState().openSheet('clipboard');
}
