// Ruler-lane actions slice (issue #257, Packet 3).
//
// Mirrors markerSlice in shape, but the lane stack is an ordered, format-UNIQUE
// set: at most one lane per format. The menu (Packet 5) is a checklist, so we
// keep lanes in a canonical stacking order (time → timecode → frames → bars)
// rather than insertion order, using toSorted() (markerSlice predates the rule
// and mutates with .sort() — not copied here). reorderRulerLanes exists as the
// seam for a future drag-reorder UI and overrides the canonical order wholesale.
//
// Undo: lane toggles + activeRulerLaneId are VIEW state and are deliberately
// excluded from historyStore snapshots (see Packet 3 in docs/Features/
// Timeline-Rulers.md). A future tempoMap *edit* is content and must opt in then.

import type { RulerLane, RulerLaneActions, RulerLaneFormat, SliceCreator } from './types';
import { rulerLaneIdForFormat } from '../../timeline/tempo/rulerDefaults';

// Top → bottom stacking order for enabled lanes.
const RULER_LANE_FORMAT_ORDER: RulerLaneFormat[] = ['time', 'timecode', 'frames', 'bars'];

function byFormatOrder(a: RulerLane, b: RulerLane): number {
  return RULER_LANE_FORMAT_ORDER.indexOf(a.format) - RULER_LANE_FORMAT_ORDER.indexOf(b.format);
}

export const createRulerSlice: SliceCreator<RulerLaneActions> = (set, get) => ({
  addRulerLane: (format: RulerLaneFormat) => {
    const existing = get().rulerLanes.find(lane => lane.format === format);
    if (existing) return existing.id; // no-op: one lane per format

    const id = rulerLaneIdForFormat(format);
    set(state => ({
      rulerLanes: [...state.rulerLanes, { id, format }].toSorted(byFormatOrder),
    }));

    return id;
  },

  removeRulerLane: (laneId: string) => {
    set(state => {
      const rulerLanes = state.rulerLanes.filter(lane => lane.id !== laneId);
      // Keep the active lane valid: if we removed it, fall back to the first lane.
      const activeRulerLaneId = state.activeRulerLaneId === laneId
        ? rulerLanes[0]?.id ?? null
        : state.activeRulerLaneId;
      return { rulerLanes, activeRulerLaneId };
    });
  },

  setActiveRulerLane: (laneId: string | null) => {
    set(state => {
      if (laneId === null) return { activeRulerLaneId: null };
      // Ignore ids that do not reference a current lane.
      if (!state.rulerLanes.some(lane => lane.id === laneId)) return {};
      return { activeRulerLaneId: laneId };
    });
  },

  reorderRulerLanes: (orderedLaneIds: string[]) => {
    set(state => {
      const byId = new Map(state.rulerLanes.map(lane => [lane.id, lane]));
      const reordered = orderedLaneIds
        .map(id => byId.get(id))
        .filter((lane): lane is RulerLane => lane !== undefined);
      // Preserve any lanes not mentioned in the new order, appended in place.
      const mentioned = new Set(orderedLaneIds);
      const rest = state.rulerLanes.filter(lane => !mentioned.has(lane.id));
      return { rulerLanes: [...reordered, ...rest] };
    });
  },
});
