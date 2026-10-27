// Title commands of the phone skin: add a text clip at the playhead on an unlocked video track
// above the main picture (creating that track through the editor's addTrack when needed), or edit
// the selected text clip. A title session previews the text live while typing inside ONE owned,
// cancellable transaction (repository gesture or legacy history batch): Done commits it as one
// undo step, Cancel rolls it back without calling undo.

import { useEffect, useRef } from 'react';

import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { Logger } from '../../../services/logger';
import {
  captureEditorTransactionAcrossAwaits, getEditorRepositorySession, ownsEditorTransaction, runEditorBatch,
} from '../../../services/project/repository/transaction/editorMutationRuntime';
import type { TransactionToken } from '../../../services/project/repository/transaction/ProjectTransactionCoordinator';
import {
  beginEditorGesture, finishEditorGesture, runEditorGesture,
} from '../../../services/project/repository/transaction/editorGestureOwnership';
import { cancelHistoryBatch, endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TEXT_DURATION } from '../../../stores/timeline/constants';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { PhoneActionResult } from '../contracts';
import { DEFAULT_PHONE_TEXT_STYLE, readPhoneTextStyle, writePhoneTextDraft, type PhoneTextStyle } from './phoneTextStyle';

const log = Logger.create('PhoneTitle');
const EPSILON = 1e-4;

export type PhoneTitleTrackChoice = { trackId: string } | { createTrack: true };

/**
 * Video track for a new title at [start, start + duration): the nearest unlocked, visible video
 * track above the main picture (the lowest video track) that is free there; otherwise a new one.
 */
export function choosePhoneTitleTrack(
  tracks: readonly TimelineTrack[],
  clips: readonly Pick<TimelineClip, 'trackId' | 'startTime' | 'duration'>[],
  start: number,
  duration: number,
): PhoneTitleTrackChoice {
  const video = tracks.filter((track) => track.type === 'video');
  const above = video.slice(0, -1).toReversed();
  const end = start + duration;
  for (const track of above) {
    if (track.locked || track.visible === false) continue;
    const busy = clips.some((clip) => clip.trackId === track.id && clip.startTime < end - EPSILON && clip.startTime + clip.duration > start + EPSILON);
    if (!busy) return { trackId: track.id };
  }
  return { createTrack: true };
}

/** The selected text clip the title sheet edits, or null when it should create a new title. */
export function getSelectedPhoneTextClip(): TimelineClip | null {
  const state = useTimelineStore.getState();
  const id = state.primarySelectedClipId;
  const clip = id && state.selectedClipIds.has(id) ? state.clips.find((candidate) => candidate.id === id) : undefined;
  if (!clip?.textProperties || clip.source?.type !== 'text') return null;
  if (state.tracks.find((track) => track.id === clip.trackId)?.locked) return null;
  return clip;
}

/** Creates the title clip at the playhead (track creation included). Runs inside the caller's transaction. */
async function createTitleClip(): Promise<string | null> {
  const state = useTimelineStore.getState();
  const start = Math.max(0, getPlayheadPosition(state.playheadPosition));
  const choice = choosePhoneTitleTrack(state.tracks, state.clips, start, DEFAULT_TEXT_DURATION);
  const trackId = 'trackId' in choice ? choice.trackId : state.addTrack('video');
  return useTimelineStore.getState().addTextClip(trackId, start, DEFAULT_TEXT_DURATION, true);
}

export interface PhoneTitleSession {
  readonly mode: 'create' | 'edit';
  readonly originalText: string;
  /** The style the sheet starts from: the edited clip's style at the playhead, or the editor default. */
  readonly originalStyle: PhoneTextStyle;
  /** Live preview of the draft (text + style) in the composition (inside the open transaction). */
  preview: (text: string, style?: PhoneTextStyle) => Promise<void>;
  /** Applies the final text + style and commits everything as one undo step. */
  commit: (text: string, style?: PhoneTextStyle) => Promise<PhoneActionResult>;
  /** Rolls back the live preview; never calls undo. */
  cancel: () => void;
  readonly closed: boolean;
}

export function createPhoneTitleSession(editClip: TimelineClip | null = getSelectedPhoneTextClip()): PhoneTitleSession {
  const mode: 'create' | 'edit' = editClip ? 'edit' : 'create';
  const label = mode === 'edit' ? 'Edit title' : 'Add title';
  const originalText = editClip?.textProperties?.text ?? '';
  const originalStyle = editClip
    ? readPhoneTextStyle(editClip, useTimelineStore.getState().playheadPosition - editClip.startTime)
    : DEFAULT_PHONE_TEXT_STYLE;
  let clipId: string | null = editClip?.id ?? null;
  let gesture: { id: number; token: TransactionToken } | null = null;
  let legacyBatch: { opened: boolean } | null = null;
  let chain: Promise<void> = Promise.resolve();
  let closed = false;
  /** True once a preview may have opened a transaction or created a clip. */
  let started = false;
  const repository = () => getEditorRepositorySession() !== null;
  const gestureAlive = () => gesture !== null && ownsEditorTransaction(gesture.token);
  const clipExists = () => clipId !== null && useTimelineStore.getState().clips.some((clip) => clip.id === clipId);
  const inGesture = <T,>(action: () => T): T => (gestureAlive() ? runEditorGesture(gesture!.id, action) : action());

  const open = () => {
    // The editor ends open gestures on window blur; start a fresh one instead of writing outside any.
    if (gesture && !gestureAlive()) gesture = null;
    if (gesture || legacyBatch) return;
    if (repository()) {
      const opened = beginEditorGesture(label);
      if (opened.token && opened.batchId !== null) gesture = { id: opened.batchId, token: opened.token };
    } else {
      legacyBatch = { opened: startBatch(label).opened };
    }
  };

  const ensureClip = async () => {
    if (clipExists()) return;
    if (mode === 'edit') throw new Error('The selected title no longer exists.');
    clipId = gestureAlive()
      ? await captureEditorTransactionAcrossAwaits(gesture!.token, createTitleClip)
      : await createTitleClip();
    if (!clipId) throw new Error('No video track is available for the title.');
  };

  /** Absolute write of the whole draft (text and style), safe to repeat after a platform-ended gesture. */
  const applyText = (text: string, style: PhoneTextStyle) => inGesture(() => writePhoneTextDraft(clipId!, text, style));

  const preview = (text: string, style: PhoneTextStyle = originalStyle) => {
    if (closed) return chain;
    if (mode === 'create' && !started && text.trim() === '') return chain;
    started = true;
    chain = chain.then(async () => {
      if (closed) return;
      if (mode === 'create' && !clipExists() && text.trim() === '') return;
      open();
      await ensureClip();
      if (!closed) applyText(text, style);
    }).catch((error) => {
      log.warn('Title preview failed', error);
    });
    return chain;
  };

  const commit = async (text: string, style: PhoneTextStyle = originalStyle): Promise<PhoneActionResult> => {
    if (closed) return { ok: false, message: 'This title was already closed.' };
    if (text.trim() === '') return { ok: false, message: 'Type a title first.' };
    await chain;
    closed = true;
    try {
      if (gestureAlive()) {
        await ensureClip();
        applyText(text, style);
        inGesture(() => useTimelineStore.getState().selectClip(clipId));
        finishEditorGesture(gesture!.id);
      } else if (repository()) {
        // No live transaction (nothing previewed, or it was cancelled by the platform): one batch.
        await runEditorBatch(label, async () => {
          await ensureClip();
          applyText(text, style);
        });
        useTimelineStore.getState().selectClip(clipId);
      } else {
        if (!legacyBatch) legacyBatch = { opened: startBatch(label).opened };
        await ensureClip();
        applyText(text, style);
        useTimelineStore.getState().selectClip(clipId);
        if (legacyBatch.opened) endBatch();
      }
      return { ok: true };
    } catch (error) {
      log.error('Title commit failed', error);
      rollback();
      return { ok: false, message: `${label} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  const rollback = () => {
    if (gestureAlive()) { finishEditorGesture(gesture!.id, true); return; }
    if (legacyBatch?.opened) { cancelHistoryBatch(); return; }
    // Fallback when someone else owned the batch: undo only our own preview changes.
    const state = useTimelineStore.getState();
    if (mode === 'create' && clipExists()) state.removeClip(clipId!);
    else if (mode === 'edit' && clipExists() && legacyBatch) writePhoneTextDraft(clipId!, originalText, originalStyle);
  };

  const cancel = () => {
    // A session that never previewed has nothing to roll back and stays usable (StrictMode remount).
    if (closed || !started) return;
    closed = true;
    // Let an in-flight create finish first so the rollback also removes that clip.
    chain = chain.then(() => {
      try { rollback(); } catch (error) { log.error('Title cancel failed', error); }
    });
  };

  return {
    mode, originalText, originalStyle, preview, commit, cancel,
    get closed() { return closed; },
  };
}

/** One title session per sheet mount; an unmounted sheet that never committed is cancelled. */
export function usePhoneTitleCommands(): PhoneTitleSession {
  const sessionRef = useRef<PhoneTitleSession | null>(null);
  sessionRef.current ??= createPhoneTitleSession();
  const session = sessionRef.current;
  useEffect(() => () => session.cancel(), [session]);
  return session;
}
