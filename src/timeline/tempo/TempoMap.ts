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
  startTime: number;    // seconds the segment takes effect
  endTime: number;      // seconds the NEXT event takes effect (Infinity if last)
  numerator: number;    // beats per bar
  denominator: number;  // the beat's note value (4 = quarter)
  startBps: number;     // metric beats per second at startTime
  endBps: number;       // ... at endTime; equals startBps unless the next event ramps
  startPhase: number;   // cumulative bar phase at startTime
  startQuarters: number; // cumulative QUARTER NOTES at startTime
}

const FALLBACK_EVENT: TempoEvent = {
  id: 'tempo-fallback',
  time: 0,
  bpm: 60,
  numerator: 4,
  denominator: 4,
};

// Metric beats per second. BPM counts quarter notes; the counted beat is a
// 1/denominator note, so a 6/8 bar at 120 BPM ticks eighth notes.
function beatsPerSecond(bpm: number, denominator: number): number {
  return (bpm / SECONDS_PER_MINUTE) * (denominator / 4);
}

// Beats elapsed `tau` seconds into a segment.
//
// A jump segment is linear: beats = bps * tau. A RAMP segment interpolates the
// tempo linearly in time, so beats is the INTEGRAL of that line — quadratic in
// tau, not a division by a constant. Outside [0, T] the tempo is held constant
// (before the project origin, or past the last segment), which keeps the
// projection total.
function beatsElapsed(segment: TempoSegment, tau: number): number {
  const duration = segment.endTime - segment.startTime;
  const delta = segment.endBps - segment.startBps;
  if (!Number.isFinite(duration) || Math.abs(delta) < EPSILON || tau <= 0) {
    return segment.startBps * tau;
  }
  const within = Math.min(tau, duration);
  const beats = segment.startBps * within + (delta * within * within) / (2 * duration);
  return tau > duration ? beats + segment.endBps * (tau - duration) : beats;
}

// Inverse of beatsElapsed: how far into the segment beat `beats` falls. The ramp
// case solves the quadratic in closed form, so this stays exact rather than
// iterating.
function tauForBeats(segment: TempoSegment, beats: number): number {
  const duration = segment.endTime - segment.startTime;
  const delta = segment.endBps - segment.startBps;
  if (!Number.isFinite(duration) || Math.abs(delta) < EPSILON || beats <= 0) {
    return beats / segment.startBps;
  }

  const totalBeats = beatsElapsed(segment, duration);
  if (beats > totalBeats) {
    // Past the ramp: the tempo is whatever it reached.
    return duration + (beats - totalBeats) / segment.endBps;
  }

  // (delta / 2T) * tau^2 + startBps * tau - beats = 0
  const a = delta / (2 * duration);
  const discriminant = segment.startBps * segment.startBps + 4 * a * beats;
  if (discriminant <= 0) return beats / segment.startBps;
  return (-segment.startBps + Math.sqrt(discriminant)) / (2 * a);
}

// Fold the events into segments carrying their cumulative bar phase so every
// query is a constant-time lookup + one arithmetic step within a segment.
function buildSegments(map: TempoMap): TempoSegment[] {
  const events = map.events.length > 0
    ? [...map.events].sort((a, b) => a.time - b.time)
    : [FALLBACK_EVENT];

  const segments: TempoSegment[] = [];
  let previous: TempoSegment | null = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const next = events[index + 1];
    const startBps = beatsPerSecond(event.bpm, event.denominator);
    // A ramp belongs to the event it leads INTO: marking event N+1 as a ramp
    // makes THIS segment glide from its own tempo up to N+1's. The next tempo is
    // expressed in this segment's beat unit, because the beat only changes at
    // the boundary.
    const endBps = next?.curve === 'ramp'
      ? beatsPerSecond(next.bpm, event.denominator)
      : startBps;

    const previousBeats = previous
      ? beatsElapsed(previous, previous.endTime - previous.startTime)
      : 0;
    const startPhase = previous ? previous.startPhase + previousBeats / previous.numerator : 0;
    const startQuarters = previous
      ? previous.startQuarters + previousBeats * (4 / previous.denominator)
      : 0;

    const segment: TempoSegment = {
      startTime: event.time,
      endTime: next ? next.time : Number.POSITIVE_INFINITY,
      numerator: event.numerator,
      denominator: event.denominator,
      startBps,
      endBps,
      startPhase,
      startQuarters,
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
  const phase = segment.startPhase
    + beatsElapsed(segment, time - segment.startTime) / segment.numerator;
  return phaseToBarBeat(phase, segment.numerator);
}

// Convert a 1-based bar/beat position back to seconds. Walks segments so the
// correct meter (numerator) is used for the bar that contains the target.
export function barBeatToSeconds(map: TempoMap, bar: number, beat = 1): number {
  const segments = buildSegments(map);

  // Below the first segment (bar <= 0, i.e. musical time before the project
  // origin) no range test below can match, and the loop would fall through to
  // the LAST segment and return nonsense. This is reachable in normal use: a
  // MIDI clip extended leftwards has a negative inPoint, so its content origin
  // sits before 0 (see midiClipTiming.ts). Extrapolate through segment 0's
  // tempo instead — the projection stays continuous and invertible.
  const firstSegment = segments[0];
  const firstTargetPhase = (bar - 1) + (beat - 1) / firstSegment.numerator;
  if (firstTargetPhase < firstSegment.startPhase - EPSILON) {
    const beats = (firstTargetPhase - firstSegment.startPhase) * firstSegment.numerator;
    return firstSegment.startTime + beats / firstSegment.startBps;
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const nextStartPhase = segments[i + 1]?.startPhase ?? Infinity;
    const targetPhase = (bar - 1) + (beat - 1) / segment.numerator;
    const isLast = i === segments.length - 1;
    if (
      isLast
      || (targetPhase >= segment.startPhase - EPSILON && targetPhase < nextStartPhase - EPSILON)
    ) {
      const beats = (targetPhase - segment.startPhase) * segment.numerator;
      return segment.startTime + tauForBeats(segment, beats);
    }
  }

  // Unreachable (the last segment always matches); kept for total-function safety.
  return 0;
}

// Object-taking companion, so a `secondsToBarBeat` result can be fed straight
// back without unpacking it at every call site (issue #299, Packet 2).
export function barBeatToSecondsAt(map: TempoMap, position: BarBeat): number {
  return barBeatToSeconds(map, position.bar, position.beat);
}

// ─── Quarter-note position ───────────────────────────────────────────────────
//
// The musical coordinate CONTENT is anchored to (issue #299). Deliberately NOT
// bar/beat: BPM defines how long a quarter note lasts, while the time signature
// only groups beats into bars. Anchoring content to bar/beat would make a pure
// meter change (4/4 -> 3/4 at the same BPM) drag every note sideways, even
// though no note's duration changed. Quarters are invariant under re-grouping
// and scale correctly with tempo, including through ramps.

// A segment's beat is a 1/denominator note = 4/denominator quarter notes.
function beatsToQuarters(segment: TempoSegment, beats: number): number {
  return beats * (4 / segment.denominator);
}

export function secondsToQuarters(map: TempoMap, time: number): number {
  const segments = buildSegments(map);
  const segment = segmentAtTime(segments, time);
  return segment.startQuarters
    + beatsToQuarters(segment, beatsElapsed(segment, time - segment.startTime));
}

export function quartersToSeconds(map: TempoMap, quarters: number): number {
  const segments = buildSegments(map);

  // Before the project origin the first segment's tempo is held constant, the
  // same extrapolation barBeatToSeconds uses (reachable via negative MIDI
  // content time).
  const first = segments[0];
  if (quarters < first.startQuarters - EPSILON) {
    const beats = (quarters - first.startQuarters) * (first.denominator / 4);
    return first.startTime + beats / first.startBps;
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const nextStartQuarters = segments[i + 1]?.startQuarters ?? Infinity;
    const isLast = i === segments.length - 1;
    if (isLast || quarters < nextStartQuarters - EPSILON) {
      const beats = (quarters - segment.startQuarters) * (segment.denominator / 4);
      return segment.startTime + tauForBeats(segment, beats);
    }
  }

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
    const segmentEnd = segment.endTime;
    const from = Math.max(startTime, segment.startTime);
    const to = Math.min(endTime, segmentEnd);
    if (from > to + EPSILON) continue;

    // First beat index k (>= 0) whose line time is at or after `from`. With a
    // ramp the spacing is not constant, so k comes from the integral and each
    // line time from its inverse.
    let k = Math.max(0, Math.ceil(beatsElapsed(segment, from - segment.startTime) - EPSILON));
    for (; ; k++) {
      const time = segment.startTime + tauForBeats(segment, k);
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
