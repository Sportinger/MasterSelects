---
title: "Slit Scan 3D"
---

Slit Scan's **3D geometry** inspector selects the existing 2D image, a reference
time surface, a motion-deformed surface, or a free motion band. New Slit Scan effects
start with Motion-deformed surface and the `history` base sampler; existing effects
retain their saved representation. Selecting a 3D representation enables the clip's
shared scene participation.

The base time sampler is an explicitly saved graph node identity. RGB offsets
remain color operations: geometry follows the selected base query. A missing
sampler reports an error instead of choosing a different node. The reference
projection, schema version, mesh quality and depth controls are ordinary effect
parameters and travel with project serialization. GPU objects remain runtime-only.

## Time surface

The image is carried by a two-sided, unlit triangle grid. Each vertex moves along
its fixed reference ray. The fragment shader projects its local position back
into the reference image; vertex UV interpolation alone would distort triangles
with unequal depths. The reference is fixed in object space. Orbiting and moving
the scene camera do not redefine it.

The **Reference view** button temporarily aligns the preview with that reference.
Navigating the scene camera releases this preview override, so orbit, pan and
dolly immediately show the surface from the new camera position.
The geometry inspector shows active preparation and DIS progress in large red text;
completed status returns to small gray text. Explanatory paragraphs below the
controls are omitted.

Inspector drag input is coalesced to the latest value per animation frame;
release flushes the final value before ending the undo batch. Numeric typing,
keyboard steps and resets remain immediate. Full parameter snapshots from
effect controls write only changed fields, preserving unrelated animation.

Time depth is signed and follows requested continuous source age, including trim,
reverse, source overrides and speed changes. It is not normalized to each frame's
minimum and maximum. A Float32 table with 8192 intervals evaluates the existing
temporal mapping; interpolation between table entries approximates nonlinear
speed ramps. Color retains the temporal sampler's own discrete PTS/interpolation
semantics. Float fields have no display color transform or tone mapping.

**Depth time source → Sampled source frames** instead uses the selected sampler's
resolved source PTS and blend weights. Nearest selection, its halfway tie, delay
clamping and both stages of temporal interpolation match color sampling. Relative
ages are subtracted before Float32 conversion. Current input remains an explicit
zero-age reference; its decoded PTS is not guessed. Blended pixels use weighted
age as the geometry rule, not a claim that they contain one source instant.
This mode skips the continuous-time lookup and needs no DIS when Flow depth is
zero. The old continuous mode remains the default. Missing source metadata reports
an error instead of silently substituting requested time.

This constructs a time relief directly from the numerical sampling field; a test
grid is unnecessary. It does not recover moving-object deformation or physical
scene depth. The numeric field covers the image, while the finite triangle grid
approximates its shape and can bridge narrow time steps. RGB time offsets, image
mix and image smoothing remain color operations rather than extra geometry inputs.

Flow depth uses DIS at the base query's UV and delay. Logarithmic stretch is
bounded, confidence-weighted and rejected at folds. The first implementation
accepts image-aligned coordinates for flow deformation; other coordinates retain
the time surface. Geometry smoothing is independent of image smoothing and avoids
large delay changes, invalid motion and strong motion boundaries.

## Motion-deformed surface

**Motion-deformed surface** transports every image-grid point from its sampled
source time to the current source time using independently measured forward and
backward DIS correspondences. Unlike the line-seeded band, zero motion preserves
the full image rectangle. Spatially varying motion changes the grid's spacing,
shear and orientation; changing motion changes its shape over time. A constant
motion field and constant scan can still produce a constant shape.

**Motion deformation** scales lateral displacement (0 = undeformed XY, 1 = measured
transport, 2 = exaggerated). Time depth remains the Z rule. This is a designed
space-time surface, not recovered physical depth. It supports arbitrary scan
angles and delay profiles with image-aligned UVs. A blended source time uses the
chosen age rule; it does not track separate geometries for each blended image.

Trajectory source requests include all intermediate indexed PTS and the next
endpoint for fractional source times. Subframe motion assumes constant velocity
within a measured pair. Integration stops after 512 pairs per vertex; missing
intervals, weak confidence, occlusion and image exits invalidate point tracks.
**Untracked regions** defaults to **Keep time surface**: those vertices retain
their original XY rather than an invented correspondence. **Leave gaps** instead
omits cells touching lost tracks, useful for checking tracking coverage. The
fallback can reduce apparent motion where tracking is weak. Large windows cost
analysis time and increase tracking failures. Completed pairs reuse the project cache.
DIS progress is displayed inside the geometry section. The 3D bypass retains the
selected representation and stops pending geometry analysis.
Changing Delay or Time factor replaces a pending analysis window; advancing the
playhead alone does not repeatedly cancel it. Until the first geometry is ready,
preview shows the flat image instead of an empty scene. Export continues to wait
for complete geometry.

## Free motion band (line seed)

The experimental band is for cardinal, linear scans without an external time-map
mix. Its seed is a line through the image center, transverse to the scan direction.
The band carries the finished Slit Scan image, not another history of source colors.
There is no reference-image equality promise for this representation.

Trajectories use actual adjacent source PTS pairs. Both independently measured DIS
directions are retained. A backward correspondence is not approximated by negating
a forward vector at the same image point. Each seed has a deterministic grid
identity; integration is capped at 512 pairs per time direction. Low confidence,
missing correspondence or image exit terminates a segment. Cells touching a lost
vertex are omitted rather than bridged.

Self-overlap uses depth with an explicit alpha cutout: pixels below 50% alpha are
discarded and surviving source pixels are opaque before clip opacity. This does
not implement order-independent translucent self-overlap. The back face carries
the same image and is not a reconstruction of an object's hidden side.

## Scene and export

The **3D geometry** switch appears at the top of the Slit Scan inspector.
Bypassing restores both the 2D representation and the clip's 2D layer mode,
including clips that were already 3D before the effect was enabled. It remembers the selected 3D mode
and its settings. Pending geometry analysis stops after its submitted GPU pair;
turning off both scan smoothing and its diagnostic also stops pending smoothing
analysis. Completed disk fields remain reusable.

Effects through Slit Scan are evaluated in image space exactly once. The native
scene mesh then projects that image; subsequent effects retain their scene-output
position. Each surface processes its own projected image, including scenes with
multiple visual layers. Its original mesh depth is retained for scene occlusion;
new pixels generated outside the mesh by effects such as blur occupy the far
plane. Clip opacity is applied once after these effects. The effect's red
smoothing diagnostic is excluded from mesh color.

**Return to Slit Scan reference view** changes the preview camera only. Use the
existing scene-camera controls to save an export view. Source-history preparation
and required DIS work participate in the existing export barrier. A pending Hybrid
image is not paired with a new geometry field. Export errors are propagated.

Mesh quality is separate from image resolution and DIS resolution. The default is
256 columns; 128, 512, 1024 and 2048 columns are also available. Rows follow the
image aspect ratio up to 512. Numeric field memory is reserved from the
selected history budget. Bidirectional bands reduce their raw analysis allocation
to keep the two flow atlases bounded. No geometry point owns a decoder and no
previous playback frame becomes source history.

DIS analysis is persisted with the saved project. Small source/analysis references
live in `Analysis`; binary forward/backward source-pair fields live in
`Cache/motion` (or the linked media folder's `.masterselects-cache/motion` for
packaged projects). On reload or GPU-cache replacement, completed pairs are
uploaded from these files instead of recalculated. Keys cover the source
fingerprint, file revision, exact source PTS pair, analysis dimensions,
stabilization and algorithm version. Camera, depth and stretch controls do not
invalidate measured pairs. Corrupt or incomplete files are recomputed. The
status reports loaded/saved pairs; projects without folder storage explicitly
report memory-only analysis. Copy the linked media/cache directory with the
project to retain this acceleration on another computer.

Completed fields save through a bounded background queue (up to four pairs,
64 MiB of packed payloads, or one pair if larger). Cache reads use bounded
batches. The first project reference is written alongside the fields rather
than before GPU analysis; binary pair writes never re-encode the project
package. `ready · saving` means rendering can proceed while files finish.
`DisMotion` and `DisPersistence` logs separate GPU computation, readback,
checksum, file-write and project-reference timings for diagnosing slow storage.

Adaptive preview also limits 3D meshes to 128 columns during playback and
scrubbing. Pausing and exporting use the selected mesh resolution. The geometry
status displays the active preview grid. Source-time lookup tables are reused
across playhead changes; speed mappings, trims and holds invalidate the table,
while the current clock and time factor update small uniforms each frame.

Implementation verification is still in progress; this page is not a claim that
the complete editor/export acceptance checks have passed.
