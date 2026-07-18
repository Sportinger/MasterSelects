# BUG: Timeline track section jitters vertically when editing a selected track's panel (short window)

Status: **Open / not started** — documented, root-caused with live data, fix deferred.
Discovered while working on the Simple Synth branch (`298-improve-simple-synth`),
but it is **pre-existing and unrelated to the synth** — it reproduces with any
track-panel slider (Track Controls *and* Track Instrument). Do **not** fix it on
the synth branch; this doc is the handoff for a dedicated fix.

---

## 1. Summary

When a track is selected and the browser window is **short** (timeline vertically
tight), interacting with any control in that track's properties panel — dragging a
slider/knob, or even toggling a checkbox like the filter Lowpass — makes the
selected track's row in the timeline **jump vertically and settle back** over
~0.5s. The properties panel and the rest of the app do not visibly move; only the
timeline track section wobbles.

- **Severity:** medium (annoying, not data-losing; only in short viewports).
- **Area:** timeline vertical section layout + scroll (not the properties panel,
  not the synth).
- **Regression?** No — pre-existing. It became noticeable now because the synth
  instrument panel got taller (envelope graph + knobs), which makes the short-
  window condition easier to hit, but the mechanism is independent of the synth.

## 2. Reproduction

1. Make the browser window short (so the timeline is vertically tight and its
   sections are scrollable).
2. Select a track (repro'd on a MIDI track; the trigger is generic).
3. Open a track properties tab with a slider — **Track Controls** (e.g. volume)
   or **Track Instrument** (e.g. filter Cutoff).
4. Drag the slider/knob (or repeatedly toggle a control).
5. Observe: the selected track's row in the timeline jumps up/down and eases back
   to its original position while you interact.

## 3. Root cause (confirmed with live instrumentation)

The timeline splits its body into a **video section** and an **audio section**,
whose pixel heights are derived from measured heights and re-clamped on change:

- `useTimelineSectionViewportMeasurement.ts` — a `ResizeObserver` measures
  `splitViewportHeight` (the scroll wrapper), `videoViewportHeight`,
  `audioViewportHeight` and pushes them to state.
- `useTimelineSectionLayout.ts` — derives `videoSectionHeight` /
  `audioSectionHeight` from `splitViewportHeight`, the split ratio, and each
  section's content height.
- `useTimelineSectionScrollPinning.ts` — re-clamps `audioScrollY`/`videoScrollY`
  whenever those heights change.
- `Timeline.css` (~L398 and ~L422) — the section elements have a
  `transition: height …`, so any height change **animates**.

Any track-panel edit calls a `setTrack*` store action (e.g.
`setTrackMidiInstrument`, volume/pan setters), which **replaces the `tracks`
array**, causing an app-wide re-render + reflow. Under that reflow the measured
heights are re-read and the split is re-derived; because the derivation and the
measurement feed each other, the values **oscillate and converge** over several
frames, and the CSS `height` transition animates the settling — the visible
"jump and return."

### Captured data (AI bridge, one drag in a short window)

`split` = measured scroll-wrapper height (`splitViewportHeight`);
`aVp` = measured audio viewport; `aSec` = derived `audioSectionHeight`;
`aContent` = audio content height.

| # | split | vVp | aVp | vContent | aContent | vSec | aSec |
|---|------:|----:|----:|---------:|---------:|-----:|-----:|
| 1 | 320 | 160 | 160 | 140 | 48 | 42 | 276 |
| 2 | 155 | 42 | 276 | 140 | 48 | 32 | 121 |
| 3 | 155 | 32 | 121 | 140 | 48 | 32 | 121 |
| 4 | 155 | 32 | 121 | 149 | 266 | 32 | 121 |
| 5 | **125** | 32 | 121 | 149 | 266 | 32 | **91** |
| 6 | 125 | 32 | 112 | 149 | 266 | 32 | 91 |
| 7 | 125 | 32 | 104 | 149 | 266 | 32 | 91 |
| 8–13 | 125 | 32 | 99→96→94→93→92→**91** | 149 | 266 | 32 | 91 |

Read-out:
- **`split` (the timeline's own allotted height) is itself unstable** — it drops
  320 → 155 → 125 during the interaction. The outer measurement is not stable
  under the churn.
- Once `split=125`, `aSec` recomputes to `91`, and the **measured `aVp` lags and
  converges** 121 → 91 over ~10 frames (rows 5–13). The section `height`
  transition animates that catch-up ⇒ the track visibly slides and returns.
- `aContent` jumping 48 → 266 (row 4) is the selected track expanding; it feeds
  the split math but is not itself the oscillation.

`ratio` stayed constant (`0.1318`), `focus="balanced"`, `splitDragVideoHeight=null`
throughout — so it is **not** a split-drag or focus-mode change; it is the
measurement/derivation loop.

## 4. Why the earlier "obvious" fixes did NOT work

- **Bounding the properties panel** (`min-height:0` + `overflow:hidden`) — no
  effect; the panel is not what pushes. The dock is already fully bounded.
- **Rounding/bailing the ResizeObserver heights** — no effect; the values change
  by real integer pixels (e.g. 121→112→104…), not sub-pixels.
- **Knob pointer-capture vs pointer-lock** — good hygiene, but unrelated (native
  `<input type=range>` sliders reproduce it too).

## 5. Suggested fix directions (pick after a focused investigation)

1. **Stabilize the outer measurement.** `splitViewportHeight` should reflect the
   container's real allotted height and must not change just because `tracks`
   re-rendered. Investigate why `split` drops 320→125 during interaction
   (container reflow? a sibling growing? scrollbar toggling?). If it is a
   transient reflow, decouple the section-height derivation from it (measure only
   on genuine container resize, e.g. rAF-coalesced + settle detection).
2. **Break the measure↔derive feedback.** Don't feed a measured *section viewport*
   height back into the *section height* it sizes; derive both from the stable
   container height only.
3. **Don't animate measurement noise.** Scope the section `height` transition
   (`Timeline.css` ~L398/L422) to *intentional* resizes (split drag, collapse,
   focus change) and disable it during passive re-measures — so even if a height
   settles over a few frames, it doesn't visibly wobble.
4. **(Band-aid, not preferred)** Throttle/`rAF`-coalesce the section re-clamp so a
   60Hz slider drag can't re-clamp every frame.

Option 1 or 2 is the real fix; 3 is a cheap, low-risk mitigation that would
likely remove the *visible* symptom even if the underlying oscillation remains.

## 6. Affected files

- `src/components/timeline/hooks/useTimelineSectionViewportMeasurement.ts`
- `src/components/timeline/hooks/useTimelineSectionLayout.ts` (the split math,
  ~L181–L210)
- `src/components/timeline/hooks/useTimelineSectionScrollPinning.ts`
- `src/components/timeline/hooks/useTimelineSectionController.ts` (wires them)
- `src/components/timeline/Timeline.css` (~L398, ~L422 — section `height`
  transition)

## 7. How to re-instrument (for whoever fixes it)

Reproduce the data above by temporarily logging in
`useTimelineSectionController.ts` (after the section hooks resolve):

```ts
import { Logger } from '../../../services/logger';
const dbg = Logger.create('SectionSplitDebug');
useEffect(() => {
  dbg.warn('split-inputs', {
    split: splitViewportHeight, vVp: videoViewportHeight, aVp: audioViewportHeight,
    vContent: videoSectionMetrics.contentHeight, aContent: audioSectionMetrics.contentHeight,
    vSec: videoSectionHeight, aSec: audioSectionHeight,
    focus: trackFocusMode, ratio: timelineSplitRatio, splitDragVideoHeight,
  });
}, [/* all of the above */]);
```

Then read it back over the AI debug bridge (dev server running, app open):

```bash
TOKEN=$(cat .ai-bridge-token)
curl -s http://localhost:5173/api/ai-tools -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"tool":"getLogs","args":{"module":"SectionSplitDebug","limit":40}}'
```

`.warn` (not `.debug`) so the entries land in the buffer the bridge returns.

---

## 8. GitHub issue (paste-ready)

> **Title:** Timeline track section jitters vertically when editing a selected track's panel in a short window
>
> **Labels:** bug, timeline, layout
>
> **Description**
>
> In a short browser window (timeline vertically tight), editing a selected
> track's properties — dragging any Track Controls or Track Instrument slider/knob,
> or toggling a control — makes the selected track's row in the timeline jump
> vertically and ease back over ~0.5s. Only the timeline section wobbles; the
> panels don't move. Pre-existing; not synth-specific.
>
> **Steps to reproduce**
> 1. Shrink the window so the timeline is vertically tight (sections scrollable).
> 2. Select a track, open Track Controls or Track Instrument.
> 3. Drag a slider/knob (or toggle a control) repeatedly.
> 4. The selected track's row jumps up/down and settles back while interacting.
>
> **Root cause**
> Any track edit replaces the `tracks` array → app-wide re-render/reflow. Under
> that reflow the timeline's section-height split is re-measured/re-derived and
> oscillates: the measured scroll-wrapper height (`splitViewportHeight`) itself
> drops (observed 320→155→125), the derived `audioSectionHeight` recomputes, and
> the measured audio viewport lags and converges to it over ~10 frames. The
> section elements have a CSS `height` transition, which animates that settle into
> the visible jump. Confirmed via instrumentation (`SectionSplitDebug`) read over
> the AI bridge.
>
> Not sub-pixel jitter (integer-pixel changes), not the properties panel (dock is
> bounded), not the synth (reproduces with Track Controls sliders).
>
> **Affected code**
> `src/components/timeline/hooks/useTimelineSectionViewportMeasurement.ts`,
> `useTimelineSectionLayout.ts` (split math ~L181–210),
> `useTimelineSectionScrollPinning.ts`, `useTimelineSectionController.ts`,
> `Timeline.css` (section `height` transition ~L398/L422).
>
> **Suggested fix**
> Stabilize `splitViewportHeight` / decouple the section-height derivation from
> transient reflow (measure only on real container resize), or break the
> measure↔derive feedback. Cheap mitigation: scope the section `height` transition
> to intentional resizes so passive re-measures don't animate. Full analysis and
> captured frame-by-frame data in
> `docs/ongoing/Timeline-Section-Split-Jitter-Bug.md`.
