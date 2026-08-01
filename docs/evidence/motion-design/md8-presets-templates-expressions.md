# MD8 Evidence — Presets, Templates, Expressions (Brand-Brief Lower Third)

Date: 2026-08-01 · Evidence session: disposable dev-bridge session
(`motion-md5b5a1.localhost:5173/?motionDesignEvidenceSession=md5b5a1`),
never the user's real project session.

## Scenario (brand brief, built end-to-end through AI tools)

Brief: "MasterSelects-Brand: Petrol-Balken (#0f2a33), Coral-Akzent (#ff5a3c)
mit subtilem Puls, weißer Name/Rolle, unten links."

Built exclusively with bridge AI tool calls (no UI interaction):

| Element | Tools | Key values |
| --- | --- | --- |
| Petrol bar | createMotionShapeClip → updateMotionProperties → updateMotionAppearances | video-1, 640×96, cornerRadius 6, pos (−480, 360), color `#0f2a33ee` |
| Coral accent | createMotionShapeClip → updateMotionProperties → updateMotionAppearances → setMotionExpression | video-2, 14×96, pos (−812, 360), replicator 1×1 enabled, color `#ff5a3c`, expression below |
| Name text | createTrack → createTextClip → setTextBox | "ROMAN K.", Inter 44 w700 `#ffffff`, box (210, 856, 560×48) |
| Role text | createTrack → createTextClip → setTextBox | "Founder · MasterSelects", Inter 24 w400 `#cfd8dc`, box (210, 902, 560×30) |

One clip per track (track overlap hides all but one clip — MD8-B2 learning).

## Expression pulse proof (`setMotionExpression`)

Binding: `replicator.offset.opacity` ← `0.7 + 0.3 * sin(time * 4)`, fallback 1.

GPU readback (`renderHostPort.readPixels()`, premultiplied RGBA at the
accent pixel, composition (148, 900)):

| Timeline t | Expected opacity | Observed pixel | Effective opacity |
| --- | --- | --- | --- |
| 0.00 | 0.700 | `[124, 44, 29, 178]` | 178/255 = **0.698** |
| 0.39 | 0.99998 | `[255, 90, 60, 255]` | **1.0** |
| 2.00 | 0.9967 | `[253, 90, 60, 254]` | **0.996** |

Runtime API cross-check (`createMotionFrameRuntimeAdmission`, per-instance
resolved values): t=0 → 0.7, t=0.39 → 0.99998, t=1 → 0.47296. Preview
consumer, deterministic, one value per instance.

Screenshots (composited frame export, JPEG over black):

- `md8/brand-lower-third-t0.00-pulse-0.7.jpg` — accent muted (opacity 0.7)
- `md8/brand-lower-third-t0.39-pulse-1.0.jpg` — accent full coral (opacity 1.0)

## Verification detour worth keeping

The first captures at t=0 vs t=0.39 were byte-identical (accent stuck at
opacity 0.7). Root cause was NOT the expression pipeline: the evidence tab
had been backgrounded since an HMR reload, the RAF render loop was parked,
and `captureFrame` returned the frozen t=0 framebuffer ("stable" because
nothing re-rendered). Confirmed by probing `renderHostPort.render` (zero
calls after seeks) and by the runtime API returning correct time-dependent
values. Fix for evidence capture: foreground the tab AND force a real
render per frame (`layerBuilder.captureFrameContext(t)` →
`buildLayersFromStore` → `renderHostPort.render(layers, frameContext)`),
then read pixels / export the frame. The expression pipeline itself
(admission → frame state → `createReplicatorRenderPacket` → instance
buffer → shader) is correct per-frame, including cache identity
(expression values are hashed into the packet cacheIdentity, and
`baseIdentity` includes `timelineTimeSeconds`).

## MD8 feature status covered by this evidence

- `setMotionExpression` authoring via bridge: set accepted, binding
  reported with id/path/source/fallback/enabled, history single-entry.
- Expression evaluation live in the preview GPU path with clip-local time,
  precedence over modifier/keyframe values, fail-closed unused (no
  diagnostics emitted — source valid).
- Presets/templates: unit evidence in `tests/unit/motionAppearancePresetsMd8.test.ts`,
  `tests/unit/motionTemplatesMd8.test.ts` (4/4 each),
  `tests/unit/motionExpressionsMd8.test.ts` (5/5).

Known gaps (logged in plan): templates do not yet capture `expressions`;
playing video textures deferred; multi-clip templates + categories + UI
verification pending.
