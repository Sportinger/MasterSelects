# SuperSplat Parity Plan for Native 3D Splats

Date: 2026-04-24
Branch: `native-3d`
Reference clone: `.codex-ref/supersplat`
Reference commit: `035d599` (`Improve mouse wheel vs trackpad classification for camera controls (#871)`)

## Goal

Make MasterSelects splats look and perform close to PlayCanvas SuperSplat while still fitting the MasterSelects timeline/compositor architecture:

- One shared 3D scene containing splats, 3D planes, 3D text, models, primitives, and future point clouds.
- One shared scene camera.
- Predictable preview/export parity.
- No permanent second render engine or canvas-copy path for the main compositor.

## Current Findings

### MasterSelects

- `NativeSceneRenderer` already has the right high-level shape: opaque geometry writes shared depth, splats depth-test against it, transparent geometry renders after.
- Splats currently render through `GaussianSplatGpuRenderer.renderToTexture()` per splat layer, then `NativeSceneRenderer` composites those splat textures back into the scene.
- The splat data path is a simple 14-float storage buffer: position, scale, quaternion, RGB, opacity.
- PLY loading detects SH data but the renderer does not use SH coefficients.
- Sorting uses the custom WebGPU `SplatSortPass` bitonic sort and only sorts above `SORT_THRESHOLD`.
- Realtime sorting depends on validated cull readback, so unsorted or stale-order frames are possible.
- The splat shader is custom and differs materially from PlayCanvas/SuperSplat in covariance projection, support radius, alpha clipping, antialiasing, SH color, and tonemapping.
- Mesh/text/plane rendering works, but creates per-object uniform buffers and bind groups every frame.

### SuperSplat / PlayCanvas

- SuperSplat delegates actual splat rendering to `playcanvas` `GSplatResource` / `GSplatInstance`.
- File loading goes through `@playcanvas/splat-transform`, which supports more production splat formats and applies Morton ordering for render locality.
- PlayCanvas packs data into GPU textures/streams rather than one large uncompressed storage buffer.
- Sorting runs in a Worker using center/chunk data and bucket/counting-style ordering, then uploads only the order buffer.
- Sorting transforms the camera into splat-local space instead of transforming every splat center by the world matrix each frame.
- The shader path uses PlayCanvas GSplat chunks: robust covariance projection, alpha-dependent quad clipping, normalized Gaussian falloff, premultiplied alpha, optional dither/depth-write mode, SH bands, and output color preparation.
- SuperSplat renders splats as scene entities in a dedicated splat layer with custom object-level transparent sorting.

## Direction

Do not embed the PlayCanvas renderer as the production timeline renderer yet. A second engine/device/canvas would fight MasterSelects' existing WebGPU compositor and likely reintroduce canvas-copy performance costs.

Instead, port the proven pieces:

1. Use `@playcanvas/splat-transform` for import normalization and format coverage.
2. Port PlayCanvas/SuperSplat sorting strategy into a MasterSelects worker-backed order buffer.
3. Port PlayCanvas GSplat shader math into the existing WebGPU splat pass.
4. Render splats directly into the shared native scene color/depth targets when possible.
5. Keep an escape hatch for per-layer compositor features only where direct scene rendering cannot preserve semantics.

## Implementation Plan

### Phase 0: Baseline and Repro Assets

- Pick 3 reference assets: one small PLY, one large PLY, one SH-heavy/compressed asset.
- Open each in SuperSplat and record frame time, sort time, visual screenshot, memory footprint, and camera pose.
- Open the same assets in MasterSelects and record the same metrics via existing stats/log tools.
- Add a small debug readout for splat path state: loaded format, splat count, SH degree, sort mode, sort time, draw count, direct-scene vs offscreen path.

Acceptance:

- We can reproduce "terrible and slow" with measurable screenshots and timings before changing renderer code.

### Phase 1: Loader Parity

- Add `@playcanvas/splat-transform` as the splat import backend.
- Convert its `DataTable` output into the current internal splat asset model first, then later into packed GPU streams.
- Apply Morton ordering for normal PLY imports.
- Support at least `.ply`, `.compressed.ply`, `.splat`, `.spz`, and `.sog` if the package exposes them cleanly.
- Preserve SH coefficients as first-class runtime data instead of parsing and dropping them.
- Keep existing `.ply` / `.splat` loaders as fallback until parity tests pass.

Acceptance:

- The same asset count, bounds, orientation, opacity, scale activation, and SH degree are reported in MasterSelects and SuperSplat.

### Phase 2: SuperSplat-Style Sorter

- Replace realtime WebGPU bitonic sort with a worker-backed sorter modeled after PlayCanvas `GSplatSorter`.
- Store immutable local-space centers and chunk bounds per splat resource.
- On camera/object transform changes, transform the camera into splat-local space and sort centers in local space.
- Upload the returned order buffer to the GPU.
- Sort all splat counts, not only scenes above 50k; small unsorted scenes are visibly wrong too.
- Keep GPU bitonic sort only as an optional precise/export fallback if it proves better for deterministic export.
- Remove realtime dependence on async visible-count readback.

Acceptance:

- Camera motion does not cause long GPU dispatch storms.
- Splats are sorted from the first visible frame.
- Sorting cost scales closer to SuperSplat than the current bitonic path.

### Phase 3: Shader Visual Parity

- Port PlayCanvas WGSL covariance projection and corner generation into `gaussianSplat.wgsl`.
- Replace the current conic/radius fragment path with the PlayCanvas normalized Gaussian UV path.
- Add alpha-dependent `clipCorner` behavior to reduce over-large quads.
- Add antialiasing factor support from the PlayCanvas covariance path.
- Add SH evaluation for loaded SH bands.
- Match premultiplied alpha behavior and optional dither mode.
- Add color controls later: tint, temperature, saturation, brightness, black/white point, transparency.

Acceptance:

- Same camera pose and asset produces close visual parity against SuperSplat before any MasterSelects-specific effects are enabled.

### Phase 4: Direct Shared-Scene Splat Rendering

- Stop rendering every splat layer to a temporary offscreen texture for the common path.
- Render splats directly into the native scene color target after opaque geometry and before transparent geometry.
- Keep shared depth testing enabled and depth writes disabled by default.
- Apply per-splat-layer opacity in the splat shader uniforms.
- Sort splat objects by SuperSplat-style far-AABB distance before drawing each object's internally sorted splats.
- Keep per-layer offscreen rendering only for features that truly need compositor isolation, such as masks or non-normal blend modes.

Acceptance:

- One splat plus one 3D plane/text object renders correctly with shared depth.
- Multiple splat objects do not pay one full render target and fullscreen composite each.
- Common path has fewer passes and fewer transient textures.

### Phase 5: Packed GPU Streams and LOD

- Move from 14-float storage buffers to packed splat streams inspired by `GSplatResource`.
- Pack color, transform A/B, and SH streams separately.
- Add SOG/LOD import support as the primary path for very large scenes.
- Add an explicit max-splats / LOD budget control that maps to real loading or drawing cost, not only a draw-count clamp.

Acceptance:

- Large scenes reduce GPU memory and upload time.
- LOD-heavy assets remain interactive in preview.

### Phase 6: Native 3D Scene Cleanup

- Replace per-frame uniform buffer creation in mesh/plane/text passes with reusable per-frame ring buffers or persistent per-layer buffers.
- Cache bind groups where source textures and uniform buffers are stable.
- Upload video plane textures only when the backing frame changes where possible.
- Add object bounds for culling/sorting across planes, text, meshes, and splats.

Acceptance:

- Mixed scenes with splats, planes, text, and models do not allocate many GPU buffers per frame.

## Risks

- Porting PlayCanvas shader chunks directly may conflict with MasterSelects' current matrix conventions. The first port should use screenshot parity tests, not eyeballing.
- A direct scene splat path may bypass existing compositor masks/effects. Keep offscreen fallback until feature parity is explicit.
- Global sorting across multiple splat objects is expensive. Start with SuperSplat's object-level transparent sort plus per-object internal sort.
- SOG/LOD support may require more than `@playcanvas/splat-transform` if runtime streaming is needed.

## First Engineering Slice

1. Add `@playcanvas/splat-transform`.
2. Implement a new loader adapter behind a feature flag or internal option.
3. Add Morton reorder and SH preservation.
4. Add a SuperSplat-style worker sorter for the existing 14-float buffer path.
5. Change sorting to run for all splat counts and remove the readback-gated first-frame behavior.
6. Build a screenshot/perf comparison with one known PLY before touching the shader.

