// Pure tempo-map projection (issue #257, Packet 2).
//
// Bars+Beats is NOT a linear ruler — it is time projected through a sorted list
// of tempo / time-signature events. Once tempo can vary you cannot convert
// beats <-> seconds with a single formula; you must walk the map segment by
// segment. This module is that walk. It is pure (no runtime handles), so it
// satisfies the durable-store rules and sits beside geometry/ and projection/.
//
// Today the map is a single 4/4 @ 60 BPM event, which reduces to clean
// arithmetic (bar N starts at (N-1)*4s, beats on integer seconds). The loop is
// already general, so N-segment maps (future tempo/meter edits) work unchanged.
//
// Model: musical position is a continuous, monotonic "bar phase" (fractional
// bars from the origin). BPM is quarter-notes per minute; a metric beat is a
// 1/denominator note (= 4/denominator quarter notes). A tempo/meter event takes
// effect at its `time`; bars/beats accumulate continuously across the boundary,
// so a meter change that does not land on a downbeat simply yields one short or
// long bar — well-defined and invertible rather than silently snapped.

import type { TempoEvent, TempoMap } from '../../types/timeline';

const SECONDS_PER_MINUTE = 60;
const EPSILON = 1e-6;

// A 1-based musical position. `beat` is fractional within the bar (beat 2.5 is
// halfway between the 2nd and 3rd beats).
export interface BarBeat {
  bar: number;
  beat: number;
}

// One emitted ruler tick: a beat line at `time` seconds.
export interface BarBeatLine {
  time: number;
  bar: number;
  beat: number; // integer, 1-based
  isBarStart: boolean;
}

interface TempoSegment {
  startTime: number;   // seconds the segment takes effect
  numerator: number;   // beats per bar
  beatSeconds: number; // seconds per metric beat
  barSeconds: number;  // seconds per bar
  startPhase: number;  // cumulative bar phase at startTime
}

const FALLBACK_EVENT: TempoEvent = { time: 0, bpm: 60, numerator: 4, denominator: 4 };

function beatSecondsFor(event: TempoEvent): number {
  // Quarter note = 60/bpm seconds; the counted beat is a 1/denominator note.
  const quarterNoteSeconds = SECONDS_PER_MINUTE / event.bpm;
  return quarterNoteSeconds * (4 / event.denominator);
}

// Fold the events into segments carrying their cumulative bar phase so every
// query is a constant-time lookup + one arithmetic step within a segment.
function buildSegments(map: TempoMap): TempoSegment[] {
  const events = map.events.length > 0
    ? [...map.events].sort((a, b) => a.time - b.time)
    : [FALLBACK_EVENT];

  const segments: TempoSegment[] = [];
  let previous: TempoSegment | null = null;

  for (const event of events) {
    const beatSeconds = beatSecondsFor(event);
    const barSeconds = beatSeconds * event.numerator;
    const startPhase = previous
      ? previous.startPhase + (event.time - previous.startTime) / previous.barSeconds
      : 0;
    const segment: TempoSegment = {
      startTime: event.time,
      numerator: event.numerator,
      beatSeconds,
      barSeconds,
      startPhase,
    };
    segments.push(segment);
    previous = segment;
  }

  return segments;
}

function segmentAtTime(segments: TempoSegment[], time: number): TempoSegment {
  let result = segments[0];
  for (const segment of segments) {
    if (segment.startTime <= time + EPSILON) result = segment;
    else break;
  }
  return result;
}

function phaseToBarBeat(phase: number, numerator: number): BarBeat {
  const barIndex = Math.floor(phase + EPSILON);
  const fractionOfBar = phase - barIndex;
  return {
    bar: barIndex + 1,
    beat: fractionOfBar * numerator + 1,
  };
}

// Convert a time (seconds) to its 1-based bar/beat position.
export function secondsToBarBeat(map: TempoMap, time: number): BarBeat {
  const segments = buildSegments(map);
  const segment = segmentAtTime(segments, time);
  const phase = segment.startPhase + (time - segment.startTime) / segment.barSeconds;
  return phaseToBarBeat(phase, segment.numerator);
}

// Convert a 1-based bar/beat position back to seconds. Walks segments so the
// correct meter (numerator) is used for the bar that contains the target.
export function barBeatToSeconds(map: TempoMap, bar: number, beat = 1): number {
  const segments = buildSegments(map);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const nextStartPhase = segments[i + 1]?.startPhase ?? Infinity;
    const targetPhase = (bar - 1) + (beat - 1) / segment.numerator;
    const isLast = i === segments.length - 1;
    if (
      isLast
      || (targetPhase >= segment.startPhase - EPSILON && targetPhase < nextStartPhase - EPSILON)
    ) {
      return segment.startTime + (targetPhase - segment.startPhase) * segment.barSeconds;
    }
  }

  // Unreachable (the last segment always matches); kept for total-function safety.
  return 0;
}

// Emit every beat line within [startTime, endTime] (inclusive), in order. Drives
// the bars ruler over the visible window; pixel spacing is variable-ready (it
// follows each segment's barSeconds) but constant for the single-segment map.
export function iterateBarBeatLines(
  map: TempoMap,
  startTime: number,
  endTime: number,
): BarBeatLine[] {
  if (endTime < startTime) return [];

  const segments = buildSegments(map);
  const lines: BarBeatLine[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentEnd = segments[i + 1]?.startTime ?? Infinity;
    const from = Math.max(startTime, segment.startTime);
    const to = Math.min(endTime, segmentEnd);
    if (from > to + EPSILON) continue;

    // First beat index k (>= 0) whose line time is at or after `from`.
    let k = Math.max(0, Math.ceil((from - segment.startTime) / segment.beatSeconds - EPSILON));
    for (; ; k++) {
      const time = segment.startTime + k * segment.beatSeconds;
      if (time > to + EPSILON) break;
      // The line on a segment's start belongs to that next segment, not this one.
      if (segmentEnd !== Infinity && time >= segmentEnd - EPSILON) break;

      const phase = segment.startPhase + k / segment.numerator;
      const barIndex = Math.floor(phase + EPSILON);
      const beatWithinBar = Math.round((phase - barIndex) * segment.numerator);
      const rolledOver = beatWithinBar >= segment.numerator;
      lines.push({
        time,
        bar: rolledOver ? barIndex + 2 : barIndex + 1,
        beat: rolledOver ? 1 : beatWithinBar + 1,
        isBarStart: rolledOver || beatWithinBar === 0,
      });
    }
  }

  return lines;
}
