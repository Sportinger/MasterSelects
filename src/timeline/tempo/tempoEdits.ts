// Tempo-map editing invariants (issue #299, Packet 1).
//
// The tempo map is project CONTENT, and both the store slice and the load-time
// normalizer (`rulerDefaults.normalizeRulerLaneState`) commit through here, so a
// hand-edited project file and a UI edit land on byte-identical data. Pure: no
// store, no React, no runtime handles.
//
// Invariants enforced by `normalizeTempoMap`, which every editing function runs
// on its way in and out:
//
//   - at least one event; the FIRST event is the project tempo, pinned at
//     `time === 0` and not deletable (its BPM/meter stay editable);
//   - events sorted ascending by `time` and UNIQUE by time — writing onto an
//     occupied position replaces the event that was there;
//   - every event carries a unique `id` (backfilled for projects saved before
//     this feature);
//   - `bpm`, `numerator` and `denominator` clamped to the legal ranges below.

import type { TempoEvent, TempoMap } from '../../types/timeline';

// Defaults for a fresh composition. 4/4 @ 60 BPM makes a bar exactly 4 s and
// puts beats on integer seconds — a placeholder, not a musical default.
export const DEFAULT_TEMPO_BPM = 60;
export const DEFAULT_TIME_SIGNATURE_NUMERATOR = 4;
export const DEFAULT_TIME_SIGNATURE_DENOMINATOR = 4;

// The EDITABLE tempo range. Deliberately NOT the MIN_TEMPO_BPM / MAX_TEMPO_BPM
// pair in `services/audio/beatOnset/beatGridEstimation.ts` (60 / 200): those are
// octave-folding bins for autocorrelation *detection*, not an authoring range.
// Reusing them would reject a 40 BPM largo and a 240 BPM drum'n'bass track, and
// would park the default tempo exactly on the lower boundary.
export const MIN_EDITABLE_TEMPO_BPM = 20;
export const MAX_EDITABLE_TEMPO_BPM = 999;

export const TIME_SIGNATURE_DENOMINATORS = [1, 2, 4, 8, 16, 32] as const;
export type TimeSignatureDenominator = (typeof TIME_SIGNATURE_DENOMINATORS)[number];
export const MAX_TIME_SIGNATURE_NUMERATOR = 32;

// Two events closer than this occupy the same musical position.
const TEMPO_EVENT_TIME_EPSILON = 1e-6;

// Stable id for the pinned first event, so a freshly created composition has a
// deterministic project-tempo handle to edit.
export const PROJECT_TEMPO_EVENT_ID = 'tempo-project';

let tempoEventCounter = 0;

export function createTempoEventId(): string {
  tempoEventCounter += 1;
  return `tempo-${tempoEventCounter}-${Math.random().toString(36).slice(2, 9)}`;
}

/** A requested new event; meter falls back to the tempo in effect at `time`. */
export interface TempoEventDraft {
  time: number;
  bpm?: number;
  numerator?: number;
  denominator?: number;
}

/** A partial edit of an existing event. `id` is the target, never the payload. */
export type TempoEventPatch = Partial<Omit<TempoEvent, 'id'>>;

export interface TempoMapEditResult {
  map: TempoMap;
  /** The inserted/updated/removed event, or null when the edit was rejected. */
  event: TempoEvent | null;
  /** False when the map is unchanged — callers skip the history snapshot. */
  changed: boolean;
}

export function clampTempoBpm(bpm: number | undefined): number {
  if (bpm === undefined || !Number.isFinite(bpm)) return DEFAULT_TEMPO_BPM;
  return Math.min(MAX_EDITABLE_TEMPO_BPM, Math.max(MIN_EDITABLE_TEMPO_BPM, bpm));
}

export function clampTimeSignatureNumerator(numerator: number | undefined): number {
  if (numerator === undefined || !Number.isFinite(numerator)) {
    return DEFAULT_TIME_SIGNATURE_NUMERATOR;
  }
  return Math.min(MAX_TIME_SIGNATURE_NUMERATOR, Math.max(1, Math.round(numerator)));
}

// Denominators are note values, so an illegal one snaps to the nearest legal
// power of two (7 -> 8) rather than silently collapsing to 4.
export function clampTimeSignatureDenominator(
  denominator: number | undefined,
): TimeSignatureDenominator {
  if (denominator === undefined || !Number.isFinite(denominator) || denominator <= 0) {
    return DEFAULT_TIME_SIGNATURE_DENOMINATOR;
  }
  let best: TimeSignatureDenominator = TIME_SIGNATURE_DENOMINATORS[0];
  let bestDistance = Infinity;
  for (const candidate of TIME_SIGNATURE_DENOMINATORS) {
    const distance = Math.abs(Math.log2(candidate) - Math.log2(denominator));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function createDefaultTempoEvent(): TempoEvent {
  return {
    id: PROJECT_TEMPO_EVENT_ID,
    time: 0,
    bpm: DEFAULT_TEMPO_BPM,
    numerator: DEFAULT_TIME_SIGNATURE_NUMERATOR,
    denominator: DEFAULT_TIME_SIGNATURE_DENOMINATOR,
  };
}

function sanitizeEvent(
  event: Partial<TempoEvent> | undefined,
  usedIds: Set<string>,
): TempoEvent | null {
  if (!event || typeof event.time !== 'number' || !Number.isFinite(event.time)) return null;

  // Backfill a missing id (pre-#299 projects) and repair duplicates, which would
  // otherwise make edits target the wrong event and collide as React keys.
  let id = typeof event.id === 'string' && event.id.length > 0 ? event.id : createTempoEventId();
  if (usedIds.has(id)) id = createTempoEventId();
  usedIds.add(id);

  return {
    id,
    time: Math.max(0, event.time),
    bpm: clampTempoBpm(event.bpm),
    numerator: clampTimeSignatureNumerator(event.numerator),
    denominator: clampTimeSignatureDenominator(event.denominator),
  };
}

/**
 * Tempo data of unknown provenance. Wide on purpose: the durable project tier
 * (`ProjectTempoMap`) has optional ids, and hand-edited files have anything.
 */
export interface TempoMapInput {
  events?: readonly Partial<TempoEvent>[] | null;
}

/**
 * The single repair point for tempo data of unknown provenance: store state,
 * a loaded project, or a hand-edited file. Total function — always returns a
 * map satisfying every invariant.
 */
export function normalizeTempoMap(map?: TempoMapInput | null): TempoMap {
  const usedIds = new Set<string>();
  const sanitized: TempoEvent[] = [];
  for (const event of map?.events ?? []) {
    const next = sanitizeEvent(event, usedIds);
    if (next) sanitized.push(next);
  }
  if (sanitized.length === 0) return { events: [createDefaultTempoEvent()] };

  sanitized.sort((a, b) => a.time - b.time);

  // Unique by time: the later event at a position wins, matching the "writing
  // onto an occupied bar replaces it" rule the UI exposes.
  const deduped: TempoEvent[] = [];
  for (const event of sanitized) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(event.time - previous.time) <= TEMPO_EVENT_TIME_EPSILON) {
      deduped[deduped.length - 1] = event;
      continue;
    }
    deduped.push(event);
  }

  // The project tempo starts the timeline whatever the data claimed.
  if (deduped[0].time !== 0) deduped[0] = { ...deduped[0], time: 0 };

  return { events: deduped };
}

export function tempoMapsEqual(a: TempoMap | undefined, b: TempoMap | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.events.length !== b.events.length) return false;
  return a.events.every((event, index) => {
    const other = b.events[index];
    return event.id === other.id
      && event.time === other.time
      && event.bpm === other.bpm
      && event.numerator === other.numerator
      && event.denominator === other.denominator;
  });
}

/** The event in effect at `time` — the segment a new event inherits meter from. */
export function tempoEventAt(map: TempoMap, time: number): TempoEvent {
  const normalized = normalizeTempoMap(map);
  let result = normalized.events[0];
  for (const event of normalized.events) {
    if (event.time <= time + TEMPO_EVENT_TIME_EPSILON) result = event;
    else break;
  }
  return result;
}

function indexAtTime(events: readonly TempoEvent[], time: number): number {
  return events.findIndex(event => Math.abs(event.time - time) <= TEMPO_EVENT_TIME_EPSILON);
}

/**
 * Add a tempo change. Writing onto an occupied position edits that event in
 * place (keeping its id, so an open editor and React keys survive); inserting
 * at 0 therefore edits the project tempo rather than creating a second event.
 */
export function insertTempoEvent(map: TempoMap, draft: TempoEventDraft): TempoMapEditResult {
  const normalized = normalizeTempoMap(map);
  const time = Number.isFinite(draft.time) ? Math.max(0, draft.time) : 0;
  const inherited = tempoEventAt(normalized, time);

  const occupiedIndex = indexAtTime(normalized.events, time);
  const events = [...normalized.events];
  let event: TempoEvent;

  if (occupiedIndex >= 0) {
    const existing = events[occupiedIndex];
    event = {
      id: existing.id,
      time: existing.time,
      bpm: clampTempoBpm(draft.bpm ?? existing.bpm),
      numerator: clampTimeSignatureNumerator(draft.numerator ?? existing.numerator),
      denominator: clampTimeSignatureDenominator(draft.denominator ?? existing.denominator),
    };
    events[occupiedIndex] = event;
  } else {
    event = {
      id: createTempoEventId(),
      time,
      bpm: clampTempoBpm(draft.bpm ?? inherited.bpm),
      numerator: clampTimeSignatureNumerator(draft.numerator ?? inherited.numerator),
      denominator: clampTimeSignatureDenominator(draft.denominator ?? inherited.denominator),
    };
    events.push(event);
  }

  const next = normalizeTempoMap({ events });
  return { map: next, event, changed: !tempoMapsEqual(map, next) };
}

/**
 * Patch an existing event. The project tempo (index 0) keeps `time === 0`; any
 * other event that would be dragged onto or before it simply does not move,
 * while its BPM/meter patch still applies. Moving onto another occupied
 * position replaces that event, mirroring insert.
 */
export function updateTempoEvent(
  map: TempoMap,
  eventId: string,
  patch: TempoEventPatch,
): TempoMapEditResult {
  const normalized = normalizeTempoMap(map);
  const index = normalized.events.findIndex(event => event.id === eventId);
  if (index < 0) return { map, event: null, changed: false };

  const current = normalized.events[index];
  const isProjectTempo = index === 0;
  const requestedTime = patch.time ?? current.time;
  const canMove = !isProjectTempo
    && Number.isFinite(requestedTime)
    && requestedTime > TEMPO_EVENT_TIME_EPSILON;

  const updated: TempoEvent = {
    id: current.id,
    time: isProjectTempo ? 0 : (canMove ? requestedTime : current.time),
    bpm: clampTempoBpm(patch.bpm ?? current.bpm),
    numerator: clampTimeSignatureNumerator(patch.numerator ?? current.numerator),
    denominator: clampTimeSignatureDenominator(patch.denominator ?? current.denominator),
  };

  const events = [...normalized.events];
  events[index] = updated;

  const collisionIndex = events.findIndex(
    (event, i) => i !== index && Math.abs(event.time - updated.time) <= TEMPO_EVENT_TIME_EPSILON,
  );
  if (collisionIndex > 0) events.splice(collisionIndex, 1);

  const next = normalizeTempoMap({ events });
  return {
    map: next,
    event: next.events.find(event => event.id === eventId) ?? updated,
    changed: !tempoMapsEqual(map, next),
  };
}

/** Remove a tempo change. The project tempo (index 0) is not deletable. */
export function removeTempoEvent(map: TempoMap, eventId: string): TempoMapEditResult {
  const normalized = normalizeTempoMap(map);
  const index = normalized.events.findIndex(event => event.id === eventId);
  if (index <= 0) return { map, event: null, changed: false };

  const removed = normalized.events[index];
  const next = normalizeTempoMap({
    events: normalized.events.filter((_, i) => i !== index),
  });
  return { map: next, event: removed, changed: !tempoMapsEqual(map, next) };
}
