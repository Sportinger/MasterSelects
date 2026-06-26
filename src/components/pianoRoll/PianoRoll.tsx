// Piano-roll editor for a single MIDI clip (issue #182).
//
// Runs inside a detached same-origin popup (see PianoRollBoot) but is a normal
// React component reading the shared Zustand timeline store. Vertical axis is
// pitch (keyboard on the left), horizontal axis is time in seconds across the
// clip. Notes are drawn/moved/resized with free placement (no grid snapping)
// and deleted via right-click. A live cursor mirrors the timeline playhead.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Icon, IconEraser, IconMarquee2, IconPointer } from '@tabler/icons-react';
import { useTimelineStore } from '../../stores/timeline';
import { selectTempoMap } from '../../stores/timeline/selectors';
import { previewMidiNote } from '../../services/audio/midiPlaybackScheduler';
import type { MidiNote } from '../../types/midiClip';
import { computeGhostNotes } from './ghostNotes';
import { PianoRollScrollbars, PIANO_ROLL_SCROLLBAR } from './PianoRollScrollbars';
import { PianoRollRuler, PIANO_ROLL_RULER_H, PART_BORDER_COLOR } from './PianoRollRuler';
import { PianoRollGridLines } from './PianoRollGridLines';
import { buildPianoRollGrid } from './pianoRollGrid';
import { clipLocalToContentTime, contentTimeToClipLocal, isNoteStartInWindow, type MidiClipWindow } from '../../services/midi/midiClipTiming';
import { computeTrimTiming, trimOriginalsFromClip, type TrimOriginals } from '../timeline/utils/clipTrimTiming';
import { resolvePianoRollToolAction, type PianoRollToolId } from './pianoRollToolShortcuts';
import { duplicateNotesRight, hasPianoRollClipboard, pasteNotesAt, setPianoRollClipboard } from './pianoRollClipboard';
import { redo, undo } from '../../stores/historyStore';

// Two independent zoom axes, like Cubase (#249): horizontal = time scale
// (px per second), vertical = note-row height (px per pitch). Both live in
// component state so Ctrl / Ctrl+Shift wheel zoom (and, later, the on-screen
// zoom buttons) can drive them. The DEFAULT_* values are the historical fixed
// scale; MIN/MAX keep the grid usable at the extremes.
const DEFAULT_ROW_H = 16;          // px per pitch row
const MIN_ROW_H = 5;
const MAX_ROW_H = 48;
const DEFAULT_PX_PER_SEC = 120;    // px per second (time scale)
const MIN_PX_PER_SEC = 12;
const MAX_PX_PER_SEC = 1200;
const ZOOM_WHEEL_STEP = 1.15;      // multiplier per wheel notch
const ZOOM_BUTTON_STEP = 1.4;      // multiplier per +/- button click

const KEYBOARD_W = 48;     // px, left keyboard column
// Playhead accent — concrete hex of the timeline's --accent-timeline, so the
// piano-roll playhead reads identically to the main timeline (the popup can't
// resolve the app's CSS variables in dev, hence inline like the rest of this UI).
const PLAYHEAD_ACCENT = '#2997E5';
const PLAYHEAD_HEAD_SIZE = 14; // px width of the grab head (≈ .playhead-head)
const PLAYHEAD_HEAD_H = 20;    // px height of the grab head — a little longer
// A plain click (no drag) makes a SHORT note; drag-and-release sizes longer
// notes by the drag distance (#249). Kept visible/grabbable at default zoom
// (0.1s ≈ 12px at 120 px/s).
const CLICK_NOTE_DURATION = 0.1; // seconds, note created by a plain click (no drag)
// Below this row height the note name (e.g. "C#4") can't fit legibly, so it's
// hidden; below this pixel width the note is too short to show even a clipped
// name without looking like noise (#249 note labels).
const MIN_NOTE_LABEL_ROW_H = 11;
const MIN_NOTE_LABEL_WIDTH = 16;
const PITCH_MIN = 21;      // A0
const PITCH_MAX = 108;     // C8
const PITCH_COUNT = PITCH_MAX - PITCH_MIN + 1;

// Cubase-style "outside the clip" margins (#249 clip-resize). Each side shows a
// dimmed band, proportional to the clip length but bounded so a tiny clip still
// has a grabbable handle and a huge clip doesn't drown in margin. marginPx scales
// with the time zoom, so the geometry stays self-consistent under zoom.
const MARGIN_FRACTION = 0.25;   // of the clip duration, per side
const MIN_MARGIN_SEC = 0.5;
const MARGIN_CAP_SEC = 4;
// Trimmed-off notes (outside the window) are shown dimmed and non-editable so you
// can see what falls outside the clip while resizing.
const OUT_OF_WINDOW_NOTE_OPACITY = 0.32;
const DIMMED_MARGIN_BG = 'rgba(0,0,0,0.45)';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

function pitchLabel(pitch: number): string {
  const name = NOTE_NAMES[((pitch % 12) + 12) % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

function pitchToY(pitch: number, rowH: number): number {
  return (PITCH_MAX - pitch) * rowH;
}

function yToPitch(y: number, rowH: number): number {
  return PITCH_MAX - Math.floor(y / rowH);
}

type DragState =
  | { kind: 'create'; noteId: null; pitch: number; startTime: number }
  | { kind: 'move'; noteId: string; grabOffsetTime: number }
  | { kind: 'resize'; noteId: string; startTime: number }
  // Eraser swipe: delete any note the cursor passes over (#249 tool palette).
  | { kind: 'erase' }
  // Marquee select: rubber-band rectangle in grid-content pixels.
  | { kind: 'marquee'; startX: number; startY: number }
  // Group move: drag all selected notes together. `origins` snapshots each
  // selected note's start/pitch at grab time so deltas apply from a fixed base.
  | { kind: 'move-group'; anchorId: string; grabOffsetTime: number; origins: { id: string; start: number; pitch: number }[] };

// Active editor tool (#249). Pointer = the original draw/move/resize behavior;
// eraser deletes; select marquee-picks and group-moves notes. Shared id type so
// the keyboard-shortcut seam and the palette can't drift.
type Tool = PianoRollToolId;

interface PendingNote {
  pitch: number;
  start: number;
  duration: number;
}

// Live clip-resize preview (#249). While a Time-ruler handle is dragged we hold
// the in-progress window here and render the whole editor from it — matching the
// main timeline's trim pattern (local drag state, ONE history commit on mouseup).
interface ResizeDrag {
  edge: 'left' | 'right';
  inPoint: number;
  outPoint: number;
  startTime: number;
}

interface PianoRollProps {
  clipId: string;
}

// --- tool palette (#249) ---------------------------------------------------
// Reuses the main timeline's Tabler tool icons and mirrors the
// `.timeline-tool-button` look (24px, accent-blue active) so the piano-roll
// palette is visually unified with the timeline. The popup can't reliably
// inherit that CSS class (Vite injects app CSS as <style>, which the popup
// boot doesn't mirror), so the matching style is applied inline here.
const TOOL_ICON_SIZE = 18;
const TOOL_ACCENT = '#2d8ceb';

// Custom rubber/eraser mouse cursor for the eraser tool, so it's obvious the
// click will delete. No native CSS keyword looks like an eraser, so we inline a
// pink-rubber SVG as a data-URI cursor (hotspot at the eraser tip, ~5,19). Built
// with encodeURIComponent so the markup stays readable; single quotes inside the
// SVG are left untouched by the encoder.
const ERASER_CURSOR_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<g stroke='#f0f0f0' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'>" +
  "<path fill='#2a2a2a' d='M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3'/>" +
  "<path fill='none' d='M18 13.3l-6.3 -6.3'/>" +
  "</g></svg>";
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ERASER_CURSOR_SVG)}") 5 19, auto`;

function ToolButton({ active, title, onClick, glyph: Glyph }: {
  active: boolean; title: string; onClick: () => void; glyph: Icon;
}) {
  const [hover, setHover] = useState(false);
  const background = active ? 'rgba(45,140,235,0.18)' : hover ? 'rgba(255,255,255,0.08)' : 'transparent';
  const color = active ? TOOL_ACCENT : hover ? '#fff' : 'rgba(255,255,255,0.72)';
  const borderColor = active ? 'rgba(45,140,235,0.45)' : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, borderRadius: 3, cursor: 'pointer',
        border: `1px solid ${borderColor}`, background, color,
        transition: 'color 120ms ease, background-color 120ms ease, border-color 120ms ease',
      }}
    >
      <Glyph size={TOOL_ICON_SIZE} stroke={2.2} aria-hidden />
    </button>
  );
}

export function PianoRoll({ clipId }: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // The ruler track that slides under the viewport's horizontal scroll. Driven by
  // an imperative translateX (never React state) so scrolling never re-renders the
  // notes layer (#249 §6).
  const rulerInnerRef = useRef<HTMLDivElement | null>(null);
  // The clipped ruler-track viewport (its left edge = grid pixel 0 on screen),
  // used to map a scrub's clientX back to clip-local pixels.
  const rulerTrackRef = useRef<HTMLDivElement | null>(null);
  // The single playhead overlay's scroll-follower — slid by the same horizontal
  // scroll as the ruler so one continuous line spans the ruler band + the grid.
  const playheadFollowRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PendingNote | null>(null);
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null);
  // Flipped true whenever a drag (create/move/resize) starts, so the document
  // listener effect re-runs to attach handlers regardless of which drag kind.
  const [dragActive, setDragActive] = useState(false);
  // Pitch under the cursor, so the matching key on the keyboard lights up (#249).
  const [hoverPitch, setHoverPitch] = useState<number | null>(null);

  // Live clip-resize (#249). `resizeDrag` drives the rendered geometry during a
  // drag; `resizeRef` holds the originals + grab anchor for the document handlers.
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);
  const resizeRef = useRef<{ edge: 'left' | 'right'; orig: TrimOriginals; startClientX: number } | null>(null);

  // Active tool + selection model (#249 tool palette). Refs mirror state so the
  // document-level drag/key handlers read fresh values without re-binding.
  const [tool, setTool] = useState<Tool>('pointer');
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  // Switching to the pointer (note-entry) tool drops any existing selection so a
  // left-over marquee highlight doesn't linger while drawing notes (#249).
  const selectTool = useCallback((next: Tool) => {
    setTool(next);
    if (next === 'pointer') setSelectedIds(new Set());
  }, []);
  // Live marquee rectangle in grid-content pixels (null when not selecting).
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Two independent zoom axes (#249). Refs mirror the state so the native wheel
  // handler reads fresh values without re-attaching the listener on every zoom.
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [rowH, setRowH] = useState(DEFAULT_ROW_H);
  const pxPerSecRef = useRef(pxPerSec);
  const rowHRef = useRef(rowH);
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);
  useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  // After a zoom changes the content size, restore the scroll offset that keeps
  // the point under the cursor stationary. Applied in a layout effect because the
  // grid's new width/height only exist once React has re-rendered.
  const pendingScrollRef = useRef<{ left: number | null; top: number | null }>({ left: null, top: null });

  // Plain selectors (no useShallow): the clip object identity changes whenever
  // its notes change, so this re-renders on every edit; actions are stable refs.
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  // All clips, so ghost notes from other overlapping MIDI clips can be shown
  // read-only in this clip's editor (#232). Re-renders on any clip edit, which
  // is what we want — ghosts must track the other clips' notes live.
  const allClips = useTimelineStore((state) => state.clips);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  // Same TempoMap the main timeline ruler reads, so bar numbers / timecodes in the
  // piano-roll ruler are identical to the timeline at the same musical positions
  // (#249). Stable identity unless the tempo/meter map actually changes.
  const tempoMap = useTimelineStore(selectTempoMap);
  const addMidiNote = useTimelineStore((state) => state.addMidiNote);
  const addMidiNotes = useTimelineStore((state) => state.addMidiNotes);
  const updateMidiNote = useTimelineStore((state) => state.updateMidiNote);
  const removeMidiNote = useTimelineStore((state) => state.removeMidiNote);
  const removeMidiNotes = useTimelineStore((state) => state.removeMidiNotes);
  const setPlayheadPosition = useTimelineStore((state) => state.setPlayheadPosition);
  const applyTimelineEditOperation = useTimelineStore((state) => state.applyTimelineEditOperation);

  // Effective window: the live clip, OR the in-progress resize preview while a
  // Time-ruler handle is dragged (#249). ALL geometry below derives from these so
  // the editor reflects the resize live; on mouseup it commits once and resizeDrag
  // clears, falling back to the real clip values.
  const effInPoint = resizeDrag ? resizeDrag.inPoint : (clip?.inPoint ?? 0);
  const effOutPoint = resizeDrag ? resizeDrag.outPoint : (clip?.outPoint ?? 0);
  const effStartTime = resizeDrag ? resizeDrag.startTime : (clip?.startTime ?? 0);
  // The window the timing helpers read (inPoint/outPoint/startTime/duration).
  const effWindow: MidiClipWindow = {
    startTime: effStartTime,
    inPoint: effInPoint,
    outPoint: effOutPoint,
    duration: effOutPoint - effInPoint,
  };

  const clipDuration = effWindow.duration;
  const clipStartTime = effStartTime;
  // The window is exactly the clip's real time span; the editor adds a dimmed
  // "outside" margin on each side for resize context (#249).
  const windowPx = clipDuration * pxPerSec;
  const marginSec = clamp(clipDuration * MARGIN_FRACTION, MIN_MARGIN_SEC, MARGIN_CAP_SEC);
  const marginPx = marginSec * pxPerSec;
  // Full scrollable grid width: left margin + window + right margin. Replaces the
  // old window-only contentWidth as the grid + ruler-inner + scrollbar extent.
  const gridWidth = marginPx * 2 + windowPx;
  const gridH = PITCH_COUNT * rowH;
  const notes = clip?.midiData?.notes ?? [];

  // Tempo-synced ruler ticks + gridlines, computed ONCE here and shared by the
  // ruler and the gridlines so both use the identical absolute→pixel mapping and
  // stay aligned by construction (#249). The grid is built `marginSec` past each
  // window edge so bars/beats/ticks continue under the dimmed margins. Keyed only
  // on geometry/tempo — NOT on notes — so editing notes never recomputes the grid.
  const pianoRollGrid = useMemo(
    () => buildPianoRollGrid({
      tempoMap,
      clipStartTime,
      clipDuration,
      pxPerSec,
      visibleStartPx: -marginPx,
      visibleWidthPx: gridWidth,
      marginSec,
    }),
    [tempoMap, clipStartTime, clipDuration, pxPerSec, marginPx, gridWidth, marginSec],
  );

  // Read-only ghosts: notes from other MIDI clips that overlap this clip's
  // window, in this clip's local time space (#232). Editing stays in each
  // note's own clip; ghosts are display only.
  const ghostNotes = useMemo(
    () => (clip ? computeGhostNotes(clip, allClips) : []),
    [clip, allClips],
  );

  // Center the view near middle C on first mount so notes land in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, pitchToY(72, rowHRef.current) - el.clientHeight / 2 + rowHRef.current);
  }, []);

  // Restore cursor-anchored scroll after a zoom resizes the grid content.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingScrollRef.current;
    if (!el || (pending.left === null && pending.top === null)) return;
    if (pending.left !== null) el.scrollLeft = Math.max(0, pending.left);
    if (pending.top !== null) el.scrollTop = Math.max(0, pending.top);
    pendingScrollRef.current = { left: null, top: null };
  }, [pxPerSec, rowH]);

  // --- ruler scroll lock (#249 §6) -------------------------------------------
  // Slide the ruler track to match the viewport's horizontal scroll with a pure
  // imperative transform — no state, so scrolling never re-renders the heavy
  // notes/keys subtree. The onScroll path keeps it aligned while scrolling; the
  // layout effect re-aligns after any re-render (mount, zoom, content resize),
  // including the programmatic scrollLeft the zoom-restore effect above sets.
  const syncRulerScroll = useCallback(() => {
    const el = scrollRef.current;
    const inner = rulerInnerRef.current;
    if (el && inner) inner.style.transform = `translateX(${-el.scrollLeft}px)`;
    // The single continuous playhead overlay (ruler + grid in one element) rides
    // the same horizontal scroll, so it stays glued to the grid without state.
    const ph = playheadFollowRef.current;
    if (el && ph) ph.style.transform = `translateX(${-el.scrollLeft}px)`;
  }, []);

  useLayoutEffect(() => { syncRulerScroll(); });

  // On open, place the viewport at the clip START (skip the left "outside"
  // margin) so the clip begins at the viewport's left edge, like before the
  // margins existed (#249). Guarded so later marginPx changes (zoom/resize)
  // don't snap the scroll back. syncRulerScroll keeps the ruler aligned.
  const didInitScrollLeftRef = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitScrollLeftRef.current) return;
    didInitScrollLeftRef.current = true;
    el.scrollLeft = marginPx;
    syncRulerScroll();
  }, [marginPx, syncRulerScroll]);

  const handleGridScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      syncRulerScroll();
    });
  }, [syncRulerScroll]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  // --- ruler scrubbing (#249 Phase 4) ----------------------------------------
  // Click/drag on the ruler moves the GLOBAL playhead. The ruler track's left
  // edge sits at grid pixel 0 on screen, and the track content is slid by
  // scrollLeft, so clip-local pixel = (clientX - trackLeft) + scrollLeft. That
  // maps to absolute time as clipStartTime + localSeconds (the window's left edge
  // is clipStartTime regardless of inPoint), clamped to the clip window.
  const scrubToClientX = useCallback((clientX: number) => {
    const track = rulerTrackRef.current;
    const el = scrollRef.current;
    if (!track || !el) return;
    // Grid pixel 0 is now the LEFT margin edge, so the clip window starts at
    // marginPx; subtract it to get seconds from the window's left edge (#249).
    const localPx = clientX - track.getBoundingClientRect().left + el.scrollLeft - marginPx;
    const localSeconds = localPx / pxPerSec;
    const absolute = clamp(clipStartTime + localSeconds, clipStartTime, clipStartTime + clipDuration);
    setPlayheadPosition(absolute);
  }, [clipStartTime, clipDuration, pxPerSec, marginPx, setPlayheadPosition]);

  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Listen on the POPUP's document (the ruler's ownerDocument), not the opener's
    // global `document`, so move/up fire inside the popup — matching the note drag.
    const doc = rulerTrackRef.current?.ownerDocument ?? document;
    scrubToClientX(e.clientX);
    const onMove = (ev: MouseEvent) => scrubToClientX(ev.clientX);
    const onUp = () => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }, [scrubToClientX]);

  // --- clip resize from the Time-ruler handles (#249) ------------------------
  // Cubase-style: drag a window-edge handle on the Time lane to retrim the MIDI
  // clip. Follows the main timeline's trim pattern (useClipTrim): hold local drag
  // state for live feedback, reuse the shared `computeTrimTiming` for the exact
  // infinite-source clamps, and commit ONE history-aware `trim-clip` op on mouseup.
  // The handle's own mousedown stops propagation so this doesn't also scrub.
  const handleResizeStart = useCallback((edge: 'left' | 'right', e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const live = useTimelineStore.getState().clips.find((c) => c.id === clipId);
    if (!live) return;
    resizeRef.current = { edge, orig: trimOriginalsFromClip(live), startClientX: e.clientX };
    const doc = rulerTrackRef.current?.ownerDocument ?? document;

    // Source type / startTime / inPoint don't change during a drag, so reuse the
    // clip captured at mousedown rather than re-reading the store every move.
    const timingFor = (clientX: number) => {
      const r = resizeRef.current;
      if (!r) return null;
      const deltaTime = (clientX - r.startClientX) / pxPerSecRef.current;
      return computeTrimTiming(live, r.edge, r.orig, deltaTime);
    };

    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      const t = timingFor(ev.clientX);
      if (!r || !t) return;
      setResizeDrag({ edge: r.edge, inPoint: t.newInPoint, outPoint: t.newOutPoint, startTime: t.newStartTime });
    };

    const onUp = (ev: MouseEvent) => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      // Compute the final timing BEFORE clearing the ref — timingFor reads it.
      const r = resizeRef.current;
      const t = timingFor(ev.clientX);
      resizeRef.current = null;
      setResizeDrag(null);
      if (!r || !t) return;
      // Skip a no-op (a click that didn't move) so it never lands in history.
      if (Math.abs(t.newInPoint - r.orig.inPoint) < 0.0001 && Math.abs(t.newOutPoint - r.orig.outPoint) < 0.0001) return;
      applyTimelineEditOperation({
        id: `pr-resize:${clipId}:${r.edge}`,
        type: 'trim-clip',
        clipId,
        inPoint: t.newInPoint,
        outPoint: t.newOutPoint,
        ...(r.edge === 'left' ? { startTime: t.newStartTime } : {}),
      }, { source: 'ui', historyLabel: 'Resize MIDI clip' });
    };

    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  }, [clipId, applyTimelineEditOperation]);

  // --- two-axis zoom (#249) ---------------------------------------------------
  // Shared by the Ctrl/Ctrl+Shift wheel gesture and the on-screen +/- buttons.
  // Each keeps the point under its anchor (cursor for wheel, viewport center for
  // buttons) stationary by stashing the corrected scroll offset for the layout
  // effect above to apply once the grid has resized.

  // Time (horizontal) zoom to newPx, anchored on the second under anchorClientX.
  // The first KEYBOARD_W px of the scroll content is the sticky keyboard column.
  const zoomTimeTo = useCallback((newPx: number, anchorClientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = clamp(newPx, MIN_PX_PER_SEC, MAX_PX_PER_SEC);
    const oldPx = pxPerSecRef.current;
    if (clamped === oldPx) return;
    const rect = el.getBoundingClientRect();
    const cursorX = anchorClientX - rect.left;
    const time = Math.max(0, (cursorX + el.scrollLeft - KEYBOARD_W) / oldPx);
    pendingScrollRef.current = { left: KEYBOARD_W + time * clamped - cursorX, top: null };
    setPxPerSec(clamped);
  }, []);

  // Note-height (vertical) zoom to newRowH, anchored on the pitch under anchorClientY.
  const zoomNotesTo = useCallback((newRowH: number, anchorClientY: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = clamp(newRowH, MIN_ROW_H, MAX_ROW_H);
    const oldRowH = rowHRef.current;
    if (clamped === oldRowH) return;
    const rect = el.getBoundingClientRect();
    const cursorY = anchorClientY - rect.top;
    const frac = (cursorY + el.scrollTop) / oldRowH;
    pendingScrollRef.current = { left: null, top: frac * clamped - cursorY };
    setRowH(clamped);
  }, []);

  // Center-anchored zoom steps for the +/- buttons (dir: +1 in, -1 out).
  const zoomTimeStep = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const factor = dir > 0 ? ZOOM_BUTTON_STEP : 1 / ZOOM_BUTTON_STEP;
    zoomTimeTo(pxPerSecRef.current * factor, el.getBoundingClientRect().left + el.clientWidth / 2);
  }, [zoomTimeTo]);

  const zoomNotesStep = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const factor = dir > 0 ? ZOOM_BUTTON_STEP : 1 / ZOOM_BUTTON_STEP;
    zoomNotesTo(rowHRef.current * factor, el.getBoundingClientRect().top + el.clientHeight / 2);
  }, [zoomNotesTo]);

  // Ctrl+wheel = time zoom; Ctrl+Shift+wheel = note-height zoom, both pointer-
  // anchored. The native, non-passive listener is mandatory: it preventDefaults
  // the gesture so the browser never page-zooms the popup (the app's usePageZoom
  // guard lives in the main window and never runs in this detached document).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const doc = el.ownerDocument;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
      if (e.shiftKey) {
        zoomNotesTo(rowHRef.current * factor, e.clientY);
      } else {
        zoomTimeTo(pxPerSecRef.current * factor, e.clientX);
      }
    };

    // Block the browser's Ctrl+wheel zoom over the popup chrome outside the
    // scroll area too (e.g. the header), mirroring usePageZoom's intent.
    const handleDocWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && !el.contains(e.target as Node)) e.preventDefault();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    doc.addEventListener('wheel', handleDocWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      doc.removeEventListener('wheel', handleDocWheel, { capture: true } as EventListenerOptions);
    };
  }, [zoomTimeTo, zoomNotesTo]);

  // --- coordinate helpers (relative to the scrollable grid content) ----------
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const el = gridRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // Topmost editable note whose rendered pixel box contains a grid-content point.
  // Reads the live store + current zoom so the eraser/select hit-test matches what
  // is actually drawn (#249). Returns the LAST-drawn match (notes draw in order).
  const noteAtPx = useCallback((x: number, y: number): MidiNote | null => {
    const liveClip = useTimelineStore.getState().clips.find((c) => c.id === clipId);
    if (!liveClip || liveClip.source?.type !== 'midi') return null;
    const ppx = pxPerSecRef.current;
    const rh = rowHRef.current;
    const liveNotes = liveClip.midiData?.notes ?? [];
    for (let i = liveNotes.length - 1; i >= 0; i--) {
      const n = liveNotes[i];
      if (!isNoteStartInWindow(liveClip, n)) continue;
      const left = contentTimeToClipLocal(liveClip, n.start) * ppx;
      const width = Math.max(2, n.duration * ppx);
      const top = pitchToY(n.pitch, rh);
      if (x >= left && x <= left + width && y >= top && y <= top + rh) return n;
    }
    return null;
  }, [clipId]);

  // --- global drag handling ---------------------------------------------------
  useEffect(() => {
    if (!dragActive) return;

    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { x, y } = localPoint(e.clientX, e.clientY);
      // Map the cursor's screen offset to CONTENT time through the clip window
      // (#232), so note times stay anchored to the content, not the window edge.
      const liveInPoint = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.inPoint ?? 0;
      // Floor at the window's left edge (inPoint), NOT 0: after a left-extend the
      // clip's inPoint is negative (empty space before content origin 0), so that
      // region is valid content time. Clamping to 0 snapped clicks back to the old
      // origin; clamping to inPoint keeps notes inside the visible window (#249).
      const time = Math.max(liveInPoint, clipLocalToContentTime({ inPoint: liveInPoint }, x / pxPerSecRef.current));

      if (drag.kind === 'create') {
        const next = { pitch: drag.pitch, start: drag.startTime, duration: Math.max(0.02, time - drag.startTime) };
        pendingRef.current = next;
        setPendingNote(next);
        return;
      }
      if (drag.kind === 'move') {
        const newStart = Math.max(liveInPoint, time - drag.grabOffsetTime);
        const newPitch = yToPitch(y, rowHRef.current);
        updateMidiNote(clipId, drag.noteId, { start: newStart, pitch: newPitch }, { captureHistory: false });
        return;
      }
      if (drag.kind === 'resize') {
        const duration = Math.max(0.02, time - drag.startTime);
        updateMidiNote(clipId, drag.noteId, { duration }, { captureHistory: false });
        return;
      }
      if (drag.kind === 'erase') {
        const hit = noteAtPx(x, y);
        if (hit) removeMidiNote(clipId, hit.id);
        return;
      }
      if (drag.kind === 'move-group') {
        const anchor = drag.origins.find((o) => o.id === drag.anchorId);
        if (!anchor) return;
        const newAnchorStart = Math.max(liveInPoint, time - drag.grabOffsetTime);
        const deltaTime = newAnchorStart - anchor.start;
        const deltaPitch = yToPitch(y, rowHRef.current) - anchor.pitch;
        for (const o of drag.origins) {
          updateMidiNote(clipId, o.id, {
            start: Math.max(liveInPoint, o.start + deltaTime),
            pitch: clamp(o.pitch + deltaPitch, PITCH_MIN, PITCH_MAX),
          }, { captureHistory: false });
        }
        return;
      }
      if (drag.kind === 'marquee') {
        const rx = Math.min(drag.startX, x);
        const ry = Math.min(drag.startY, y);
        const rw = Math.abs(x - drag.startX);
        const rh = Math.abs(y - drag.startY);
        setMarquee({ x: rx, y: ry, w: rw, h: rh });
        const liveClip = useTimelineStore.getState().clips.find((c) => c.id === clipId);
        const liveNotes = liveClip?.midiData?.notes ?? [];
        const ppx = pxPerSecRef.current;
        const rowPx = rowHRef.current;
        const next = new Set<string>();
        for (const n of liveNotes) {
          if (!liveClip || !isNoteStartInWindow(liveClip, n)) continue;
          const left = contentTimeToClipLocal(liveClip, n.start) * ppx;
          const width = Math.max(2, n.duration * ppx);
          const top = pitchToY(n.pitch, rowPx);
          // Axis-aligned rectangle overlap.
          if (left <= rx + rw && left + width >= rx && top <= ry + rh && top + rowPx >= ry) next.add(n.id);
        }
        setSelectedIds(next);
      }
    };

    const handleUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragActive(false);
      if (drag?.kind === 'create') {
        const pending = pendingRef.current ?? { pitch: drag.pitch, start: drag.startTime, duration: CLICK_NOTE_DURATION };
        // A near-zero drag is a plain click → make a short note; an actual drag
        // keeps its dragged length.
        const duration = pending.duration <= 0.05 ? CLICK_NOTE_DURATION : pending.duration;
        addMidiNote(clipId, { ...pending, duration });
        pendingRef.current = null;
        setPendingNote(null);
      } else if (drag && (drag.kind === 'move' || drag.kind === 'resize')) {
        // Commit a single history snapshot for the whole drag.
        const note = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes
          .find((n) => n.id === drag.noteId);
        if (note) {
          updateMidiNote(clipId, drag.noteId, { start: note.start }, { captureHistory: true });
        }
      } else if (drag?.kind === 'move-group') {
        // One history snapshot for the whole group move (live drag was silent).
        const note = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes
          .find((n) => n.id === drag.anchorId);
        if (note) {
          updateMidiNote(clipId, drag.anchorId, { start: note.start }, { captureHistory: true });
        }
      } else if (drag?.kind === 'marquee') {
        setMarquee(null);
      }
    };

    // CRITICAL: this component runs in the opener's JS realm but is mounted in a
    // popup window, so the global `document` is the MAIN window's document. Mouse
    // events happen in the popup, so listen on the grid's ownerDocument (the
    // popup's document) — otherwise mouseup never fires and notes never commit.
    const doc = gridRef.current?.ownerDocument ?? document;
    doc.addEventListener('mousemove', handleMove);
    doc.addEventListener('mouseup', handleUp);
    return () => {
      doc.removeEventListener('mousemove', handleMove);
      doc.removeEventListener('mouseup', handleUp);
    };
  }, [dragActive, clipId, addMidiNote, updateMidiNote, removeMidiNote, localPoint, noteAtPx]);

  // --- clipboard + history (#249) --------------------------------------------
  // Copy/cut/paste/duplicate operate on the live selection and the shared
  // module-level note clipboard. Each mutation routes through a batched store
  // action (addMidiNotes/removeMidiNotes) so it collapses to ONE undo step.
  // Reads go through getState() so the document key handler always sees fresh
  // notes without re-binding on every edit.
  const liveSelectedNotes = useCallback(() => {
    const liveNotes = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes ?? [];
    const sel = selectedIdsRef.current;
    return liveNotes.filter((n) => sel.has(n.id));
  }, [clipId]);

  const copySelection = useCallback(() => {
    const picked = liveSelectedNotes();
    if (picked.length > 0) setPianoRollClipboard(picked);
  }, [liveSelectedNotes]);

  const cutSelection = useCallback(() => {
    const picked = liveSelectedNotes();
    if (picked.length === 0) return;
    setPianoRollClipboard(picked);
    removeMidiNotes(clipId, picked.map((n) => n.id));
    setSelectedIds(new Set());
  }, [clipId, liveSelectedNotes, removeMidiNotes]);

  const pasteClipboard = useCallback(() => {
    if (!hasPianoRollClipboard()) return;
    const live = useTimelineStore.getState();
    const liveClip = live.clips.find((c) => c.id === clipId);
    if (!liveClip || liveClip.source?.type !== 'midi') return;
    // Anchor the earliest pasted note at the playhead's content time, clamped
    // into the clip's content window so a paste with the playhead outside the
    // clip still lands inside it (falls back to the window's left edge).
    const playheadContent = clipLocalToContentTime(liveClip, live.playheadPosition - liveClip.startTime);
    const anchor = clamp(playheadContent, liveClip.inPoint, liveClip.outPoint);
    const newIds = addMidiNotes(clipId, pasteNotesAt(anchor));
    if (newIds.length > 0) setSelectedIds(new Set(newIds));
  }, [clipId, addMidiNotes]);

  const duplicateSelection = useCallback(() => {
    const picked = liveSelectedNotes();
    if (picked.length === 0) return;
    const newIds = addMidiNotes(clipId, duplicateNotesRight(picked));
    if (newIds.length > 0) setSelectedIds(new Set(newIds));
  }, [clipId, liveSelectedNotes, addMidiNotes]);

  // Undo/redo: the store already captures a snapshot for every note edit, but the
  // global Ctrl+Z handler lives on the MAIN window — its keydown never fires in
  // this detached popup. So drive the shared history facade directly here. Stale
  // selection ids left over after a restore are harmless: a removed note is never
  // rendered or matched (selection is read as `selectedIds.has(note.id)` over the
  // live notes), so no pruning pass is needed.
  const runHistory = useCallback((op: 'undo' | 'redo') => {
    if (op === 'undo') undo(); else redo();
  }, []);

  // Popup keyboard shortcuts (#249). Bound to the popup's OWN document so keys
  // fire inside the detached window. Concerns: tool switching (1/2/3, via the
  // shortcut seam), delete (Delete/Backspace), clipboard (Ctrl+C/X/V), duplicate
  // (Ctrl+D, Ctrl+B alias) and undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
  useEffect(() => {
    const doc = gridRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from an editable field (future-proofing — the popup has
      // none today, but a rename/velocity input could land here later).
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      // Space toggles transport. The popup shares the JS heap with the host, so we
      // drive the same playback engine; play() starts from the current playhead —
      // i.e. the live cursor in the roll (#249).
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        const transport = useTimelineStore.getState();
        if (transport.isPlaying) transport.pause();
        else void transport.play();
        return;
      }

      // Ctrl/Cmd combos: clipboard, duplicate, undo/redo. Handled before the tool
      // switch because the tool seam matches plain 1/2/3 (no modifiers) only.
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z': e.preventDefault(); runHistory(e.shiftKey ? 'redo' : 'undo'); return;
          case 'y': e.preventDefault(); runHistory('redo'); return;
          case 'c': e.preventDefault(); copySelection(); return;
          case 'x': e.preventDefault(); cutSelection(); return;
          case 'v': e.preventDefault(); pasteClipboard(); return;
          case 'd': case 'b': e.preventDefault(); duplicateSelection(); return;
          default: break;
        }
      }

      // Tool switch. matchesCombo requires an exact modifier match, so Ctrl/Alt+1
      // etc. don't resolve here and fall through to any future global shortcut.
      const nextTool = resolvePianoRollToolAction(e);
      if (nextTool) {
        e.preventDefault();
        selectTool(nextTool);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = selectedIdsRef.current;
        if (sel.size === 0) return;
        e.preventDefault();
        removeMidiNotes(clipId, Array.from(sel));
        setSelectedIds(new Set());
      }
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [clipId, removeMidiNotes, copySelection, cutSelection, pasteClipboard, duplicateSelection, runHistory, selectTool]);

  if (!clip || clip.source?.type !== 'midi') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888' }}>
        This MIDI clip is no longer available.
      </div>
    );
  }

  // Track the pitch under the cursor so the matching key lights up. Only updates
  // state when the row actually changes, to avoid a re-render on every pixel.
  const updateHoverPitch = (e: React.MouseEvent) => {
    const { y } = localPoint(e.clientX, e.clientY);
    const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, yToPitch(y, rowH)));
    setHoverPitch((prev) => (prev === pitch ? prev : pitch));
  };

  const startCreate = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const { x, y } = localPoint(e.clientX, e.clientY);
    const pitch = yToPitch(y, rowH);
    // Floor at inPoint (the window's left edge), not 0 — see the handleMove note:
    // a left-extended clip has negative inPoint, and that region is valid (#249).
    const startTime = Math.max(clip.inPoint, clipLocalToContentTime(clip, x / pxPerSec));
    // Audible feedback for the note being drawn (issue #182, Phase 4) — routed
    // through the track's synth bus so preview respects its volume/pan.
    const track = useTimelineStore.getState().tracks.find((t) => t.id === clip?.trackId);
    previewMidiNote(track?.midiInstrument, pitch, 0.85, clip?.trackId);
    dragRef.current = { kind: 'create', noteId: null, pitch, startTime };
    pendingRef.current = { pitch, start: startTime, duration: 0.02 };
    setPendingNote(pendingRef.current);
    setDragActive(true);
    e.preventDefault();
  };

  const startMove = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Audible feedback for the clicked note (issue #182, Phase 4) — routed
    // through the track's synth bus so preview respects its volume/pan.
    const track = useTimelineStore.getState().tracks.find((t) => t.id === clip?.trackId);
    previewMidiNote(track?.midiInstrument, note.pitch, note.velocity, clip?.trackId);
    const { x } = localPoint(e.clientX, e.clientY);
    const grabTime = clipLocalToContentTime(clip, x / pxPerSec);
    dragRef.current = { kind: 'move', noteId: note.id, grabOffsetTime: grabTime - note.start };
    setDragActive(true);
    e.preventDefault();
  };

  const startResize = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { kind: 'resize', noteId: note.id, startTime: note.start };
    setDragActive(true);
    e.preventDefault();
  };

  const deleteNote = (e: React.MouseEvent, note: MidiNote) => {
    e.preventDefault();
    e.stopPropagation();
    removeMidiNote(clipId, note.id);
  };

  // --- tool-aware mousedown dispatch (#249) ----------------------------------
  // Empty grid: pointer draws, eraser starts a swipe, select starts a marquee.
  const handleGridMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (tool === 'pointer') { startCreate(e); return; }
    const { x, y } = localPoint(e.clientX, e.clientY);
    if (tool === 'eraser') {
      const hit = noteAtPx(x, y);
      if (hit) removeMidiNote(clipId, hit.id);
      dragRef.current = { kind: 'erase' };
      setDragActive(true);
      e.preventDefault();
      return;
    }
    // select: click on empty grid clears selection, then marquee builds a new one.
    setSelectedIds(new Set());
    dragRef.current = { kind: 'marquee', startX: x, startY: y };
    setMarquee({ x, y, w: 0, h: 0 });
    setDragActive(true);
    e.preventDefault();
  };

  // A note body: pointer moves the single note, eraser deletes it (and keeps
  // swiping), select picks it / group-moves the current selection.
  const handleNoteMouseDown = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    if (tool === 'pointer') { startMove(e, note); return; }
    e.stopPropagation();
    e.preventDefault();
    if (tool === 'eraser') {
      removeMidiNote(clipId, note.id);
      dragRef.current = { kind: 'erase' };
      setDragActive(true);
      return;
    }
    // select tool
    if (e.shiftKey) {
      // Toggle this note's membership; no drag.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(note.id)) next.delete(note.id); else next.add(note.id);
        return next;
      });
      return;
    }
    // Clicking an unselected note replaces the selection with just it; clicking
    // a member keeps the whole selection. Either way we begin a group move.
    let sel = selectedIdsRef.current;
    if (!sel.has(note.id)) {
      sel = new Set([note.id]);
      setSelectedIds(sel);
    }
    const liveNotes = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes ?? [];
    const origins = liveNotes.filter((n) => sel.has(n.id)).map((n) => ({ id: n.id, start: n.start, pitch: n.pitch }));
    const track = useTimelineStore.getState().tracks.find((t) => t.id === clip?.trackId);
    previewMidiNote(track?.midiInstrument, note.pitch, note.velocity, clip?.trackId);
    const { x } = localPoint(e.clientX, e.clientY);
    const grabTime = clipLocalToContentTime(clip, x / pxPerSec);
    dragRef.current = { kind: 'move-group', anchorId: note.id, grabOffsetTime: grabTime - note.start, origins };
    setDragActive(true);
  };

  const clipLocalPlayhead = playheadPosition - effStartTime;
  const showPlayhead = clipLocalPlayhead >= 0 && clipLocalPlayhead <= clipDuration;
  // Whole-pixel SCREEN x for the playhead (track frame, where the ruler's
  // translateX layer and the grid both live). marginPx is fractional, so we round
  // the final screen position — not the grid-frame offset — to keep the 2px line
  // crisp and identical in width across the grid (native-scrolled) and the ruler
  // (translateX-composited) layers, which otherwise anti-alias a fractional
  // position to different apparent widths. The grid line subtracts marginPx to
  // re-enter its own frame (gridRef is offset by marginPx).
  const playheadScreenX = Math.round(marginPx + clipLocalPlayhead * pxPerSec);

  // Notes split for rendering: those whose start is inside the (effective) window
  // are editable; those outside are shown dimmed in the margins for context while
  // resizing (#249), but only if they're near enough to actually fall in a margin.
  const inWindowNotes = notes.filter((note) => isNoteStartInWindow(effWindow, note));
  const outOfWindowNotes = notes.filter((note) =>
    !isNoteStartInWindow(effWindow, note) &&
    note.start >= effInPoint - marginSec && note.start <= effOutPoint + marginSec);

  // Whether note-name labels are drawn inside note blocks. Today this is purely a
  // zoom/fit decision (hide when rows are too short to read). FUTURE: a user
  // "show note labels" preference should AND into this single flag — it's the one
  // seam, so adding the toggle won't touch the note-render code (#249).
  const showNoteLabels = rowH >= MIN_NOTE_LABEL_ROW_H;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
        background: '#161616', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        {/* Tool palette (#249): pointer = draw/move/resize, eraser = delete,
            select = marquee + group-move. Styled to match the timeline palette. */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, padding: 2,
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, background: 'rgba(0,0,0,0.18)',
        }}>
          <ToolButton active={tool === 'pointer'} title="Pointer — draw, move & resize notes (1)" onClick={() => selectTool('pointer')} glyph={IconPointer} />
          <ToolButton active={tool === 'eraser'} title="Eraser — click or swipe to delete notes (2)" onClick={() => selectTool('eraser')} glyph={IconEraser} />
          <ToolButton active={tool === 'select'} title="Select — marquee to select, drag to move, Del to remove (3)" onClick={() => selectTool('select')} glyph={IconMarquee2} />
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#777' }}>{notes.length} notes · {clipDuration.toFixed(2)}s</span>
        <strong style={{ fontSize: 13, color: '#e0e0e0' }}>{clip.name || 'MIDI Clip'}</strong>
      </div>

      {/* Ruler + body share one positioned wrapper so the playhead can be ONE
          continuous element spanning both — see the overlay at the end. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Ruler row (#249 Phase 2): Bars + Time lanes, locked to the grid's time
          zoom and reading the shared TempoMap so labels match the main timeline.
          Sits OUTSIDE the scroll viewport — a corner spacer covers the keyboard
          column, and the ruler track is slid by the viewport's scrollLeft via an
          imperative translateX (no React state; scrolling must not re-render the
          notes). The track viewport clips ticks scrolled in behind the spacer. */}
      <div style={{
        display: 'flex', flexShrink: 0, height: PIANO_ROLL_RULER_H,
        // Match the main timeline ruler background (--bg-tertiary, #1e1e1e dark).
        background: '#1e1e1e', borderBottom: '1px solid #2a2a2a', overflow: 'hidden',
      }}>
        <div style={{ width: KEYBOARD_W, flexShrink: 0, background: '#1a1a1a', borderRight: '1px solid #000' }} />
        <div
          ref={rulerTrackRef}
          onMouseDown={handleRulerMouseDown}
          style={{ position: 'relative', flex: 1, overflow: 'hidden', cursor: 'pointer' }}
        >
          <div
            ref={rulerInnerRef}
            // No `willChange: transform` here: promoting this to its own GPU
            // compositing layer makes the playhead's ruler line rasterize with
            // different edge anti-aliasing than its grid line (which paints into
            // the main layer), so the single continuous line looks like two
            // different thicknesses on Mesa. The imperative translateX scroll still
            // works without the hint; the ticks are cheap, so we don't need it.
            style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: gridWidth }}
          >
            <PianoRollRuler
              rulerTicks={pianoRollGrid.rulerTicks}
              clipStartTime={effStartTime}
              clipDuration={clipDuration}
              pxPerSec={pxPerSec}
              marginPx={marginPx}
              onResizeStart={handleResizeStart}
            />
          </div>
        </div>
      </div>

      {/* Body: relative container holding the scroll viewport + our own bars
          (#249). The viewport keeps the native scroll engine (overflow:auto) but
          its native bars are hidden — see the <style> below and scrollbarWidth —
          and is inset to leave room for the custom bars along the bottom/right. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <style>{'.pr-grid-scroll::-webkit-scrollbar{display:none}'}</style>
        <div
          ref={scrollRef}
          className="pr-grid-scroll"
          onScroll={handleGridScroll}
          style={{
            position: 'absolute', top: 0, left: 0,
            right: PIANO_ROLL_SCROLLBAR, bottom: PIANO_ROLL_SCROLLBAR,
            display: 'flex', overflow: 'auto', scrollbarWidth: 'none',
          }}
        >
        {/* Keyboard column (sticky left) — FL-style piano keys (#249). The whole
            strip is the white-key surface; black keys are narrower overlays on
            the left so the white surface shows behind/beside them, and adjacent
            white keys (B–C, E–F) get a seam like a real keyboard. Equal row
            heights keep every key aligned to its note row in the grid. */}
        <div style={{ width: KEYBOARD_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: '#cccccc', borderRight: '1px solid #000' }}>
          {Array.from({ length: PITCH_COUNT }, (_, i) => {
            const pitch = PITCH_MAX - i;
            const black = isBlackKey(pitch);
            const mod = ((pitch % 12) + 12) % 12;
            // Seam between two adjacent white keys (below C and below F).
            const whiteSeam = !black && (mod === 0 || mod === 5);
            // The key the cursor is currently over in the grid lights up (#249).
            const hovered = pitch === hoverPitch;
            return (
              <div
                key={pitch}
                style={{
                  position: 'relative',
                  height: rowH,
                  boxSizing: 'border-box',
                  // Each row carries its own opaque white-key fill. This is the
                  // FL look, but crucially it also fully covers the sticky
                  // container's background so that tall composited fill is never
                  // exposed — exposing it produced a faint GPU-tiling shade seam
                  // on Mesa that rode along with the content.
                  // Only light the row fill for WHITE keys. For a black key the
                  // row's right strip is the neighbouring white surface, so the
                  // highlight belongs on the black-key overlay alone, not the row.
                  background: hovered && !black ? '#a9c2f0' : '#cccccc',
                  borderBottom: whiteSeam ? '1px solid #000' : 'none',
                  // Octave label (C-rows only) sits on the light white-key fill,
                  // so it's pure black for contrast/readability (#249).
                  color: '#000',
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: `${rowH}px`,
                  textAlign: 'right',
                  paddingRight: 4,
                  userSelect: 'none',
                }}
              >
                {black && (
                  <>
                    {/* Hover highlight bleeding into the white strip beside this
                        black key. A black key's neighbours are always white: the
                        white key ABOVE it (pitch+1) owns the strip's TOP half,
                        the white key BELOW it (pitch-1) owns the BOTTOM half —
                        split at the black key's middle seam. */}
                    {hoverPitch === pitch + 1 && (
                      <div style={{ position: 'absolute', left: '62%', right: 0, top: 0, height: rowH / 2, background: '#a9c2f0' }} />
                    )}
                    {hoverPitch === pitch - 1 && (
                      <div style={{ position: 'absolute', left: '62%', right: 0, top: rowH / 2, bottom: 0, background: '#a9c2f0' }} />
                    )}
                    {/* White-key seam running through the middle of this black
                        key — the boundary between the white keys above and below
                        it. The black key (drawn next, on top) covers its left
                        part, so the seam shows only in the white strip beside it,
                        like a real keyboard. */}
                    <div style={{ position: 'absolute', left: 0, top: rowH / 2, width: '100%', height: 1, background: '#000' }} />
                    <div style={{
                      position: 'absolute', left: 0, top: 0, height: '100%', width: '62%',
                      background: hovered ? '#3a4866' : '#1a1a1a',
                      borderRight: '1px solid #000',
                      borderTopRightRadius: 2, borderBottomRightRadius: 2,
                      boxSizing: 'border-box',
                    }} />
                  </>
                )}
                {mod === 0 ? pitchLabel(pitch) : ''}
              </div>
            );
          })}
        </div>

        {/* Grid + margins (#249 clip-resize). Outer layer is the full scrollable
            width (window + a dimmed margin each side); it owns the full-width lane
            fill, the tempo gridlines (shifted into the window by marginPx so they
            sit under the ruler ticks and continue across the margins), the dimmed
            "outside the clip" overlays and the read-only out-of-window notes. The
            inner layer (gridRef, offset by marginPx) holds the EDITABLE window
            content, so every existing mouse/draw calc keeps pixel 0 = clip start. */}
        <div style={{ position: 'relative', width: gridWidth, height: gridH, flexShrink: 0 }}>
          {/* Flat lane fill + sparse octave reference lines, full width. We
              deliberately avoid any repeating pattern here (neither a per-row div
              stack nor a repeating-linear-gradient): on a tall composited layer the
              GPU rasterizes in tiles and resets the gradient phase at tile edges,
              which showed up as a single shade seam that moved on resize. A solid
              fill can't seam; fine per-semitone reference comes from the keyboard
              strip; only the octave boundaries (each C) get a line. */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: gridH, background: '#181818' }} />
          {Array.from({ length: PITCH_COUNT }, (_, i) => {
            const pitch = PITCH_MAX - i;
            if ((((pitch % 12) + 12) % 12) !== 0) return null; // octave boundary = top of each C
            return (
              <div
                key={`oct-${pitch}`}
                style={{ position: 'absolute', top: i * rowH, left: 0, width: '100%', height: 1, background: '#262626' }}
              />
            );
          })}

          {/* Tempo-synced bar / beat / sub gridlines (#249 Phase 3), positioned by
              the same absolute→pixel mapping as the ruler (offset by marginPx) so
              each line sits under its ruler tick and runs through the margins.
              Isolated, memoized child → unaffected by note edits. */}
          <PianoRollGridLines
            barLines={pianoRollGrid.barLines}
            beatLines={pianoRollGrid.beatLines}
            subLines={pianoRollGrid.subLines}
            height={gridH}
            offsetX={marginPx}
          />

          {/* Dimmed "outside the clip" margins (#249). Painted over the fill +
              gridlines (so the grid shows through, dimmed) but under the notes. */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: marginPx, height: gridH, background: DIMMED_MARGIN_BG, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, left: marginPx + windowPx, width: marginPx, height: gridH, background: DIMMED_MARGIN_BG, pointerEvents: 'none' }} />

          {/* Trimmed-off notes that fall just outside the window — shown dimmed and
              non-editable in the margins so you can see what's outside while
              resizing (#249). Mapped in outer coords (marginPx + clip-local px). */}
          {outOfWindowNotes.map((note) => (
            <div
              key={`oow-${note.id}`}
              title={`${pitchLabel(note.pitch)} · outside clip`}
              style={{
                position: 'absolute',
                left: marginPx + contentTimeToClipLocal(effWindow, note.start) * pxPerSec,
                top: pitchToY(note.pitch, rowH),
                width: Math.max(2, note.duration * pxPerSec),
                height: rowH - 1,
                background: `rgba(120,170,255,${0.45 + note.velocity * 0.5})`,
                border: '1px solid rgba(180,210,255,0.6)',
                borderRadius: 2, boxSizing: 'border-box',
                opacity: OUT_OF_WINDOW_NOTE_OPACITY, pointerEvents: 'none',
              }}
            />
          ))}

          {/* Editable window content — inner layer offset by marginPx. gridRef
              lives here so localPoint/hit-test math keeps pixel 0 = clip start. */}
          <div
            ref={gridRef}
            onMouseDown={handleGridMouseDown}
            onMouseMove={updateHoverPitch}
            onMouseLeave={() => setHoverPitch(null)}
            style={{ position: 'absolute', top: 0, left: marginPx, width: windowPx, height: gridH, cursor: tool === 'pointer' ? 'default' : tool === 'eraser' ? ERASER_CURSOR : 'crosshair' }}
          >
          {/* Ghost notes from other overlapping MIDI clips — read-only (#232).
              Drawn before the real notes so editable notes always sit on top. */}
          {ghostNotes.map((ghost) => (
            <div
              key={`ghost-${ghost.key}`}
              title={`${pitchLabel(ghost.pitch)} · (other clip)`}
              style={{
                position: 'absolute',
                left: ghost.start * pxPerSec,
                top: pitchToY(ghost.pitch, rowH),
                width: Math.max(2, ghost.duration * pxPerSec),
                height: rowH - 1,
                background: 'rgba(150,150,150,0.18)',
                border: '1px solid rgba(170,170,170,0.35)',
                borderRadius: 2,
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Notes — only those whose start is inside the clip window are shown
              and editable; notes outside it render dimmed in the margins above. */}
          {inWindowNotes.map((note) => {
            const left = contentTimeToClipLocal(effWindow, note.start) * pxPerSec;
            const width = Math.max(2, note.duration * pxPerSec);
            const top = pitchToY(note.pitch, rowH);
            const selected = selectedIds.has(note.id);
            const noteCursor = tool === 'eraser' ? ERASER_CURSOR : tool === 'select' ? 'move' : 'grab';
            return (
              <div
                key={note.id}
                onMouseDown={(e) => handleNoteMouseDown(e, note)}
                onContextMenu={(e) => deleteNote(e, note)}
                title={`${pitchLabel(note.pitch)} · ${note.duration.toFixed(2)}s`}
                style={{
                  position: 'absolute', left, top, width, height: rowH - 1,
                  background: `rgba(120,170,255,${0.45 + note.velocity * 0.5})`,
                  border: selected ? '1px solid #ffd54a' : '1px solid rgba(180,210,255,0.9)',
                  boxShadow: selected ? '0 0 0 1px #ffd54a inset' : undefined,
                  borderRadius: 2, boxSizing: 'border-box', cursor: noteCursor,
                }}
              >
                {/* Note-name label (e.g. "C#4"). Gated by row height + width so
                    it never renders as illegible noise; pointer-transparent so it
                    can't intercept drag/resize. */}
                {showNoteLabels && width >= MIN_NOTE_LABEL_WIDTH && (
                  <span
                    style={{
                      position: 'absolute', left: 3, top: 0, height: '100%',
                      display: 'flex', alignItems: 'center',
                      fontSize: 9, fontWeight: 600, lineHeight: 1, color: '#fff',
                      textShadow: '0 1px 1px rgba(0,0,0,0.45)',
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      maxWidth: 'calc(100% - 6px)', pointerEvents: 'none',
                    }}
                  >
                    {pitchLabel(note.pitch)}
                  </span>
                )}
                {/* Resize grip only in pointer mode — eraser/select own the body. */}
                {tool === 'pointer' && (
                  <div
                    onMouseDown={(e) => startResize(e, note)}
                    style={{ position: 'absolute', right: 0, top: 0, width: 6, height: '100%', cursor: 'ew-resize' }}
                  />
                )}
              </div>
            );
          })}

          {/* Pending (in-progress draw) note */}
          {pendingNote && (
            <div
              style={{
                position: 'absolute', left: contentTimeToClipLocal(effWindow, pendingNote.start) * pxPerSec, top: pitchToY(pendingNote.pitch, rowH),
                width: Math.max(2, pendingNote.duration * pxPerSec), height: rowH - 1,
                background: 'rgba(120,170,255,0.5)', border: '1px solid rgba(180,210,255,0.9)',
                borderRadius: 2, boxSizing: 'border-box', pointerEvents: 'none',
              }}
            />
          )}

          {/* Marquee selection rectangle (#249 select tool) */}
          {marquee && (
            <div style={{
              position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
              background: 'rgba(255,213,74,0.12)', border: '1px solid rgba(255,213,74,0.8)',
              boxSizing: 'border-box', pointerEvents: 'none',
            }} />
          )}

          </div>

          {/* Clip-boundary lines (#249) — solid full-height lines in the flag color
              at the window start/end, so the limits are clear in the grid. Drawn
              last (on top) and pointer-transparent so they never block editing. */}
          <div style={{ position: 'absolute', top: 0, left: marginPx, width: 1, height: gridH, background: PART_BORDER_COLOR, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, left: marginPx + windowPx, width: 1, height: gridH, background: PART_BORDER_COLOR, pointerEvents: 'none' }} />
        </div>
        </div>

        <PianoRollScrollbars
          scrollRef={scrollRef}
          contentWidth={KEYBOARD_W + gridWidth}
          contentHeight={gridH}
          onZoomTime={zoomTimeStep}
          onZoomNotes={zoomNotesStep}
        />
      </div>

      {/* Single continuous playhead — ONE element spanning the ruler band AND the
          grid, so there is no seam or gap at their border. (Two separate halves —
          one in the ruler's transform layer, one in the natively-scrolled grid —
          could never meet cleanly: different pixel snapping plus the ruler's 1px
          bottom border left a visible vertical gap.) The overlay is clipped to
          start just after the keyboard column and is slid by the same horizontal
          scroll as the ruler via playheadFollowRef (see syncRulerScroll). The line
          is pointer-transparent; only the head grabs, scrubbing through the ruler's
          own handleRulerMouseDown — and it sits on top (zIndex 40) so the playhead
          always wins over the Start/End resize tabs. */}
      {showPlayhead && (
        <div style={{
          position: 'absolute', top: 0, bottom: PIANO_ROLL_SCROLLBAR,
          left: KEYBOARD_W + 1, right: PIANO_ROLL_SCROLLBAR,
          overflow: 'hidden', pointerEvents: 'none', zIndex: 40,
        }}>
          <div ref={playheadFollowRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: gridWidth }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: playheadScreenX - 1, width: 2, background: PLAYHEAD_ACCENT }} />
            <div
              title="Drag to move the playhead"
              onMouseDown={handleRulerMouseDown}
              style={{
                position: 'absolute', top: 0, left: playheadScreenX,
                width: PLAYHEAD_HEAD_SIZE, height: PLAYHEAD_HEAD_H,
                marginLeft: -(PLAYHEAD_HEAD_SIZE / 2),
                background: PLAYHEAD_ACCENT, borderRadius: 2,
                cursor: 'grab', pointerEvents: 'auto',
              }}
            />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
