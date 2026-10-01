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
node; Knot, Celtic Knot, Thread Along, Yarn Profile, Flyaways, Cloth Sheet, Surface
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

Both feed Yarn Profile, Flyaways, Thread Along, Rod Simulation or any other curve
modifier. Closed curves repeat their first point at the end; the yarn twist meets at
that seam.

## Rope simulation

**Rod Simulation** turns any incoming curves into elastic ropes or threads with
thickness. They barely stretch (**Stretch Stiffness**), bend toward straight
(**Bend Stiffness**), collide with each other and with themselves as capsules of
**Radius** (match it to the Yarn Profile radius) and rub with **Friction**. A
**Floor** plane at **Floor Height** catches falling curves. Gravity, Wind,
Turbulence and Drag connect as on Cloth Sheet.

The incoming curves are the rest state at the start of the simulation; curves that
repeat their first point become rings. **Pin** holds the starts or both ends of open
curves, and a connected **Pin** field holds the points where it exceeds 0.5.
**Pull** moves the pinned points outward along the tangent of their nearer end over
**Pull Time** seconds from the clip start. That tightens a knot: Knot (reef knot) →
Rod Simulation → Yarn Profile draws two ropes locking together. Pulling further
than the knot allows stretches the ropes, sooner with higher friction, because the
knot jams earlier.

**Segment Length** sets the spacing of the simulated rod nodes; 0 uses one radius.
Finer curve detail rides along on the original points, so the output keeps every
input point and attribute. A simulation holds up to 16,384 rod nodes and 4,096
curves; denser input is coarsened automatically.

The solver is XPBD in small steps (60 steps per second, **Substeps** each) in double
precision and a fixed order. Rods carry no frames: with a straight rest shape and
position-only pins, twist does not move the centre line. Contact candidates come
from a hashed grid kept as a Verlet list, and no node moves more than half a radius
per substep, so ropes cannot pass through each other. A Rod Simulation must come
before Surface Bind; animating its input curves restarts it.

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
simulation on the CPU and binds the cached rest curves to the cloth on the GPU,
including the rotation-minimizing yarn frames. On the reference machine an animated
frame of the default weave costs about 5 ms of CPU for the strands; a paused frame
reuses everything. GPU times are in the table above.

Rod Simulation runs on the CPU. Per simulated step (1/60 s, 16 substeps) a
tightening reef knot of two ropes costs about 0.8 ms and 16 falling threads (864 rod
nodes) about 6 ms; 64 threads take about 80 ms, too slow for playback. In the
browser, 30 fps playback of the reef knot costs about 3.4 ms per frame and a dropped
3 × 2 Celtic knot about 6 ms.

The browser checks `tests/browser/weave-*-gpu-check.html` verify the coverage
modes, the analytic raster, the shadow exchange and the GPU Surface Bind against
the CPU reference; `tests/browser/weave-perf-check.html` measures the default
weave at 1080p, `tests/browser/weave-look-check.html` renders the looks and
knots, and `tests/browser/weave-rod-check.html` renders and times knots tightening
and falling onto a floor.

## AI agent

The in-app agent edits Weave graphs with the generic `getOperatorGraph` and
`editOperatorGraph` tools, like every effect-owned operator graph: it can add
Knot, Celtic Knot, Thread Along, Rod Simulation and the shared field nodes, wire
them and expose values. There is no Weave-specific toolset.

## Limits

- 65,536 curves and 1,048,576 curve points per graph; up to 256 fibers per yarn.
- Speed keyframes do not drive the cloth clock yet.
- One strand layer passes its shadow to meshes; light linking is not available.
- Rod Simulation runs on the CPU: thousands of threads (a whole weave) are too
  slow for playback; a GPU solver is future work.
- The cloth does not collide with itself or with rods.
