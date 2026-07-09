# Piano-roll clip-resize handles + inside/outside shading (Cubase-style)

Issue: `#249` (piano-roll enhancements). Status: **implemented** (branch
`249-enhance-pianoroll`, not yet merged).

## Context

In Cubase's Key Editor you can resize the MIDI **part** from inside the editor
via two draggable border handles; the area outside the part is dimmed (with the
grid continuing through it) so you can see what is inside vs. outside the clip,
and trimmed-off notes stay visible (dimmed) in those margins. Our piano roll used
to render **exactly** the clip window with no "outside" region and dropped notes
whose start fell outside `[inPoint, outPoint]`.

Delivered: (1) left/right resize handles on the **Time** ruler lane, (2) a dimmed
"outside the clip" margin on each side with bars/beats/ticks continuing through
it, (3) trimmed-off notes shown dimmed in those margins.

## Key facts

- Clip = window `[inPoint, outPoint]` into content time; `duration = outPoint -
  inPoint`. MIDI is an **infinite source type**
  (`clipSourceTiming.ts:isInfiniteTimelineSourceType`) → resizable both directions
  (inPoint may go negative).
- Canonical resize = `applyTimelineEditOperation({ type:'trim-clip', clipId,
  inPoint, outPoint, startTime? }, { source:'ui', historyLabel })` — store action,
  proper undo/redo, reached via `useTimelineStore.getState()`.

## Implementation

### Margin geometry (single offset, two layers)
`marginSec = clamp(clipDuration * 0.25, MIN_MARGIN_SEC=0.5, MARGIN_CAP_SEC=4)`,
`marginPx = marginSec * pxPerSec` (zoom-stable), `windowPx = clipDuration *
pxPerSec`, `gridWidth = marginPx*2 + windowPx`. `gridWidth` replaces the old
window-only `contentWidth` at the **grid div**, the **ruler-inner** width, and the
**scrollbar** extent.

Rather than threading `+marginPx` through every draw site, the grid is split into
two layers (`PianoRoll.tsx`):
- **Outer** (`gridWidth` wide): full-width lane fill, octave lines, tempo
  gridlines (shifted by `marginPx` via a new `offsetX` prop on
  `PianoRollGridLines`), the two dimmed margin overlays
  (`rgba(0,0,0,0.45)`, `pointerEvents:'none'`), and the read-only out-of-window
  notes (dimmed, mapped at `marginPx + contentTimeToClipLocal*px`).
- **Inner** (`gridRef`, offset by `marginPx`, `windowPx` wide): the editable
  window content (notes, pending note, marquee, playhead, ghosts). Keeping
  `gridRef` here means pixel 0 stays = clip start, so **all existing mouse/draw
  math is unchanged**. `scrubToClientX` subtracts `marginPx`.

### Grid continues across margins
`buildPianoRollGrid` takes a `marginSec` param and generates bars/beats/ticks over
`[clipStartTime - marginSec, clipEndAbs + marginSec]` (low end still clamped to
absolute time 0, so the pre-zero part of the left margin stays blank). The tick
generators receive the widened `duration` so right-margin ticks aren't clamped
away.

### Resize handles + live preview
`PianoRollRuler` renders two `ew-resize` grab tabs in the Time lane at
`toPixel(clipStartTime)` and `toPixel(clipStartTime + clipDuration)` (its
`toPixel` now adds `marginPx`). The handle mousedown **stops propagation** so it
doesn't also scrub the playhead.

`handleResizeStart` (in `PianoRoll.tsx`) follows the timeline's own trim pattern
(`useClipTrim`): hold **local drag state** (`resizeDrag`), render the whole editor
from an **effective window** (`effInPoint/effOutPoint/effStartTime`) during the
drag, and commit **one** history-aware `trim-clip` op on mouseup (no per-frame
store writes). New timing is computed with the shared `computeTrimTiming`,
extracted from `useClipTrim.ts` into `components/timeline/utils/clipTrimTiming.ts`
and imported by both — so the infinite-source left clamp (`-startTime`,
`MIN_CLIP_DURATION` floor) can't drift.

## Files
- `src/components/pianoRoll/PianoRoll.tsx` — effective-window geometry, two-layer
  grid, dimmed overlays, out-of-window notes, `gridWidth` (3 sites), resize
  handler + ruler wiring.
- `src/components/pianoRoll/PianoRollRuler.tsx` — `marginPx`/`clipDuration`/
  `onResizeStart` props, `toPixel` offset, two Time-lane handles.
- `src/components/pianoRoll/PianoRollGridLines.tsx` — `offsetX` prop.
- `src/components/pianoRoll/pianoRollGrid.ts` — `marginSec` range widening.
- `src/components/timeline/utils/clipTrimTiming.ts` (new) — shared
  `computeTrimTiming`/`trimOriginalsFromClip`; `useClipTrim.ts` imports them.

## Verification
1. `npx tsc -b` clean; eslint clean on touched files.
2. Open a MIDI clip's piano roll: dimmed margins left/right, clip area at normal
   brightness, bars/beats/ticks continue across the margins.
3. Drag the **right** handle out → clip lengthens, hidden notes past the old end
   brighten + become editable; drag in → they dim. Single undo restores.
4. Drag the **left** handle → start + inPoint move together, `startTime` stays
   `≥ 0`; the main-timeline clip reflects it live; single undo restores.
5. Dragging a handle does **not** move the playhead.
6. Existing note place/move/resize, ruler scrub, and Ctrl/Ctrl+Shift wheel zoom
   still land under the cursor; left-extended clip (negative inPoint) geometry
   stays correct.
