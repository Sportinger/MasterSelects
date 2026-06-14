# Playback Preview Notes

## Review Findings - 2026-06-14

### RAM Preview Cached Frames May Be Bypassed

The normal dock preview is currently registered as a render target canvas via
`usePreviewRenderTargetRegistration`, not as the legacy `mainPreviewCanvas`
owned by `useEngine()`.

`CachedFrameRenderer.renderCachedFrame()` still returns `false` when
`previewContext` is null, even though `RenderOutputRouterAdapter.routeCachedFrame`
can draw cached frames to registered target canvases. That means the RAM-preview
fast path can be skipped for the normal preview panel.

Relevant files:

- `src/components/preview/Preview.tsx`
- `src/components/preview/usePreviewRenderTargetRegistration.ts`
- `src/engine/render/dispatcher/cachedFrameRenderer.ts`
- `src/engine/render/RenderOutputRouterAdapter.ts`

Recommended fix: remove the legacy `previewContext` precondition and allow the
cached-frame route to render when active target canvases exist.

### Engine Hook Ownership Is Too Diffuse

`useEngine()` is mounted by the toolbar, preview panels, mobile preview, and
multi-preview slots. The WebGPU engine singleton prevents multiple render loops,
but each hook instance still owns its own stats interval and can replace the
singleton render callback.

Relevant files:

- `src/hooks/useEngine.ts`
- `src/components/common/Toolbar.tsx`
- `src/components/preview/Preview.tsx`
- `src/components/preview/MultiPreviewSlot.tsx`
- `src/components/mobile/MobilePreview.tsx`

Recommended fix: centralize engine lifecycle ownership in one app-level host or
provider. Other components should subscribe to engine readiness and call command
APIs without starting render-loop side effects.

### Preview Transparency Re-registers Targets

`showTransparencyGrid` is part of the preview target registration effect deps,
while a second effect already updates transparency in place. Re-registering a
target during playback clears video, scrubbing, and composite caches.

Relevant files:

- `src/components/preview/usePreviewRenderTargetRegistration.ts`
- `src/services/render/previewTargetRegistration.ts`

Recommended fix: remove `showTransparencyGrid` from the registration effect and
let `setPreviewTargetTransparency()` handle the live update.

### Independent Preview Scheduling Is Separate And Costly

Independent preview targets are driven by `renderScheduler`, which has its own
RAF loop and calls `engine.renderToPreviewCanvas()` per target. Active-comp
layer-filtered previews reuse the main loop's layers, but independent
composition previews still evaluate and render separately on the main thread.

Relevant files:

- `src/services/renderScheduler.ts`
- `src/engine/render/dispatcher/targetPreviewRenderer.ts`

Recommended fix: keep this on the main thread for now, but batch independent
target renders more deliberately before considering a worker rewrite.

### Worker Rendering Is Not The Right First Move

The playback preview is not comparable to the timeline clip canvas. The timeline
worker paints 2D UI decoration and has an exercised main-thread fallback. It is
disabled on Linux/Mesa because worker `OffscreenCanvas` can silently fail to
composite.

The preview pipeline is WebGPU compositing plus WebCodecs, HTML video fallback,
DOM video sync, masks, overlays, nested comps, 3D scene rendering, output
windows, and export routing. Moving all of that to a worker would first require
isolating the HTML-video fallback and DOM-facing overlays.

Recommended order:

1. Fix the target-canvas RAM-preview cached-frame path.
2. Centralize `useEngine()` ownership.
3. Move demux/decode/frame-provider work toward worker isolation where possible.
4. Consider worker-owned preview WebGPU only after main-thread fallback paths are
   explicit and tested.

## RAM Preview Investigation - 2026-06-14

### Current Path Map

Normal playback is the primary path:

`useEngine()` RAF -> `layerBuilder.syncVideoElements()` ->
`layerBuilder.buildLayersFromStore()` -> `engine.render(layers)` ->
`RenderDispatcher` -> `RenderOutputRouterAdapter`.

The layer source selected inside that path may be HTML video, WebCodecs/runtime
`VideoFrame`, native decoder output, an image/canvas source, a nested comp, or a
proxy image frame. The final compositor/output route is shared.

Proxy playback is not a separate renderer. Proxy mode is a source substitution
and prewarm layer over the normal render path:

- `TimelineControls` exposes the Proxy toggle.
- `useAutoFeatures()` starts proxy generation when proxy mode is enabled.
- `LayerBuilderService` reads `mediaStore.proxyEnabled` into `FrameContext`.
- `buildLayerBuilderVideoLayer()` can replace a video clip with a proxy image
  layer during scrub/clip-drag previews.
- `useLayerSync()` has an older paused/scrub path that also swaps in proxy
  image layers.
- `videoSyncHtmlClipCoordinator` pauses/mutes the real video during interactive
  proxy previews.

The generated proxy artifacts are currently JPEG proxy frames. There is a
`proxyFrameCache` VideoFrame/MP4 proxy cache API, but no call site outside that
service currently asks for `getVideoFrame()`, so that path appears dormant.

RAM preview is a separate pre-render/cache path:

`startRamPreview*()` -> `RamPreviewEngine.generate()` -> build layers for each
frame -> `engine.render(layers)` -> `engine.cacheCompositeFrame(time)` ->
`ScrubbingCache` composite/GPU RAM preview cache.

Normal playback/scrubbing then tries to consume those cached composites via
`engine.renderCachedFrame(time)` before doing a live render.

### User-Facing RAM Preview Is Disabled

`RAM_PREVIEW_FEATURE_ENABLED` is currently `false`. The feature gate returns
effective RAM preview values as disabled/null and cancels or clears ordinary RAM
preview state unless an active video-bake cache exists.

`TimelineControls` does not expose a RAM Preview button. The remaining
`useAutoFeatures()` RAM-preview idle-start path receives the gated
`effectiveRamPreviewEnabled`, so it cannot start from normal UI state.

Conclusion: RAM preview is effectively not a normal user-facing playback mode
anymore.

### RAM Preview Is Still Reachable

It is not dead code:

- `videoBakeSlice.bakeClipVideoBakeRegion()` calls
  `startRamPreviewForRange()` directly for clip-scoped video bake regions.
- AI timeline-canvas RAM preview smokes call both direct `RamPreviewEngine` and
  `startRamPreviewForRange()` paths.
- `useEngine()` still attempts `engine.renderCachedFrame(currentPlayhead)` every
  render tick before live layer building.
- `useLayerSync()` still attempts cached-frame rendering while paused/scrubbing.

The video-bake exception explains why the feature gate preserves RAM preview
state while active bake regions exist. Composition-scoped video bake uses a
different `videoBakeProxyCache` artifact path; clip-scoped bake still relies on
the transient RAM preview cache.

### Main Risk

The RAM preview cache consumer is probably broken for the normal desktop preview
panel because `CachedFrameRenderer.renderCachedFrame()` requires the legacy
`previewContext`, while the normal preview panel registers a target canvas
instead of calling `engine.setPreviewCanvas()`.

That means RAM preview can still generate frames, and clip video bake can still
mark a range as baked, but the normal dock preview may not actually display the
cached composite frames. Mobile preview may behave differently because it uses
the `useEngine()` `canvasRef` as the legacy main preview canvas.

### Practical Read

There are not three fully independent playback renderers. There is one main
playback renderer, a proxy source/cache subsystem feeding it, and a RAM preview
composite-cache shortcut that can bypass it on cache hits.

RAM preview should either be retired from normal playback docs/UI and renamed
around clip video bake internals, or repaired and re-enabled intentionally. The
first repair should be the target-canvas cached-frame path, because without that
the remaining RAM preview use is suspect in the current desktop preview.
