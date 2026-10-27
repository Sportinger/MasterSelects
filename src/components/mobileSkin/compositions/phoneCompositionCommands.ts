// Composition commands of the phone: create, duplicate, rename, delete, settings, nest the selection
// into a new composition and enter a nested one. Each edit calls the same media/timeline store
// actions as the desktop media panel and lands as ONE undo step; switching the open composition is
// navigation, not an edit, and stays out of the history. Failures come back as { ok: false, message }.

import { normalizeCompositionRenderSettings } from '../../../engine/native3d/pathtrace/contracts/ptTypes';
import { Logger } from '../../../services/logger';
import { createSubcompositionFromClipIds } from '../../../services/timelineSubcomposition';
import { useMediaStore } from '../../../stores/mediaStore';
import { isUserVisibleComposition } from '../../../stores/mediaStore/compositionVisibility';
import type { Composition } from '../../../stores/mediaStore/types';
import type { RenderEngine } from '../../../types/renderSettings';
import { updateCompositionRenderSettings } from '../../preview/compositionRenderSettings';
import { useTimelineStore } from '../../../stores/timeline';
import { PHONE_PROJECT_FORMATS, type PhoneActionResult, type PhoneProjectFormatId } from '../contracts';
import { createPhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneCompositionTrail } from './phoneCompositionTrail';

const log = Logger.create('PhoneCompositions');

export const PHONE_COMPOSITION_FRAME_RATES = [24, 25, 30, 60] as const;
export const PHONE_COMPOSITION_MIN_DURATION = 1;
export const PHONE_COMPOSITION_MAX_DURATION = 3600;
export const PHONE_COMPOSITION_NAME_MAX = 200;

type CompositionLike = Pick<Composition, 'id' | 'name' | 'transitionComp' | 'captionComp' | 'timelineData'>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs one edit as ONE undo step (a one-shot phone edit session). */
export function runPhoneUndoStep(label: string, change: () => void | Promise<void>): Promise<PhoneActionResult> {
  return createPhoneEditSession(label).commit(change);
}

/** The compositions a person manages: transition and caption compositions are private parts of a parent. */
export function phoneUserCompositions<T extends Pick<Composition, 'transitionComp' | 'captionComp'>>(compositions: readonly T[]): T[] {
  return compositions.filter((composition) => isUserVisibleComposition(composition));
}

/** Names of the other compositions that use `id` as a nested clip (stored timelines). */
export function phoneCompositionUsers(compositions: readonly CompositionLike[], id: string): string[] {
  return compositions
    .filter((composition) => composition.id !== id && isUserVisibleComposition(composition))
    .filter((composition) => composition.timelineData?.clips.some((clip) => clip.compositionId === id))
    .map((composition) => composition.name);
}

export type PhoneDeletePlan =
  | { ok: true; switchTo: string | null; users: string[] }
  | { ok: false; reason: string };

/** Never the last composition; deleting the open one first switches to a neighbour. */
export function planPhoneCompositionDelete(compositions: readonly CompositionLike[], activeId: string | null, id: string): PhoneDeletePlan {
  const visible = phoneUserCompositions(compositions);
  const index = visible.findIndex((composition) => composition.id === id);
  if (index < 0) return { ok: false, reason: 'This composition no longer exists.' };
  if (visible.length <= 1) return { ok: false, reason: 'A project keeps at least one composition. Create another one first.' };
  const neighbour = visible[index + 1] ?? visible[index - 1];
  return { ok: true, switchTo: activeId === id ? neighbour.id : null, users: phoneCompositionUsers(compositions, id) };
}

export function clampPhoneCompositionDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 60;
  return Math.min(PHONE_COMPOSITION_MAX_DURATION, Math.max(PHONE_COMPOSITION_MIN_DURATION, Math.round(seconds)));
}

export function cleanPhoneCompositionName(name: string): string {
  return name.trim().slice(0, PHONE_COMPOSITION_NAME_MAX);
}

/** A free default name like "Comp 3". */
export function nextPhoneCompositionName(compositions: readonly Pick<Composition, 'name'>[], base = 'Comp'): string {
  const names = new Set(compositions.map((composition) => composition.name));
  let index = compositions.length + 1;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/** The format chip that matches a composition's size, null for other sizes. */
export function phoneFormatOf(width: number, height: number): PhoneProjectFormatId | null {
  const match = (Object.entries(PHONE_PROJECT_FORMATS) as Array<[PhoneProjectFormatId, { width: number; height: number }]>)
    .find(([, size]) => size.width === width && size.height === height);
  return match ? match[0] : null;
}

async function openComposition(id: string): Promise<PhoneActionResult> {
  try {
    await useMediaStore.getState().openCompositionTab(id, { skipAnimation: true });
  } catch (error) {
    log.error('Opening a composition failed', error);
    return { ok: false, message: `The composition could not be opened: ${errorText(error)}` };
  }
  if (useMediaStore.getState().activeCompositionId !== id) {
    return { ok: false, message: 'The composition did not open. Try again.' };
  }
  return { ok: true };
}

/** Switches the timeline to another composition (navigation, no undo step). */
export function openPhoneComposition(id: string): Promise<PhoneActionResult> {
  if (useMediaStore.getState().activeCompositionId === id) return Promise.resolve({ ok: true });
  if (useTimelineStore.getState().isPlaying) useTimelineStore.getState().pause();
  return openComposition(id);
}

export interface PhoneNewComposition {
  name: string;
  format: PhoneProjectFormatId;
  frameRate: number;
  duration: number;
}

/** Creates a composition (one undo step) and opens it. */
export async function createPhoneComposition(request: PhoneNewComposition): Promise<PhoneActionResult & { id?: string }> {
  const name = cleanPhoneCompositionName(request.name);
  if (!name) return { ok: false, message: 'Give the composition a name.' };
  const size = PHONE_PROJECT_FORMATS[request.format];
  let created: Composition | null = null;
  const result = await runPhoneUndoStep('New composition', () => {
    created = useMediaStore.getState().createComposition(name, {
      width: size.width,
      height: size.height,
      frameRate: request.frameRate,
      duration: clampPhoneCompositionDuration(request.duration),
    });
  });
  if (!result.ok) return result;
  const id = (created as Composition | null)?.id;
  if (!id) return { ok: false, message: 'The composition could not be created.' };
  const opened = await openPhoneComposition(id);
  return opened.ok ? { ok: true, id } : { ...opened, id };
}

/** Duplicates a composition with its clips (one undo step). The copy is listed, not opened. */
export async function duplicatePhoneComposition(id: string): Promise<PhoneActionResult & { id?: string }> {
  let copy: Composition | null = null;
  const result = await runPhoneUndoStep('Duplicate composition', () => {
    copy = useMediaStore.getState().duplicateComposition(id);
  });
  if (!result.ok) return result;
  const copyId = (copy as Composition | null)?.id;
  // The store refuses some compositions (e.g. a private transition composition) and logs why.
  return copyId ? { ok: true, id: copyId } : { ok: false, message: 'This composition cannot be duplicated.' };
}

export async function renamePhoneComposition(id: string, rawName: string): Promise<PhoneActionResult> {
  const name = cleanPhoneCompositionName(rawName);
  if (!name) return { ok: false, message: 'Give the composition a name.' };
  const current = useMediaStore.getState().compositions.find((composition) => composition.id === id);
  if (!current) return { ok: false, message: 'This composition no longer exists.' };
  if (current.name === name) return { ok: true };
  return runPhoneUndoStep('Rename composition', () => useMediaStore.getState().updateComposition(id, { name }));
}

/** Deletes a composition (one undo step); the open one is first swapped for a neighbour. */
export async function deletePhoneComposition(id: string): Promise<PhoneActionResult> {
  const media = useMediaStore.getState();
  const plan = planPhoneCompositionDelete(media.compositions, media.activeCompositionId, id);
  if (!plan.ok) return { ok: false, message: plan.reason };
  if (plan.switchTo) {
    const switched = await openPhoneComposition(plan.switchTo);
    if (!switched.ok) return switched;
  }
  // Close its tab with it, as the desktop does when a composition disappears.
  return runPhoneUndoStep('Delete composition', () => useMediaStore.getState().removeComposition(id));
}

export interface PhoneCompositionSettings {
  frameRate: number;
  duration: number;
  /** A phone format to resize to; omitted keeps the current size. */
  format?: PhoneProjectFormatId | null;
}

/** Format, frame rate and duration, the same update the desktop settings dialog makes (one undo step). */
export async function applyPhoneCompositionSettings(id: string, settings: PhoneCompositionSettings): Promise<PhoneActionResult> {
  const current = useMediaStore.getState().compositions.find((composition) => composition.id === id);
  if (!current) return { ok: false, message: 'This composition no longer exists.' };
  const duration = clampPhoneCompositionDuration(settings.duration);
  const size = settings.format ? PHONE_PROJECT_FORMATS[settings.format] : { width: current.width, height: current.height };
  if (current.frameRate === settings.frameRate && current.duration === duration && current.width === size.width && current.height === size.height) {
    return { ok: true };
  }
  return runPhoneUndoStep('Composition settings', () => {
    useMediaStore.getState().updateComposition(id, { frameRate: settings.frameRate, duration, width: size.width, height: size.height });
    if (useMediaStore.getState().activeCompositionId === id) useTimelineStore.getState().setDuration(duration);
  });
}

/** Moves the selected clips into a new composition that replaces them on the timeline (one undo step). */
export async function nestPhoneSelection(): Promise<PhoneActionResult & { compositionId?: string }> {
  const timeline = useTimelineStore.getState();
  if (timeline.isExporting) return { ok: false, message: 'Nesting is unavailable while an export is running.' };
  const ids = timeline.clips.filter((clip) => timeline.selectedClipIds.has(clip.id)).map((clip) => clip.id);
  if (ids.length === 0) return { ok: false, message: 'Select the clips to nest first, then open Compositions.' };
  if (timeline.isPlaying) timeline.pause();
  let outcome: Awaited<ReturnType<typeof createSubcompositionFromClipIds>> | null = null;
  const result = await runPhoneUndoStep('Nest clips', async () => {
    outcome = await createSubcompositionFromClipIds(ids);
    // A refused nest must not leave a half-made step behind: throwing rolls the step back.
    if (!outcome.success) throw new Error(outcome.reason);
  });
  if (!result.ok) {
    const reason = (outcome as Awaited<ReturnType<typeof createSubcompositionFromClipIds>> | null);
    return { ok: false, message: reason && !reason.success ? `Could not nest: ${reason.reason}.` : result.message };
  }
  const done = outcome as Awaited<ReturnType<typeof createSubcompositionFromClipIds>> | null;
  return done?.success ? { ok: true, compositionId: done.compositionId } : { ok: false, message: 'Could not nest the clips.' };
}

/** Enters a nested composition and remembers the way back for the top bar crumb. */
export async function enterPhoneNestedComposition(childId: string): Promise<PhoneActionResult> {
  const parentId = useMediaStore.getState().activeCompositionId;
  const opened = await openPhoneComposition(childId);
  if (opened.ok && parentId && parentId !== childId) usePhoneCompositionTrail.getState().enter(parentId, childId);
  return opened;
}

/** Back to the composition the active nested one was entered from. */
export async function leavePhoneNestedComposition(parentId: string): Promise<PhoneActionResult> {
  const opened = await openPhoneComposition(parentId);
  if (opened.ok) usePhoneCompositionTrail.getState().pop();
  return opened;
}

/** The 3D render engine a composition uses (absent settings mean raster). */
export function phoneCompositionRenderEngine(composition: Pick<Composition, 'renderSettings'>): RenderEngine {
  return normalizeCompositionRenderSettings(composition.renderSettings).engine;
}

/** Switches the 3D scene's render engine like the desktop preview toolbar (one undo step). */
export async function setPhoneCompositionRenderEngine(id: string, engine: RenderEngine): Promise<PhoneActionResult> {
  const current = useMediaStore.getState().compositions.find((composition) => composition.id === id);
  if (!current) return { ok: false, message: 'This composition no longer exists.' };
  if (phoneCompositionRenderEngine(current) === engine) return { ok: true };
  const result = await runPhoneUndoStep('3D render engine', () => { updateCompositionRenderSettings(id, { engine }); });
  if (!result.ok) return result;
  const after = useMediaStore.getState().compositions.find((composition) => composition.id === id);
  if (!after || phoneCompositionRenderEngine(after) !== engine) {
    log.warn('The render engine did not change', { id, engine });
    return { ok: false, message: 'The render engine could not be changed (see the log).' };
  }
  return { ok: true };
}
