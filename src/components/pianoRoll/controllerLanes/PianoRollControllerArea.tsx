// Cubase-style controller-lane area docked under the piano-roll grid (#249).
//
// It holds a left info column (aligned under the keyboard) + a horizontally
// scroll-following track (aligned under the grid, shares the grid's h-scroll &
// zoom, no vertical scroll) + a top divider that resizes the area height. Today
// it shows the single Velocity lane; the `lanes: string[]` registry shape lets
// CC / pitchbend lanes drop in later with no UI rewrite (see the plan).
//
// Mounting note: PianoRoll renders this as a third absolutely-positioned band
// INSIDE the body, above the horizontal scrollbar (which lives inside the body
// pinned to bottom:0). The scroll-follow track is slid by the viewport's
// scrollLeft via `velocityFollowRef` — the same imperative translateX pattern as
// the ruler/playhead — so editing or scrolling never re-renders this subtree.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MidiNote } from '../../../types/midiClip';
import type { MidiClipWindow } from '../../../services/midi/midiClipTiming';
import { useSettingsStore } from '../../../stores/settingsStore';
import { PIANO_ROLL_SCROLLBAR } from '../PianoRollScrollbars';
import { getLaneType, LANE_TYPES } from './pianoRollLaneTypes';
import { PianoRollVelocityLane } from './PianoRollVelocityLane';
import { PianoRollCcLane } from './PianoRollCcLane';

type UpdateMidiNote = (
  clipId: string,
  noteId: string,
  patch: Partial<Pick<MidiNote, 'pitch' | 'start' | 'duration' | 'velocity'>>,
  options?: { captureHistory?: boolean },
) => void;

// Height resize bounds + the grab strip at the top of the area. Sane clamps so
// the lane can't collapse to nothing or balloon past the viewport.
const DIVIDER_H = 6;
const MIN_AREA_H = 48;
const MAX_AREA_H = 400;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface PianoRollControllerAreaProps {
  clipId: string;
  /** Full scrollable grid width (left margin + window + right margin). */
  gridWidth: number;
  /** Left "outside" margin in px (grid pixel 0 = the margin's left edge). */
  marginPx: number;
  pxPerSec: number;
  effWindow: MidiClipWindow;
  inWindowNotes: MidiNote[];
  outOfWindowNotes: MidiNote[];
  selectedIds: ReadonlySet<string>;
  updateMidiNote: UpdateMidiNote;
  /** Scroll-follow track ref — PianoRoll slides it via translateX on scroll. */
  velocityFollowRef: React.RefObject<HTMLDivElement | null>;
  /** The grid's scroll viewport, so wheel-over-the-lane drives the grid scroll. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Ctrl/Ctrl+Shift wheel zoom — same handler the grid uses (pointer-anchored). */
  onZoomWheel: (e: WheelEvent) => void;
  /** Keyboard-column width (KEYBOARD_W in PianoRoll) so the info column aligns. */
  keyboardWidth: number;
}

export function PianoRollControllerArea({
  clipId,
  gridWidth,
  marginPx,
  pxPerSec,
  effWindow,
  inWindowNotes,
  outOfWindowNotes,
  selectedIds,
  updateMidiNote,
  velocityFollowRef,
  scrollRef,
  onZoomWheel,
  keyboardWidth,
}: PianoRollControllerAreaProps) {
  const area = useSettingsStore((s) => s.pianoRollControllerArea);
  const setArea = useSettingsStore((s) => s.setPianoRollControllerArea);
  // Live 0–127 readout shown in the info column while a bar is dragged.
  const [readout, setReadout] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Wheel over the lane drives the GRID's scroll viewport (the lane lives outside
  // it), so Shift+wheel scrolls horizontally and plain wheel scrolls the grid —
  // exactly like hovering the grid. The scroll-follow track then tracks it via
  // syncRulerScroll. Setting scrollLeft directly per wheel tick feels choppy
  // (the browser would otherwise ANIMATE a native wheel scroll), so we accumulate
  // deltas into a target and ease toward it on rAF — matching the grid's smooth
  // feel. Non-passive so we can preventDefault the popup page scroll; Ctrl/Cmd
  // (zoom) is left untouched. Re-attaches when the lane (un)mounts.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let targetLeft: number | null = null;
    let targetTop: number | null = null;
    let raf: number | null = null;

    const tick = () => {
      raf = null;
      const sc = scrollRef.current;
      if (!sc) { targetLeft = null; targetTop = null; return; }
      let again = false;
      if (targetLeft !== null) {
        const diff = targetLeft - sc.scrollLeft;
        if (Math.abs(diff) < 0.5) { sc.scrollLeft = targetLeft; targetLeft = null; }
        else { sc.scrollLeft += diff * 0.22; again = true; }
      }
      if (targetTop !== null) {
        const diff = targetTop - sc.scrollTop;
        if (Math.abs(diff) < 0.5) { sc.scrollTop = targetTop; targetTop = null; }
        else { sc.scrollTop += diff * 0.22; again = true; }
      }
      if (again) raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      // Ctrl/Cmd (+Shift) = zoom, identical to the grid (pointer-anchored).
      if (e.ctrlKey || e.metaKey) { onZoomWheel(e); return; }
      const sc = scrollRef.current;
      if (!sc) return;
      e.preventDefault();
      const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
      const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
      // Shift = horizontal; otherwise vertical (+ any horizontal trackpad delta).
      if (e.shiftKey) {
        targetLeft = clamp((targetLeft ?? sc.scrollLeft) + (e.deltaY || e.deltaX), 0, maxLeft);
      } else {
        targetTop = clamp((targetTop ?? sc.scrollTop) + e.deltaY, 0, maxTop);
        if (e.deltaX) targetLeft = clamp((targetLeft ?? sc.scrollLeft) + e.deltaX, 0, maxLeft);
      }
      if (raf === null) raf = requestAnimationFrame(tick);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [scrollRef, onZoomWheel, area.visible]);

  const onDividerDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = area.height;
    // Listen on the POPUP's document so move/up fire inside the detached window.
    const doc = containerRef.current?.ownerDocument ?? document;
    const onMove = (ev: MouseEvent) => {
      // The area is bottom-anchored, so dragging the top divider UP grows it.
      setArea({ height: clamp(startH + (startY - ev.clientY), MIN_AREA_H, MAX_AREA_H) });
    };
    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }, [area.height, setArea]);

  if (!area.visible) return null;

  const areaH = area.height;
  const laneInnerH = Math.max(8, areaH - DIVIDER_H);
  // Option A: one lane visible at a time, chosen via the info-column selector
  // (persisted as the single entry in `lanes`). Velocity is a per-note property;
  // the four CC lanes are breakpoint envelopes on clip.automation.
  const lanes = area.lanes.length > 0 ? area.lanes : ['velocity'];
  const activeLaneId = lanes[0];
  const activeLane = getLaneType(activeLaneId) ?? LANE_TYPES[0];

  return (
    <div
      ref={containerRef}
      style={{
        // Span the full body width (right:0) so the lane background fills the
        // gutter beside the now-shortened vertical scrollbar; the track viewport
        // below is still inset by PIANO_ROLL_SCROLLBAR so its scroll-follow track
        // clips at the SAME right edge as the grid (bars stay aligned with notes).
        position: 'absolute', left: 0, right: 0, bottom: PIANO_ROLL_SCROLLBAR,
        height: areaH, display: 'flex', background: '#141414', borderTop: '1px solid #2a2a2a',
        zIndex: 5,
      }}
    >
      {/* Top resize divider (full width, sits above both columns). */}
      <div
        onMouseDown={onDividerDown}
        title="Drag to resize the controller area"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: DIVIDER_H, cursor: 'ns-resize', zIndex: 6 }}
      />

      {/* Info column — aligned under the keyboard. Plain "Velocity" label + the
          0–127 scale; the live readout replaces the scale while dragging. The
          interactive +/− lane picker is deferred until a 2nd lane type exists. */}
      <div
        style={{
          // Content-box (NOT border-box) so the column is keyboardWidth + 1px
          // border = the SAME total width as the grid's keyboard column; the
          // track viewport then starts at the same x as the grid content, so the
          // bars line up with their notes (and the playhead) to the pixel.
          width: keyboardWidth, flexShrink: 0, position: 'relative',
          background: '#1a1a1a', borderRight: '1px solid #000',
          paddingTop: DIVIDER_H, userSelect: 'none',
        }}
      >
        {/* Lane picker (Option A): switch the single visible lane. */}
        <select
          value={activeLaneId}
          onChange={(e) => setArea({ lanes: [e.currentTarget.value] })}
          title="Controller lane"
          style={{
            position: 'absolute', top: DIVIDER_H + 1, left: 3, right: 3, width: 'calc(100% - 6px)',
            fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.82)',
            background: '#232323', border: '1px solid #000', borderRadius: 3, padding: '1px 2px',
          }}
        >
          {LANE_TYPES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        {readout === null ? (
          <>
            <div style={{ position: 'absolute', top: DIVIDER_H + 18, right: 3, fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{activeLane.max}</div>
            <div style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>{activeLane.min}</div>
          </>
        ) : (
          <div style={{ position: 'absolute', left: 0, right: 0, top: DIVIDER_H + 16, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#cfe0ff' }}>
            {readout}
          </div>
        )}
      </div>

      {/* Track viewport — aligned under the grid, clips the scroll-follow track. */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={velocityFollowRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: gridWidth }}>
          {activeLane.kind === 'cc' && activeLane.automationKey ? (
            <PianoRollCcLane
              key={activeLane.id}
              clipId={clipId}
              lane={activeLane}
              effWindow={effWindow}
              pxPerSec={pxPerSec}
              marginPx={marginPx}
              laneInnerH={laneInnerH}
              gridWidth={gridWidth}
              onReadoutChange={setReadout}
            />
          ) : (
            <PianoRollVelocityLane
              key={activeLane.id}
              clipId={clipId}
              inWindowNotes={inWindowNotes}
              outOfWindowNotes={outOfWindowNotes}
              effWindow={effWindow}
              pxPerSec={pxPerSec}
              marginPx={marginPx}
              laneInnerH={laneInnerH}
              selectedIds={selectedIds}
              updateMidiNote={updateMidiNote}
              onReadoutChange={setReadout}
            />
          )}
        </div>
      </div>

      {/* Right gutter filler aligned under the (shortened) vertical scrollbar, so
          the lane reads as one continuous band to the editor's right edge. */}
      <div style={{ width: PIANO_ROLL_SCROLLBAR, flexShrink: 0 }} />
    </div>
  );
}
