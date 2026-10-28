# Inspector performance

Effect and node controls keep DOM interaction on the main thread. Pointer drags
coalesce to one value per animation frame, with a synchronous final flush before
the undo transaction closes. Shared inspector number rows open a transaction only
when no enclosing transaction owns the gesture. Typing and resets stay immediate.

Image-effect inspectors prepare graph metadata in a shared module worker.
Normalization, composition recognition and expansion happen once per authored
graph revision, rather than during every React render. Ordinary parameter values
and playback updates reuse the same graph. Inspector metadata does not require
shader compilation; renderer validation and compilation remain unchanged.

One worker job runs at a time. Unsubscribed pending revisions are removed, late
answers remain attached to their original revision, and at most 32 unused/completed
revisions are retained alongside active subscribers. Worker errors are visible;
they do not silently trigger expensive synchronous work in the inspector.
Non-image graph families keep their existing preparation path.

Exposed numeric node bindings use the normal property/keyframe update path instead
of cloning and revalidating the whole graph as a structural edit. Graph-local
constants and connections still use structural validation. Slit Scan numeric
geometry programs reuse their instruction plans when only uniform values change;
resource-affecting changes and graph revisions still compile a new plan.

This does not move all rendering or project/history serialization into a worker.
The default render host remains the main host with WebGPU effect execution. The
manual `tests/manual/inspector-graph-worker.html` probe checks real worker output,
metadata parity, revision reuse and event-loop responsiveness while the job runs.

## Drag latency

Dragging a Transform or effect value keeps the control at input rate while the
preview catches up:

- **One encode per gesture.** Every frame-coalesced drag sample is staged as a
  live gesture preview (`TimelineGesturePreview`); the clip is encoded, saved as
  one revision and mirrored into the composition once, at release. Store-session
  keys such as `timelineRevision` may ride along with a staged write;
  `invalidateCache` keeps the `clips` and `videoBakeRegions` arrays when nothing
  is baked and writes cache fields in their own update. A write that cannot be
  staged logs its reason once per gesture ("Gesture preview off ...").
- **Composition switch during a gesture.** A preview lives only in the timeline
  store of one composition. A phone sheet keeps its explicit gesture open for the
  whole sheet session, so a tab switch can happen inside it. Before navigation
  swaps the store, it writes every open preview of the visible composition into
  its gesture's transaction (`flushEditorGesturePreviews`, logged at INFO). The
  release then saves what the user saw. A cancel after the switch saves nothing.
  It does not revert the other composition's timeline writes into the visible
  store; it restores that composition's `timelineData` instead. The gesture
  records its projections of each composition as segments: a new segment starts
  when another transaction committed a write to that composition in between. A
  cancel takes the segments back newest first, per clip and field, so an edit
  committed outside the sheet between two samples stays. After the flush, samples
  in the composition switched to still use the preview path. Back in a
  composition the gesture already wrote in full, samples are encoded in full;
  this is logged once ("Gesture preview off ... already wrote composition").
  A cancel or release after A -> B -> A works on the rebuilt store. A preview whose
  store was replaced without this flush, such as by a project activation, is
  dropped with a warning on release and with an INFO line on cancel, because
  its composition still holds the values from before the gesture. Commit and
  cancel do not throw in either case
  (`tests/unit/gesturePreviewCompositionSwitch.test.ts`).
- **Local draft value.** Number fields and sliders show the dragged value at
  once and write it to the store once per frame. At release the last value is
  written first, then the control follows the store again (a clamp shows there).
  A slider and the number field next to it share the draft
  (`usePairedDragDraft`), so the partner paints the same sample instead of one
  frame later.
- **No graph rebuild per sample.** The section bypass reads its effect's graph
  from a cache keyed by graph identity, so a parameter value change does not
  re-run composition recognition.
- **Narrow subscriptions.** The media bin, Properties panel, Transform and
  Effects tabs and the effect catalog select their clip, effect or derived keys,
  not the whole clip list, and skip playhead ticks when nothing is keyframed.
  The Properties panel also follows the parent chain of a parented clip (each
  ancestor, its keyframes and the composition size), because the shown
  transform is composed with it. The memoised Transform tab subscribes to the
  active composition's pixel size, the clip's media-file size and the nested
  composition's size, one number per selector (`useTransformMediaSizes`). It
  follows a resolution change, a composition switch, metadata or a proxy that
  arrives, and a source swap. A mirror write of the composition list does not
  re-render it (`tests/unit/transformTabDerivedSizes.test.tsx`). `App` (`useClipPanelSync`,
  `useLiveInputFeedbackCoordinator`), every `DockTabPane` and a closed
  `MulticamDialog` no longer re-render per sample either.
- **No graph serialization per render.** An effect's pause reason is read from
  its stored graph object instead of serializing the graph.

The journey `tests/playwright/performance/inspector-latency.spec.ts`
(`@module:performance-stress`, gate `draft`) drags Position X, the Rotation
slider and the Gaussian Blur radius with a 125 Hz mouse, on a plain frame-code
clip and on one with Brightness, Gaussian Blur and Glow. Its deterministic checks
are: every sample accepted by `stage()`, no rejection warning, exactly one
revision, no composition-mirror write during the drag and one at release, at
most 10 ms store work per sample (quiet hosts measure under 1 ms), the saved value shown after release, the preview
pixels at that value, and one undo back to the start value. Frame rate, input to
control paint and input to preview paint (matched from preview pixels against
reference renders) are reported against budgets with about 2x headroom: a miss is
a `perf-soft` annotation by default, because a loaded host halves the frame rate
while every counter holds. `MASTERSELECTS_INSPECTOR_PERF=budget` fails a missed
budget (quiet, dedicated host), `strict` fails against the owner targets (plain
clip 50 fps, control 20 ms, preview 45 ms; three effects 40 fps, 25 ms, 60 ms),
and `MASTERSELECTS_INSPECTOR_PERF_RESULTS=<file>` collects every case as JSON lines. Run it headless on its own Vite port:

```text
MASTERSELECTS_E2E_HEADLESS=1 MASTERSELECTS_E2E_PORT=<free port> \
  npx playwright test tests/playwright/performance/inspector-latency.spec.ts
```

Measured on the Linux desktop (dev server, headless, quiet host), before (3.3.6)
and after:

| Case | fps | control p50 | preview p50 | store per sample |
|---|---|---|---|---|
| Plain clip, Position X | 19 → 38 | 61 → 10 ms | 178 → 93 ms | 1.2 → 0.4 ms |
| Plain clip, Rotation slider | 19 → 42 | 58 → 8 ms | 163 → 70 ms | 1.4 → 0.4 ms |
| Three effects, Position X | 7 → 41 | 174 → 10 ms | 328 → 72 ms | 122 → 0.4 ms |
| Three effects, Blur radius slider | 5 → 36 | 220 → 12 ms | 231 → 75 ms | 160 → 0.4 ms |

Still open (the strict targets need them): the preview is committed one frame
after the input flush; Linux presents the preview through a JavaScript pixel copy
(`SoftwareOutputCanvas`); the release and typed-Enter hitch on effect clips; and
`Preview`, `Timeline` and the Properties panel still re-render per sample (about
3.4 React commits per sample, p95 about 240 components per commit, down from
about 370). `Preview` needs the live clip for its edit overlays and is left for
a split of that component.
