# Browser 3D Scan

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
language of the Media Panel. The Gaussian Splat workspace retains source photos
in the open project immediately, before camera solving. Each completed video
frame is saved before extraction advances. Reloading or reopening that project
restores the source list automatically, including unfinished capture sets.
Original file bytes are required project artifacts under the logical
`RAW/scan-sources/` namespace, with `manifest.json` recording names, order, and
source timing. They are included in repository persistence rather than kept as
reproducible cache. Runtime Files and object URLs remain outside durable stores.
Without an open project, the panel explicitly reports that photos are memory-only.
Failed writes remain visible with a Retry action; they are never reported as saved.
Removing or clearing photos updates the saved list and retires only its generated
project copies, leaving original input media untouched.

- Add JPEG, PNG, WebP, AVIF, HEIC, or HEIF images with the picker or drag/drop.
- Drop a video or use **+ Video** to extract frames locally at original decoded
  resolution in Gaussian Splat (including portrait orientation). There is no
  1600-pixel source cap. The small list thumbnails do not change the saved images.
  Existing reduced images must be extracted again to recover original detail.
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
If the browser rejects the video or reports no image dimensions (including
audio-only playback of unsupported H.265), extraction uses the shared source
frame service with the existing HEVC native/WASM decoder fallback. This applies
to both scan workspaces. Container rotation is applied to extracted JPEGs, so
portrait phone recordings retain their orientation and aspect ratio. The fallback
keeps one source lease for the job, copies each borrowed frame before encoding,
and records its actual source timestamp for camera solving. Cancellation releases
the lease; decoding and encoding failures remain visible in the scan panel.
No video or extracted photo is uploaded. Camera matching still uses reduced
working images; Gaussian Splat training retains its separately selected training
resolution. Original extraction does not override those compute budgets.

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

Training shows its splat live on the timeline. The first training snapshot is
imported as `<dataset>-training.ply` and placed on a new track together with a
Training Camera at the first captured pose (text COLMAP datasets). About every
five seconds while the clip is in the active composition and the editor tab is
visible, a new snapshot replaces that clip's GPU scene in place: the clip, its
settings, and the scene camera stay untouched, so the normal Preview camera can
orbit, dolly, and keyframe while the splat improves. The previous scene stays
visible until the next one is parsed, and a load of the stale intermediate media
file can never overwrite a newer live scene. The panel reports the step shown on
the timeline and any failed update; training continues regardless.

On completion the final PLY enters Media as `<dataset>-trained.ply`. It is
uploaded before the live clip switches to it, and the intermediate
`-training.ply` item is removed when no other clip uses it. Deleting the live
media item stops placement for that job; **Show on timeline** brings it back,
also when only the clip was deleted. After a reload, a restored checkpoint
updates an existing `-training.ply` clip but never adds a clip by itself.
Binary COLMAP datasets are normalized from the fixed sparse point cloud, so
every snapshot, checkpoint, and final export of one run shares one transform.

Snapshots are serialized between training batches, including while paused, so
readback never borrows the WASM training instance concurrently with a training
step. Timeline update errors remain visible and do not cancel training.
Polling stops while the live clip is not shown; cancelling/resetting the job
releases the channel and transient snapshot. Project switches reset the job as
before. Only the first and the final snapshot become Media items; the live
updates in between are runtime-only and do not enter project history.

`BrushTimelineSplat` keeps job logic independent of editor stores. Its exact
`brushTimelineSplatRuntime` adapter supplies store access, while render requests
go through `renderHostPort` so they reach the selected render host.
Training checkpoints are saved as required `RAW/scan-training/` project data
about every 15 seconds, independently of the visible panel, and on pause and
completion. The manifest is published only after both the exact training dataset
and immutable PLY checkpoint exist. Save failures remain visible and offer Retry.
Reloading automatically restores a matching checkpoint as paused, or restores a
completed splat for preview/export. Changed source photos invalidate an older
checkpoint instead of silently continuing the wrong reconstruction.

**Resume** reloads the saved splats as Brush `init.ply` and continues at the saved
`start-iter`. Brush reinitializes its optimizer; this is model/iteration resume,
not a bit-exact optimizer/GPU-memory restore. Only steps after the last saved
checkpoint can be lost on an abrupt reload. **Add splat to Media** remains for
completed results without a live clip, including after reopening the project.

Completed Camera Solve datasets are also required RAW artifacts, automatically
rediscovered when the project opens. Legacy cache-only solves migrate on first
read. An unfinished camera solve remains a runtime job; reloading during that
stage requires solving again from the retained original photos.
Switching editor tabs, hiding Preview, or unmounting 3D Scan does not stop either
job. Reattaching the solved dataset to the panel preserves the training owner;
only an explicit dataset change/reset/cancel or project switch replaces it.
The live clip uses the editor's normal Gaussian renderer and retains only the
latest PLY; snapshot readback adds some training overhead.

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
in [3D Layers](./3D-Layers.md).

Existing `.ply`, `.compressed.ply`, `.splat`, `.ksplat`, `.spz`, `.sog`,
`.lcc`, and supported ZIP splats can also be added directly with
**Import splat**.

## Current Boundary

For a marker projected onto reconstructed ground, **Properties → Tracking** also
uses the browser camera solver with decoded frame timestamps and a sparse mesh.
That workflow keeps poses on the source surface and offers a geometry inspector;
it does not create a separate camera clip or run dense reconstruction. See
[Surface Tracking](./Surface-Tracking.md#3d-camera-and-ground-mesh).

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

### Trained scene framing

Adding a trained splat with readable camera poses also adds a Training Camera at the first captured pose. The scan uses the loader’s existing COLMAP-to-editor conversion without a second PLY orientation flip; existing camera clips are preserved. This matches the live training view’s geometry and lens. A different composition aspect ratio reveals a wider or narrower field of view; it does not rescale the model axes. The 500-step draft preset samples every fourth image and is explicitly labeled as a draft, with limited detail and unreliable views outside the captured camera path.

Camera solving now validates every extension of a 3D feature track against its projected image position. Features cannot be reassigned between points, and a point cannot own multiple features in the same view. Conflicting COLMAP tracks fail explicitly instead of entering training. Results created by the older unchecked track propagation need a new solve and training run; continuing their learned splats cannot repair the underlying geometry.
