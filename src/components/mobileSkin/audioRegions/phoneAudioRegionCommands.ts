// Commands of the Sound range sheet. Every command is one of the editor's own audio region actions
// (the desktop waveform's region menu model, createAudioRegionContextMenuModel, wired to the phone):
// split/cut through the shared audioRegionClipCommands, copy/paste through the region clipboard,
// gain/fades through setAudioRegionGainEdit, everything else through applyAudioRegionEdit, and room
// tone through applyRoomToneFill. Edits run inside the sheet's edit session (Done = one undo step,
// Cancel = nothing); a refused edit says why instead of failing silently.

import { useMemo } from 'react';

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  ApplyAudioRegionEditOptions, TimelineAudioRegionEditType, TimelineAudioRegionSelection,
} from '../../../stores/timeline/types';
import {
  createAudioRegionContextMenuModel, type AudioRegionContextMenuModel,
} from '../../timeline/utils/audioRegionContextMenu';
import { cutAudioRegionOfClip, splitAudioRegionOfClip } from '../../timeline/utils/audioRegionClipCommands';
import type { PhoneEditSession } from '../sheets/phoneEditSession';
import { phoneRegionChannelMask, type PhoneRegionChannel } from './phoneAudioRegionModel';

const log = Logger.create('PhoneAudioRegionCommands');

export interface PhoneRegionCommandDeps {
  session: PhoneEditSession;
  clipId: string | null;
  selection: TimelineAudioRegionSelection | null;
  channel: PhoneRegionChannel;
  hasClipboard: boolean;
  /** Result line under the commands (null clears it). */
  report: (message: string | null, tone?: 'info' | 'error') => void;
}

export interface PhoneRegionCommands {
  model: AudioRegionContextMenuModel;
  setGain: (gainDb: number, fadeInSeconds: number, fadeOutSeconds: number) => void;
  roomTone: () => Promise<void>;
  toggleOperation: (operationId: string, enabled: boolean) => void;
  removeOperation: (operationId: string) => void;
}

/** Makes the store's region selection the sheet's range before an edit (the actions read it). */
function adoptRange(selection: TimelineAudioRegionSelection): void {
  const current = useTimelineStore.getState().audioRegionSelection;
  if (current !== selection) useTimelineStore.getState().setAudioRegionSelection(selection);
}

export function usePhoneRegionCommands(deps: PhoneRegionCommandDeps): PhoneRegionCommands {
  const { session, clipId, selection, channel, hasClipboard, report } = deps;

  return useMemo(() => {
    const needRange = (label: string): TimelineAudioRegionSelection | null => {
      if (!clipId || !selection) {
        report(`${label}: select a range of the sound first.`, 'error');
        return null;
      }
      return selection;
    };

    const edit = (label: string, run: () => string | null | boolean) => {
      const range = needRange(label);
      if (!range) return;
      const outcome = { ok: false };
      void session.apply(() => {
        adoptRange(range);
        const result = run();
        outcome.ok = result !== null && result !== false;
      }).then(() => {
        if (outcome.ok) report(`${label} applied to the range.`);
        else {
          log.warn('Region edit refused', { label, clipId });
          report(`${label} was refused by the editor (empty range, locked track or not an audio clip).`, 'error');
        }
      });
    };

    const applyEdit = (type: TimelineAudioRegionEditType, options: ApplyAudioRegionEditOptions = {}) => {
      const label = typeof options.params?.label === 'string' ? options.params.label : type;
      const channelMask = phoneRegionChannelMask(channel, type);
      edit(label, () => useTimelineStore.getState().applyAudioRegionEdit(type, {
        ...options, keepSelection: true, ...(channelMask ? { channelMask } : {}),
      }));
      return null;
    };

    const clipCommand = (label: string, run: typeof splitAudioRegionOfClip) => {
      const range = needRange(label);
      if (!range || !clipId) return;
      const outcome: { result: ReturnType<typeof splitAudioRegionOfClip> | null } = { result: null };
      void session.apply(() => { outcome.result = run(clipId, range); }).then(() => {
        const result = outcome.result;
        if (result?.ok) report(label === 'Split' ? 'Split at both edges; the middle piece is selected.' : 'Cut out; the range is on the clipboard.');
        else report(`${label} failed: ${result && !result.ok ? result.reason : 'unknown reason'}`, 'error');
      });
    };

    const model = createAudioRegionContextMenuModel({
      hasAudioRegionClipboard: hasClipboard,
      onSplit: () => clipCommand('Split', splitAudioRegionOfClip),
      onCut: () => clipCommand('Cut', cutAudioRegionOfClip),
      onCopy: () => {
        const range = needRange('Copy');
        if (!range) return;
        adoptRange(range);
        if (useTimelineStore.getState().copySelectedAudioRegion()) report('Copied. Select where it goes, then Paste.');
        else report('Copy failed: the range is empty or not on an audio clip.', 'error');
      },
      onPaste: () => {
        if (!hasClipboard) { report('Copy or cut a range first.', 'error'); return; }
        edit('Paste', () => useTimelineStore.getState().pasteAudioRegionToSelection());
      },
      applyAudioRegionEdit: applyEdit,
    });

    const setGain = (gainDb: number, fadeInSeconds: number, fadeOutSeconds: number) => {
      const range = needRange('Level');
      if (!range) return;
      void session.apply(() => {
        adoptRange(range);
        const id = useTimelineStore.getState().setAudioRegionGainEdit({ gainDb, fadeInSeconds, fadeOutSeconds, keepSelection: true });
        if (!id) report('The level was refused by the editor (locked track or empty range).', 'error');
      });
    };

    const roomTone = async () => {
      const range = needRange('Room tone');
      if (!range || !clipId) return;
      const outcome: { id: string | null; error: string | null } = { id: null, error: null };
      report('Searching the clip for room tone…');
      await session.apply(async () => {
        adoptRange(range);
        try {
          outcome.id = await useTimelineStore.getState().applyRoomToneFill(clipId, {});
        } catch (error) {
          outcome.error = error instanceof Error ? error.message : String(error);
        }
      });
      if (outcome.error || !outcome.id) {
        report(`Room tone fill failed: ${outcome.error ?? 'the editor refused the range (see the log).'}`, 'error');
        return;
      }
      const operation = useTimelineStore.getState().clips.find((clip) => clip.id === clipId)
        ?.audioState?.editStack?.find((candidate) => candidate.id === outcome.id);
      const sources = Number(operation?.params.roomToneSourceCount ?? 0);
      report(sources > 0
        ? `Filled from ${sources} quiet passage${sources === 1 ? '' : 's'} of this clip.`
        : 'No quiet passage found in this clip: the range is filled with generated soft noise (-66 dB) instead of real room tone.');
    };

    const toggleOperation = (operationId: string, enabled: boolean) => {
      if (!clipId) return;
      void session.apply(() => useTimelineStore.getState().setClipAudioEditOperationEnabled(clipId, operationId, enabled));
    };
    const removeOperation = (operationId: string) => {
      if (!clipId) return;
      void session.apply(() => useTimelineStore.getState().removeClipAudioEditOperation(clipId, operationId));
    };

    return { model, setGain, roomTone, toggleOperation, removeOperation };
  }, [session, clipId, selection, channel, hasClipboard, report]);
}
