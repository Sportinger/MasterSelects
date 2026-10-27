// Transition commands of the phone skin. They call the same editor operations as the desktop
// transition inspector (TransitionTab: transition-update-type / -duration) and the AI tools
// (applyTransition / removeTransition), so a cut edited on the phone is the same data as one edited
// on the desktop. Every setter is ABSOLUTE ("this cut has Dip to White, 0.8 s"): the sheet's edit
// session may re-apply it, and re-applying the same state is a no-op.

import { getAllTransitions, getDefaultTransitionParams, getRuntimeTransition, type TransitionCategory, type TransitionDefinition } from '../../../transitions';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from '../../../stores/timeline/editOperations/transitionPlanner';
import { createTimelineTransitionMediaDurationResolver } from '../../../services/timeline/timelineTransitionMediaDurations';
import type { TimelineClip } from '../../../types/timeline';
import { findPhoneCutsOnTrack, resolvePhoneCut, type PhoneCut, type PhoneCutTarget } from './phoneTransitionCuts';

/** 'none' removes the transition at the cut. */
export type PhoneTransitionChoice = string | 'none';

export interface PhoneTransitionDesired {
  type: PhoneTransitionChoice;
  /** Requested duration in seconds (ignored for 'none'). */
  duration: number;
}

export interface PhoneTransitionApplyReport {
  /** Cuts that now match the desired state. */
  applied: number;
  /** Human-readable problems the editor reported (locked track, unsupported pair, ...). */
  problems: string[];
}

const DURATION_EPSILON = 1e-4;
const SOURCE = 'ui' as const;

export const PHONE_TRANSITION_CATEGORY_LABELS: Readonly<Record<TransitionCategory, string>> = {
  dissolve: 'Dissolve',
  wipe: 'Wipe',
  slide: 'Slide',
  light: 'Light',
  glitch: 'Glitch',
  pattern: 'Pattern',
  stylize: 'Stylize',
  rotate: 'Rotate',
  '3d': '3D',
  zoom: 'Zoom',
};

/** The editor's runtime transitions (same list as the desktop inspector), grouped by category in registry order. */
export function phoneTransitionCatalog(): Array<{ category: TransitionCategory; label: string; transitions: TransitionDefinition[] }> {
  const groups = new Map<TransitionCategory, TransitionDefinition[]>();
  for (const definition of getAllTransitions()) {
    const list = groups.get(definition.category);
    if (list) list.push(definition);
    else groups.set(definition.category, [definition]);
  }
  return [...groups.entries()].map(([category, transitions]) => ({
    category, label: PHONE_TRANSITION_CATEGORY_LABELS[category] ?? category, transitions,
  }));
}

function isAudioClip(clip: Pick<TimelineClip, 'source' | 'file'> | undefined): boolean {
  return clip?.source?.type === 'audio' || clip?.file?.type?.startsWith('audio/') === true;
}

/** Audio cuts take only the crossfade (editor rule in validateTransitionPair). */
export function isPhoneAudioCut(clips: readonly TimelineClip[], cut: Pick<PhoneCut, 'clipAId' | 'clipBId'>): boolean {
  return isAudioClip(clips.find((clip) => clip.id === cut.clipAId)) || isAudioClip(clips.find((clip) => clip.id === cut.clipBId));
}

/** Why a transition type cannot be used at this cut, or null when it can. */
export function phoneTransitionUnavailableReason(clips: readonly TimelineClip[], cut: PhoneCut, type: string): string | null {
  if (type === 'none') return null;
  if (isPhoneAudioCut(clips, cut) && type !== 'crossfade') return 'Audio cuts only take a crossfade, in the full editor too.';
  if (!getRuntimeTransition(type)) return 'This transition is not available in this version of the editor.';
  return null;
}

function warningsText(result: { success: boolean; warnings: Array<{ code: string; message: string }> }): string[] {
  return result.warnings.filter((warning) => warning.code !== 'no-op').map((warning) => warning.message);
}

/** Sets one cut to the desired transition through the editor's own operations. Runs inside the caller's transaction. */
export function setPhoneCutTransition(target: PhoneCutTarget, desired: PhoneTransitionDesired): string[] {
  const store = useTimelineStore.getState();
  const cut = resolvePhoneCut(store.clips, target);
  if (!cut) return ['The two clips no longer touch, so this cut has no transition.'];
  const current = cut.transition;
  if (desired.type === 'none') {
    if (!current) return [];
    return warningsText(store.removeTransition(cut.clipAId, 'out', { source: SOURCE, historyLabel: 'Remove transition' }));
  }
  const definition = getRuntimeTransition(desired.type);
  if (!definition) return [`Unsupported transition type: ${desired.type}`];
  if (!current) {
    return warningsText(store.applyTransition(cut.clipAId, cut.clipBId, definition.id, desired.duration, { source: SOURCE, historyLabel: 'Apply transition' }));
  }
  const problems: string[] = [];
  if (current.type !== definition.id) {
    const id = `phone-transition-type:${current.id}:${Date.now()}`;
    problems.push(...warningsText(store.applyTimelineEditOperation({
      id, type: 'transition-update-type', transactionId: id, historyBatchId: id, source: SOURCE,
      clipId: cut.clipAId, edge: 'out', transitionId: current.id,
      transitionType: definition.id, params: getDefaultTransitionParams(definition),
    }, { source: SOURCE, historyLabel: 'Change transition type' })));
  }
  const fresh = resolvePhoneCut(useTimelineStore.getState().clips, target)?.transition;
  if (fresh && Math.abs(fresh.duration - desired.duration) > DURATION_EPSILON) {
    const id = `phone-transition-duration:${fresh.id}:${Date.now()}`;
    problems.push(...warningsText(useTimelineStore.getState().applyTimelineEditOperation({
      id, type: 'transition-update-duration', transactionId: id, historyBatchId: id, source: SOURCE,
      clipId: cut.clipAId, edge: 'out', transitionId: fresh.id, requestedDuration: desired.duration,
    }, { source: SOURCE, historyLabel: 'Update transition duration' })));
  }
  return problems;
}

/** The cuts a sheet scope covers: the one cut, or every cut on its track ("Apply to all cuts"). */
export function phoneTransitionScopeCuts(clips: readonly TimelineClip[], target: PhoneCutTarget, scope: 'cut' | 'track'): PhoneCutTarget[] {
  if (scope === 'cut') return [target];
  return findPhoneCutsOnTrack(clips, target.trackId).map((cut) => ({ trackId: cut.trackId, clipAId: cut.clipAId, clipBId: cut.clipBId }));
}

/** Applies the desired state to every cut of the scope and reports what the editor said. */
export function applyPhoneTransition(target: PhoneCutTarget, scope: 'cut' | 'track', desired: PhoneTransitionDesired): PhoneTransitionApplyReport {
  const cuts = phoneTransitionScopeCuts(useTimelineStore.getState().clips, target, scope);
  const problems: string[] = [];
  let applied = 0;
  for (const cut of cuts) {
    const clips = useTimelineStore.getState().clips;
    const resolved = resolvePhoneCut(clips, cut);
    // Audio cuts of an "apply to all" keep what they have when the type is not a crossfade.
    const reason = resolved ? phoneTransitionUnavailableReason(clips, resolved, desired.type) : null;
    if (reason) { problems.push(reason); continue; }
    const cutProblems = setPhoneCutTransition(cut, desired);
    if (cutProblems.length === 0) applied += 1;
    problems.push(...cutProblems);
  }
  return { applied, problems: [...new Set(problems)] };
}

export interface PhoneTransitionTimingNote {
  /** Duration the editor stored (it never goes below the transition's minimum). */
  resolvedDuration: number;
  /** Seconds of the transition for which a clip has no more source and its edge frame is held. */
  holdSeconds: number;
}

/** What the editor's planner makes of this cut's transition: stored duration and held edge frames. */
export function phoneTransitionTiming(target: PhoneCutTarget): PhoneTransitionTimingNote | null {
  const clips = useTimelineStore.getState().clips;
  const cut = resolvePhoneCut(clips, target);
  const transition = cut?.transition;
  if (!cut || !transition) return null;
  const outgoingClip = clips.find((clip) => clip.id === cut.clipAId);
  const incomingClip = clips.find((clip) => clip.id === cut.clipBId);
  if (!outgoingClip || !incomingClip) return null;
  const plan = planTransition({
    outgoingClip, incomingClip, transitionType: transition.type, requestedDuration: transition.duration,
    params: transition.params, placement: DEFAULT_TRANSITION_PLACEMENT, edgePolicy: 'hold',
    junctionTime: cut.time, bodyOffset: transition.offset ?? 0,
    getMediaDuration: createTimelineTransitionMediaDurationResolver(),
  });
  if (!plan) return null;
  return {
    resolvedDuration: transition.duration,
    holdSeconds: Math.max(plan.outgoing.holdDuration, plan.incoming.holdDuration),
  };
}
