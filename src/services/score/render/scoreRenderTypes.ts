// Shared types for the VexFlow score renderer (issue #366, port phase 2).

import type { ArticulationType, NoteDuration, PitchAlter, PitchStep } from '../../../types/scoreClip';

/**
 * Ghost note preview shown while hovering before note entry.
 * Pitch is stored as spelling (step/alter/octave) — same as NotePitch.
 * `rawX` lets the ghost follow the pointer horizontally between slots.
 */
export interface GhostNote {
  step: PitchStep;
  alter: PitchAlter;
  octave: number;
  duration: NoteDuration;
  measure: number;
  beat: number;
  rawX?: number;
  dots?: number;
  articulations?: ArticulationType[];
}

/**
 * What is currently selected, expressed in model ids. The renderer styles
 * these elements BEFORE drawing (VexFlow setStyle/setKeyStyle/modifier
 * styles) — this replaces kikoromantest's post-render HighlightController.
 */
export interface ScoreRenderSelection {
  /** Selected pitch (NotePitch id) or rest (Rest slot id) */
  noteId?: string | null;
  /** Style the accidental modifier of this pitch instead of its head */
  accidentalNoteId?: string | null;
  /** Style the articulation glyphs of this slot's lowest pitch */
  articulationNoteId?: string | null;
  /** Style this tuplet's bracket/number */
  tupletId?: string | null;
  /** Style the tie that starts at this pitch */
  tieFromNoteId?: string | null;
}

/** Per-render options passed to VexFlowScoreRenderer.renderScore(). */
export interface ScoreRenderOptions {
  /** Available container width in CSS px (replaces the old fixed 1000px) */
  width: number;
  selection?: ScoreRenderSelection | null;
  ghostNote?: GhostNote | null;
  /** Draw a dangling tie arc from this pitch (tie entry pending a target) */
  pendingTieFromNoteId?: string | null;
}

/** Bounds information for a rendered measure. */
export interface MeasureBounds {
  measureX: number;
  measureY: number;
  measureWidth: number;
  /** X position where notes can start (after clef/time sig) */
  noteStartX: number;
  /** X position where notes must end */
  noteEndX: number;
  /** Line (system) index this measure was laid out on */
  lineNumber: number;
}

/** Selection styling — amber, matching the kikoromantest editor. */
export const SELECTION_STYLE = { fillStyle: '#F59E0B', strokeStyle: '#D97706' };
/** Ghost preview styling — translucent blue. */
export const GHOST_STYLE = { fillStyle: 'rgba(59, 130, 246, 0.75)', strokeStyle: 'rgba(37, 99, 235, 0.75)' };
