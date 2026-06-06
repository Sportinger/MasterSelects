# Timeline Rendering Architecture — Full-Scope Plan

**Status:** Shipped for the main-thread canvas/shell architecture. The full DOM clip body has been deleted on the issue branch. The OffscreenCanvas worker path is implemented for eligible simple clips plus prepared waveform, spectrogram, bounded normal/reversed thumbnail-strip, composition visuals, passive badge/progress, transcript-marker, sampled analysis-overlay, active trim/source-extension, fade-curve, ordinary active drag/drag-preview resources, Slip/Slide resolved geometry/source-range parity, smoke-level worker resource-budget/pending/error gates, focused forced-worker browser proof, full timeline-canvas verification, and explicit default-off product policy. Product worker mode remains default-off because default-on still needs real-media worker-positive proof beyond forced live fallback.
**Goal:** Display arbitrarily large compositions (100s–1000s of clips) at near-60fps, fully zoomed out, while still showing thumbnails and waveforms — and keep all editing interactions.
**Author:** debugging session 2026-05-31 (super-cut comp, 100 clips, ~9fps)

---

## Implementation status (issue #228 branch)

| Phase | What | State | Commit |
|---|---|---|---|
| P0a/b/c | Selection-culling fix · TimelineTrack memo · shared id-index | ✅ done | 9ebeae46 |
| P1 | `TimelineClipCanvas` clip bodies + LOD (migration flag retired) | ✅ done | 77c45121 |
| P1 | Canvas thumbnails (filmstrip, ImageBitmap cache) | ✅ done | 86f95755 |
| P2 | Canvas interaction via active-clip DOM overlay + hover hit-test | ✅ done | 9f2e338c |
| P4 | OffscreenCanvas Web Worker path (flag `timelineCanvasWorker`, default OFF) | partial: solid/eligible clips plus waveform, spectrogram, bounded normal/reversed thumbnail-strip, composition visuals, passive badge/progress, transcript-marker, sampled analysis-overlay, active trim/source-extension, fade-curve, ordinary active drag/preview transfer, Slip/Slide resolved geometry/source-range parity, smoke-level resource-budget/pending/error gates, focused forced-worker browser proof, full timeline-canvas verification, and explicit default-off product policy done; default-on still needs real-media worker-positive proof | d01c3cd9 + issue branch |
| P3 | Make canvas the **default** and remove visible high-zoom DOM fallback | ✅ done | b8df7c0b + issue branch |
| P3 | Finish god-object dissolution / delete full DOM clip body | done on issue branch | |
| P1 | Waveforms on canvas (audio clips) | done on issue branch | |

**P3 note:** the canvas is now the production timeline clip-body renderer.
The per-clip visible DOM path is no longer used as an extreme-zoom fallback. The
track canvas is viewport-sliced and positioned in absolute timeline space, so its
backing store stays below browser canvas limits even when the full timeline would
be far wider than `MAX_CANVAS_WIDTH_PX`. In canvas mode, mounted DOM clips are
invisible interaction shells for active handles/context-menu affordances while the
canvas remains the single visible clip-body renderer. The old `timelineCanvasClips`
rollback flag has been removed; rollback now means reverting the fixed canvas
track path or repairing the canvas renderer directly. The full DOM clip body has
since been deleted on the issue branch. Current follow-up work is to keep passive
parity in `TimelineClipCanvas`, active parity in `ClipInteractionShell` modules,
and runtime/cache ownership outside view components.

---

## 0. TL;DR — Is this even possible with React?

**Yes — but the clips must leave the React DOM.**

Every professional NLE (Premiere, DaVinci Resolve, Final Cut) and every fast web editor (Descript, Clipchamp, Veed) renders the timeline clip area to a **canvas**, not to DOM nodes. React/DOM stays responsible only for:

- the chrome (track headers, controls, ruler, playhead, scrollbars),
- dialogs / context menus,
- the **interaction overlay** for the 1–2 clips you are currently touching (selection handles, trim/fade handles, hover affordance).

The clip bodies — rectangles, colors, **thumbnails**, **waveforms**, labels — get drawn onto a single `<canvas>` per timeline. This makes per-frame cost **O(visible clips)** instead of **O(all DOM nodes)**, and "fully zoomed out, everything at once" becomes trivial because you simply draw colored bars (Level-of-Detail) instead of mounting thousands of components.

React itself is not the bottleneck. **DOM-per-clip is.** React stays — it just stops owning the clip bodies.

---

## 1. Measured evidence (why we are at 9fps)

From the live dev bridge (`getStats` / `getPlaybackTrace`) on the 100-clip "super cut" comp, **idle/paused**:

| Metric | Value | Meaning |
|---|---|---|
| `fps` | **9** (target 60) | starved |
| `timing.total` (GPU render) | **1.01 ms** | the WebGPU engine is NOT the problem |
| `rafGap` | **115.9 ms** | ~114 ms/frame spent on main thread *outside* render |
| `drops.reason` | `slow_raf` | main thread can't service requestAnimationFrame |
| `layerCount` | 1 | only one visual layer at the playhead — rendering is cheap |

The GPU draws a frame in ~1 ms. The other ~114 ms is React reconciliation + browser style/layout/paint/composite of a huge timeline DOM. Loading the comp takes ~30 s = mounting 100 heavy components.

### Historical root causes from the original profile

1. **Viewport culling was defeated by selection.**
   Historical `TimelineTrack.tsx` code rendered selected clips regardless of viewport:
   ```ts
   if (selectedClipIds.has(clip.id) || draggedClipIds.has(clip.id) || clipTrim?.clipId === clip.id) {
     return true;
   }
   ```
   Select-all on 100 clips mounted all 100 DOM bodies. Current track rows use measured viewport culling plus `TimelineClipCanvas` and active shells instead.

2. **The former `TimelineClip` mega-component was the main per-clip React cost.**
   `src/components/timeline/TimelineClip.tsx` — 51 × `useTimelineStore(...)` + 3 × `useMediaStore(...)`, including **30 `.find()` scans** over `files` / `compositions` / `clips` (O(n)). At 100 clips that is ~5,000 selector evaluations and thousands of array scans on *every* store update. Most are audio-only features (spectral, stems, audio-regions) that a video clip subscribes to but never needs.

   Current checkpoint: the `TimelineClip.tsx` component file has been deleted; new work must keep passive clip bodies in canvas and active behavior in `ClipInteractionShell` plus focused modules.

3. **`TimelineTrack` memoization was too weak.**
   The current track component uses the canvas/shell split and a broader comparator; remaining render work is tracked through timeline canvas diagnostics rather than the old DOM-body memoization profile.

4. **Heavy DOM → expensive paint/composite each frame.**
   100 clips × thumbnails + gradients + `backdrop-filter` form large composited layers the browser must re-composite whenever the preview canvas updates → RAF starved to 115 ms.

### What is already good (keep it)

- Thumbnails are already viewport-windowed (`THUMBNAIL_RENDER_OVERSCAN_PX`, `thumbnailRenderWindow`).
- The deleted `TimelineClip` body no longer subscribes per clip; normal playback must continue to avoid per-clip React renders by keeping passive bodies in the canvas.
- Thumbnails come from the central source cache and canvas demand path:
  `thumbnailCacheService`, `thumbnailBitmapCache`, and `TimelineClipCanvas`.
- **Waveforms and spectrograms are now rendered in the timeline canvas** from cache/artifact services. The old DOM `ClipWaveform` and `ClipSpectrogram` components are retired; new passive audio visuals should stay in canvas/shared drawing utilities.

---

## 2. Target architecture — Hybrid Canvas Timeline

Three layers, stacked, sharing one coordinate transform (`timeToPixel` / `scrollX` / `zoom`):

```
┌─────────────────────────────────────────────────────────┐
│ React chrome (DOM)                                        │  ← unchanged React
│  track headers · controls · ruler · playhead · scrollbars │
├─────────────────────────────────────────────────────────┤
│ Interaction overlay (DOM, React)                          │  ← only ACTIVE clips
│  trim/fade handles · selection outline · hover · ctx menu │     (1–2 at a time)
├─────────────────────────────────────────────────────────┤
│ Clip layer (Canvas 2D / OffscreenCanvas)                  │  ← ALL clips, drawn
│  clip rects · thumbnails · waveforms · labels (LOD)       │     not mounted
└─────────────────────────────────────────────────────────┘
```

### 2.1 The Clip Canvas (`TimelineClipCanvas`)

A single `<canvas>` covering the track-lanes area. One draw call cycle paints every visible clip across all tracks.

Draw loop (per visible clip, culled to viewport + small overscan):

```
for each track (visible vertical range):
  for each clip overlapping [scrollLeftTime, scrollRightTime]:
    x = timeToPixel(clip.startTime) - scrollX
    w = timeToPixel(clip.duration)
    drawClipBackground(ctx, x, y, w, h, color, selected, muted, ...)
    if lod >= THUMB:   drawThumbnails(ctx, clip, x, w)      // from ImageBitmap atlas
    if lod >= WAVE:    drawWaveform(ctx, clip, x, w)        // reuse waveformLod pyramid
    if lod >= LABEL:   drawLabel(ctx, clip.name, x, w)
    drawClipBorder(ctx, ...)                                 // selection / link group
```

Cost is proportional to **clips intersecting the viewport**, never the total. Drawing rectangles + cached bitmaps is GPU-accelerated by the browser's 2D canvas backend.

### 2.2 Level of Detail (this is what makes "fully zoomed out" smooth)

The clip's pixel width decides how much to draw:

| Clip pixel width | What we draw |
|---|---|
| `< 4 px` | merge into a density bar (see 2.6); no per-clip work |
| `4–14 px` | color + **one poster thumbnail** when available |
| `14–96 px` | color + **one poster thumbnail** + truncated label |
| `> 96 px` | full filmstrip thumbnails + waveform + label + (handles via overlay) |

Fully zoomed out, 1000 clips might each be 2 px wide → we draw a handful of aggregated density bars, not 1000 anything. This is impossible to do cheaply with DOM (you'd still mount 1000 nodes) but trivial on canvas.

### 2.3 Thumbnail atlas (reuse `thumbnailCacheService`)

- Keep `thumbnailCacheService` as the source of truth (already source-based, dedup across clips sharing a media file).
- Add an **ImageBitmap layer**: decode each cached thumbnail blob once into an `ImageBitmap` (GPU-uploadable, drawable with `ctx.drawImage` with zero per-frame decode). Optionally pack into a sprite atlas per media file to reduce `drawImage` calls.
- Canvas asks: "thumbnails for media X, source range [in,out], N slots"
  through `thumbnailCacheService.getThumbnailsForRange(...)`; decoded
  `ImageBitmap` lifecycle belongs to `thumbnailBitmapCache`.
- Eviction by LRU on total bitmap memory budget (mirror existing cache budget logic).

### 2.4 Waveform on canvas (reuse `waveformLod`)

`TimelineClipCanvas` now loads cached waveform-pyramid refs, requests detailed waveform generation for visible audio clips through timeline services, and draws detailed LOD waveform columns directly in the track canvas. The old DOM waveform component is retired; active audio interactions belong in shell modules, not a passive DOM fallback.

### 2.5 Hit-testing & interaction (no DOM per clip)

- Maintain a **spatial index** of clip rects keyed by `(trackId, startTime, endTime)` — an interval tree or a simple per-track sorted array with binary search (clips per track are modest; binary search is plenty).
- Pointer events land on the canvas (or a transparent DOM hit layer). Convert `clientX/Y → (trackId, time)` → look up the clip → dispatch the **existing** selection/drag/trim handlers (they already operate on `clip.id`, see `Timeline.tsx` `handleTimelineClipMouseDown` etc.).
- While hovering or selecting a clip, mount a **single DOM overlay** for that clip only: trim handles, fade handles, region-edit UI, context-menu anchor. This keeps the rich interactive affordances exactly as today, but for 1–2 clips instead of 100.
- Drag/trim previews: redraw the canvas (cheap) instead of re-rendering React. The active clip's geometry comes from the same `clipDrag`/`clipTrim` state already in the store.

### 2.6 Density bars (zoomed-out aggregation)

When many clips fall under a few pixels, bucket them per X-pixel-column and draw an aggregate bar (average label color, "selected" if any selected). Gives a meaningful, smooth overview when fully zoomed out instead of a smear of sub-pixel rectangles.

### 2.7 Invalidation model (don't redraw when nothing changed)

The clip canvas redraws only when something it depends on changes:

- `clips` / `tracks` geometry, `selectedClipIds`, label colors, thumbnail/waveform cache version, `scrollX`, `zoom`, track heights, drag/trim preview.
- It does **not** redraw on `playheadPosition` (the playhead is a separate cheap DOM/canvas line).
- Use a dirty flag + single `requestAnimationFrame` coalesce; skip frames where nothing is dirty. This alone keeps idle at true idle (no 115 ms paint loop).

### 2.8 Phase 2 option — OffscreenCanvas in a worker

Once the clip canvas is stable, move eligible drawing to an `OffscreenCanvas` controlled by a Web Worker. Current issue-branch status: geometry, selection/hover, request ids, ready/drawn/error acks, diagnostics, fallback recovery, solid clips, prepared waveform columns, prepared spectrogram rasters, fresh per-draw thumbnail-strip ImageBitmap transfer, source-timed and reversed thumbnail strips, composition visuals, passive badge/progress resources, bounded transcript markers, sampled focus/motion/face analysis overlays, reversed badge parity, active trim/source-extension ghost visuals, fade curve resources, ordinary active drag/drag-preview geometry, Slip/Slide resolved geometry/source-range parity, smoke-level resource-budget/pending/error gates, focused forced-worker browser proof, and full timeline-canvas verification are implemented. The product flag remains default-off after final gates because the current real-media proof is forced fallback, not worker-positive; the verification runner includes forced worker smokes by default.

### 2.9 God-object decomposition (`TimelineClip.tsx` retired)

**This is a first-class workstream, not a side effect of the canvas migration.** Historically, canvas migration removed only the rendering responsibility from `TimelineClip`; the former component still carried interaction/business logic such as audio-region editing, spectral selection, stem separation, video bake, trim/fade/slip gestures, keyframe drag, and context menus. That logic now belongs in focused active shell modules and services. If future work recreates one large active overlay, we still have a god object, just rendered for one clip.

The former `TimelineClip` responsibilities are decomposed by responsibility:

Current checkpoint: the component file is gone. Do not recreate a one-file active overlay; route passive body work to `TimelineClipCanvas`, active controls to `ClipInteractionShell`, and shared behavior to focused hooks/services.

| Former responsibility | Target home |
|---|---|
| Geometry / trim math (`displayStartTime`, slip window, clamps) | pure `utils` + small hooks |
| Audio-region editing (selection, gain, fades, fx presets) | own component, **mounted only for audio clips** |
| Spectral selection / spectrogram region edits | own module |
| Stem-separation UI (jobs, choices, prewarm) | own module |
| Video-bake regions | own module |
| Thumbnails / filmstrip | → canvas (Phase 1) |
| Waveform / spectrogram | canvas/shared drawing utilities plus timeline artifact warmup services |
| Pointer / tool dispatch | already partly `timelineToolPointerDispatcher` (finish extracting) |
| Label-color resolution | indexed-map lookup (see 0c) |
| 51 store subscriptions | **split by feature** — a video clip must not instantiate the ~30 audio-only subscriptions |

Two payoffs that do **not** depend on the canvas:
1. **Immediate performance:** splitting subscriptions by clip kind removes ~30 audio-feature subscriptions + their `.find()` scans from every video clip. This helps even the zoomed-out-to-fit case where all clips are genuinely in view.
2. **De-risks the canvas migration:** the interaction logic ends up in cohesive, testable modules feeding the single active-clip overlay, instead of a monolith that must be moved atomically.

Decomposition rule: the only thing that needs to render for *every* clip is the visual body (→ canvas). Everything else only needs to exist for the **1–2 clips being interacted with** → mount those modules in the active-clip overlay, lazily, by clip kind.

---

## 3. Migration plan (incremental, app stays working)

Each phase is shippable; rendering-path flags were migration tools and can be retired after parity is proven.

### Phase 0 — Stop the bleeding (hours, low risk) ✅ do first
- **0a.** Historical: fix culling bypass. Current issue-branch rows use measured viewport culling, `TimelineClipCanvas`, and active shells rather than forcing selected off-screen DOM bodies.
- **0b.** Historical: repair weak `TimelineTrack` memoization. Current issue-branch work tracks remaining render cost through canvas diagnostics and the canvas/shell split.
- **0c.** Replace the O(n) `.find()` selectors from the former `TimelineClip` media-label path with lookups into indexed maps (`filesById`, `compositionsById`) provided by the stores.
- **0d.** Historical: begin the god-object split (§2.9). Current issue-branch state has deleted the full DOM clip body; do not reintroduce per-clip subscriptions for passive bodies.
- **Expected:** select-all on 100 clips drops from 100 → ~15 DOM clips; idle paint loop stops; video clips shed ~30 subscriptions each. Measure `rafGap` via bridge before/after.

### Phase 1 — Read-only clip canvas migration (the real fix)
- Historical migration step: `featureFlags.timelineCanvasClips` was added during rollout and retired after the canvas path became fixed.
- Build `TimelineClipCanvas` rendering clip backgrounds + LOD + labels for all tracks. Thumbnails/waveforms first via existing data, drawn as bitmaps.
- During migration, the DOM clip path renders **nothing** (or only the active overlay); the canvas owns the clip bodies. Selection/scroll/zoom drive canvas redraws.
- Keep DOM path only during migration parity testing.
- **Exit criteria:** 1000-clip synthetic comp scrolls and zooms at ≥55fps; `rafGap` ≤ 18 ms idle.

### Phase 2 — Interaction parity
- Spatial index + pointer routing → existing `clip.id` handlers.
- Single-clip DOM interaction overlay (trim/fade/region edit/context menu) for hovered/selected clip.
- Drag/trim/slip previews via canvas redraw.
- **Exit criteria:** every interaction available in the DOM path works on the canvas path; QA sign-off.

### Phase 3 — Make canvas the default, finish god-object decomposition, remove DOM clip path
- Make canvas the fixed path; delete the per-clip DOM rendering once parity is confirmed.
- Complete the §2.9 decomposition: `TimelineClip.tsx` is dissolved into the active-clip overlay + focused per-feature modules (audio-region, spectral, stem, video-bake) mounted lazily by clip kind. The 4,328-line monolith no longer exists; nothing renders for non-active clips except the canvas body.

### Phase 4 (optional) — OffscreenCanvas worker
- Move eligible clip drawing off the main thread for very large comps. Solid/eligible clips plus prepared waveform columns, spectrogram rasters, bounded normal/reversed thumbnail strips, composition visuals, passive badge/progress resources, transcript markers, sampled analysis overlays, reversed badge parity, active trim/source-extension ghost visuals, fade curve resources, ordinary active drag/preview geometry, Slip/Slide resolved geometry/source-range parity, smoke-level resource-budget/pending/error gates, focused forced-worker browser proof, full timeline-canvas verification, and explicit default-off product policy are implemented; default-on worker mode still waits on real-media worker-positive proof.

---

## 4. Performance targets & how we measure

Use the existing dev bridge (`getStats`, `getStatsHistory`, `getPlaybackTrace`):

| Scenario | Target |
|---|---|
| 100 clips, idle | `rafGap` ≤ 17 ms, `fps` ≥ 58 |
| 100 clips, select-all, idle | unchanged from above (no penalty) |
| 1000 clips, fully zoomed out, scrolling | `fps` ≥ 55 |
| Comp load (100 clips) | ≤ ~2 s to interactive (no 100-component mount) |
| Playback, 100 clips | no per-frame clip re-render; `drops.lastSecond` ≈ 0 |

Benchmark harness: a script that programmatically creates N clips (via the AI bridge / store) and samples `getStatsHistory` while scrolling/zooming.

---

## 5. Alternatives considered (and why they're insufficient alone)

- **Virtualize the DOM clip list only.** Helps the common case but breaks down exactly when the user wants "everything at once, zoomed out" (then *all* clips are in view → no windowing benefit) and still mounts heavy components. Necessary as Phase 0, not sufficient.
- **Just optimize React (memo, split subscriptions).** Cuts the 51-subscription tax and helps a lot (Phase 0c), but DOM node count, layout, and paint still scale with clip count. Ceiling is maybe low-hundreds of clips, not thousands.
- **Render timeline with the existing WebGPU engine.** Possible but couples timeline to the preview render target and competes for the device; a dedicated 2D/Offscreen canvas is simpler, isolated, and already half-built (waveforms).

## 6. Risks & mitigations

- **Interaction parity is the hard part** (trim/fade/region/spectral edits, context menus). Mitigation: keep these as invisible DOM overlays for the active clip and reuse existing handlers.
- **Text/label crispness & accessibility on canvas.** Mitigation: draw labels at devicePixelRatio; keep a11y affordances on the active-clip DOM overlay; canvas is decorative/visual like the preview already is.
- **Theme/CSS styling moves into draw code.** Mitigation: read CSS custom properties (`--track-color`, etc.) once per redraw into a style object; centralize clip visual style constants.
- **Large refactor on a shared branch.** Mitigation: staged commits, active-clip interaction shells, focused tests, and direct rollback of the fixed canvas path if needed.

## 7. First concrete steps

1. Land Phase 0a/0b/0c and re-measure `rafGap` on the super-cut comp (fast, high ROI).
2. Spike `TimelineClipCanvas` (backgrounds + LOD + labels only) during migration to validate the 1000-clip target.
3. Keep waveform/spectrogram drawing in canvas/shared utilities and keep decoded thumbnail bitmap ownership in cache services.
4. Build the spatial index + pointer routing; add the single active-clip overlay.

---

### Appendix — key files

- `src/components/timeline/Timeline.tsx` — composition root, canvas-backed composition switch overlay, playhead subscription.
- `src/components/timeline/TimelineTrack.tsx` — viewport culling (`:270`), selection bypass (`:282`), memo (`:430`).
- `src/components/timeline/TimelineClipCanvas.tsx` — current passive clip-body renderer.
- `src/components/timeline/utils/spectrogramCanvas.ts` and waveform drawing utilities — current passive audio visual drawing paths.
- `src/services/thumbnailCacheService.ts` and `src/services/timeline/thumbnailBitmapCache.ts` — thumbnail source cache plus decoded bitmap lifecycle.
- `src/engine/render/RenderLoop.ts` — engine RAF/idle (confirms render is cheap; timeline DOM is the cost).
</content>
</invoke>
