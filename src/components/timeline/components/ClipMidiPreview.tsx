// ClipMidiPreview — Cubase-style mini note view drawn inside a MIDI clip on the
// timeline (issue #232). Each note is a thin horizontal bar: X = note time, Y =
// pitch. The pitch axis is normalized to the clip's own min..max range (DAW
// "fit notes to view") so the used register fills the height instead of being
// squashed into the full 0–127 span.
//
// The canvas spans the FULL clip width so the whole musical content is always
// shown and stays proportional to the clip (X = note.start * pixelsPerSecond,
// literal timeline time). The backing store is capped for very wide clips: it
// then renders at slightly lower resolution but never drops notes.

import { memo, useEffect, useRef } from 'react';
import type { MidiNote } from '../../../types/midiClip';

interface ClipMidiPreviewProps {
  notes: MidiNote[];
  /** Full clip pixel width (content space) — the canvas spans exactly this. */
  width: number;
  height: number;
  pixelsPerSecond: number;
  /**
   * Content time (seconds) at the clip's left edge — the clip's in-point. Notes
   * are drawn at `(note.start - inPoint) * pixelsPerSecond` so the preview tracks
   * the in/out window when the clip is resized (#232). Defaults to 0.
   */
  inPoint?: number;
  /** Bar color (defaults to a light blue that reads on the MIDI clip body). */
  color?: string;
}

const MIN_BAR_HEIGHT = 2;
const MAX_BAR_HEIGHT = 4;
// Each note is at least this wide so even short notes on a narrow (zoomed-out)
// clip stay visible — legibility of the time structure over literal width.
const MIN_BAR_WIDTH = 2;
const PITCH_PADDING = 1; // semitones of headroom above/below the used range
const VERTICAL_INSET = 3; // px breathing room top/bottom inside the canvas
// Cap the backing-store width so a deeply-zoomed/long clip can't allocate a huge
// canvas. Beyond this the preview renders at reduced horizontal resolution but
// still shows every note across the full width.
const MAX_BACKING_WIDTH = 4096;

function ClipMidiPreviewImpl({
  notes,
  width,
  height,
  pixelsPerSecond,
  inPoint = 0,
  color = 'rgba(198, 218, 255, 1)',
}: ClipMidiPreviewProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cssWidth = Math.max(1, Math.round(width));
  const cssHeight = Math.max(1, Math.round(height));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Horizontal scale: full DPR until the clip is wider than the cap, then
    // shrink so the backing store stays bounded (content still spans the width).
    const scaleX = Math.min(dpr, MAX_BACKING_WIDTH / cssWidth);
    canvas.width = Math.max(1, Math.round(cssWidth * scaleX));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));

    ctx.setTransform(scaleX, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; // crisp bar edges so dense notes stay distinct
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (notes.length === 0 || pixelsPerSecond <= 0) return;

    // Pitch range fit to this clip's notes (DAW "fit to view").
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    for (const note of notes) {
      if (note.pitch < minPitch) minPitch = note.pitch;
      if (note.pitch > maxPitch) maxPitch = note.pitch;
    }
    minPitch -= PITCH_PADDING;
    maxPitch += PITCH_PADDING;
    const pitchSpan = Math.max(1, maxPitch - minPitch);

    const usableHeight = Math.max(1, cssHeight - VERTICAL_INSET * 2);
    const barHeight = Math.min(
      MAX_BAR_HEIGHT,
      Math.max(MIN_BAR_HEIGHT, usableHeight / pitchSpan),
    );

    ctx.fillStyle = color;
    for (const note of notes) {
      // X is literal clip-local time: x = note.start * zoom (1:1 with the
      // timeline). Notes starting at/after the clip end are silent (the synth
      // skips them), so they are not drawn; tails crossing the end are clamped
      // to the boundary — mirroring midiPlaybackScheduler exactly.
      const noteStartPx = (note.start - inPoint) * pixelsPerSecond;
      if (noteStartPx >= cssWidth || noteStartPx + note.duration * pixelsPerSecond <= 0) continue;
      const clampedEndPx = Math.min((note.start - inPoint + note.duration) * pixelsPerSecond, cssWidth);
      const rawWidthPx = clampedEndPx - noteStartPx;
      const noteWidthPx = Math.max(MIN_BAR_WIDTH, rawWidthPx);

      // High pitch on top: invert the normalized position.
      const norm = (note.pitch - minPitch) / pitchSpan;
      const y = VERTICAL_INSET + (1 - norm) * usableHeight - barHeight / 2;
      // Leave a hairline seam between long legato notes so consecutive notes
      // stay distinguishable; never shrink a min-width note to nothing.
      const drawWidth = rawWidthPx > MIN_BAR_WIDTH + 1
        ? Math.max(MIN_BAR_WIDTH, noteWidthPx - 1)
        : noteWidthPx;
      ctx.fillRect(noteStartPx, y, drawWidth, barHeight);
    }
  }, [notes, cssWidth, cssHeight, pixelsPerSecond, inPoint, color]);

  return (
    <canvas
      ref={canvasRef}
      className="clip-midi-preview-canvas"
      style={{ width: cssWidth, height: cssHeight }}
      aria-hidden="true"
    />
  );
}

export const ClipMidiPreview = memo(ClipMidiPreviewImpl);
