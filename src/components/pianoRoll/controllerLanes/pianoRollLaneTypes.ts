// Controller-lane registry + shared velocity scale/color helpers (#249).
//
// Cubase docks a stack of controller lanes under the note grid. Velocity is the
// only lane that ships first, but it is a *per-note property* — not a free CC
// event — so the registry is deliberately generic (`kind`, display `min`/`max`)
// to let real CC / pitchbend / aftertouch lanes drop in later with no UI rewrite
// (see docs/ongoing/PianoRoll-Velocity-Controller-Lanes-Plan.md).
//
// This file is the SINGLE SOURCE OF TRUTH for the velocity scale + color ramp:
// the grid note bodies, the out-of-window notes, and the velocity lane all import
// `velocityToColor` from here so they can never drift, and keeping the helpers out
// of PianoRoll.tsx keeps that already-oversized file from growing further.

/** What a controller lane shows. Velocity is a per-note property; CC lanes (later) are free events. */
export type LaneKind = 'note-property' | 'cc';

export interface LaneTypeDescriptor {
  /** Stable id persisted in `settingsStore.pianoRollControllerArea.lanes`. */
  id: string;            // 'velocity', later 'cc1', 'cc11', 'pitchbend'
  label: string;         // 'Velocity', 'CC1 Modulation', …
  kind: LaneKind;
  /** Display scale shown in the UI (MIDI standard 0–127 for velocity). */
  min: number;
  max: number;
}

// Velocity is the only entry today. Adding a descriptor here is what makes a new
// lane type selectable once the interactive picker lands (a deferred fast-follow).
export const LANE_TYPES: readonly LaneTypeDescriptor[] = [
  { id: 'velocity', label: 'Velocity', kind: 'note-property', min: 0, max: 127 },
];

/** Default ordered lane ids shown in the controller area (velocity-only for now). */
export const DEFAULT_CONTROLLER_LANES: readonly string[] = ['velocity'];

export function getLaneType(id: string): LaneTypeDescriptor | undefined {
  return LANE_TYPES.find((lane) => lane.id === id);
}

// --- velocity scale ---------------------------------------------------------
// Storage stays 0–1 (MidiNote.velocity), but the UI speaks MIDI's 0–127 (numeric
// readouts, lane scale). These two helpers are the only conversion seam.

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 0–1 stored velocity → 0–127 MIDI value for display. */
export function vel01ToMidi(v: number): number {
  return Math.round(clamp01(v) * 127);
}

/** 0–127 MIDI value → 0–1 stored velocity. */
export function midiToVel01(n: number): number {
  return clamp01(n / 127);
}

// --- velocity color ramp ----------------------------------------------------
// A perceptual low→high ramp readable on the #181818 grid: blue (low) → violet
// (mid) → red (high), sweeping hue the "purple way" (225°→360°) so it NEVER
// passes through green/yellow. That matters because the selected-note outline is
// amber (#ffd54a), which would lose contrast against a yellow/orange band; a
// blue→red ramp keeps the amber ring distinct at every velocity. A slight
// lightness lift adds a secondary low-dim→high-hot cue. Returned as an `hsl()`
// string (a solid fill, no gradient — Mesa tiling guard, CLAUDE.md §9).
const VEL_HUE_LOW = 225;   // blue
const VEL_HUE_HIGH = 360;  // red (≈ violet/magenta at the midpoint, hue ~292°)
const VEL_LIGHT_LOW = 44;  // %
const VEL_LIGHT_HIGH = 54; // %
const VEL_SAT = 72;        // % — constant, keeps the ramp vivid end to end

export function velocityToColor(v01: number): string {
  const v = clamp01(v01);
  const hue = VEL_HUE_LOW + (VEL_HUE_HIGH - VEL_HUE_LOW) * v;
  const light = VEL_LIGHT_LOW + (VEL_LIGHT_HIGH - VEL_LIGHT_LOW) * v;
  return `hsl(${hue.toFixed(0)}, ${VEL_SAT}%, ${light.toFixed(0)}%)`;
}
