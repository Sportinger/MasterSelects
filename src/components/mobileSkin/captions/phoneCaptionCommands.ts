// Commands of the phone Captions sheet, all through the editor's own caption paths: the
// createCaptionClip / updateCaptionProperties tool handlers (the same validation, track allocation
// and text-style sync the assistant and the desktop use), removeClip, the desktop transcript
// panel's word cut (deleteCaptionTimelineRange) and word correction
// (correctTranscriptWordFromCaption). Timeline edits run inside one owned phone edit session
// (Done = one undo step, Cancel = exact rollback). Word corrections write the shared transcript
// like the desktop does (outside the undo history); Cancel writes the previous words back.

import { useEffect, useRef } from 'react';

import { handleCreateCaptionClip, handleUpdateCaptionProperties } from '../../../services/aiTools/handlers/captions';
import { deleteCaptionTimelineRange } from '../../../services/captions/captionTimelineEditing';
import type { CaptionTimelineWordEvent } from '../../../services/captions/captionTimelineTranscript';
import { layerBuilder } from '../../../services/layerBuilder';
import { Logger } from '../../../services/logger';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { correctTranscriptWordFromCaption } from '../../../services/transcription/artifactPersistence';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneActionResult } from '../contracts';
import { createPhoneEditSession, type PhoneEditSession } from '../sheets/phoneEditSession';
import type { PhoneCaptionUpdate } from './phoneCaptionStyles';
import { validatePhoneCaptionWord } from './phoneCaptionModel';

const log = Logger.create('PhoneCaptions');

export type PhoneCaptionOutcome = { ok: true; clipId?: string } | { ok: false; message: string };

interface Correction { sourceClipId: string; wordId: string; before: string }

export interface PhoneCaptionCommands {
  readonly session: PhoneEditSession;
  /** Creates one caption clip: bound to `sourceClipId`, or automatic over [startTime, startTime + duration]. */
  create: (input: { sourceClipId: string | null; startTime?: number; duration?: number }) => Promise<PhoneCaptionOutcome>;
  update: (clipId: string, update: PhoneCaptionUpdate) => Promise<PhoneCaptionOutcome>;
  remove: (clipId: string) => Promise<PhoneCaptionOutcome>;
  cutWord: (captionClipId: string, word: CaptionTimelineWordEvent) => Promise<PhoneCaptionOutcome>;
  correctWord: (word: Pick<CaptionTimelineWordEvent, 'sourceClipId' | 'wordId' | 'text'>, text: string) => PhoneCaptionOutcome;
  readonly corrected: boolean;
  commit: () => Promise<PhoneActionResult>;
  cancel: () => void;
}

function redraw(): void {
  useTimelineStore.getState().invalidateCache();
  layerBuilder.invalidateCache();
  renderHostPort.requestNewFrameRender();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPhoneCaptionCommands(): PhoneCaptionCommands {
  const session = createPhoneEditSession('Captions');
  const corrections: Correction[] = [];

  const run = async (label: string, change: () => Promise<PhoneCaptionOutcome> | PhoneCaptionOutcome): Promise<PhoneCaptionOutcome> => {
    let outcome: PhoneCaptionOutcome = { ok: false, message: `${label} did not run.` };
    await session.apply(async () => {
      try {
        outcome = await change();
      } catch (error) {
        log.warn(`${label} failed`, error);
        outcome = { ok: false, message: `${label} failed: ${message(error)}.` };
      }
    });
    return outcome;
  };

  const writeWord = (sourceClipId: string, wordId: string, text: string) => {
    const result = correctTranscriptWordFromCaption({ sourceClipId, wordId, text });
    if (result.ok) redraw();
    return result;
  };

  return {
    session,
    create: (input) => run('Creating captions', async () => {
      const args: Record<string, unknown> = {};
      if (input.sourceClipId) args.sourceClipId = input.sourceClipId;
      if (input.startTime !== undefined) args.startTime = input.startTime;
      if (input.duration !== undefined) args.duration = input.duration;
      const result = await handleCreateCaptionClip(args, useTimelineStore.getState());
      if (!result.success) return { ok: false, message: result.error ?? 'The editor did not create captions.' };
      const clipId = (result.data as { clipId?: string } | undefined)?.clipId;
      return clipId ? { ok: true, clipId } : { ok: false, message: 'The editor created no caption clip.' };
    }),
    update: (clipId, update) => run('Changing captions', async () => {
      const result = await handleUpdateCaptionProperties({ clipId, ...update }, useTimelineStore.getState());
      return result.success ? { ok: true, clipId } : { ok: false, message: result.error ?? 'The editor did not change the captions.' };
    }),
    remove: (clipId) => run('Deleting captions', () => {
      useTimelineStore.getState().removeClip(clipId);
      const gone = !useTimelineStore.getState().clips.some((clip) => clip.id === clipId);
      return gone ? { ok: true } : { ok: false, message: 'The caption clip was not deleted (is its track locked?).' };
    }),
    cutWord: (captionClipId, word) => run('Cutting the word', () => {
      const result = deleteCaptionTimelineRange({
        captionClipId,
        sourceClipId: word.sourceClipId,
        timelineStart: word.timelineStart,
        timelineEnd: word.timelineEnd,
        label: `Cut "${word.text}"`,
        transcriptEvent: word,
      });
      return result.ok ? { ok: true } : { ok: false, message: `The word could not be cut: ${result.error}` };
    }),
    correctWord: (word, text) => {
      const invalid = validatePhoneCaptionWord(text);
      if (invalid) return { ok: false, message: invalid };
      const next = text.trim();
      if (next === word.text) return { ok: true };
      const result = writeWord(word.sourceClipId, word.wordId, next);
      if (!result.ok) {
        log.warn('Word correction refused', result.error);
        return { ok: false, message: 'The word could not be saved: its transcript was not found.' };
      }
      if (!corrections.some((entry) => entry.sourceClipId === word.sourceClipId && entry.wordId === word.wordId)) {
        corrections.push({ sourceClipId: word.sourceClipId, wordId: word.wordId, before: word.text });
      }
      return { ok: true };
    },
    get corrected() { return corrections.length > 0; },
    commit: () => session.commit(),
    cancel: () => {
      for (const entry of corrections.toReversed()) {
        const result = writeWord(entry.sourceClipId, entry.wordId, entry.before);
        if (!result.ok) log.warn('Could not restore a corrected word on Cancel', { ...entry, error: result.error });
      }
      corrections.length = 0;
      session.cancel();
    },
  };
}

export function usePhoneCaptionCommands(): PhoneCaptionCommands {
  const ref = useRef<PhoneCaptionCommands | null>(null);
  ref.current ??= createPhoneCaptionCommands();
  const commands = ref.current;
  useEffect(() => () => {
    if (!commands.session.closed) commands.cancel();
  }, [commands]);
  return commands;
}
