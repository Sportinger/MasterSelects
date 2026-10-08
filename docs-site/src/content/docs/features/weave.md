---
title: "Weave"
---

**Weave** builds woven fabric, yarns, ropes and knots from general curve nodes and
draws them as fine, lit fibers in the shared 3D scene. Threads can be pulled in one
by one, wobble like handmade cloth and billow on a simulated sheet in the wind;
simulated ropes collide, fall onto a floor and pull knots tight. Preview and export
use the same geometry and the same renderer.

Weave is an effect (*Effects → 3D & Particles → Weave*). It works on any clip,
including an empty host clip: the strands are drawn as an extra 3D layer above the
clip with the clip's transform. Disabling the effect hides the strands and keeps
the graph, values and keyframes. The graph is edited on the unified Nodes canvas;
values exposed from it appear in the clip's **Effects** tab, grouped by node group.
These instance-owned values are also registered as numeric animatable properties:
property search and atomic keyframe authoring use their saved labels, ranges and
steps. Unexposing a value removes it from property discovery without changing other
effect instances or catalog-owned parameter contracts.
Node contracts are listed in the [Node Catalog](/features/node-catalog/#curve-graphs-weave).

Geometry graphs allow 1,024 nodes and 4,096 edges, including expanded reusable
compositions. Expansion uses the graph's own domain budget and reports that domain
and its limits on overflow. Each per-point field still has a separate 640-instruction
limit, so additional formation stages do not lift the shader complexity guard.
The field compiler shares identical pure expressions and cancels matching vector
combine/split operations within each stage. Parameter owners remain independent:
animated constants are shared by their source and expression, never by coincident
numeric values. Animation updates the constant buffer without changing shader topology. Budget
errors name the field owner and report the actual and maximum instruction counts.

## Raster layer blending

Strand layers use their Transform **Blend Mode** (including Multiply, Screen and
Difference) inside a shared Raster 3D scene. Each custom-blend layer is rendered
separately against the existing scene depth, then mixed with the scene using the
same blend functions as Flock particles and timeline layers. Clip opacity is
applied once. Projected effects such as Glow remain confined to their own layer.
Normal full-opacity layers retain the direct rendering path.

Blend modes affect overlapping visible pixels; Multiply does not darken isolated
strands or particles over transparent canvas simply because the preview displays
that canvas as black. Geometry behind opaque objects remains occluded. This
per-layer mixing is a Raster feature, not a change to physical path tracing.

## Curve Scan Labels

Insert **Curve Scan Labels** before **Strand Render** to annotate a curve layer
with up to twelve transparent 3D outline cards, leader lines, and tracking rings.
The markers read the final GPU curve positions, including procedural motion and
contacts; enabling the cards does not rerun the geometry or read positions back to
the CPU. X/Y/Z readouts show world coordinates. Scan titles cycle independently;
edit the pipe-separated ASCII titles in the node (1–20 characters per title).

Cards occupy alternating left/right slots relative to the camera. **Camera Follow**
sets a delay in seconds; their world position and orientation follow sampled past
camera poses. The same timeline time yields the same layout when seeking backwards,
playing, or exporting. This follows the animated timeline camera; a static edit-view
camera has no recorded earlier motion to lag behind. The camera-pose data also travels
with render-worker packets and is resolved in the owning nested composition.

**Floating Motion** adds independent slow drift, yaw, pitch and roll, even when
a card already has a clear position. **Floating Speed** slows that motion without
reducing its extent; zero holds the ambient pose. **Avoid Curves** builds a small soft occupancy
field from projected GPU points. A separable spatial blur suppresses narrow gaps
and individual moving strands before cards choose space. Unlocked cards search a
7×9 grid across the whole live camera image, including upper corners and the
opposite side; they are no longer constrained to their original row. Candidate
positions translate the lagged card in the live image plane, retaining its depth
and rotation. This avoids unstable inversion when the lagged plane is edge-on.
The complete projected card footprint contributes occupancy and frame-edge costs.
Continuous weights and stable per-card preferences reduce position hunting; locked
cards retain their camera slots and avoidance fades out during docking.
Six bounded GPU separation rounds also account for the projected bounds of other
visible cards. Visibility weights follow the shared intro/outro schedule, so
hidden windows do not reserve space. Locked cards remain fixed obstacles; floating
cards yield around them, preferring routes with less yarn occupancy. Tilted card
footprints include a reading margin, and both sides of each pair see the same
layout snapshot before a round advances. Smaller separation steps reduce lateral
pressure. Congested floating cards can yield up to 55% of their camera distance
along their center sightline; perspective makes their fixed world-size planes
appear smaller. Clear, large foreground cards retain their authored size and
rotation. Orthographic cameras retain apparent size while moving the plane deeper.
There is no hard shared height ceiling above stacks: only visible locked card
footprints reserve space, avoiding a flat constraint that trapped free cards and
made the placement inversion singular.
This is a soft layout preference, not a collision guarantee: cards may overlap
one another or the subject when space is scarce. Spatial smoothing reduces
sensitivity to fine strand motion; it is not a temporal speed limit. Layout is
recomputed from source time and geometry with no playback-history state, CPU
readback, or extra geometry evaluation.
**Preferred Row Spacing** is fitted to the available frame; oversized card/count
combinations report a validation error.

**Card Style → Mixed** combines rectangular, oval, circular and square outlines, three typefaces and
per-card sizes controlled by **Size Variation**. Every card retains its text; headings
type in, numerical rows drift slightly, and rotating first-word accents turn bold red.
These accents are a scan graphic, not event or fault detection. Circles and squares
have equal physical side extents, even in portrait compositions. **Font Size Variation**
varies the text scale; roughly one in four cards emphasizes a changing word.
**Brief Bold Flashes** adds occasional 180 ms heading pulses. **Changing Readouts**
periodically scrambles selected headings and status words for up to 240 ms, then
resolves a new word. Other cards remain steady; X/Y/Z slots retain their actual values. **Window Echoes**
occasionally duplicates a visible window 3–10 times along camera depth for 1–3 seconds,
with faded parallel outlines and text. Leader lines and target rings are not duplicated.
The effect is deterministic and omits episodes when the visible lifetime is too short;
no duplicate draw instances are issued when no echo is active. **Marker Line Weight**
changes tracking-circle thickness independently of the card and leader lines.
**Tracking Ring Color** sets their independent base color; target-acquisition alerts
override it with the same red/orange signal as the card. Line weight stays constant
through introduction and alert changes. **Leader Line Weight** separately thickens
connecting lines. **Tracking Glow** adds a soft colored halo to rings and leaders
inside their existing raster draw; text stays sharp. It requires no extra render
pass, fullscreen blur, or path tracing. At zero, the halo is disabled and line
quads retain their original size.

Cards have staggered lifetimes. **Visible Cycle Fraction** leaves an offscreen pause
between appearances; **Intro / Outro** (50–500 ms, default 450 ms) draws the marker
and leader toward the card, then its outline and text. The outro runs the same
sequence backwards. Short cycles shorten both transitions to fit. Keyframe
**Camera Follow** down temporarily to let cards catch up during a camera move.
**Opening Build-up** introduces the first card immediately and each subsequent card
at shorter intervals over the chosen duration; zero uses ongoing staggered cycles.
**Depth Spread** distributes planes in front of and behind their common camera
distance, preserving physical size so parallax and apparent size vary. **Depth Travel**
adds independent smooth movement along camera depth at **Floating Speed**. Spread
and travel together must stay at or below 0.8, keeping every plane ahead of its
follow camera.

**Side Position**, **Preferred Row Spacing**, **Card Width/Height**, and **Camera Distance**
control placement. **First Strand / Strand Step** wrap over available curves;
**First Curve Position / Curve Position Step** choose normalized positions along
them. Numeric parameters accept keyframes or uniform node inputs. Per-point fields
are rejected with an explanation. **Opacity**, line width, marker size, color, and
scan-cycle length control the look. Bypass removes the annotations, preserving the
original strand image. Cards are unlit, depth-tested geometry and remain separate
from the strand's Glow or other projected effects.

**Released Tracking Blend** switches anchors from their normal strand selection to
an ordered release pool. **Released Curve Fraction** is the normalized release
front across curve indices. **Released Pool Margin** delays the candidate pool
relative to that front so barely-started strands are not selected too early;
**Released Tracker Share** chooses how many cards follow
that pool. Remaining cards attach to the last unreleased curves. Drive these values
from the same release graph as the geometry. Until enough curves are released,
several markers can share one curve at different positions. **Detached Section Focus** finds the portion furthest from the remaining parent
curves on the GPU, instead of anchoring to a still-attached stitch. Alert colors start
only after the tracking blend arrives and that portion is measurably separated.
Released cards flicker between red and orange with deterministic irregular timing; remaining cards gain
orange as the release fraction increases. After all curves release, they follow the
last curves rather than inventing a remaining parent.

## Default graph

A new Weave effect starts with a plain weave of fuzzy three-ply yarns on a sail
held at its corners:

| Group | What it does | Exposed values |
|---|---|---|
| **Weave In** | *Thread Along* pulls every thread in along its path behind a tip that arcs up off the sheet and settles with a damped swing. Warps come first, then the wefts row by row, over the first four seconds of the clip. | **Weave Speed** (1 = four seconds) |
| **Handmade** | Each thread meanders along its length (uneven spacing), each thread gets its own tension (crimp varies), and slubs thicken the yarn in places. | **Irregularity** (1 = default look, 0 = machine-perfect, up to 3) |
| **Reveal by Shape** | A growing sphere with a noisy front scales the yarn radius. | **Reveal** (0–1) |
| **Yarn** | Yarn Profile (plies and fibers twisted along curve length) and Flyaways (stray loops and free ends). | — |
| **Wind Cloth** | A simulated cloth sheet in gusty, swirling wind; Surface Bind places the woven curves on it. | — |

Each group can be bypassed from its **Byp** button or its Effects tab section:
bypassing *Weave In* shows the finished weave from the first frame, *Handmade* a
regular weave, *Yarn* the bare curves, *Reveal by Shape* the whole sheet and
*Wind Cloth* a flat one. Bypass changes only the compiled view; wiring, values and
keyframes stay intact.

All of this is built from general nodes. Weave Pattern is the only weave-specific
node; Knot, Celtic Knot, Knit, Extend, Thread Along, Yarn Profile, Flyaways, Cloth Sheet, Surface
Bind, Rod Simulation, Noise, Shape Distance, Ramp and the shared Math/Vector nodes
work for any curves.

## Knots and ropes

**Knot** creates closed knot curves: a trefoil (simple knot), a figure-eight, a
**reef knot** of two ropes whose bights lock around each other, or a (P, Q) torus
knot (P and Q without a common divisor). **Depth** lifts the crossings so the ropes
pass over and under each other. The reef knot's six crossings alternate over and
under along both ropes.

**Celtic Knot** creates plaitwork on a grid of cells: threads run diagonally, loop
around at the border (**Roundness**) and alternate over and under like a plain
weave. **Height** lifts the crossings.

**Knit** creates weft-knit (stockinette) fabric: one curve per row whose loops reach
through the loops of the row below, head in front, legs behind (**Stitches**, **Rows**,
**Width** and **Height** of a stitch, row **Spacing**, loop **Depth**, **Lean**).
With the defaults a yarn up to about a quarter of the stitch width (Yarn Profile
radius 0.015) fits between the loops without touching.

All three feed Yarn Profile, Flyaways, Thread Along, Rod Simulation or any other curve
modifier. Closed curves repeat their first point at the end; the yarn twist meets at
that seam.

For a fabric that knits itself, wire Knit → Thread Along with **Ahead: Trail**:
the rows form one after another (Stagger) while the unused rest of each thread
streams in from the **Trail** direction instead of being hidden. Thread Along moves
the threads along their paths without collisions, so a trailing thread can pass
through finished loops.

## Endless knit sphere

**Close Curve** connects each open yarn back to its own start with a smooth return
bow. Return Offset positions the back of the bow, End Handles sets the endpoint
tangents, and Return Points controls its resolution. Put it before Rod Simulation
to include the return and seam in the same closed rod and contact solve. Closing
geometry does not make a simulation periodic or provide a knitting guide.

**Closed Curve Flow** advects material points around existing closed yarn paths at
Turns per Second in clip source time. Unlike changing a stitch generator's phase,
it keeps the path in place while yarn colors travel through it. It preserves the
repeated seam and interpolates upstream radius scales. A useful chain is a static
Knit Sphere, Curve Contact to relax its rest paths, Closed Curve Flow, animated
deformations, Yarn Profile and a final Curve Contact. This separates material flow
from forming new crossings. Linear resampling and later deformations still need
enough curve resolution and contact clearance.

**Curve Contact** corrects overlapping yarn capsules after procedural animation.
Place it after all position modifiers and after Yarn Profile when using its radius
scale. Set Contact Radius to cover the outer yarn bundle, including fiber width and
a small allowance for spline interpolation. Iterations controls contact convergence;
Correction Smoothing spreads displacement without smoothing away the input stitches.
The modifier preserves point IDs, per-point colors and closed seams, and supports up
to 16,384 points. A final contact modifier after GPU-compatible Set Position and
Yarn Profile fields runs on the GPU: per-layer scratch buffers, a stable sorted
capsule grid, simultaneous contact projection and welded ring endpoints. Each
iteration uses four parallel sweeps to propagate neighboring corrections. Animated
fields remain on the GPU and export waits for the exact requested geometry through
the shared preparation barrier. Only bounds and length metrics return to the CPU.
The solve is frame-local, so seeking does not replay simulation history. Unsupported
stage orders or position-dependent material colors retain CPU evaluation; GPU
validation failures log a warning and fall back to CPU. Parallel projection and the
sequential CPU solver can converge differently in crowded knots; increase Iterations
when necessary. Neither solver guarantees a topologically collision-free transition.
Strength blends the positional correction from zero to one and accepts an animated
parameter or a uniform clock/value input. Zero removes the solve from the compiled
program, retaining the original positions and the usual GPU deformation path.
This allows contact correction only during an unfolding interval; per-point
Strength fields are rejected explicitly. Partial strength can leave overlap.
This is geometric contact projection, not a dynamic simulation: it does not conserve
length, prevent tunneling between frames or calculate temporal friction. Finite
iterations can leave residual overlaps in crowded configurations; flyaway hairs are
decorative and do not collide. Use Rod Simulation for integrated rod dynamics and
friction with a fixed rest shape.

In Raster rendering, image effects after Weave (including Glow) process each
strand layer's own projected image before it joins the shared 3D scene. The layer
retains its depth and opacity; other strand and particle layers are not included
in its effect input. Generated halo pixels outside the strands occupy the far
plane. Glow expands alpha coverage and accounts for source coverage, so its halo
survives transparent backgrounds. Per-layer projected strand stacks currently
apply to Raster; mixed path-traced scenes do not gain this per-object image pass.

Strand Render accepts an optional **Color** vector field (RGB, 0 to 1), replacing
its uniform color. Curve Info's Curve Param and Strand Index can drive gradients
and alternating bands with a different offset per yarn. The color follows the
material points and is shared by all plies, fibers and flyaways; all three strand
antialiasing modes and export use the same interpolated colors. Material colors
based on Curve Param, Strand Index or constants retain GPU cloth/rod simulation
and reuse their color buffer while those values stay unchanged. Position-based
colors evaluate geometry on the CPU so they match the final deformed curves.

**Knit Sphere ? Yarn Profile ? Flyaways (optional) ? Strand Render ? Scene Output**
builds a hollow ball of closed horizontal yarn rings. All rings circulate in the
same direction. A small stationary oval patch at the lower front (+Z) forms the same loose
stockinette loops as Knit. At one visible edge the incoming yarn bows and folds
into loops; at the opposite edge the loops open and straighten again. Courses
shorten toward the top and bottom of the patch, so parallel yarn surrounds it on
all sides, including below. Edge Softness spreads the formation/unravelling over
a readable transition instead of filling a whole hemisphere. **Zone Center** is height divided by sphere radius
(negative is below the equator); **Zone Height**, **Zone Width** in degrees and
**Edge Softness** control the window. **Loop Height**, **Depth** and **Lean** shape
the stitches; **Rings**, **Stitches per Ring** and **Points per Stitch** set detail.
**Band Half Height / Radius** narrows the rows around the equator (default 0.94).
For a connected band using every row, reduce it and center a taller knitting
window over the band; the rings still close around the free back of the sphere.

**Speed (turns/s)** runs in clip source time: 0.05 gives a 20-second revolution,
zero freezes it, and negative values reverse it. **Phase (turns)** offsets the
motion and can be keyframed. Trimming, splitting and constant clip speed/reverse
follow the same source-time mapping as the other curve animations. For a seamless
export, use a duration containing a whole revolution with constant parameters.
The generator has no simulation history, so seeking directly to a time gives the
same geometry as playback. Preview and export evaluate the same curve program.

This is a stylized periodic deformation: it does not conserve yarn length or
resolve collisions while loops form and dissolve. A sphere made of independent
horizontal rings has no yarn at its exact poles. Start with the default 28 rings,
32 stitches and a Yarn Profile radius around 0.0055; large loop heights or thick
yarns can overlap, especially near the poles and transition edges.

## Rope simulation

**Rod Simulation** turns any incoming curves into elastic ropes or threads with
thickness. They barely stretch (**Stretch Stiffness**), bend toward straight
(**Bend Stiffness**), collide with each other and with themselves as capsules of
**Radius** (match it to the Yarn Profile radius) and rub with **Friction**. A
**Floor** plane at **Floor Height** catches falling curves. Gravity, Wind,
Turbulence and Drag connect as on Cloth Sheet.

The incoming curves are the rest state at the start of the simulation; curves that
repeat their first point become rings. **Pin** holds the starts or both ends of open
curves, and a connected **Pin** field holds the points where it exceeds 0.5, including
points on closed rings. **Pull** sets the distance those pins move over **Pull Time**
seconds from each point's **Pull Start** (a per-point field, 0 when
unconnected). That tightens a knot: Knot (reef knot) →
Rod Simulation → Yarn Profile draws two ropes locking together. Pulling further
than the knot allows stretches the ropes, sooner with higher friction, because the
knot jams earlier. **Pull Motion** chooses the existing eased pull or a constant-speed pull for a steady succession of releases.
**Out and back** repeatedly eases selected pins outward and home, with a full cycle
of twice Pull Time starting at each pin's Pull Start. This moves the fixture;
the rod state, velocities and contacts keep advancing forward without replaying
the simulation backwards.

**Pull Direction** is an optional Vector 3 field over the rest curves. It is
interpolated onto the arc-length rod nodes and normalized to unit length; its
magnitude does not change the Pull distance. A zero vector keeps a selected pin
stationary. Only pinned nodes move under this control. Without this input, open
curves pull along their nearer end's outward tangent and closed-ring pins remain
stationary. Directions stay fixed in the rest state: Clip Time and Timeline Time
dependencies are rejected. Use Pull Start, Pull Time and Pull Motion for the
movement schedule. Keyframing upstream fields changes the rest setup and restarts
the solve; it does not animate a moving target in an existing simulation.

**Closed-rope tension studies.** Create the stitch geometry, apply any ring mapping,
and add **Close Curve before Rod Simulation**, then render with Yarn Profile.
The ring, return and knit now participate in the same forward-time contact and
tension solve. Use a Pin field to select supported loop heads and return handles;
give supports zero Pull Direction and handles their desired pull vectors. Set the
Pin dropdown to None when only the field should select pins. Avoid a post-solve
ring mapping for this setup: that changes the displayed shape without moving its
collision bodies. This supports closed-rope tension studies; it does not implement
repeated needle-driven stitch formation.

**Unravelling, played backwards.** A fabric that knits itself without any thread
passing through another is its unravelling played in reverse. **Extend** continues
every row straight beyond the fabric edge (say 4 units, out of frame); Rod
Simulation pins those far **ends** and pulls them outward by half the slack of a row
(a row is much longer than the fabric is wide). Pull Start from Curve Info (Strand
Index × −0.7 s + 7.7 s for twelve rows) pulls the top row first and each row below
0.7 s later, the way a sweater unravels: once a row is out, the loops of the row
below are free. Set **Bend Stiffness** to 0 and leave out turbulence so the rows
that are not pulled yet keep their loops (yarn bends toward straight otherwise).
Then reverse the clip (clip speed, Reverse): straight threads are pulled in from
outside the frame, row by row, and through the loops of the row below. The
simulation runs forward in source time, so playing backwards resumes from the
checkpoints and costs more per frame than forward playback.

**Knit Cycle Guides (experimental).** Creates closed yarn rings arranged across a
cylindrical band. Connect its Curves output to both Curves and Cycle Guide on one
Rod Simulation: the initial curves and the moving soft guides then share one
forward-time rod/contact solve. Entry Turns and Exit Turns control independent
forming/release windows; Seconds per Stitch advances the material without
resetting the solver clock. Each stitch uses a sampled draw-through shape from
the four-yarn rod study, resampled by arc length so slack can feed into a growing
loop. Each whole stitch shares one draw-through phase; the measured expanding
end chord reserves a longer entry/exit path instead of squeezing the release into
the compact stitch pitch. Formation follows the inverse shape progression as a moving guide; the
live four-ring solver itself runs only forward, with stretch/bend/contact forces.
This is guided choreography based on a physical study, not autonomous knitting
or proof that every crossing is collision-free. This is an experimental driven solve, not a guaranteed
collision-free knitting planner or a certified seamless animation loop. The rod
solver still has its ten-minute simulation limit. Guide forces compete with
length, bend and contact constraints, so evaluate actual motion before increasing
speed or tightening the patch. Guided rods also bound every substep, including
stretch, bend and contact corrections, by conservative displacement balls based
on the previous segment separation. Three contact projections reduce capsule
overlap. Guided output follows the actual segment centre lines, without spline
overshoot or rest-detail offsets. The guard protects disjoint non-neighbouring
centre lines during accepted substeps; it does not certify initial geometry,
rendered fibre thickness, frame interpolation or downstream deformations. Invalid
guides can stall or distort the knit instead of completing a draw-through.

**Knit Passage Study (finite).** Replays a baked four-yarn rod draw-through over
33.8 seconds. A travelling material window retains the active loops of the longer
simulation; one additional mature stitch on each side separates formation from
release. A short mature seam blend and a tangent return form four closed yarn
rings. Entry uses the reversed release trajectory. This is an authored presentation
of a physical study, not an independently simulated entry or a fully coupled ring
simulation. Playback Seconds sets the duration, while Time Scale and Time Offset
map the host clip's source clock. Follow Patch keeps the patch in a common moving
frame and preserves the user's orbital camera; Fixed View reveals Patch Travel
Turns. The first and last states hold outside the finite interval. No live rod
catch-up is required, and this does not make the animation seamless. The authored
seam, return and frame interpolation are not certified collision-free.

**Paired entry and exit.** Each Rod Simulation has its own **Time Scale** and
**Time Offset**. The default is source time (scale 1, offset 0); scale -1 and
offset 8 replay the same eight-second physical trajectory backwards. Times below
zero hold the initial state. This changes the simulation clock, including its
forces, while retaining the same rest geometry and CPU/GPU checkpoint identity.
A mirrored reverse simulation can form the lower edge while the upper edge
unravels forwards. Hold a shared middle stitch and match the halves there;
separate simulations do not calculate contact with each other. Reversal alone
does not produce a seamless infinite loop or guarantee collision-free joins.

**Forming.** With **Start: Straight**, every open curve begins as a straight thread
of its own length, laid along the line from its first to its last point through its
centre, so a knit or weave starts out as parallel fibres. A connected **Form Time**
field gives each point the second at which it is drawn onto its place in the
incoming curves; over **Form Ease** seconds the pull fades in. The pull is a motion
in the prediction, capped at a quarter radius per substep, so collisions, stretch and
bending still act on it: threads fold into the fabric and slide through its loops
while their loose ends are pulled in, instead of passing through each other. Folding
threads may press about a fifth of a radius into each other, as with all contacts
of this solver. A self-knitting fabric is Knit → Rod Simulation (Start Straight,
Pin None, Radius just below half the loop clearance, Turbulence for waving loose
ends) with Form Time = Shape Distance from the centre × seconds per unit + delay:
the middle forms first and the fabric grows outward.

Node previews run rods on the CPU only while reaching the playhead costs about a quarter
second (small knots and ropes); larger simulations show their rest curves in the node
previews, labelled *Rest curves*, while the viewer simulates them on the GPU.

**Segment Length** sets the spacing of the simulated rod nodes; 0 uses one radius.
Finer curve detail rides along on the original points, so the output keeps every
input point and attribute. A simulation holds up to 16,384 rod nodes and 4,096
curves; denser input is coarsened automatically.

The solver is XPBD in small steps (60 steps per second, **Substeps** each). Stretch
and bend constraints are solved colour by colour (constraints of one colour share no
node) and contacts as one averaged Jacobi pass, so the same scheme runs in parallel on
the GPU. Rods carry no frames: with a straight rest shape and position-only pins,
twist does not move the centre line. Contact candidates come from a hashed grid, and
prediction limits reduce tunneling. Contacts are discrete rather than a guarantee
against every crossing, especially when prescribed pin motion forces an impossible
path.

When only Yarn Profiles follow it, the renderer simulates on the GPU in f32 and writes
the strand points itself, including the Yarn Profile radius fields; node previews and
other chains use the CPU reference in double precision. Both are deterministic on one
device (scrubbing resumes from exact checkpoints) and stay within about 2 % of a radius
of each other over seconds of simulation. A Rod Simulation must come before Surface
Bind; animating its input curves restarts it.

## Time

Weave runs on the **source time of its host clip**, like Flock: splitting or
trimming a clip continues the cloth motion and the weave-in instead of restarting
them. Speed keyframes are not followed yet. *Clip Time* reads that clock in a graph.
The cloth simulates 60 fixed steps per second with a pre-roll before the clip and
exact checkpoints every half second, so scrubbing forward and backward gives the
same positions on the same device. Rod Simulation uses the same clock, step rate and
checkpoints. Thread Along is analytic in its progress and needs no simulation state.

## Rendering

Every curve becomes camera-facing ribbons, one per fiber, expanded on the GPU.
Width is in world units and follows the layer scale; width 0 draws nothing. Fibers
are shaded as round tubes (Kajiya-Kay for thin fibers, wrapped Lambert across wide
ones) with two shifted highlights (Marschner/Karis) and forward scattering. Light
clips light the strands like native meshes; without a light clip a fixed key light
applies. An environment light with an HDRI lights them by its spherical-harmonics
irradiance. Light that passes fibers is tinted by their color once per two fibers
(dual scattering), so bright yarn stays bright and saturated in its depth. The
**Fiber Material** node (wool, cotton, silk, synthetic, hair) sets color, roughness
and highlights for the raster and the path tracer alike; with **Path Traced** the
composition renders every fiber as a ray traced round cone with a hair BSDF (see
[Path Tracing](/features/path-tracing/)).

**Antialiasing** (Strand Render) applies to preview, export, nested compositions
and both render hosts:

| Mode | How | Cost (default weave, 1080p, AMD RDNA3) |
|---|---|---|
| **Hashed** (default) | Fibers thinner than a pixel keep one pixel of geometry with deterministic hashed coverage; distant yarns draw a hashed share of their fibers (stochastic simplification). | ~4 ms GPU |
| **4x Coverage** | Every fiber, four-sample alpha-to-coverage in a strand-only target that starts from the scene depth; resolved once into the scene. About 32 bytes per viewport pixel; extremely thin fibers can still lose coverage. | ~6 ms GPU |
| **Analytic** | Tile compute raster: every fiber piece is binned into 16 × 16 pixel tiles, sorted by depth with a stable radix sort and blended front to back with exact pixel coverage (pieces of one fiber add up at their joints). Deterministic; falls back to 4x Coverage when a layer exceeds the device's buffer limits. | ~35 ms GPU |

**Shadows.** Fibers shadow each other through deep opacity maps from the
shadowing light (the key light without light clips, otherwise the point or panel
light brightest at the layer if its clip has **Casts Shadows** on). With a scene
light, shadows are also exchanged with meshes: lit meshes receive the strands'
shadow, and opaque meshes between the light and the strands shadow them. One strand
layer passes its shadow to meshes. Unlit planes (video and image layers) do not
receive shadows.

## Performance

Curves before the first Surface Bind are cached; within them, field expressions
that did not change are reused per point. Each frame of animated cloth advances the
simulation on the CPU; the GPU pulls the threads in (Thread Along with one progress
for all points), evaluates the Yarn Profile radius fields (compiled to WGSL, their
values passed as data, so an animated Reveal or Irregularity keeps the pipeline) and
binds the cached rest curves to the cloth, including the rotation-minimizing yarn
frames. On the reference machine a frame of the default weave costs about 6 ms of CPU
for the strands, while threads are pulled in and afterwards (before: about 140 ms
while pulling in); a paused frame reuses everything. GPU times are in the table above.

Rod Simulation on the GPU costs about 2.4 ms per simulated step (1/60 s, 16
substeps) for a tightening reef knot, 3.5 ms for 16 falling threads, 4.2 ms for 64
and 4.3 ms for 256 threads (9,728 rod nodes); the CPU reference needs 1.7, 10.6 and
38 ms for the first three. Small knots are bound by the fixed number of passes per
substep, large scenes hardly cost more.

Set Position and Yarn Profile modifiers after Rod Simulation also run in its GPU
output pass, in graph order. This allows bending an existing stitch motion into
a ring without a CPU readback or a new rod solve. Bounds are measured on the
deformed output. These are render deformations: collisions and friction still
belong to the original simulation space, not the bent ring.

The browser checks `tests/browser/weave-*-gpu-check.html` verify the coverage
modes, the analytic raster, the shadow exchange and the GPU Surface Bind against
the CPU reference; `tests/browser/weave-perf-check.html` measures the default
weave at 1080p, `tests/browser/weave-look-check.html` renders the looks and
knots, `tests/browser/weave-rod-check.html` renders knots tightening and falling onto
a floor, and `tests/browser/weave-rod-gpu-check.html` compares the GPU rod solver with
the CPU reference, checks determinism across scrubbing and times both.

## AI agent

The in-app agent edits Weave graphs with the generic `getOperatorGraph` and
`editOperatorGraph` tools, like every effect-owned operator graph: it can add
Knot, Celtic Knot, Knit, Thread Along, Rod Simulation and the shared field nodes, wire
them and expose values. There is no Weave-specific toolset.

## Limits

- 65,536 curves and 1,048,576 curve points per graph; up to 256 fibers per yarn.
- Speed keyframes do not drive the cloth clock yet.
- One strand layer passes its shadow to meshes; light linking is not available.
- Rod Simulation holds up to 16,384 rod nodes; a whole weave of rods needs coarse
  Segment Lengths.
- The cloth does not collide with itself or with rods.

Legacy graphs stored in effect parameters are cached per effect and stored revision. Switching between custom Weave graphs no longer reuses the first loaded graph or contaminates the default graph.

Yarn Profile ? **Surface Feed** moves ply, fiber and flyaway detail along arc length in local units per source second (positive follows the curve). It can show feed through a guided knitting zone while the straight ends stay in place. Zero preserves existing scenes. This is surface transport: it does not advect connected color fields, conserve yarn length, or calculate tension/friction. Curve Contact remains a frame-local contact correction, not a continuous collision guarantee.

## Built-in Weave presets

In **Nodes → Effect presets → Weave presets**, **Add copy** applies a self-contained,
editable Weave effect to the selected visual clip, including a transparent Blank Clip.
These built-in graphs remain available after browser storage is cleared; personal
saved effects stay in their existing browser library.

- **Four-Yarn Knit Ring** restores the four closed ropes and front knitting patch
  from the archived Knit Passage Study, including all 508 baked frames over 33.8 seconds.
  The yarn look is a new starting point; the original browser preset's camera and
  colors were not archived. The finite animation holds its endpoints.
- **Endless Knit Band** provides four rings with a localized knitted front and a
  20-second procedural cycle. This is a stylized deformation rather than the finite study.
- **Wave Strands** preserves the earlier general-node strand-wave example.
- **Jellyfish — Video Reconstruction** approximates a recorded yarn sculpture:
  thirteen closed cream-colored courses, a round knitted face and elongated,
  irregular return loops. This is a new reconstruction from front/side views,
  not the recovered original graph; the recording's node labels were unreadable.
  **Body Length** and **Irregularity** control the shape. **Tail Inset** (default
  0.45, zero restores the round body) draws the loose resting loops inward with
  a smooth transition immediately behind the front dome. The inset is strongest
  near the front shoulders and eases toward the back to preserve a rounded cap. It acts before the animated noise
  and swimming pulse, so the returns settle back into the narrower shape while
  the front dome and its motion stay intact. **Yarn Circulation
  (turns/s)** moves material around the closed courses, folding it into the fixed
  front knitting window and unfolding it on exit; zero stops it and negative
  values reverse it. The independent **Jellyfish Pulse** group starts a strong,
  localized contraction at the knitted head, then carries the wave backwards
  through the loose returns at full strength; attenuation starts beyond the tail.
  The reusable **Curl Noise** node group (`field.curl-noise3d`, Patterns & Fields)
  accepts Position, Detail and Strength and outputs a 3D vector for Set Position.
  It expands into ordinary Noise, Vector and Math nodes that remain inspectable
  and editable. Animate its Position input to move through the field.
  **Curl Noise (Evolving)** adds an Evolution input in turns. It rotates between
  two independent curl potentials, changing the shape rather than translating
  a fixed field; statistical strength stays stable. The original three-input
  Curl Noise remains compatible with saved projects.
  **Return Curls** uses two separate three-dimensional fields. +X-side curls
  travel away from the knitted +Z head, while -X-side curls travel toward it,
  matching the default yarn circulation. Side masks have a narrow smooth join
  at the rear; neither field affects the opposite side outside that join.
  **Curl Strength** sets displacement; **Curl Detail** raises spatial frequency
  for smaller swirls. **Curl Evolution (turns/s)** controls shape change independently
  of travel; zero freezes evolution. The knitted front is masked out. This is
  procedural displacement without collision or fluid simulation.
  **Head Wobble** (default 0.035) adds a gentle, spatially coherent motion over
  the knitted dome. **Tail Soft Noise** (default 0.075) adds broad rounded bends
  with a different stable noise seed per yarn; neighbouring courses no longer
  have to follow the same contour. Both use single-octave, low-frequency noise,
  smoothly masked to their regions, before the swimming pulse. **Soft Motion**
  (default 0.15) animates their noise field independently of curl evolution.
  Set either strength to zero to remove that contribution. Closed yarn endpoints
  stay joined. At the rear join, the two directional noise results are blended
  after sampling; the transition cannot squeeze increasing noise detail into
  the join as playback advances. These are procedural fields, not extra physics
  or a blur pass.
  **Return Length** (default 1.5; 1 restores the earlier length) stretches only
  the loose returns behind the knit, with a smooth shoulder transition. It acts
  after the moving fields and pulse, preserving the dome and transverse motion
  while carrying the same animation through the longer loops.
  **Return Flow (units/s)** sets constant travel speed; negative values reverse
  both directions and zero stops travel. **Irregularity** sets the smaller plain
  noise amplitude (default 0.04, strongly reduced at the knitted front). The
  plain noise travels toward the tail. None of these fields translate
  the whole body. **Pulse Rate (Hz)** sets the frequency; **Pulse Strength**
  sets the deformation (default 0.4); zero disables it. At defaults circulation and
  pulse repeat together after 20 source seconds; the flowing fields keep evolving. All use clip source time,
  preserving motion through seeks, trims and export without a collision or rod
  simulation. Knit Sphere, position fields, Noise, Math, Yarn Profile and Flyaways
  remain editable in Nodes; orbit the scene camera to inspect all sides.

Each insertion has independent parameters and graph ownership. Customize a copy
and use **Save effect copy** to retain your own variant. Clip length, transform,
and the shared scene camera remain under the destination project's control.

Saved Weave graphs with missing required input cables reopen as editable drafts,
with the connection error shown in Nodes. Nodes and existing cables are retained;
structurally invalid connections remain validation errors. Completing the wiring
through the graph editor restores rendering.


### GPU curve fields

Trailing **Set Position** and **Yarn Profile** fields run on WebGPU for ordinary
curve generators as well as simulated rods. This includes the reusable **Curl
Noise**, **Curl Noise (Evolving)** and Noise compositions, masks, waves and radius
fields; their existing graphs and saved project format are unchanged. The shared
pointwise WGSL compiler executes modifiers in graph order. Generators and earlier
stages that alter topology or require CPU geometry remain on the CPU.

Animated constants reuse compute pipelines; animated input curves reuse buffers
while their point/strand topology stays the same. Position, frames and radius
remain GPU-resident. Only two measurements per strand (extent and arc length)
return to the CPU for shadows and subdivision selection. Preview retains the last
complete geometry while the next snapshot is prepared, which may introduce one
preparation interval of visual latency. Export waits for the requested snapshot,
including on backwards seeks, rather than capturing the previous preview frame.

Position-dependent strand colors or Fiber Material color, roughness, melanin and
selection fields retain CPU evaluation so they read the final deformed positions.
Unsupported field operations and GPU preparation failures also retain the CPU
path. Changing preview resolution reduces raster work, not the number of authored
curve points. Performance depends on both curve complexity and GPU fill cost. At a fixed time,
the completed curve buffers are reused during camera navigation. Unchanged Solid
host textures are also reused across main and target previews; changing their
color or dimensions refreshes the upload.

The browser regression at `tests/browser/weave-point-fields-gpu-check.html`
compares positions, radius, frames and bounds against the CPU reference, including
animated input, topology changes, export preparation and the jellyfish preset.

### Raster camera depth of field

The Physical Camera f-Stop and Focus Distance controls now work in Raster preview as well.
A bounded pair of 37-tap separable HDR passes uses the shared scene depth and the thin-lens circle of confusion;
it does not repeat geometry evaluation. f-Stop 0 disables it with no extra texture/pass.
Focus Distance 0 follows the camera target. The blur radius is bounded to 18 output pixels.
Orthographic cameras and path-traced output bypass this approximation. Transparent surfaces
inherit the underlying raster depth; it cannot reconstruct hidden or multiple transparent layers.
Particle sprite softness provides independent soft appearance for those layers.
Foreground gathers include clear pixels behind thin strands and spread into neighboring
pixels even when those pixels are in focus, so yarn silhouettes soften as well as solid interiors.
The camera inspector explicitly shows when f-stop 0 disables depth of field.

Camera numeric properties, including aperture and focus, are registered for the shared
property authoring and keyframe path. Lens keyframes preserve camera framing and movement.

The **Physical Camera** section has a persistent bypass switch. Off skips exposure,
custom tone mapping, depth of field and camera shutter processing in preview and export,
without changing the stored lens parameters, their keyframes or the camera's pose/FOV.
Particle sprite softness and particle velocity streaks remain independent. Existing projects
keep physical processing enabled unless explicitly bypassed. Raster focus blur is a bounded
screen-space approximation; it is not equivalent to path-traced lens sampling, and the
jellyfish project currently leaves it bypassed while its export appearance is under review.

### Downstream image effects

Image effects placed after Weave (for example Glow) operate on that strand
layer's projected image. Preview, nested compositions, and export preserve the
same interpolated effect stack. Disabled, detached, audio and other geometry
generators are excluded. The worker scene path explicitly declines these stacks
until it can carry them, rather than silently dropping the effects.

### Window glitch wave

**Window Glitch Wave** (0–1, off by default, keyframeable/node-driven) affects only
readout windows and their echo copies. A one-second screen-space wave starts at
the top-right and reaches the bottom-left at 12, 24, 36… seconds of composition
time. Each card's disturbance decays over its own deterministic 1–2-second
recovery, with RGB splitting, displaced text groups/outlines, brief glyph errors,
and small colored blocks. Coordinates retain their real underlying values.
Tracking rings, leaders and scene geometry remain untouched. The effect uses the
existing annotation render pass, plus a small block draw only during active waves;
there is no fullscreen post-process or frame-history dependency. Reverse seeks
and export reproduce the same event. Zero strength restores the clean windows.

### Independent eased circulation

`Motion Time` supplies analytically integrated source seconds: acceleration from rest, constant-speed travel, then deceleration to rest. Duration, Acceleration and Deceleration are node parameters; invalid or overlapping intervals report an error. The clock is clamped outside its duration and is independent of playback history, so scrubbing and rendering agree.

Knit Sphere and Closed Curve Flow accept an optional uniform **Motion Seconds** input. Without it they retain their source-time behavior. Connect Motion Time only to circulation branches to preserve the original timing of pulsation, formation, camera and other effects. Per-point generator clocks are rejected explicitly. An eased clock controls speed, not loop geometry: a matching final pose or whole-turn phase is still needed for a seamless loop.

Composed geometry fields allow up to 640 instructions, including independent motion clocks alongside inherited forces.

### Independent scan-window appearances

Curve Scan Labels offers **Lifetime Variation** and **Appearance Seed** for reproducible, independent visible durations and pauses, including a shuffled opening order. Opening Build-up retains its accelerating stagger. CPU text, GPU reveal and the exported `curveLabelCues` intro/outro schedule use the same episode boundaries; seeking does not resample randomness. A **Tracking Hold Start/End** interval keeps the first **Held Tracking Cards** fully revealed, overriding their random pauses without a hard visibility jump. This controls visibility timing, not whether the camera can see their anchors.

Window Echoes now produces 6–20 parallel copies for occasional 2.4–4.8-second episodes (limited by the visible interval), with a longer hold and an 800-ms tail fade. Distant copies retain enough opacity to remain visible. **Window Rotation** adds smooth, independent yaw/pitch targets up to 45 degrees, separately from camera lag and spatial drift.

### Emissive scan-window glitches

The diagonal 12-second glitch wave now warps window outlines, shears them into bands and changes groups of glyphs in size. Bright RGB fringes, local shader halos and short rectangular/orbital wireframe fragments strengthen the effect without a fullscreen blur pass. Connection lines morph through subdivided three-dimensional loops, retaining their exact point/card attachments and returning to straight leaders after the wave. Tracking ring positions and scene geometry remain unchanged.


### Camera alignment and brief camera locks

Window Rotation uses smooth independent excursions up to the configured angle, followed by a camera-parallel rest. Yaw, pitch and roll all settle with zero angular velocity; depth travel and position drift continue. Camera Follow retains its sampled delay during fast camera moves and catches up after the camera settles. Seeking evaluates the same pose without a playback-history simulation.

**Camera Locks** optionally schedules a limited number of short corner docks. **First Camera Lock**, **Camera Lock Interval** and **Camera Lock Hold** control the timing; a hold lasts 2–3 seconds, with a 500-ms dock and a 700-ms release. The scheduler chooses an existing fully visible appearance near each requested time, keeping intro/outro sounds and card lifetimes unchanged. If no card stays visible long enough, the renderer logs the missing lock count so the lifetime can be increased. A docked card uses the current camera pose exactly, temporarily overriding delayed floating position/rotation. A closing padlock, brief lock flash and rapidly scrolling priority text identify the state. Release restores normal readouts, camera lag and floating motion. This is a raster annotation pass, with no physics simulation or geometry readback.


### Visible material-coordinate diagnostic

The dev-only `captureStrandMap` diagnostic reads a paused, currently rendered strand clip without changing its materials. It reuses the raster fiber geometry and final GPU positions, checks the scene depth for occlusion, and renders exact integer IDs into a separate attachment. The false-color PNG distinguishes strands by hue and alternates material-position bands. Exact `strand` and normalized `u` values come from up to 32 requested image pixels or bounded visible candidates, independently of lighting, tone mapping, Glow and image compression. Those coordinates refer to material points and follow their subsequent motion; they are not fixed world-space positions.

This diagnostic does no extra draw or readback during normal playback. It currently requires a matching main-thread native scene frame and returns an explicit error for unavailable/stale frames or worker-only scenes. Capture is limited to 4 megapixels and rejects concurrent playback/seek changes. It is excluded from the provider/kernel tool catalog.

### Closing an eased circulation loop

Motion Time supplies both integrated **Motion Seconds** and a normalized **Loop Phase (0–1)**. Phase completes exactly one forward turn across Duration with the same acceleration/deceleration envelope. Multiply it by an integer number of turns for a cyclic path with matching endpoints; do not multiply accumulated seconds by a falling envelope, which reverses motion. Apply a common phase before each harmonic of a periodic path to move material along that path instead of changing its shape. Neither output changes other animation clocks or guarantees constant world-space speed on an unevenly parameterized curve.

### Narrow scan disturbance front

The diagonal scan disturbance crosses the viewport in three seconds, every twelve seconds. Its bright front uses half the former high-intensity spatial extent (the old envelope above 80%); travel time and spatial width are independent. A quieter, individually timed one-to-two-second aftershock follows each card, without prolonging the bright front. Tracking anchors remain attached throughout.

### Lingering near rest

Motion Time’s **Final Stillness** (integer 1–4, default 1) shapes only the deceleration speed: it raises the remaining smooth speed to that power. Higher values approach near-rest earlier while preserving the chosen stopping time and the entire acceleration/cruise portion. Motion Seconds integrates this envelope analytically, without frame history; Loop Phase normalizes its changed distance back to one full turn. Invalid powers fail explicitly. Shape morphs driven by another clock remain independent and need their own settling curve if their motion must also stop gently.

### Exact scan anchors and opening rings

Curve Scan Labels accepts **Anchor Overrides** such as `0:4@0.18 | 10:2@0.6`. Card and strand indices start at zero; the value after `@` is the material position from 0 to 1. These anchors follow the final GPU-deformed strand, preserve different curve point counts, and leave released-tracking destinations unchanged. Unspecified cards retain First Strand / Strand Step / Curve Position settings. Strand indices wrap just like the regular selection. Malformed or duplicate entries produce an error.

**Amber Opening Rings** selects the first N cards in the actual appearance order, including randomized schedules. Their amber rings appear together with each card's leader and intro, never in advance. They fade with their first episode; later episodes use the regular ring color and acquired-target alerts. Set 0 to preserve the previous behavior.

Tracking rings and their leader origins sit on the camera-facing yarn envelope instead of the buried centerline, using the profile radius, per-point radius scale and layer scale. Foreground geometry still depth-occludes them; coordinate readouts continue to describe the actual curve point.

Rings trace their circumference during the shared intro, at constant radius and line thickness. The outro retracts the same path in reverse. An analytic ring stroke keeps the glow smooth without overlapping segment halos.

### Multilingual 3D intro headlines

**Intro Titles** places bold multilingual text inside the first two detailed readout cards. Use `KUNST? > ART > कला | KANN WEG. > CAN GO. > À JETER.`: `|` separates cards, `>` separates language variants. Each phrase decodes from changing characters over about 420 ms, rests briefly, and switches after about 1.05 seconds. Whole grapheme clusters settle together, including punctuation and Indic combining marks. After the last phrase a short fade returns to ordinary readouts; the existing card, ring and intro/outro audio schedule stays intact. Short card episodes compress these timings. Empty Intro Titles preserves regular cards.

**Intro Card Scale** and **Intro Camera Distance** make these cards larger and closer while retaining camera lag and free-space placement. **Intro Text Depth** separates the text plane from the frame; **Intro Text Motion** adds independent slow 3D drift and rotation. Warm cream text has a subtle vertical gradient and a one-sample offset shadow, surrounded by small optical/material readouts, separators and a moving progress accent. Text opacity remains independent of the dimmer frame while respecting layer opacity.

Decode variants are rasterized once per phrase set, with whole-line Unicode shaping, into a bounded two-column software atlas (at most 1024×7168 for the maximum 16 phrases). Playback only selects atlas tiles; it does not re-rasterize text per frame. Atlas resources stay outside project data and retire after GPU submission, including multiple label layers. Intro placement contains the enlarged projected card footprint within the shot, including depth and tilt.


### Smooth direction changes

Motion Time can turn **Motion Seconds** smoothly from forward to backward: set **Turn Start** to source seconds (default `-1` disables it), and choose **Turn Duration**. Signed speed crosses zero halfway through that interval and then follows the negative original speed envelope. The turn is integrated against acceleration and Final Stillness, so accumulated time never jumps and seeking needs no simulation history. Invalid intervals report an error.

**Loop Phase stays forward and still ends at 1**, independently of the direction turn. Use seconds for a return-stage circulation and the phase for a closed periodic path that must continue through the loop seam. Reversing a clock does not itself guarantee continuity when morphing between two different shapes.


### Material anchors during a tracking hold

**Held Material Anchors** uses the same `card:strand@u | …` syntax as Anchor Overrides, for the cards inside **Held Tracking Cards**. These targets apply to the complete appearance that covers Tracking Hold Start/End, from intro through outro, so changing anchors cannot jump halfway through an appearance. The material coordinates stay fixed while the yarn moves through its geometry. Opening anchors and later released-strand targets remain independent. The interval must be ordered and each override must address an existing held card.

During the hold, the full projected footprint of these cards is kept within the image, including their rotation and depth. Held card planes also move toward the camera while retaining their projected size, so the inspected yarn does not hide the readout. The correction enters and leaves smoothly; ordinary cards keep their unrestricted camera lag. This does not make a material point visible through foreground geometry: use several appropriately spaced targets when tracking yarn through interlocking meshes.


### Stacked camera locks

**Locked Cards per Side** reserves up to three cards in each lower screen corner between **Stack Lock Start/End**. Cards dock with a slight row stagger, show their own animated padlock and fast priority readout, stay aligned to the live camera, then return smoothly to their floating planes. Sizes remain varied: the placement sums each column's actual card heights and gaps, scaling the column when needed to fit the lower region without overlapping the stacked card footprints. The stack planes move nearer while preserving their screen size, so the inspected object does not hide their text. Other floating planes avoid the visible locked footprints through the shared placement solver, retaining their orientation lag and optionally yielding in depth when crowded.

The stack interval extends these cards' shared appearance schedule, including intro/outro audio cues; regenerate pre-rendered cue audio after changing it. Existing material tracking holds can follow or overlap a stack. Individual brief locks that overlap the reserved interval are skipped. Zero cards per side disables stacks and preserves older projects; an enabled stack requires enough cards for both sides and at least 1.5 seconds to dock and release.


### Inspecting actual tracking acquisition

The dev-only `captureStrandMap` diagnostic also accepts `mode: "tracking"`. On a paused, current main-thread preview frame it returns each card's selected source/target strand, exact GPU tracking position and acquisition readiness, appearance reveal and projected pixel position. Readiness is the same separation test used by the alert tint; it can be used to audit or bake matching acquisition sounds. A projected position is not proof of visibility through foreground yarn.

This mode runs the existing tracking compute pass against the already prepared GPU strands and reads back only the small per-card result. It creates no material PNG, does not evaluate geometry on the CPU, and adds no readback to ordinary playback or export. Missing topology, missing labels, stale frames, playback or a composition/time change during capture return explicit errors. The tool remains read-only and excluded from provider/chat discovery.

Opaque WebCodecs/HTMLVideo export now matches preview coverage on GPU readback:
soft dust and thin yarn RGB are not attenuated again by residual compositor alpha.
See [Export](/docs/features/export/) for the readback and stacked-alpha contracts.

### Sequential camera locks

**Stack Card Delay (s)** offsets each card's docking and release independently,
alternating left/right. Start/End describe the first card; later cards use the
same hold duration shifted by their index times the delay. A one-second delay
with six cards and Start/End 13/21 docks at 13–18 seconds and finishes releasing
at 21–26 seconds. The appearance schedule, lock ticker, GPU placement and reserved
screen area follow these per-card windows. Zero retains the previous compact
row stagger.

**Early Camera Locks** chooses separate existing visible episodes inside **Early
Locks Start/End**, before the ordinary recurring lock schedule. Two locks in
5–13 seconds occupy different slots, never starting before 5 seconds. A requested
window must fit the dock/hold/release durations and gaps. If card lifetimes or
reserved stacks prevent an early lock, the renderer reports it explicitly.
Changing stack timing changes appearance cues; pre-rendered sound tracks need
regeneration separately.

### Readable intro planes and released-strand warning text

The first two intro planes face almost parallel to the live camera while retaining
position lag and a small residual tilt. Their independent text depth moves along
the viewing ray, keeping off-axis headlines beneath the upper separator rather
than shifting them toward the frame edge. Main words sit slightly below the
card center. Four or more language variants use at most 650 ms each (including
letter decoding); shorter appearances compress the slots to fit all variants.

**Warning Text Groups** adds up to six groups of two to four large bold red
exclamation marks inside each released-target card. Their deterministic locations
vary by card and appearance, with individual flicker. More groups fade in as
Released Curve Fraction increases. They use the same GPU acquisition gate as the
red alert tint; cards still tracking the parent do not receive these warnings.
The existing bold glyph atlas is reused, with bounded geometry and no extra
readback, simulation or per-frame text rasterization. Zero disables the feature.

### Minimum circulation speed

**Motion Time → Minimum Speed** optionally keeps a small fraction of normal
speed at the beginning and end. Zero retains the previous full stop; 0.005 means
0.5 percent, and one disables the speed ramps. The acceleration/deceleration
intervals and Final Stillness still shape the remaining speed. Both outputs use
the integrated envelope; Loop Phase is normalized to exactly 0–1, including the
extra distance, so a periodic path still closes. The optional direction turn also
reverses the minimum speed of Motion Seconds. Outside Duration the clock stays
clamped; a looping caller wraps time itself.

This governs parameter travel, not physical distance on changing-length curves.
Morphing geometry can still move even when its circulation is slow.

### Closed Curve Flow travel units

**Flow Units → Curve Distance** interprets Travel per Second and Travel Offset
in curve-local length units. It builds cumulative segment lengths and samples the
shifted distance with a binary search, preserving the incoming material spacing.
Unequally spaced vertices and differently sized loops therefore receive the same
travel distance. Radius scales interpolate with the sampled path; the repeated
endpoint stays exact. Zero-length segments and completely collapsed loops remain
finite. Non-finite travel values are rejected explicitly.

The default **Turns (point indices)** retains previous projects' behavior. A
Motion Seconds input can supply the independent eased clock in either mode.
Distance is measured on the current path, not through a tension or inextensibility
solver: morphing the path itself can still move material points. Scene transforms
scale curve-local distances. As the final modifier of a GPU point-field chain,
Closed Curve Flow now runs on the GPU in either unit mode, optionally before a
final Curve Contacts stage. It reuses GPU arc lengths and a persistent packed-point
snapshot, resamples position/radius, then rebuilds strand frames and bounds. Only
the existing two metrics per strand are read back. Open input loops are reported
explicitly through that same readback; CPU fallback retains the same closed-input
requirement. An intervening unsupported stage or spatial material field keeps the
existing CPU path. This does not make deformation-induced motion inextensible or
integrate historical lengths of a changing path; author those shape clocks separately.


### Authored scan text cues

**Text Cues (JSON)** assigns timed content to existing scan cards. Supply an ordered array of `{ "start": 0, "end": 5, "panels": [["STATUS", "FIRST LINE", "SECOND LINE", "THIRD LINE"]] }`. Times are source seconds and use inclusive starts/exclusive ends. Cues may leave gaps; gaps restore the ordinary readouts. Each cue accepts 1–12 panels, with exactly four ASCII rows of at most 20 characters. Panels repeat across card indices when there are fewer panels than cards. Authored rows replace the changing telemetry and coordinate slots, including camera-locked cards; headings leave space for the animated lock icon.

A cue may also contain `"headlines": [{ "text": "A question?", "header": "OBSERVER", "footer": "LIVE" }]`. At most two headlines can appear together, each with up to 32 printable Unicode characters and 20-column ASCII header/footer. They reuse the shaped cream headline atlas, progressive decode, independent text motion and intro scale/distance settings. The first multilingual Intro Titles keep priority until their phrases finish. Only the current phrase set is rasterized, keeping the atlas bounded independently of the number of cues.

Headline cards are selected deterministically at cue start, preferring already visible, unlocked cards with the greatest remaining overlap. Selection stays fixed through the cue and across seeks. Cue text does not extend an appearance, remove occlusion or guarantee a full cue's visibility: choose suitable card lifetimes or a tracking hold for an uninterrupted reading interval. Existing rings, tracking acquisition, card colors, locks and sound-event timing keep their own controls. The transport rejects overlapping/out-of-order intervals, unknown fields, oversized text and more headlines than available cards instead of silently trimming them. Limits: 64 cues, 32,768 JSON characters and source times through 36,000 seconds. Empty text preserves existing projects.


### Sequential final material tracking

Set **Final Target Hold End** later than **Final Target Start** to enable a closing target handoff. Card 0 begins at Start; every subsequent card follows after **Final Target Card Delay**. Each interpolates its current moving target toward **Final Target Strand / Final Material Position** during **Final Target Travel**, then adopts **Final Target Color** only on arrival. Position accepts node-driven values, wraps in both directions and is sampled from final GPU strand positions. Feed the same material coordinate that controls a colored yarn section to keep the marker on that section. No point readback or CPU deformation is introduced.

The existing appearance covering each handoff is extended through Hold End, followed by the regular intro/outro duration. Other appearances retain their ordinary schedule; this is a hold interval, not a global clip-duration limit. The hold must fit all delays and travel. An end no later than start disables the feature for older projects. Acquired final targets suppress the released-target red warning groups and accents; ordinary tracking stays unchanged before acquisition. Tracking diagnostic readiness uses 0–1 for released acquisition and 2 for the final target. Large cream headline words keep their authored typography.
