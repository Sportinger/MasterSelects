# Piano-Roll Rulers + Tempo-Synced Grid — Implementation Plan

> Issue #249 · branch `249-enhance-pianoroll`
> Status: **Implemented (Phases 1–5).** Phases 1–3 committed `24557670`; Phases 4–5
> (scrubbing + docs) pending the next commit. Only future work: the `gridResolution`
> UI control and snap-to-grid (both out of scope here).
> Updated: 2026-06-24

## 1. Goal

Give the piano-roll editor a stacked **Bars + Time** ruler and a **tempo-synced
grid**, both geometrically locked to the piano roll's own horizontal time zoom,
and both reading the **same shared `TempoMap` as the main timeline** so the bar
numbers and timecodes are *identical* to the timeline at the same musical
positions. The ruler is scrubbable (click/drag → playhead).

The user's framing: the piano roll needs a clear view of **time** and — more
importantly — **bars**; the **grid must match the ruler**; and everything must be
**in sync with the original timeline rulers** (same numbers, everything).

## 2. Locked-in decisions

Decided with the user, one at a time — do not re-litigate:

| Topic | Decision |
|-------|----------|
| **Lanes** | **Always Bars + Time** — two stacked lanes in the piano roll, regardless of which lanes the main timeline's Rulers menu has enabled. Bars on top, Time below. |
| **Grid depth** | **Bars + beats now**, but built through a **`gridResolution` parameter** (lines per beat) so a future UI control can add 1/8, 1/16, triplets, etc. The control itself is out of scope; the parameter ships in Phase 1. |
| **Zoom** | Inside the piano roll, the **ruler and grid share one horizontal time zoom** (`pxPerSec`) — exact DAW geometry. This zoom is **independent of the main timeline track zoom**; the two do not affect each other. Bar/time *numbers* still match because both read the shared `TempoMap` — only spacing differs. |
| **Scrubbing** | **Yes** — click/drag on the piano-roll ruler moves the global playhead. |
| **Snapping** | Out of scope. Note placement stays free (per #182). The grid is purely visual for now; snap-to-grid becomes trivial later since musical gridlines will exist. |

## 3. Why the numbers match the timeline (core mapping)

The piano-roll x-axis is **clip-local content time**; bars and time are
**global**. The bridge is the existing timing model in
`src/services/midi/midiClipTiming.ts`:

```
absoluteTime = clip.startTime + localSeconds        // localSeconds = x / pxPerSec
pixelX       = (absoluteTime - clip.startTime) * pxPerSec
```

Key fact: the visible window's **left edge (pixel 0)** corresponds to content
time `inPoint`, which is exactly `clip.startTime` in absolute time. So the
clip-local → absolute offset is precisely `clip.startTime`, regardless of
`inPoint`.

Therefore: generate ruler ticks and gridlines over the **absolute-time window**
`[clip.startTime, clip.startTime + clipDuration]`, feed the shared `TempoMap`
with `zoom = pxPerSec`, then map each tick back to a pixel with the formula
above. The labels (bar numbers, timecodes) read identical to the main timeline
**by construction**. Independent piano-roll zoom only changes spacing, never the
numbers.

## 4. Reuse vs. new

### Reuse as-is (pure layer + selectors + CSS)
- `iterateBarBeatLines`, `secondsToBarBeat` — `src/timeline/tempo/TempoMap.ts`
- `createBarsLaneTicks`, `createLinearLaneTicks`,
  `formatTimelineTimecode` / `formatTimelineFrameNumber` —
  `src/components/timeline/utils/timelineGrid.ts`
- Store selectors: `selectTempoMap`; action `setPlayheadPosition`
  (`src/stores/timeline/selectors.ts`, `playbackSlice.ts`)
- ~~CSS classes `.ruler-lane`, `.time-marker(.main/.sub)`, `.time-label`
  (`Timeline.css`)~~ — **DO NOT reuse these classes.** `PianoRollBoot` mirrors
  only `<link rel="stylesheet">`, but in Vite **dev** the app CSS is injected as
  `<style>` tags, so those classes are absent in the popup during dev (markers
  lose `position:absolute` and stack vertically). The whole piano roll is
  inline-styled for exactly this reason — `PianoRollRuler` follows suit with
  inline styles (Phase 2). Reuse the pure tick generators, not the CSS.

### Do NOT reuse `TimelineRuler.tsx` as a component
It is coupled to timeline-only concerns — cache ranges, video-bake regions,
shared lane selection (which would mutate the *timeline's* active lane), and a
viewport with **no left column**. The piano roll has the 48px keyboard column
(`KEYBOARD_W`). A thin purpose-built ruler that calls the same **pure
generators** keeps coupling low and both files well under the 700-LOC ceiling.

### New files
- `src/components/pianoRoll/pianoRollGrid.ts` — pure adapter wrapping the tick
  generators with the clip→absolute offset and the `gridResolution` parameter.
- `src/components/pianoRoll/PianoRollRuler.tsx` — the Bars + Time ruler view.
- `src/components/pianoRoll/PianoRollGridLines.tsx` — dedicated child that owns
  its own `scrollLeft` state and renders the windowed gridlines, so scroll never
  re-renders the notes layer (§6 / §7). Optional if §7 option (a) is chosen.
- Shared `formatTime` util (extracted from `useTimelineHelpers.ts`), imported by
  both the timeline hook and the piano-roll Time lane (§6).

## 5. The subdivision parameter (future-proofing)

`iterateBarBeatLines` emits only bars + beats. To support finer grids later
without rework, `pianoRollGrid.ts` exposes:

```ts
// gridResolution: lines per beat.
//   1 = beats (today's default), 2 = 1/8 (within a 1/4 beat),
//   4 = 1/16, 3 = triplets, etc.
buildPianoRollGrid({
  tempoMap,
  clipStartTime,
  clipDuration,
  pxPerSec,
  visibleStartPx,
  visibleWidthPx,
  gridResolution = 1,
}): {
  barLines:  GridLine[];   // strong tier
  beatLines: GridLine[];   // medium tier
  subLines:  GridLine[];   // faint tier (empty when gridResolution === 1)
  rulerTicks: { bars: RulerTick[]; time: RulerTick[] };
}
```

Internally:
1. Call `iterateBarBeatLines(tempoMap, fromAbs, toAbs)` for bar/beat lines over
   the **visible** absolute window only.
2. When `gridResolution > 1`, linearly interpolate sub-lines between consecutive
   beats (uniform within a tempo segment — correct for the current constant
   4/4@60 map and well-defined per-segment later).
3. Build the Bars-lane ticks from `createBarsLaneTicks` and the Time-lane ticks
   from `createLinearLaneTicks({ format: 'time' })`, both over the same absolute
   window, then convert each `time` back to a clip-local pixel.

> **Absolute-window gotcha (must-do).** Both generators clamp to `[0, duration]`
> and drop any tick with `time > duration` (`createTimeLaneTicks` at
> `timelineGrid.ts:205–211`; `createBarsLaneTicks` at `timelineGrid.ts:291, 311`).
> Because the piano-roll window is the **absolute** span `[clipStartTime,
> clipStartTime + clipDuration]`, the adapter MUST pass `duration =
> clipStartTime + clipDuration` (the absolute end) and absolute `startTime` /
> `endTime`. Passing the clip-local `clipDuration` would silently drop every
> tick past the clip length. The returned `time` values are absolute; convert
> each to a clip-local pixel with `(time - clipStartTime) * pxPerSec`.

Today every call passes `gridResolution = 1`. Later, the value comes from a new
piano-roll view-state field fed by a UI control.

## 6. Component / layout changes

### `PianoRoll.tsx`
- Restructure the body into three rows:
  1. existing header
  2. **new ruler row** = keyboard-corner spacer (width `KEYBOARD_W`, height of
     the ruler) + ruler track
  3. existing scroll viewport
- The ruler track sits **outside** the scroll container and is driven by a
  tracked `scrollLeft` via `translateX(-scrollLeft)`, mirroring how the timeline
  drives its ruler from `scrollX`.
- Add a **rAF-batched `onScroll`** on `scrollRef` that publishes `scrollLeft` for
  the ruler (and grid windowing).

> **Do NOT publish `scrollLeft` to top-level `PianoRoll` state.** That component
> re-renders its entire tree (every note + all 88 keys + ghosts) on each state
> change, and it already re-renders on every clip edit (`PianoRoll.tsx:105`).
> Re-rendering all notes on every scroll frame janks on large clips. Instead:
> - The ruler track's `translateX` is a **pure imperative ref update** in the rAF
>   callback (set `style.transform` directly) — no React state.
> - The windowed gridlines live in a **dedicated child component** that owns its
>   own `scrollLeft` state, so re-rendering the visible lines never re-renders the
>   notes layer.
> This keeps scroll cost off the heavy (notes) subtree entirely.
- **Replace** the current 1-second gridlines (today: `PianoRoll.tsx` ~lines
  502–508) with lines from `buildPianoRollGrid`, **windowed to the visible
  range** — this also fixes the current full-width line allocation (a Mesa
  risk). Three visual tiers: bar (strong), beat (medium), sub (faint).

### `PianoRollRuler.tsx`
- Two stacked lanes (**Bars** on top, **Time** below), rendered with the reused
  `.ruler-lane` / `.time-marker` / `.time-label` classes.
- Ticks for the **visible window + overscan only** (Mesa rule), positioned via
  the pixel mapping, offset by `KEYBOARD_W`, `translateX(-scrollLeft)`.
- `onMouseDown` + drag → convert `clientX` → localSeconds → `absoluteTime` →
  `setPlayheadPosition(absoluteTime)`, clamped to the clip window. Attach the
  drag listeners to the grid's `ownerDocument` (the popup document), matching the
  existing note-drag pattern in `PianoRoll.tsx`.

### Data the popup reads from the shared store
- `tempoMap` via `selectTempoMap`
- `frameRate` from the active composition (mediaStore) — **only** needed for a
  future timecode/frames lane. The shipped Bars + Time lanes need no `frameRate`
  (Time is MM:SS.ms). Treat this wiring as optional/deferrable for Phases 1–4 to
  keep the packets lean; add it with the timecode lane.
- `playheadPosition`, `setPlayheadPosition`
- `formatTime` (MM:SS.ms): the timeline's lives in a hook
  (`useTimelineHelpers.ts:27–32`) and can't be called in the popup. Do **not**
  re-inline a fresh copy — that is exactly how "identical to the timeline"
  silently drifts (e.g. centiseconds vs milliseconds). **Extract** that 6-line
  formatter to a pure shared util (alongside the other pure formatters in
  `timelineGrid.ts`, or a small `formatTime.ts`) and import it in both the
  timeline hook and the piano-roll Time lane, so labels are byte-identical by
  construction.

## 7. Mesa / Linux safety

Per `CLAUDE.md` §9 and `docs/Features/Linux-Mesa-GPU.md`:
- All-DOM (no canvas), so no GPU tile-seam / silent-blank risk — consistent with
  the opaque-key-rows + flat-grid approach already used on this branch to kill
  the Mesa shade seam.

> **Be precise about what windowing buys here.** The Mesa §9 rule is about
> **canvas backing stores**, not DOM node count. These gridlines and ruler ticks
> are plain `<div>`s, so the current full-width allocation
> (`PianoRoll.tsx:503–508`) is **not** a Mesa blanking risk — it is only a
> DOM-node-count / layout-cost concern, and only at long clips × high zoom.
> So windowing the gridlines is a **perf** optimization, not a Mesa fix, and it
> is the thing that forces the scroll-driven render in §6. Choose deliberately:
> - **(a)** Keep full-width DOM gridlines — simplest, zero scroll-render cost,
>   fine for typical clip lengths.
> - **(b)** Window them to the visible range — fewer nodes, but then you MUST do
>   the child-component isolation in §6 so notes don't re-render on scroll.
>
> Recommended: **(b)** with the §6 isolation, since clips can get long and the
> isolation is cheap. Either way, the escape hatch of a CSS
> `repeating-linear-gradient` background is **closed**: `PianoRoll.tsx:483–489`
> already removed gradients because the GPU resets gradient phase at tile edges
> on a large composited layer, producing a moving shade seam on Mesa.

## 8. Edge cases
- **`inPoint != 0`**: handled — the window left edge maps to `clip.startTime`;
  absolute time stays correct.
- **Very short / very long clips**: tick density already adapts via the
  generators' pixel-spacing thinning.
- **Tempo map**: constant 4/4@60 today; all code paths work unchanged when the
  map becomes multi-segment (tempo/meter changes), because the generators and
  `iterateBarBeatLines` are already N-segment.

## 9. Phasing

Each phase is packet-sized, leaves the app working, and is verified before the
next.

| Phase | Scope | Verify |
|-------|-------|--------|
| **1. Pure adapter** ✅ | Added `pianoRollGrid.ts` (`buildPianoRollGrid` + `gridResolution`); extracted shared `formatTimelineClock` into `timelineGrid.ts` and routed `useTimelineHelpers.formatTime` through it. No UI change. | `tests/unit/pianoRollGrid.test.ts` — 7 pinned tests (bar 4 @ abs 12s → 200px = 2·pxPerSec, label `"4"`, Time `"00:12.00"`; absolute-window gotcha; windowing; gridResolution=2 sub-lines; empty-window guard). `tsc -b` + lint + timelineGrid regression all green. |
| **2. Ruler** ✅ | Added `PianoRollRuler.tsx` (Bars+Time lanes via the adapter + reused `.ruler-lane`/`.time-marker`/`.time-label` classes; `PIANO_ROLL_RULER_H=61`). Ruler row inserted between header and viewport: `KEYBOARD_W` corner spacer + clipped track; `rulerInnerRef` slid by an imperative `translateX(-scrollLeft)` from a rAF-batched `onScroll`, re-aligned by a no-dep `useLayoutEffect` (covers mount/zoom/resize). No top-level scroll state → notes never re-render on scroll. `tsc -b` + lint green. **Visual check pending** (open piano roll: lanes show, labels match timeline, scroll lockstep). |
| **3. Grid** ✅ | Replaced the 1-second gridlines with `buildPianoRollGrid` bar/beat/sub tiers in new `PianoRollGridLines.tsx` (inline-styled, `memo`). Chose **§7 option (a)** full-width DOM lines (not the windowed (b)): they live inside the scrolling grid content so they scroll for free, the count is modest (one div/beat), and pure `<div>`s carry no Mesa risk — (b)'s scroll-state child wasn't worth the complexity at these clip sizes. Grid + ruler now share **one** `buildPianoRollGrid` call (memoized in `PianoRoll`, keyed on geometry/tempo not notes); the ruler became presentational (takes `rulerTicks`). | Lines sit exactly under ruler ticks (same absolute→pixel mapping). `tsc`+lint+tests green. **Visual check pending.** |
| **4. Scrubbing** ✅ | `handleRulerMouseDown` on the ruler track: clip-local px = `(clientX - trackLeft) + scrollLeft` → `setPlayheadPosition(clamp(clipStartTime + localSeconds, clipStartTime, clipStartTime + clipDuration))`. Drag listeners on the ruler's `ownerDocument` (popup doc), like the note drag; `cursor: ew-resize`. | `tsc`+lint green. **Visual check pending** (scrub moves playhead; cursor stays under pointer). |
| **5. Docs + checks** ✅ | Documented the feature in `docs/completed/features/MIDI-Tracks-Plan.md` (new #249 bullet + updated the "Note timing" grid note) and the shared-`TempoMap` dependency in `docs/Features/Timeline-Rulers.md` (new "Reused by the piano roll" section). This plan moved to `docs/completed/`. Full `build`/`lint`/`test` at the commit boundary. | Green chain; docs reflect shipped behavior. |

> Out of scope (later): the `gridResolution` UI control (1/8, 1/16, triplets) and
> snap-to-grid. The parameter and musical gridlines that make both easy land in
> Phases 1 and 3.

## 10. Files touched
- **New**: `src/components/pianoRoll/pianoRollGrid.ts`,
  `src/components/pianoRoll/PianoRollRuler.tsx`,
  `src/components/pianoRoll/PianoRollGridLines.tsx` (windowed-gridlines child,
  per §7 option b)
- **Edit**: `src/components/pianoRoll/PianoRoll.tsx` (layout, scroll signal, grid
  replacement)
- **Edit**: `src/components/timeline/hooks/useTimelineHelpers.ts` — extract its
  `formatTime` to a pure shared util and import it back (so the piano roll can
  share the exact same formatter; §6).
- **Possibly**: small piano-roll-scoped CSS (corner spacer, lane container);
  reuse timeline classes otherwise.
- **Docs**: `docs/Features/` (piano roll + the shared tempo-map dependency); this
  plan moves to `docs/completed/` when done.

## 11. Verification summary
- Open the piano roll on a MIDI clip; confirm bar numbers / time labels match the
  main timeline ruler at the same absolute positions; grid aligns under ruler
  ticks at multiple zooms; ruler scrubbing moves the global playhead; the
  playhead cursor stays aligned.
- `npx tsc -b` + targeted lint during phases; full `build`/`lint`/`test` only at
  the commit boundary (no commit unless the user asks).
