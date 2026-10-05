---
title: "Path Tracing"
---

The shared 3D scene can render with a **path tracer** instead of the raster. It is
built for Weave fibers: every fiber of a yarn is a round-cone segment the rays hit,
shaded with a hair BSDF, so yarn gets soft multiple scattering, real shadows and
light passing through it. Meshes, primitives, planes, voxel reliefs and Flock points
are path traced with it; HDR color and tone mapping are shared with the raster.

## Using it

| Where | What |
|---|---|
| Preview toolbar | **Raster / Path Traced** toggle and render scale **½ ⅔ 1** of the active composition; with Path Traced also the quality preset (**Draft** 64 samples / 4 bounces, **Standard** 256 / 8, **High** 1024 / 12), **Region** (drag a rectangle over the preview; only it is refined, the rest keeps the realtime image; Esc cancels, a click without dragging or the button clears it) and a status chip (samples, Realtime, Denoising, Done; red **Raster fallback** with the reason as tooltip) |
| 3D camera → Physical Camera | Exposure (EV), tone mapping (Auto, Standard, AgX, ACES, Neutral), f-stop and focus distance (depth of field), shutter angle (motion blur in export) |
| Export → Render Quality | Engine override, raster sub-samples, path traced samples per pixel, adaptive threshold, time limit per frame, denoise |
| Nodes | **Fiber Material** (wool, cotton, silk, synthetic, hair presets; color, melanin, roughness, cuticle tilt, coat, fuzz, matte, field inputs per point), **Strand Render** subdivision, **material.surface** roughness, metallic and emission |

Tone mapping **Auto** means Standard for raster and AgX for path traced. Standard at
0 EV equals the old raster look exactly.

## How the preview behaves

- **While the camera, the scene or the timeline moves**, the realtime path renders
  one sample per pixel, reducing its internal resolution below the selected render
  scale when the measured tracing cost exceeds the 12 ms preview budget: ReSTIR direct light, indirect light that
  ends in a radiance cache from its second bounce, a fiber-aware SVGF denoiser and a
  temporal upscaler to the output size.
- **When everything holds still**, unbiased samples accumulate at the selected
  render scale. Expensive samples are split across submissions into small tiles,
  starting at the image center and spreading outward (or the center of a render region),
  instead of forcing a whole image into one frame. The preview waits for GPU
  completion, then leaves an idle gap of a quarter of the submission's elapsed
  time (at least 4 ms) before continuing.
  It reuses the presented image during that interval. The realtime history warms
  alongside accumulation only when both fit the budget. Each sampled tile is shown
  immediately; unsampled pixels retain the realtime image. The status includes
  fractional progress through the next sample, so a costly first sample does not
  appear stuck at zero. OIDN runs at 16 samples and at the final target. Choose **Draft**
  to finish sooner. These are measured scheduling budgets, not a guarantee of any
  individual shader's execution time on an unfamiliar scene or GPU.
- Unchanged planes reuse their acceleration structure, so they do not repeatedly
  restart a still image. Switching back to **Raster** cancels preview wakeups and
  pending denoising; a batch already submitted to the GPU still has to finish.
- Fibers thin out with a hashed share per yarn while the view moves (preview level
  of detail); a still image and the export always use all fibers.
- Voxel reliefs (boxes, sphere blocks), Flock points (spheres) and planes are path
  traced. FaceCables and Flock lines, meshes and glyphs stay rasterized over the
  path traced image with correct depth.
- Planes show their texture unlit, like the raster, which in the path tracer means
  they emit it. A `material.surface` roughness or metallic turns a plane into a lit
  surface.
- A scene beyond the device limits (two storage buffers of segments or nodes, 512
  materials) falls back to raster with a visible reason in the status.

## Render hosts

The path tracer runs wherever the 3D scene renders: on the main thread (default render
host) or inside the GPU worker (`worker-gpu-only`). In the worker, each presented frame
reports the path tracer's status and whether it wants another frame (a still image still
converging, a finished denoise); the main thread then schedules the next frame, so the
toolbar chip and the still image behave the same in both hosts. Export of a `worker-gpu-only`
session renders on the main thread with the full export quality.

## Export

Export renders each frame until it is complete: the sample target, or every pixel
below the adaptive threshold (after 16 samples), or the time limit per frame; then
OIDN ("standard" model) if denoise is on. Samples are added in fixed batches of 4
with a frame-independent scramble seed, so the same frame renders bit-identically.
An open camera shutter splits the frame into 8 time slices: the exporter builds the
layers at each slice time and the scene is refit per slice. Raster export can render
N jittered sub-samples per frame (antialiasing, and motion blur with an open
shutter). Export progress has a second level: samples → denoise → encode, with the
remaining time.

## Measurements (NVIDIA Blackwell laptop GPU, 1080p output, GPU shared with another renderer)

| Case | Result | Target |
|---|---|---|
| Knit Form, camera moving, scale 0.5 | 29–35 fps | ≥ 30 fps |
| Knit Form, camera moving, scale 0.67 | 17–21 fps | ≥ 20 fps |
| Animated yarn (layer turning every frame), Knit Form, scale 0.5 | 27 fps on the check page, 12–15 fps in editor playback | ≥ 20 fps |
| Still image | clean after about 1 s (realtime warm-up), first OIDN after 2–5 s | visibly converged ≤ 2 s |
| Export frame, 256 spp + OIDN, Knit Form | about 230–480 ns per pixel sample, so about 2–4 min per 1080p frame | ≤ 20 s |

The reference scenes, the realtime flight and the export determinism check run on
the browser pages `tests/browser/pathtrace-check.html`, `pathtrace-realtime-check.html`
(`?scenes=…&scales=…&animate=1&still=0`) and `pathtrace-export-check.html`.

## Architecture

This renderer uses WebGPU compute shaders and a custom BVH traversal. It does not
call CUDA or OptiX and has no hardware ray-tracing backend. Using NVIDIA's OptiX
would require a separate native renderer outside the browser.

All code lives in `src/engine/native3d/pathtrace/`:

| Folder | Content |
|---|---|
| `contracts/` | Record layouts (TS and WGSL mirror, checked by a unit test), bind group layouts, fixed WGSL interfaces (`pt_trace_closest`, `pt_trace_transmittance`, `pt_bsdf_*`, `pt_sample_light`, `pt_cache_*`) |
| `bvh/` | GPU LBVH (Morton codes, radix sort, Karras hierarchy, bottom-up bounds, refit with SAH-based rebuild), packing into traversal nodes with both child boxes, two-level traversal with any-hit shadow rays |
| `scene/` | Fiber emission from the shared strand geometry, voxel emission, object pool, materials, texture atlas, paged node and fiber buffers, TLAS over all instances |
| `materials/` | Chiang 2016 hair BSDF with matte, coat and fuzz terms; GGX with VNDF sampling for surfaces |
| `lights/` | Sphere, rect, environment (HDRI with alias table) and distant lights, power-weighted selection, MIS |
| `integrator/` | Reference megakernel (still and export), realtime integrator, resolve into the scene target |
| `restir/`, `cache/` | ReSTIR DI reservoirs and reuse; SHaRC hash grid cache and resolve |
| `denoise/` | OIDN (oidn-web, MIT; weights Apache-2.0 in `public/oidn/`), SVGF temporal pass and à-trous filter, temporal upscaler |
| `runtime/` | `PathTraceRuntime` (modes, budgets, still/realtime/export), realtime renderer, dispatch budget, stage profiler, status |

Rules the runtime keeps:

- **No dispatch may run long.** Work runs in small tiles for a partial still preview
  and horizontal bands for whole-image batches, one compute pass
  each, sized from measured GPU time (timestamp queries) to about 6 ms. Planning
  never assumes less than 100 ns per pixel sample and never puts more than 2¹⁸ pixel
  samples into one dispatch: a long dispatch makes Windows reset the GPU, and Chrome
  then blocks WebGPU until it is restarted.
- **No preview backlog.** At most one scene submission is in flight per runtime.
  Still samples count as complete only after every pixel has been sampled. Export
  retains its fixed full-image batches and resolution; preview throttling does
  not change export sampling. The worker reports pending demand while waiting
  for GPU completion or an idle timer.
- **No NaN or infinite value leaves a pass.** Path samples, ReSTIR weights, SVGF
  histories, the upscaler and the OIDN input drop them; a single bad value would
  otherwise spread through denoisers and temporal histories.
- Rays with NaN or infinite components are rejected before traversal, and every
  trace stops after 1024 node visits.

## Debugging

### Optional native OptiX comparison (development only)

The **OptiX test** preview button captures a paused fiber scene and compares one
sample with the optional native helper worker; the result offers four- and 16-sample
comparison. The WebGPU preview pauses while both backends run. Both images use
the same geometry, camera, hair BSDF, lights, bounce limit and sample sequence,
without denoising. Linear RGB error and coverage error are shown alongside GPU
render time, wall time, native initialization, acceleration-structure build and
browser transfer time. WebGPU reuses its existing preview BVH.

Both backends shift each fiber intersection into a ray origin near that segment
before evaluating its quadratic, preserving thin fibers that lost precision at
camera distance. Floating-point differences can still change later sampled paths;
the images are not bit-identical. The browser check at
`tests/browser/pathtrace-native-check.html` tests analytic near/far fiber hits,
coarse fibers and dense knitted fibers at 16 or 64 samples, including coverage,
mean luminance and linear RGB error.

This is a still-render prototype, separate from the preview/export engine selector.
The worker uses OptiX RTX BVH traversal and CUDA custom round-cone intersection
and shading; WebGPU itself does not call CUDA or OptiX. Supported inputs are
world-space fibers and sphere, panel, distant and constant-environment lights.
Other geometry and HDR environment maps fail explicitly. Jobs have bounded
sample counts, memory and runtime, with one native render at a time and short
GPU submissions. Setup and protocol: native worker README.

### WebGPU diagnostics

- Debug views (console): `setPtDebugView('albedo' | 'normal' | 'depth' | 'bvh-heatmap')`
  from `runtime/PathTraceRuntime.ts`.
- `window.__PT_PROFILE__.set(true)`, then `__PT_PROFILE__.get()`: GPU milliseconds of
  the scene build, integrator, ReSTIR, cache resolve and denoiser of a recent frame.
- `getPtStatus('main')` (`runtime/ptStatus.ts`): engine, state, samples, render size,
  segments, BVH nodes, GPU bytes, measured nanoseconds per pixel sample.
- `tests/browser/pathtrace-preview-scheduling-check.html` checks static-plane
  convergence, center-first sample coverage and immediate visibility, invalidation and agreement with export
  batches on an actual WebGPU device. Scheduler and budget regressions are covered
  by `tests/unit/pathtracePreviewScheduling.test.ts`.
