// Automation → per-note window slicing (issue #298).
//
// A MIDI clip stores its four performed CC lanes (cutoff/mod/expression/pitchBend)
// as clip-level breakpoint envelopes in CONTENT time (same base as MidiNote.start).
// A synth voice, however, bakes modulation relative to its own start. This module
// is the single seam that slices a clip's automation to one note's
// [start, start+duration] window and rebases point times to NOTE-LOCAL seconds
// (0 = note start), producing the `NoteAutomationWindow` the seam passes to
// scheduleNote (plan §3a). Pure + framework-free so it is trivially unit-testable
// and identical on the live and offline paths.

import type {
  AutomationLane,
  AutomationPoint,
  MidiClipAutomation,
  NoteAutomationWindow,
} from '../../types/midiClip';

/**
 * Linear-interpolated lane value at `time` (content or note-local — same units as
 * the lane's points). Flat-holds before the first point and after the last (the
 * standard automation "no ramp past the ends" behavior). Returns `undefined` for
 * an empty/absent lane so callers can distinguish "no automation" from a value.
 */
export function sampleLaneAt(lane: AutomationLane | undefined, time: number): number | undefined {
  const points = lane?.points;
  if (!points || points.length === 0) return undefined;
  if (time <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (time <= b.time) {
      const a = points[i - 1];
      const span = b.time - a.time;
      if (span <= 0) return b.value;
      const t = (time - a.time) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/**
 * Slice one lane to `[start, start+duration]` (content time) and rebase to
 * note-local seconds. Always anchors an explicit point at local time 0 and at
 * `duration` (interpolated from the source curve) so the baked segment is complete
 * regardless of where the surrounding breakpoints fall; interior breakpoints in
 * the window are preserved. Returns `undefined` when the lane contributes nothing.
 */
function sliceLane(
  lane: AutomationLane | undefined,
  start: number,
  duration: number,
): AutomationLane | undefined {
  if (!lane?.points || lane.points.length === 0) return undefined;
  const end = start + duration;
  const out: AutomationPoint[] = [
    { time: 0, value: sampleLaneAt(lane, start) ?? 0 },
  ];
  for (const p of lane.points) {
    if (p.time > start && p.time < end) {
      out.push({ time: p.time - start, value: p.value });
    }
  }
  out.push({ time: duration, value: sampleLaneAt(lane, end) ?? 0 });
  return { points: out };
}

/**
 * Slice a clip's automation to a note's window. Returns `undefined` when there is
 * no automation at all (so the seam passes `undefined` and no carrier work is
 * done), otherwise a `NoteAutomationWindow` with only the lanes that carry data.
 */
export function sliceAutomationToNote(
  automation: MidiClipAutomation | undefined,
  noteStart: number,
  noteDuration: number,
): NoteAutomationWindow | undefined {
  if (!automation) return undefined;
  const cutoff = sliceLane(automation.cutoff, noteStart, noteDuration);
  const mod = sliceLane(automation.mod, noteStart, noteDuration);
  const expression = sliceLane(automation.expression, noteStart, noteDuration);
  const pitchBend = sliceLane(automation.pitchBend, noteStart, noteDuration);
  if (!cutoff && !mod && !expression && !pitchBend) return undefined;
  return { cutoff, mod, expression, pitchBend };
}
