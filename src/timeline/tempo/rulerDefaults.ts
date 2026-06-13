// Default factories + normalization for the multi-ruler infrastructure (issue #257).
//
// These are pure data helpers (no runtime handles) shared by the timeline store,
// the serialization round-trip, and project save/load. `normalizeRulerLaneState`
// is the migration: any composition missing the fields (every project authored
// before this feature) is filled with sane defaults on load — no version bump.

import type { RulerLane, RulerLaneFormat, TempoMap } from '../../types/timeline';

// Constant 4/4 @ 60 BPM today; the TempoMap is list-of-events-ready for future
// tempo / time-signature changes (Packet 2).
export const DEFAULT_TEMPO_BPM = 60;
export const DEFAULT_TIME_SIGNATURE_NUMERATOR = 4;
export const DEFAULT_TIME_SIGNATURE_DENOMINATOR = 4;

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

export function createDefaultTempoMap(): TempoMap {
  return {
    events: [
      {
        time: 0,
        bpm: DEFAULT_TEMPO_BPM,
        numerator: DEFAULT_TIME_SIGNATURE_NUMERATOR,
        denominator: DEFAULT_TIME_SIGNATURE_DENOMINATOR,
      },
    ],
  };
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
export function normalizeRulerLaneState(partial?: Partial<RulerLaneState>): RulerLaneState {
  const tempoMap = partial?.tempoMap && partial.tempoMap.events?.length
    ? partial.tempoMap
    : createDefaultTempoMap();

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
