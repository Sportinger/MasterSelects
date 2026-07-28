// Tempo-map editing actions (issue #299, Packet 1).
//
// Unlike rulerSlice — whose lane toggles are VIEW state and stay out of history
// — the tempo map is project CONTENT, so every action here opts into undo.
//
// History ordering matters and is NOT type-checked: this store snapshots the
// POST-edit state, so `captureSnapshot` runs AFTER the `set` (the pattern in
// midiClipSlice). Capturing first would record the pre-edit state under the new
// label and shift the whole undo stack by one entry.
//
// All invariants live in the pure `timeline/tempo/tempoEdits` module; this slice
// only decides what to commit and how to label it.

import { captureSnapshot } from '../historyStore';
import type { SliceCreator, TempoActions, TimelineClip } from './types';
import { remapTimelineClipsForTempo } from '../../timeline/tempo/tempoRemap';
import {
  insertTempoEvent,
  normalizeTempoMap,
  removeTempoEvent,
  updateTempoEvent,
  type TempoMapEditResult,
} from '../../timeline/tempo/tempoEdits';

export const createTempoSlice: SliceCreator<TempoActions> = (set, get) => {
  const commit = (result: TempoMapEditResult, label: string): void => {
    if (!result.changed) return;

    // MIDI content is musical and moves with the tempo; media stays linear
    // (plan §3.1). Both land in ONE `set` and under ONE snapshot, so a single
    // undo reverts the tempo and the notes together.
    const { clips, tempoMap, tracks } = get();
    const remappedClips = remapTimelineClipsForTempo(clips, tracks, tempoMap, result.map);

    set({
      tempoMap: result.map,
      ...(remappedClips === clips ? {} : { clips: remappedClips as TimelineClip[] }),
    });
    get().invalidateCache();
    captureSnapshot(label);
  };

  return {
    setProjectTempo: (bpm: number) => {
      const projectEvent = normalizeTempoMap(get().tempoMap).events[0];
      commit(updateTempoEvent(get().tempoMap, projectEvent.id, { bpm }), 'Set project tempo');
    },

    addTempoChange: (time, bpm, meter) => {
      const result = insertTempoEvent(get().tempoMap, {
        time,
        bpm,
        numerator: meter?.numerator,
        denominator: meter?.denominator,
      });
      commit(result, 'Add tempo change');
      return result.event?.id ?? null;
    },

    updateTempoChange: (eventId, patch) => {
      commit(updateTempoEvent(get().tempoMap, eventId, patch), 'Edit tempo change');
    },

    removeTempoChange: (eventId: string) => {
      commit(removeTempoEvent(get().tempoMap, eventId), 'Remove tempo change');
    },
  };
};
