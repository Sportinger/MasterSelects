// Phone selection and split actions. They dispatch the editor's existing store actions and edit
// operations; the phone never keeps its own timeline model and never calls executeAITool.

import { Logger } from '../../../services/logger';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneActionResult } from '../contracts';

const log = Logger.create('PhoneCutActions');

/** Tolerance so a split exactly on a clip edge counts as "not inside the clip". */
const EDGE_EPSILON = 1e-4;

let splitSequence = 0;

/** Select one clip (with its linked partners, as the desktop does) or clear the selection. */
export function selectPhoneClip(clipId: string | null): void {
  const state = useTimelineStore.getState();
  if (clipId !== null && !state.clips.some((clip) => clip.id === clipId)) {
    log.warn('Select ignored: clip no longer exists', { clipId });
    state.selectClip(null);
    return;
  }
  state.selectClip(clipId);
}

/**
 * Split exactly the selected clips that lie under the playhead. Unlike the desktop
 * `splitClipAtPlayhead`, this never falls back to every clip under the playhead.
 */
export function splitSelectedAtPlayhead(): PhoneActionResult {
  const state = useTimelineStore.getState();
  if (state.isExporting) {
    return { ok: false, message: 'Split is unavailable while an export is running.' };
  }
  const selected = state.selectedClipIds;
  if (!selected || selected.size === 0) {
    return { ok: false, message: 'Select a clip first, then split it at the playhead.' };
  }

  const time = getPlayheadPosition(state.playheadPosition);
  const clipIds = state.clips
    .filter((clip) => selected.has(clip.id))
    .filter((clip) => time > clip.startTime + EDGE_EPSILON && time < clip.startTime + clip.duration - EDGE_EPSILON)
    .map((clip) => clip.id);
  if (clipIds.length === 0) {
    return { ok: false, message: 'Move the playhead inside the selected clip to split it.' };
  }

  splitSequence += 1;
  let result;
  try {
    result = state.applyTimelineEditOperation({
      id: `phone-split:${splitSequence}:${time}`,
      type: 'split-at-time',
      clipIds,
      time,
      includeLinked: true,
    }, { source: 'ui', historyLabel: 'Split clip' });
  } catch (error) {
    log.error('Split operation threw', error);
    return { ok: false, message: `Split failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!result.success) {
    const message = result.warnings[0]?.message ?? 'The clip could not be split at the playhead.';
    log.warn('Split rejected', { clipIds, time, warnings: result.warnings });
    return { ok: false, message };
  }
  if (result.warnings.length > 0) {
    log.info('Split applied with warnings', { warnings: result.warnings });
    return { ok: true, message: result.warnings.map((warning) => warning.message).join(' ') };
  }
  return { ok: true };
}
