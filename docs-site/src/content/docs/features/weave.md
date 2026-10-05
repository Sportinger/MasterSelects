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
Node contracts are listed in the [Node Catalog](/features/node-catalog/#curve-graphs-weave).

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
to 16,384 points. It evaluates deterministically at each requested frame on the CPU.
This is geometric contact projection, not a dynamic simulation: it does not conserve
length, prevent tunneling between frames or calculate temporal friction. Finite
iterations can leave residual overlaps in crowded configurations; flyaway hairs are
decorative and do not collide. Use Rod Simulation for integrated rod dynamics and
friction with a fixed rest shape.

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
applies.

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
