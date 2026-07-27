// Default factories + normalization for the multi-ruler infrastructure (issue #257).
//
// These are pure data helpers (no runtime handles) shared by the timeline store,
// the serialization round-trip, and project save/load. `normalizeRulerLaneState`
// is the migration: any composition missing the fields (every project authored
// before this feature) is filled with sane defaults on load — no version bump.

import type { RulerLane, RulerLaneFormat, TempoMap } from '../../types/timeline';
import { createDefaultTempoEvent, normalizeTempoMap, type TempoMapInput } from './tempoEdits';

// Tempo defaults now live with the editing invariants (issue #299) and are
// re-exported here so existing importers keep their import path.
export {
  DEFAULT_TEMPO_BPM,
  DEFAULT_TIME_SIGNATURE_NUMERATOR,
  DEFAULT_TIME_SIGNATURE_DENOMINATOR,
} from './tempoEdits';

// Lanes are unique per format, so a deterministic per-format id is safe and keeps
// ids stable across remove/re-add. The slice and the defaults share this scheme.
export function rulerLaneIdForFormat(format: RulerLaneFormat): string {
  return `ruler-lane-${format}`;
}

// Stable id for the default Time lane so a freshly created or migrated
// composition has a deterministic `activeRulerLaneId` to point at.
export const TIME_RULER_LANE_ID = rulerLaneIdForFormat('time');

export interface RulerLaneState {
  tempoMap: TempoMap;
  rulerLanes: RulerLane[];
  activeRulerLaneId: string | null;
}

// What `normalizeRulerLaneState` accepts: the durable project tier has optional
// tempo-event ids (#299), so the input is deliberately wider than the output.
export interface RulerLaneStateInput {
  tempoMap?: TempoMapInput | null;
  rulerLanes?: RulerLane[];
  activeRulerLaneId?: string | null;
}

export function createDefaultTempoMap(): TempoMap {
  return { events: [createDefaultTempoEvent()] };
}

export function createDefaultRulerLanes(): RulerLane[] {
  return [{ id: TIME_RULER_LANE_ID, format: 'time' }];
}

export function getDefaultActiveRulerLaneId(): string {
  return TIME_RULER_LANE_ID;
}

export function createDefaultRulerLaneState(): RulerLaneState {
  const rulerLanes = createDefaultRulerLanes();
  return {
    tempoMap: createDefaultTempoMap(),
    rulerLanes,
    activeRulerLaneId: rulerLanes[0]?.id ?? null,
  };
}

// Drop duplicate-format lanes, keeping the first occurrence — enforces the
// "ordered set of enabled formats" invariant even on imported/hand-edited data.
function dedupeLanesByFormat(lanes: RulerLane[]): RulerLane[] {
  const seen = new Set<RulerLaneFormat>();
  const result: RulerLane[] = [];
  for (const lane of lanes) {
    if (seen.has(lane.format)) continue;
    seen.add(lane.format);
    result.push(lane);
  }
  return result;
}

// Fill any missing/invalid fields with defaults. Used at every load/restore seam
// so old projects round-trip cleanly and the active lane always references a real
// lane.
export function normalizeRulerLaneState(partial?: RulerLaneStateInput): RulerLaneState {
  // Not a pass-through: the map goes through the full invariant repair (sort,
  // dedupe, pin event 0, clamp, backfill ids). This is the single seam where a
  // pre-#299 project without event ids becomes editable.
  const tempoMap = normalizeTempoMap(partial?.tempoMap);

  const rulerLanes = partial?.rulerLanes && partial.rulerLanes.length
    ? dedupeLanesByFormat(partial.rulerLanes)
    : createDefaultRulerLanes();

  const activeRulerLaneId =
    partial?.activeRulerLaneId != null
    && rulerLanes.some(lane => lane.id === partial.activeRulerLaneId)
      ? partial.activeRulerLaneId
      : rulerLanes[0]?.id ?? null;

  return { tempoMap, rulerLanes, activeRulerLaneId };
}
