---
title: "Browser 3D Scan"
---

The dockable **3D Scan** panel prepares photogrammetry sources, solves camera
motion, creates a fast sparse reconstruction preview, and can run
Gaussian-splat training locally through WebGPU on supported desktop GPUs. Open it from
`View -> Panels -> 3D Scan` or from a dock group's add-panel menu.

The panel has independent **Gaussian Splat** and **Camera Solve** workspaces
that share the same project-backed COLMAP dataset. The workflow separates four
stages:

1. Capture photos or extract frames from a video.
2. Solve camera poses locally or open a prepared COLMAP dataset.
3. Create a frame-aligned 3D camera track or reversible source stabilization.
4. Check the reconstruction with a rough Timeline preview, then train Gaussian
   splats on a supported browser GPU and add the result to Media.

## Sources

The panel follows the compact header, row density, empty-state, and status-bar
language of the Media Panel. Sources remain browser-local runtime objects and
are not written into durable project state.

- Add JPEG, PNG, WebP, AVIF, HEIC, or HEIF images with the picker or drag/drop.
- Drop a browser-decodable video or use **+ Video** to extract frames locally.
- Select a video clip in the Timeline and press **Timeline**. The source trim
  represented by the clip's in/out points is respected.
- Camera Solve exposes separate **Samples** and **Resolution** controls. Sample
  presets range from 24 fast samples through source-rate sampling capped at 240
  frames. Resolution presets range from a 512-pixel feature solve to full-source
  input capped at 8192 pixels.
- When source FPS is known, sample times and generated pose keyframes land on
  exact source/timeline frame boundaries. Lower sample presets interpolate
  between solved frames; Maximum uses every source frame until its cap.
- Duplicate and unsupported files are skipped. Images below 720p are retained
  with a warning; decoding failures are shown as errors.

Frame extraction uses a muted local `HTMLVideoElement`, waits for
`canplaythrough`, seeks each sample, and encodes through a temporary canvas.
No video or extracted photo is uploaded.

## Camera Solve and Poses

**Solve selected clip** samples the selected Timeline video, extracts ORB
features through OpenCV.js in a dedicated worker, matches overlapping views,
and reconstructs a sparse camera/point model locally. The OpenCV runtime is
loaded only for Camera Solve and occupies about 13.3 MiB uncompressed in the
browser cache. No source frames are uploaded.

Sampling and reconstruction are owned by a persistent background manager, so
switching panels or layouts does not cancel the job. A global progress pill
continues to show frame extraction, feature work, registered cameras, and
reconstruction progress and provides a Cancel action. The latest result is
saved as a COLMAP ZIP plus manifest under the project's cache artifacts and is
restored after layout changes or reloads.

The result actions are:

- **Add camera track** creates a Timeline camera clip with six pose curves.
  Positions and rotations receive robust trajectory smoothing to reject
  single-frame SfM spikes, while every generated key remains snapped to the
  composition/source FPS grid.
- **Stabilize timeline clip** adds reversible 2D position, roll, and crop
  keyframes to the solved source clip. Strength is adjustable and the entire
  operation is one undo step.
- **Use this solved COLMAP dataset for Gaussian Splat training** hands the same
  solved images, cameras, and points to the Gaussian Splat workspace without a
  second camera solve.

Prepared COLMAP data remains supported through **Dataset**, dataset ZIP
drop, or **Media ZIP** when an imported archive is available in Media.

The selected folder must contain:

```text
dataset/
├── images/
└── sparse/
    └── 0/                 # sparse/ directly is accepted too
        ├── cameras.bin    # .txt is also accepted
        ├── images.bin
        └── points3D.bin
```

The panel validates the image count and requires a complete binary or text
model. Folder handles and extracted ZIP files remain in panel-local runtime
state. Dataset ZIPs are extracted in memory and are capped at 512 MiB and
20,000 entries. Opening a folder requires a secure context and the browser's
File System Access directory picker; ZIP import remains available when the
directory picker is absent.

**Create rough preview on timeline** converts the registered COLMAP
`points3D` cloud into a colored binary PLY, imports it through the normal
Gaussian-splat media path, and places it on a new video track with a camera
when needed. This is an immediate framing and pose diagnostic, not a trained
Gaussian result: a sparse model with about 10,000 points will look much
rougher than a trained result containing hundreds of thousands of anisotropic
Gaussians.

## WebGPU Training

Training uses the Apache-2.0
[Brush](https://github.com/ArthurBrussee/brush) `brush-js` runtime at revision
`8b7f5c6c0638892204b540d9aced219f62fc2192`. The runtime is loaded only when
**Start GPU training** is pressed. It is not part of the initial editor
bundle.

The generated JavaScript and WASM occupy about 25.4 MiB in the browser cache
and compress to about 6.4 MiB for first-use transfer when the host serves
compressed static assets. Attribution, revision, and the bundled license live
under `public/wasm/brush/`.

Training requires WebGPU and the `subgroups` adapter feature. The status bar
shows the selected adapter and disables training when the capability is
missing. Brush training is currently also disabled on mobile and AMD browser
adapters because the present WebAssembly backend can trigger an unrecoverable
WebGPU/WASM failure that takes down the editor tab; rough preview and existing
splat import remain available on those devices.

| Preset | Iterations | Max input resolution | Frame cap | Splat cap | Scene cache |
|---|---:|---:|---:|---:|---:|
| Preview | 1,500 | 720 | 60 | 250,000 | 256 MiB |
| Mobile | 7,000 | 960 | 100 | 400,000 | 384 MiB |
| Balanced | 15,000 | 1440 | 240 | 2,000,000 | 1 GiB |
| Quality | 30,000 | 1920 | Unlimited | 6,000,000 | 1.5 GiB |

The panel reports iterations, splat count, registered views, PSNR, and Brush
warnings. A run can be paused, resumed, or cancelled. Pause applies
back-pressure by stopping the training stream instead of spinning work in the
background.

## Result Flow

The MasterSelects Brush build adds a host-only `Training.exportPly()` binding
to Brush's existing `brush_serde::splat_to_ply` exporter; the training
algorithm is unchanged. **Add splat to Media** exports the latest trained
splats to an in-memory PLY and sends that file through the normal Gaussian
splat import path. Imported results therefore use the existing native WebGPU
scene, timeline, transform, effector, preview, and export contracts described
in [3D Layers](/features/3d-layers/).

Existing `.ply`, `.compressed.ply`, `.splat`, `.ksplat`, `.spz`, `.sog`,
`.lcc`, and supported ZIP splats can also be added directly with
**Import splat**.

## Current Boundary

For a marker projected onto reconstructed ground, **Properties → Tracking** also
uses the browser camera solver with decoded frame timestamps and a sparse mesh.
That workflow keeps poses on the source surface and offers a geometry inspector;
it does not create a separate camera clip or run dense reconstruction. See
[Surface Tracking](/features/surface-tracking/#3d-camera-and-ground-mesh).

- Video-to-frames is browser-local and complete.
- Timeline-video feature matching, camera-pose solving, COLMAP persistence,
  camera-track creation, and stabilization are browser-local.
- Folder/ZIP COLMAP validation, sparse preview conversion, and supported-GPU
  Brush training are browser-local. The browser solver is an efficient sparse
  SfM implementation, not a full COLMAP bundle-adjustment replacement.
- Mobile can extract frames, validate ZIP datasets, create rough previews, and
  render imported splats. In-browser Brush training is currently gated off;
  the Mobile preset remains available for future compatible backends.

## Verification

- Unit coverage includes panel registration, source analysis, FPS-aligned frame
  sampling, camera geometry, trajectory filtering, Timeline output/undo,
  virtual ZIP directories, dataset archive extraction, sparse PLY conversion,
  and WebGPU feature negotiation.
- Live verification used a 10.2187-second Timeline video, a 31-view binary
  COLMAP model, and 9,965 registered sparse points. The generated PLY loaded
  through the native shared-scene renderer and remained visible after opening
  and closing the 3D Scan panel.
- A browser-solved 3.875-second, 24 fps Timeline clip produced a project-backed
  COLMAP result, a frame-aligned smoothed camera track, and a visible trained
  splat preview. Playback diagnostics confirmed that a temporary slowdown was
  stale HMR decoder/render state and cleared after rebuilding the browser
  runtime on reload.
