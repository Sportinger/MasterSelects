---
title: "Surface Tracking"
---

Surface Tracking attaches a colored marker to a textured, approximately flat
part of a video. It estimates a perspective transform in both directions from
a chosen source frame, reconstructs a short 3D camera sequence and sparse
ground mesh, or imports a dense reconstruction with future footprint sequences.
Author it under **Properties → Tracking** on a video clip.

The Tracking panel separates depth preview and baking, precise face tracking,
surface tracking, and clip linking into collapsible inspector sections. Actions,
status messages, numeric rows, and keyboard focus use the shared Properties
inspector styling.

## Reusable assets and ordinary clips

The current Tracking workspace uses project-owned assets shown in the Media panel's grid, list and board. Assets support naming, folders and context actions. Clips reference a shared asset; retained mesh data is stored once in linked project geometry files and survives save/load and undo.

On a source video, use **Track surface** for a planar solve, **Reconstruct 3D** for a short browser-local sparse solve, or import a dense `.msterrain.json` reconstruction. Set corners, reference/range and exclusion areas in the main Preview. Coverage indicators preserve gaps rather than implying a continuous solve.

On a normal text, shape, image or nested-composition clip, choose an asset and **Follow position** or **Project onto surface**. Place the attachment in Preview and adjust size, rotation and timing in Tracking. These modes attach composited visual clips; camera, light, model and audio clips are not projection targets. Source transforms and the displayed video's decoded frame time determine the projection in preview, nested compositions and export.

**Video / 3D** switches between the source and an orbitable geometry inspection view. The inspector uses bounded geometry and redraws on demand. **Create 3D scene** creates an ordinary imported model and animated camera clips. A lens with unequal focal scales, an offset principal point or radial distortion is explicitly offered as an approximate scene-camera conversion; direct video projection retains the reconstruction's calibration. Missing camera ranges stay separate. This creates a scene from existing data, not a new dense reconstruction.

The browser reconstruction remains a short sparse solve (8-180 source frames). Dense stone geometry still requires an external reconstruction/import. A mesh cannot fill terrain that was never reconstructed, and sparse points do not become measured dense stone heights.

The legacy per-surface marker controls described below remain available for existing projects.

## Workflow

1. Scrub to a clear frame and choose **+ Surface**.
2. Drag the four corners around one textured area. Keyboard users can focus a
   corner and use arrow keys; Shift increases the movement from 0.1% to 1%.
3. Choose **Save surface key**, **Track forward**, or **Track backward**.
4. Review the result by scrubbing. **First tracked frame** and **Last tracked
   frame** navigate to coverage boundaries. Tracking stops when the motion
   estimate becomes unreliable; correct the corners and resume from a clear frame.
5. Choose an outline, ellipse, or rejection cross under **Attached marker**.
   Color, opacity, fill, line width, inset, visibility bounds, and fades are editable.

Multiple surfaces can coexist on a clip. Cancelling a tracking pass keeps the
previous track. A pass processes at most 1,800 source-frame samples; continue
from its last frame for longer ranges. Locked tracks and active exports disable
editing. Source-frame navigation follows clip timing, and the tracking viewer
follows paused timeline scrubbing.

## Occlusion

Use **Occlusion corners** to outline a shoe or another obstruction and save an
occlusion key. Saved quadrilaterals interpolate between keys; **End occlusion
here** ends the exclusion. The region excludes feature matches and hides the
rendered marker underneath it. Occlusion is manually authored, not automatic
shoe detection. Rerun tracking after adding masks if earlier matches were contaminated.
Dense imports can additionally provide up to four foreground quadrilaterals per
camera frame. Those masks hold with the decoded frame and hide the projected
footprint and wireframe. Their accuracy depends on the external mask extraction;
quadrilaterals are approximate foreground bounds, not pixel-perfect rotoscoping.

## Timing and limits

The tracking viewer and analysis use an independent Mediabunny/WebCodecs decoder.
Each observation stores its decoded presentation timestamp and duration together
with the corners measured from that image. Previous/next source-frame navigation
uses the source packet index, including variable frame durations. Analysis pixels
are drawn to a software canvas with a maximum dimension of 1,280 pixels.

The marker holds its measured corners for that source frame; it does not
interpolate surface motion between frames. The compositor resolves the marker
after choosing the displayed texture, so a held video image keeps its own marker
even when the playhead advances. HTML preview captures a VideoFrame and its
`requestVideoFrameCallback` presentation timestamp together. WebCodecs frames
carry their own timestamps. Unknown frame identity, untracked gaps, and times
beyond coverage hide the overlay. Occlusion shapes still interpolate between
manually authored keys, but are evaluated at the displayed source frame's time.

Existing tracks without decoded durations remain readable using nominal frame
durations. The Tracking panel identifies these legacy estimates; rerun tracking
from a clear frame to replace them with decoded observations. This timing model
also supplies the decoded frame identity for the camera/mesh workflow below.

The planar mode produces a homography, not a 3D reconstruction or terrain mesh.
Large depth changes within one selection, motion blur, moving obstructions, and
loss of texture can cause drift or a stopped track. Confidence measures agreement
among surviving feature matches, not independently measured tracking accuracy.
Smaller selections on one surface generally better satisfy the model, provided
there is enough texture. No Mocha-equivalent accuracy claim is made.

## 3D camera and ground mesh

At a clear reference frame, select a surface and set **Source start/end** under
**3D camera & ground mesh**. The range must contain the reference frame and
8–180 decoded source frames. **Solve 3D camera + mesh** extracts every frame in
that range and runs the existing browser-local sparse SfM solver. Cancellation
or failure preserves the previous surface. Leaving the panel cancels the job.

Reliable camera poses retain their source PTS and duration without interpolation.
Missing poses hide the projection for that frame. The solver uses estimated
pinhole intrinsics, with frame extraction capped at 1280 pixels and feature
analysis at 960 pixels on the longest side. Reprojection fit measures agreement
with image observations, not independently verified geometry or metric accuracy.

The mesh connects supported points observed in the reference area, capped at
72 vertices and 128 triangles. Long edges and large depth jumps are rejected.
Unsupported regions remain holes and clip the marker; this is a sparse surface,
not dense multi-view stereo. Small rocks, occlusions, and uncertain lens
calibration can limit its accuracy. Scale is relative.

**Projection** switches between the existing planar track and **3D ground mesh**.
**Show mesh wireframe** reveals coverage. **Inspect 3D geometry** opens an orbitable
mesh and camera-path view with keyboard-accessible orbit/tilt sliders. The view
does not modify solved poses. Camera data is stored with the surface, not added
as a separate Timeline camera clip.

The marker uses a fixed reference-camera projector and perspective-correct
coordinates on each triangle, with nearest-surface visibility. Manual occlusion
keys still hide the overlay. The projector is not automatically aligned to a
gravity-defined overhead direction. Switch back to planar mode to author a new
reference area before solving again.

## Dense reconstruction and future footprints

Under **Dense reconstruction**, use **Import camera + mesh…** to load a
`.msterrain.json` file, or expand **Import from URL** for an HTTP(S) source.
The import contains camera poses, calibrated intrinsics (including optional
radial distortion), and indexed mesh geometry. Import validates the source
filename, camera timing, rigid rotations, mesh indices, and ground axes before
replacing the selected surface. Failed imports preserve the previous data.
The input size limit is 100 MB.

Dense solving and automatic shoe/contact extraction currently run externally;
the browser's **Solve 3D camera + mesh** button remains the short sparse solver.
The dense workflow was exercised with local COLMAP/OpenMVS reconstruction,
independent per-frame pose refinement, and externally reviewed shoe detections.
Importing a reconstruction does not launch or download those tools.

For a single marker, pause at the contact and choose **Trace footprint on this
frame**. Outline the shoe contact with 3–32 points. Rays intersect the observed
mesh to establish its location and relative size. Adjust its ground position,
width, length, and rotation; **Duplicate marker on this mesh** creates another
editable marker. **Hiking sole tread** adds a stylized tread clipped to the
contour. Choose an earlier visibility start to reveal the contact in advance.

An imported footprint sequence shares the camera track and can attach a local
ground patch to each step. **Show steps ahead (seconds)** sets a 0.1–10 second
lookahead, initially three seconds. Each footprint is visible before its contact
time, with the configured fade, and disappears at contact. Use **Footstep** to
select a contact and edit its position, shoe dimensions, rotation, contact time,
or tread. Changing contact time keeps the sequence ordered. Size uses relative
reconstruction units, not meters; inferred shoe contours and hidden heels are
estimates, and the tread is not a scan of the actual outsole.

The dense renderer rasterizes the real mesh with camera depth and a local
orthographic projector aligned to the patch axes. Projector depth selects the
upper surface along its local normal, so the decal follows reconstructed stone
heights. This direction is not independently calibrated gravity. Missing mesh
stays missing. Local patches keep multi-footprint rendering bounded to nearby
ground instead of drawing the entire terrain for every contact.

The version-1 `masterselects-terrain` JSON envelope includes `sourceName` and
`terrain`. Its terrain holds `intrinsics`, timestamped `cameras`, `denseMesh`,
and optional `footsteps` (up to 500). A footprint has a unique ID, name,
placement with normalized contour/contact time, and optional local mesh.
Camera `occluders` are normalized source-space quadrilaterals. Camera timestamps
and durations may differ by one microsecond due to independent rounding;
larger overlaps are rejected and missing frames are never interpolated.

## Rendering and persistence

Normalized source-space corners, source timestamps, styles, and occlusion keys
are stored on the clip as `planarTracks`. Project save/load, composition
serialization, history capture/restore, nested restoration, and clipboard
copy/paste preserve them, including optional terrain geometry, poses, and projection
settings. Runtime decoders, video frames, workers, and object URLs are not stored.
Tracks bind to the source media ID; replacing the source does not silently
transfer an existing track to different footage.

The internal `surface-overlay` GPU effect supplies the same marker to normal
preview and export, including nested composition evaluation. It is not listed
as a manually addable effect. The marker follows source-space timing through
trims and speed mapping. An independent analysis decoder avoids seeking the
editor's playback element.

The internal `terrain-overlay` effect follows the same frame-bound preview and
export path for mesh projection. Dense geometry and footprint sequences are
embedded in the project; the import URL is not needed after import. Immutable
mesh arrays are shared across undo snapshots, while editable placement data is
cloned. GPU buffers, textures, and other runtime handles remain outside stores.

Implementation:

- `src/services/planarTracking/`: geometry, timing, edits, video acquisition, and jobs.
- `public/workers/planar-tracking.worker.js`: bundled OpenCV ORB features,
  forward/backward Lucas–Kanade flow, and RANSAC homography fitting.
- `src/components/panels/properties/surfaceTracking/`: authoring UI.
- `src/effects/tracking/surfaceOverlay.*`: perspective marker and occlusion rendering.
- `src/effects/tracking/DenseTerrainPipeline.ts` and `denseTerrain.wgsl`: dense
  raster projection, local projector depth, tread, and per-frame foreground masks.
- `src/engine/render/surfaceVideoFrame.ts`: weakly owned HTML presentation snapshots,
  paused-frame retention, and callback lifecycle.

## Verification

Targeted checks: `node --test tests/unit/planarTrackingWorker.test.mjs` and
`npx vitest run tests/unit/planarTracking.test.ts tests/unit/surfaceVideoFrame.test.ts`.
The worker tests execute the
actual bundled OpenCV against known perspective motion and texture/occlusion
loss. Contract tests cover geometry, frame holding, variable durations, timestamp
rounding, snapshot ownership, occlusion interpolation, immutable updates,
the actual history capture/restore path, and nested effect/uniform parity.

A live portrait HEVC test produced 159 samples covering 0–5.267 seconds.
Preview scrubbing, occlusion, undo/redo, reload, and an original-resolution
2160×3840 HEVC MP4 export were checked. Reduced-resolution debug export showed
an existing crop problem with the overlay both enabled and disabled; reduced
resolution export parity remains unverified.

The decoded-frame follow-up was verified with the same source: captures at
4.010 and 4.020 seconds produced identical image hashes at displayed PTS
4.000033; the capture at 4.050 seconds moved to PTS 4.033378 and a different
image. Playback advanced through distinct presented timestamps, and the marker
remained after pausing. A six-frame original-resolution HEVC export contained
the overlay. The user verified the result live.

The first terrain pass on the same video registered 121/121 frames around
2–6 seconds and produced 57 vertices, 75 triangles, and 1.32px median fit.
Live playback reported 30 preview updates/s without stalls; wireframe toggle,
undo, the geometry inspector, and a six-frame 2160×3840 HEVC export were checked.
The user confirmed playback and noted the expected gaps in the sparse surface.
`npx vitest run tests/unit/terrainTracking.test.ts tests/unit/planarTracking.test.ts`
passed 15 tests, including nonplanar geometry, projective interpolation, missing
pose handling, serialization, and uniform packing. TypeScript also passed.

The dense whole-video test solved all 1,529 frames of a 50.97-second portrait
clip with approximately 0.33px median reprojection fit. Of 57 reviewed visible
contact candidates, 55 had reconstructed ground and were imported with local
patches; two early contacts and unseen contacts during a landscape pan were
omitted. Every retained outline ray intersected the reconstructed mesh.
Reprojection fit is not a measurement of true stone height or contact accuracy.

The saved project was inspected for all cameras, footprints, tread settings,
and foreground masks. Real browser playback reached the end of the clip.
A 2160×3840 HEVC export from 36.0–37.2 seconds produced an 18,273,090-byte MP4
without reported export errors; extracted frames were checked for projection
and foreground occlusion. The user confirmed the complete sequence live.
`npx vitest run tests/unit/denseTerrain.test.ts tests/unit/terrainTracking.test.ts`
passes 19 tests, including strict import validation, rounded camera timing,
nearest-surface ray picking, radial distortion, and immutable history ownership.

## Precise face tracking

The Tracking inspector also contains **Track face precisely**, its preview
control net, and **Stabilize face / lips**. These controls analyze the selected
video independently of surface reconstruction. The separate **Face Cables**
effect consumes that clip's precise result and supports iris-centered attachments.
See [face tracking and cables](/features/effects/#precise-face-control-net).
