# Native OptiX preview and comparison

Optional Windows NVIDIA worker for the development editor's **OptiX** preview and **OptiX test** button.
It renders a captured fiber scene with OptiX RTX BVH traversal and CUDA round-cone
intersection/shading. It does not make CUDA or OptiX available inside WebGPU.

## Build and run

Requires the NVIDIA driver, CUDA Toolkit 12.8 or newer, Visual Studio C++ Build
Tools, Rust, and NVIDIA's [OptiX 9.1 headers](https://github.com/NVIDIA/optix-dev/tree/v9.1.0).
The tested SDK revision is `f1f6dd803f3159992d248178f6e09421c6eb8b6d`.
Keep the SDK outside this repository; no NVIDIA headers or binaries are vendored.

```powershell
git clone --branch v9.1.0 --depth 1 https://github.com/NVIDIA/optix-dev.git "$env:TEMP/masterselects-optix-sdk-9.1"
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_INCREMENTAL = '0'
cargo build --manifest-path tools/native-helper/Cargo.toml
powershell -ExecutionPolicy Bypass -File tools/native-helper/optix/build.ps1
tools/native-helper/target/debug/masterselects-helper.exe --console --allowed-origins http://localhost:5177
```

Use `-OptixSdk` for another headers location and `-OutputDirectory` for a custom
Cargo target directory. The helper, `masterselects-optix.exe`, and
`masterselects-optix.ptx` must be siblings. Authentication and origin checks remain
enabled. Do not run a second helper on an occupied port.

Pause a path-traced fiber composition in the development editor and wait for still
accumulation. **OptiX test** renders one sample with each backend; **Compare 4
samples** and **Compare 16 samples** repeat at those sample counts. Both results use linear radiance, matching exposure,
the same Sobol/Owen sequence, hair BSDF, virtual lights, bounces and camera.
The GPU timings exclude desktop pauses; process initialization, AS build and scene
transfer are reported separately. The existing WebGPU BVH is reused. These are
renderer measurements, not production export or total workflow speed comparisons.

The native worker supports world-space fibers, per-point appearance, flyaways,
thin-lens depth of field, sphere/panel/distant lights and constant environments.
Other geometry, textured environments and oversized snapshots fail explicitly.
Maximum: 1920×1080, 64 samples, 16 bounces, 16 million segments, 1 GiB snapshot;
the worker stops after 110 seconds and the helper kills a stalled process after
120 seconds. One native render can run at a time. Temporary files are deleted on
discard/disconnect. The still comparison uses a separate one-shot process with no
persistent scene cache. Native denoising, motion blur and export integration are not implemented.

## Persistent preview

With **Path Traced** selected, switch the preview backend from **WebGPU** to **OptiX**.
Rebuild both the Rust helper and CUDA/OptiX worker for this protocol version and reload
the editor. Set `--allowed-origins` to the actual worktree server origin.

The preview keeps its process, CUDA pipeline, fibers and OptiX GAS resident. Camera
changes use a fixed 416-byte packet; scene edits upload a snapshot, with OptiX refit
when the primitive count stays unchanged. Short center-first tile batches accumulate
progressively. Moving views reduce resolution; still views use the selected preview
scale, capped at 1920 × 1080. GPU work yields between batches. Pending new views show
the raster renderer until a matching native frame arrives. Unsupported input and
helper errors fall back to WebGPU with a status reason.

One preview process is allowed globally; GPU submissions are serialized with still
comparison jobs. `preview-open/load/frame/close` retain connection ownership. Only
helper-generated job directories reach the worker's `--preview` mode; commands use
stdin and bounded responses use stdout. Image output is premultiplied linear RGBA32F
followed by float32 depth, served through the existing authenticated HTTP transport.
Alpha -1 marks an unsampled tile so the browser retains the previous image there.
An individual frame call requests 1–4 additional samples, but stops between tiles
after an 8 ms GPU / 20 ms wall-time budget. Up to 65,536 samples accumulate per view.
This is a budget target, not a guarantee on the duration of one GPU launch.

This implementation is limited to the main-thread development renderer, supported
fiber scenes and constant environments. HDRIs, other path-traced primitive types,
render regions, debug views and more than 16 bounces use WebGPU. Native denoising and
zero-copy GPU texture sharing are not implemented. Native video export is separate
work. Runtime verification of this preview integration is pending.

## Verification

Run `python tools/native-helper/optix/check.py <worker.exe> <artifact-directory>`
for native GPU smoke checks (material/page offsets, hidden fibers, deterministic
lighting, transparency and malformed input). Open
`/tests/browser/pathtrace-native-check.html` in the development server for analytic
thin-fiber intersection checks and WebGPU/OptiX comparisons of coarse and dense
node-generated fibers at 16 or 64 samples. The helper must allow that server origin.
Both backends use a local ray origin for the fiber quadratic to avoid cancellation
at camera distance. They are not bit-identical: rounding can change subsequent
Monte Carlo paths. Coverage and mean luminance must match within the test's bounds;
the image error should fall as samples increase.

## Transport

`optix` commands: `status`, `begin`, `render`, `discard`. Begin returns a random
connection-owned job ID and upload path; render accepts only that ID and a sample
count, never an executable or arbitrary input/output paths. Upload uses the
existing authenticated binary endpoint. Result is a premultiplied linear
RGBA32F image plus measured JSON timings.

Snapshot v1: 16 little-endian uint32 header words (`MSPX`, version, then byte
lengths for frame/lights/materials/instances/fiber-page-0/fiber-page-1, followed by
eight zeros). The six payloads follow in order. Their layouts mirror the
path tracer's 416/64/80/128/48-byte records. No BVH or runtime handles cross the
boundary: OptiX builds its own acceleration structure from visible fibers.
