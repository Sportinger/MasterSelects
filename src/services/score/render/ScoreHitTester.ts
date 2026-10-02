// VexFlow-native hit testing for the score editor (issue #366, phase 3).
//
// The thin glue layer the port replaces kikoromantest's 685-line
// ElementRegistry with: geometry comes straight from the renderer's
// per-render snapshot — live Stave objects (getYForLine, getNoteStartX/EndX),
// StaveNotes (getBoundingBox, getYs, getTieLeftX/RightX) and modifiers
// (getBoundingBox, getIndex) — plus the one inverse VexFlow doesn't provide:
// staff-line → diatonic pitch per clef.

import type { Chord, ChordRest, Clef, PitchSpelling, PitchStep, Score } from '../../../types/scoreClip';
import type { ArticulationType } from '../../../types/scoreClip';
import { fracToNumber } from '../fraction';
import { buildBeatMap } from '../beatMap';
import { getMeasureDuration } from '../musicUtils';
import type { ScoreEntryGeometry, EntryNeighbor } from '../MouseNoteEntry';
import { VexFlowScoreRenderer } from './VexFlowScoreRenderer';
import { ARTICULATION_RENDER_ORDER } from './scoreNoteFactory';
import { LAYOUT_CONFIG } from './scoreLayout';
import type { BuiltSlotNote } from './scoreNoteFactory';

const DIATONIC_STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Diatonic position (spellingDiatonicPos convention) of each clef's TOP staff
 * line: treble F5=38, bass A3=26, alto G4=32, tenor E4=30.
 */
const TOP_LINE_DIATONIC: Record<Clef, number> = {
  treble: 38,
  bass: 26,
  alto: 32,
  tenor: 30,
};

/** A picked note/rest with its model ids. */
export interface PickedNote {
  /** NotePitch id for chord notes, Rest slot id for rests */
  noteId: string;
  slotId: string;
  type: 'note' | 'rest';
  beat: number;
  measure: number;
  distance: number;
}

export interface PlainRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectContains(rect: PlainRect, x: number, y: number, pad = 0): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.width + pad &&
    y >= rect.y - pad && y <= rect.y + rect.height + pad;
}

export class ScoreHitTester implements ScoreEntryGeometry {
  private renderer: VexFlowScoreRenderer;
  private getScore: () => Score;

  constructor(renderer: VexFlowScoreRenderer, getScore: () => Score) {
    this.renderer = renderer;
    this.getScore = getScore;
  }

  private clef(): Clef {
    return this.getScore().clef || 'treble';
  }

  // ==================== ScoreEntryGeometry ====================

  /** Measure at a point: nearest system row, then x span within the row. */
  measureAtPoint(coords: { x: number; y: number }): number | null {
    const score = this.getScore();
    let best: { measure: number; dy: number; dx: number } | null = null;

    for (const m of score.measures) {
      const bounds = this.renderer.getMeasureBounds(m.number);
      if (!bounds) continue;
      const rowTop = bounds.measureY;
      const rowBottom = bounds.measureY + LAYOUT_CONFIG.STAVE_HEIGHT;
      const dy = coords.y < rowTop ? rowTop - coords.y : coords.y > rowBottom ? coords.y - rowBottom : 0;
      const right = bounds.measureX + bounds.measureWidth;
      const dx = coords.x < bounds.measureX ? bounds.measureX - coords.x : coords.x > right ? coords.x - right : 0;
      if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) {
        best = { measure: m.number, dy, dx };
      }
    }

    return best ? best.measure : null;
  }

  /**
   * Natural (alter=0) pitch for a Y position: staff line from the live Stave,
   * snapped to the nearest half-line, then the clef's diatonic inverse.
   */
  yToNaturalPitch(y: number, measure: number): PitchSpelling | null {
    const stave = this.renderer.getStave(measure);
    if (!stave) return null;

    const topY = stave.getYForLine(0);
    const spacing = stave.getYForLine(1) - topY;
    if (!spacing) return null;

    const staffLine = (y - topY) / spacing;
    const halfSteps = Math.round(staffLine * 2);
    // Each half-line down = one diatonic step down; clamp to A0..C8-ish
    const diatonic = Math.max(5, Math.min(56, TOP_LINE_DIATONIC[this.clef()] - halfSteps));

    return {
      step: DIATONIC_STEPS[diatonic % 7],
      alter: 0,
      octave: Math.floor(diatonic / 7),
    };
  }

  noteEntryXRange(measure: number): { startX: number; endX: number } | null {
    const stave = this.renderer.getStave(measure);
    if (!stave) return null;
    return { startX: stave.getNoteStartX(), endX: stave.getNoteEndX() };
  }

  staffYRange(measure: number): { topY: number; bottomY: number } | null {
    const stave = this.renderer.getStave(measure);
    if (!stave) return null;
    return { topY: stave.getYForLine(0), bottomY: stave.getYForLine(4) };
  }

  findNotesLeftRight(x: number, measure: number): {
    nearestLeft: EntryNeighbor | null;
    nearestRight: EntryNeighbor | null;
    leftDistance: number;
    rightDistance: number;
  } {
    let nearestLeft: EntryNeighbor | null = null;
    let nearestRight: EntryNeighbor | null = null;
    let leftDistance = Infinity;
    let rightDistance = Infinity;

    for (const ref of this.renderer.getSlotRefsForMeasure(measure)) {
      const centerX = this.slotCenterX(ref);
      if (centerX === null) continue;
      const neighbor: EntryNeighbor = {
        type: ref.slot.type === 'rest' ? 'rest' : 'note',
        beat: fracToNumber(ref.slot.beat),
      };
      const distance = centerX - x; // positive = right, negative = left
      if (distance <= 0 && Math.abs(distance) < leftDistance) {
        leftDistance = Math.abs(distance);
        nearestLeft = neighbor;
      }
      if (distance >= 0 && distance < rightDistance) {
        rightDistance = distance;
        nearestRight = neighbor;
      }
    }

    return { nearestLeft, nearestRight, leftDistance, rightDistance };
  }

  /** Linear x→beat fallback across the stave's note-entry span. */
  xToBeat(x: number, measure: number, beatsInMeasure: number): number {
    const range = this.noteEntryXRange(measure);
    if (!range || range.endX <= range.startX) return 0;
    const t = (x - range.startX) / (range.endX - range.startX);
    return Math.max(0, Math.min(beatsInMeasure, t * beatsInMeasure));
  }

  // ==================== Note / sub-element picking ====================

  private slotCenterX(ref: BuiltSlotNote): number | null {
    try {
      const box = ref.staveNote.getBoundingBox();
      return box.getX() + box.getW() / 2;
    } catch {
      return null;
    }
  }

  private slotRect(ref: BuiltSlotNote): PlainRect | null {
    try {
      const box = ref.staveNote.getBoundingBox();
      return { x: box.getX(), y: box.getY(), width: box.getW(), height: box.getH() };
    } catch {
      return null;
    }
  }

  /** Rendered Y of a chord pitch (VexFlow key order = MIDI-sorted pitches). */
  private pitchY(ref: BuiltSlotNote, keyIndex: number): number | null {
    try {
      const ys = ref.staveNote.getYs();
      return ys[keyIndex] ?? ys[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Closest note/rest to a point within a measure. Chord members resolve by
   * their own rendered Y (StaveNote.getYs), so mid-chord clicks pick the
   * nearest pitch, not the whole chord.
   */
  closestNoteOrRest(x: number, y: number, measure: number, xTolerance = 30): PickedNote | null {
    let closest: PickedNote | null = null;

    for (const ref of this.renderer.getSlotRefsForMeasure(measure)) {
      const centerX = this.slotCenterX(ref);
      if (centerX === null) continue;
      const xDist = Math.abs(x - centerX);
      if (xDist > xTolerance) continue;

      const beat = fracToNumber(ref.slot.beat);
      if (ref.slot.type === 'rest') {
        const rect = this.slotRect(ref);
        const elementY = rect ? rect.y + rect.height / 2 : y;
        const distance = Math.hypot(xDist, y - elementY);
        if (!closest || distance < closest.distance) {
          closest = { noteId: ref.slot.id, slotId: ref.slot.id, type: 'rest', beat, measure, distance };
        }
      } else {
        ref.sortedPitches.forEach((pitch, keyIndex) => {
          const noteY = this.pitchY(ref, keyIndex) ?? y;
          const distance = Math.hypot(xDist, y - noteY);
          if (!closest || distance < closest.distance) {
            closest = { noteId: pitch.id, slotId: ref.slot.id, type: 'note', beat, measure, distance };
          }
        });
      }
    }

    return closest;
  }

  /**
   * Resolve a pointer event target to a slot via VexFlow's own SVG hit rects
   * (`<g class="vf-stavenote" id="vf-<slotId>">`). Precise fast path; the
   * geometric search above covers empty space.
   */
  slotFromDomTarget(target: EventTarget | null): ChordRest | null {
    const el = target instanceof Element ? target : null;
    const group = el?.closest('g.vf-stavenote');
    const domId = group?.getAttribute('id');
    if (!domId?.startsWith('vf-')) return null;
    return this.renderer.getSlotRef(domId.slice(3))?.slot ?? null;
  }

  /** Tuplet bracket/number at a point, via the drawn tuplet's bounding box. */
  tupletAt(x: number, y: number, pad = 4): string | null {
    const score = this.getScore();
    for (const m of score.measures) {
      for (const tuplet of m.tuplets ?? []) {
        const built = this.renderer.getTuplet(tuplet.id);
        if (!built) continue;
        try {
          const box = built.vexTuplet.getBoundingBox();
          if (rectContains({ x: box.getX(), y: box.getY(), width: box.getW(), height: box.getH() }, x, y, pad)) {
            return tuplet.id;
          }
        } catch {
          // Unformatted tuplet — skip
        }
      }
    }
    return null;
  }

  /** Smallest vertical distance from y to any note of a tuplet. */
  tupletMinNoteDistanceY(tupletId: string, y: number): number {
    const built = this.renderer.getTuplet(tupletId);
    if (!built) return Infinity;
    let min = Infinity;
    for (const staveNote of built.staveNotes) {
      try {
        for (const noteY of staveNote.getYs()) {
          min = Math.min(min, Math.abs(y - noteY));
        }
      } catch {
        // Rests without ys — skip
      }
    }
    return min;
  }

  /**
   * Tie arc at a point. The arc's bbox is derived from its endpoints
   * (getTieRightX/LeftX + the endpoint's rendered Y) and curve direction.
   */
  tieAt(x: number, y: number, pad = 6): { fromNoteId: string; toNoteId: string } | null {
    const ARC_DEPTH = 20; // StaveTie yShift 7 + control points ≈ 19px of arc
    const PARTIAL_LENGTH = 20;

    for (const built of this.renderer.getTies()) {
      let x1: number | null = null;
      let x2: number | null = null;
      let baseY: number | null = null;

      try {
        if (built.fromRef && built.toRef) {
          x1 = built.fromRef.staveNote.getTieRightX();
          x2 = built.toRef.staveNote.getTieLeftX();
          baseY = built.fromRef.staveNote.getYs()[built.fromRef.noteIndex] ?? null;
        } else if (built.fromRef) {
          x1 = built.fromRef.staveNote.getTieRightX();
          x2 = x1 + PARTIAL_LENGTH;
          baseY = built.fromRef.staveNote.getYs()[built.fromRef.noteIndex] ?? null;
        } else if (built.toRef) {
          x2 = built.toRef.staveNote.getTieLeftX();
          x1 = x2 - PARTIAL_LENGTH;
          baseY = built.toRef.staveNote.getYs()[built.toRef.noteIndex] ?? null;
        }
      } catch {
        continue;
      }

      if (x1 === null || x2 === null || baseY === null) continue;

      // Direction is the stock VexFlow default (from the note's stem)
      const direction = built.tie.getDirection() || 1;
      const rect: PlainRect = {
        x: Math.min(x1, x2),
        width: Math.abs(x2 - x1),
        y: direction === -1 ? baseY - ARC_DEPTH : baseY,
        height: ARC_DEPTH,
      };
      if (rectContains(rect, x, y, pad)) {
        return { fromNoteId: built.fromNoteId, toNoteId: built.toNoteId };
      }
    }
    return null;
  }

  /** Accidental glyph at a point → the pitch it belongs to. */
  accidentalAt(x: number, y: number, measure: number, pad = 2): { noteId: string } | null {
    for (const ref of this.renderer.getSlotRefsForMeasure(measure)) {
      if (ref.slot.type !== 'chord') continue;
      for (const modifier of ref.staveNote.getModifiers()) {
        if (modifier.getCategory() !== 'Accidental') continue;
        try {
          const box = modifier.getBoundingBox();
          if (!rectContains({ x: box.getX(), y: box.getY(), width: box.getW(), height: box.getH() }, x, y, pad)) continue;
          const pitch = ref.sortedPitches[modifier.getIndex() ?? -1];
          if (pitch) return { noteId: pitch.id };
        } catch {
          // Modifier without a bbox — skip
        }
      }
    }
    return null;
  }

  /** Articulation glyph at a point → its slot's anchor pitch and type. */
  articulationAt(x: number, y: number, measure: number, pad = 8): { noteId: string; type: ArticulationType } | null {
    for (const ref of this.renderer.getSlotRefsForMeasure(measure)) {
      if (ref.slot.type !== 'chord' || !ref.slot.articulations?.length) continue;

      // Modifiers were added in render order — reproduce the same order to
      // map the nth Articulation modifier back to its type
      const sortedTypes = ref.slot.articulations.slice().sort(
        (a, b) => ARTICULATION_RENDER_ORDER.indexOf(a) - ARTICULATION_RENDER_ORDER.indexOf(b),
      );
      let articulationIndex = 0;
      for (const modifier of ref.staveNote.getModifiers()) {
        if (modifier.getCategory() !== 'Articulation') continue;
        const type = sortedTypes[articulationIndex];
        articulationIndex++;
        try {
          const box = modifier.getBoundingBox();
          if (rectContains({ x: box.getX(), y: box.getY(), width: box.getW(), height: box.getH() }, x, y, pad) && type) {
            const anchorPitch = ref.sortedPitches[0];
            if (anchorPitch) return { noteId: anchorPitch.id, type };
          }
        } catch {
          // Modifier without a bbox — skip
        }
      }
    }
    return null;
  }

  /** Rendered bounding rect of a pitch/rest's slot (scroll-into-view). */
  noteRect(noteId: string): PlainRect | null {
    const ref = this.renderer.getNoteRef(noteId);
    if (!ref) return null;
    try {
      const box = ref.staveNote.getBoundingBox();
      return { x: box.getX(), y: box.getY(), width: box.getW(), height: box.getH() };
    } catch {
      return null;
    }
  }

  // ==================== Entry-position resolution ====================

  /**
   * Pixel point → musical position (measure, beat, natural spelling), used by
   * the ghost preview and pitch drags. Snaps to a nearby rendered slot's beat;
   * in empty space falls back to the linear x→beat mapping, quantized to the
   * armed duration.
   */
  positionFromPoint(
    coords: { x: number; y: number },
    durationBeats?: number,
  ): { measure: number; beat: number; spelling: PitchSpelling } | null {
    const measure = this.measureAtPoint(coords);
    if (measure === null) return null;
    const spelling = this.yToNaturalPitch(coords.y, measure);
    if (!spelling) return null;

    const score = this.getScore();
    const measureData = score.measures.find(m => m.number === measure);
    if (!measureData) return null;
    const beatsInMeasure = getMeasureDuration(measureData.timeSignature);

    let beat: number | null = null;
    let nearestRef: BuiltSlotNote | null = null;
    let nearestDist = Infinity;
    for (const ref of this.renderer.getSlotRefsForMeasure(measure)) {
      const centerX = this.slotCenterX(ref);
      if (centerX === null) continue;
      const dist = Math.abs(coords.x - centerX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestRef = ref;
      }
    }

    if (nearestRef) {
      const rect = this.slotRect(nearestRef);
      if (rect && nearestDist < rect.width * 1.5) {
        beat = fracToNumber(nearestRef.slot.beat);
      }
    }

    if (beat === null) {
      beat = this.xToBeat(coords.x, measure, beatsInMeasure);
      if (durationBeats) {
        beat = Math.round(beat / durationBeats) * durationBeats;
        beat = Math.max(0, Math.min(beat, beatsInMeasure - durationBeats));
      }
    }

    return { measure, beat, spelling };
  }

  // ==================== Keyboard cursor ====================

  /**
   * Geometry for the entry-mode cursor line: the insertion point AFTER the
   * anchor note (the next beat's left edge, or the anchor's right edge at the
   * end of the score) spanning the staff height.
   */
  keyboardCursorInfo(selectedNoteId: string): { x: number; topY: number; bottomY: number } | null {
    const score = this.getScore();
    const { allFlat, beats } = buildBeatMap(score);
    const currentNote = allFlat.find(n => n.id === selectedNoteId);
    if (!currentNote) return null;

    const currentKey = `${currentNote.measureNumber}:${currentNote.beat.num}/${currentNote.beat.den}`;
    const currentIndex = beats.findIndex(n => `${n.measureNumber}:${n.beat.num}/${n.beat.den}` === currentKey);
    if (currentIndex === -1) return null;

    const nextBeat = beats[currentIndex + 1];
    let cursorX: number;
    let cursorMeasure: number;

    if (nextBeat) {
      const rect = this.noteRect(nextBeat.id);
      if (!rect) return null;
      cursorX = rect.x;
      cursorMeasure = nextBeat.measureNumber;
    } else {
      const rect = this.noteRect(selectedNoteId);
      if (!rect) return null;
      cursorX = rect.x + rect.width;
      cursorMeasure = currentNote.measureNumber;
    }

    const range = this.staffYRange(cursorMeasure);
    if (!range) return null;
    return { x: cursorX, topY: range.topY - 6, bottomY: range.bottomY + 6 };
  }

  // ==================== Chord helpers ====================

  /** All pitch Ys at a chord slot (for hover/stem heuristics). */
  chordPitchesAt(slotId: string): Array<{ pitch: Chord['notes'][number]; y: number | null }> {
    const ref = this.renderer.getSlotRef(slotId);
    if (!ref || ref.slot.type !== 'chord') return [];
    return ref.sortedPitches.map((pitch, keyIndex) => ({ pitch, y: this.pitchY(ref, keyIndex) }));
  }
}
