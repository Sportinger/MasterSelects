---
title: "Flock Clips"
---

A **Flock Clip** is a native, three-dimensional particle swarm whose behavior
and appearance are defined by an executable node graph. The graph runs on the
GPU, draws into the shared 3D scene (real depth against models, planes and
splats), and is exported through the same scene path as preview.

The ordinary Properties panel shows promoted graph parameters; **Open Nodes**
shows the very same graph as the green **Flock** group on the unified clip canvas. Both surfaces
edit one definition (`clip.flock`) and one set of keyframes.

Flock follows the shared Nodes interaction model: typed cables, previews, nested
groups and the compact property inspector. Reset uses each parameter's default;
animated numeric controls edit the existing keyframe owner. The link icon exposes
or removes a control in Properties. Connections can also be edited through the
inspector, including repeated behavior inputs. Previews read existing particle
samples and evaluated parameters without starting another simulation; scene
images are labeled as the shared Flock scene.

## Flocking is an effect

The swarm is the **Flocking** effect (*Effects → 3D & Particles → Flocking*) and
works on **any** clip: video, image, text or an empty host clip. The clip's own
image stays visible underneath; the swarm is drawn as an extra 3D layer directly
above it with the clip's transform. Disabling or bypassing the effect hides the
swarm, removing it deletes the graph and its `flock.node.*` keyframes. One swarm
per clip: adding Flocking again selects the existing effect.

- In the **Effects** tab the Flocking entry shows the same controls as the Flock
  tab (preset, Open Nodes, exposed controls, Time & Quality, diagnostics).
- On the node canvas the effect node is the green **Flock** group with bypass.
- *Add Layer → Generators → Flock: …* still creates an empty host clip that
  carries the effect. Older projects' flock clips are migrated on load: they gain
  the Flocking effect entry; nothing else changes.
- Swarm nodes are filed under the shared node categories — **Particles**
  (emitter, spawn merge, simulation, flock rules, cruise, cluster, compose),
  **Forces & Physics** (attractor, vortex, turbulence, drag, wind, path, follow
  path, obstacle, boundary), **Logic & Switch** (selections), **Values & Time**,
  **Math**, **Color & Mask** (palette), **Inputs** (audio) and **Output & Render**
  (points, instances, links, trails, curves, glyphs, vectors, output). The
  workspace right-click menu lists them with every other node and adds a
  Flocking effect on first use; same-named nodes of other graphs name their graph,
  e.g. *Drag (Flocking)*.
- AI tools: `addEffect` with `effectType: "flocking"` adds a swarm to an existing
  clip; every flock tool accepts any clip with a Flocking effect.

Plan and acceptance criteria: `docs/ongoing/Flocking-Clips-And-Node-Graphs-Plan.md`.

---

## Create and edit

1. Right-click an empty area of a video track → **Add Layer → Generators → Flock: …**.
   Every preset creates one selected 10 s clip on that (unlocked) track.
2. The **Flock** tab in Properties shows the preset picker, **Open Nodes**, the
   exposed controls grouped as Population / Behavior / Guidance / Appearance /
   Lines, *Time & Quality* (step rate, warm-up, loop, precompute, cache, host
   capability, live runtime status) and graph diagnostics.
3. **Open Nodes** activates the Node Workspace and shows the clip's Flock
   group alongside its other nodes. Add nodes from the right-click
   menu, connect typed ports, bypass, duplicate (Ctrl+D), group (Ctrl+G), rename,
   expose any parameter to the Properties panel, save group or whole-graph
   presets, and apply presets to other clips.

### Presets

| Preset | Content |
|---|---|
| Free Swarm | Boids + turbulence inside a soft sphere, soft points |
| Krill Cloud | Aligned krill instances in drifting clusters, faint neighbor links |
| Vortex | Swirling shell, speed-colored points, velocity strokes |
| Follow Path | School following a figure-eight with tapered trails |
| Technical Network | Points, neighbor links and square trail-head markers |
| Shrimp Pullback (showcase) | One large hero animal inside a 24 000-animal structured swarm with links, trails and ring markers |
| Violet Filaments (showcase) | 20 000 clustered particles with a positional violet palette, long curved filaments, wire-cube heads and dot tails |

---

## Graph model

`FlockDefinition` (`src/types/flock.ts`) is plain, versioned JSON: nodes with
stable ids (no `.` so they fit property paths), edges, exposed-parameter
bindings, reusable group definitions, layout (stored separately so moving a
node never invalidates the simulation), loop settings and cache settings.
Unknown operators and newer operator versions are retained and reported, never
dropped.

Operators are JSON descriptors in `src/services/flock/operators/` (ports,
params, invalidation class, bypass contract, instance limits) and map to
`SignalOperatorDescriptor` for Signal IR.

| Category | Operators |
|---|---|
| Population | Emitter (sphere/shell/box/disc/point/line/grid, count, group, seed, burst/stagger births, lifetime, active fraction, heading/spread), Merge Emitters |
| Behavior | Flock Rules (cohesion, separation, alignment, radii, FOV, group interaction), Attractor, Vortex, Turbulence, Curl Flow, Home Pull, Drag, Wind, Cruise Speed, Cluster Anchors, Compose Behavior |
| Guidance | Path (circle, figure-8, helix, line, 4-point spline), Follow Path, Obstacle (box/sphere/capsule/plane), Boundary (contain/wrap/reflect/kill) |
| Selection | Group, ID Fraction, Region, Speed, Age, Combine (and/or/xor) |
| Values | Value, Math, Remap, Oscillator, Source Time, Audio Level (existing loudness analysis), Palette |
| Simulation | Simulation (step rate, speed/acceleration limits, turn smoothing, neighbor limit, cell candidate budget, planar mode, warm-up) |
| Render | Points, Instances (krill/fish/arrow/tetra/cube/sphere or an imported model), Neighbor Links, Trails, Curves, Endpoint Glyphs (dot/ring/square/cube/cross/diamond), Velocity Vectors |
| Output | Scene Output |

Rules enforced by `validateFlockDefinition` / `checkFlockConnection`: typed
ports, single-input occupancy (repeated inputs are evaluated in edge order),
no cycles (temporal feedback belongs only to the Simulation node), required
inputs, parameter ranges, operator versions, instance limits, group recursion
and capacity ≤ 1 048 576. Invalid drafts are saved and inspectable with
node-scoped diagnostics; preview keeps the last valid image (status `stale`)
and **export is blocked**.

The compiler (`src/services/flock/compiler/`) expands groups, applies
passthrough/mute bypass, lowers the graph to a bounded program and hashes it
into topology / behavior / derived / appearance classes. Layout never changes
a hash; appearance edits re-render only; behavior and keyframe edits
resimulate from the earliest affected step; topology edits restart.

---

## Parameters and keyframes

Every graph parameter has the property path `flock.node.<nodeId>.<param>` with
`.x/.y/.z` components for vectors and `.r/.g/.b` (0–255) channels for colors.
Group instances override inner parameters as `<innerNodeId>__<param>` on the
group node.

Flock parameters use a **source-time keyframe basis**: keyframe times are
simulation source seconds, not clip-local seconds. The timeline, curve graph
and store actions convert through `FlockTimeMapper`, so:

- split gives both halves the full parameter history and the second half does
  not restart;
- trims and slips never shift flock keys;
- speed and reverse retime source-animated behavior consistently;
- keys outside the visible source window are kept, just not drawn.

Emitter counts, seeds, step rate and other structural values are not
keyframeable; animate *Active Fraction* or *Lifetime* to change population.

---

## Simulation

- Fixed source-time steps (30/60/120 Hz), independent of render FPS, viewer
  count or wall clock. Rendering interpolates between the two adjacent steps.
- Packed 64-byte particle state (position, age, velocity, lifetime, smoothed
  forward, group, identity random, generation, emitter, neighbor count).
- Each step: deterministic births/deaths → spatial hash keys → bitonic sort by
  (cell, identity) → per-cell ranges → neighbor rules against the previous
  state with deterministic stride sampling in dense cells and a neighbor limit
  → field forces, obstacles, boundary → integration with speed/acceleration
  limits → trail history rings.
- A deterministic TypeScript reference solver (`src/engine/flock/cpu/`) defines
  the semantics the WGSL mirrors and backs the unit tests.
- Sessions are keyed per clip and consumer (`preview`, pinned `export`,
  `precompute`) so several viewers never double-step one simulation.
- Sparse restart checkpoints (1 s, thinned under a memory budget) make
  backward seeks restore-and-replay. Seeking back and forth reproduces
  bit-identical particle state and pixels on the same device.
- Buffer sizes are admitted against device limits; an oversized swarm is
  reported as `unsupported` rather than silently reduced. GPU device loss
  rebuilds sessions from source/checkpoints.

### Precompute and cache

*Time & Quality → Precompute* simulates a source range in a separate session
with 0.25 s checkpoints, hands them to the preview session, and (with *Persist
for reopen*) writes them to IndexedDB (`masterselects-flock-cache`) under a key
covering solver version, program semantics, behavior keyframes and GPU adapter.
Quota errors are reported and never touch the editable definition. *Clear
cache* drops GPU and persisted checkpoints for the clip.

Checkpoint readback submits copies of all state and trail sections before waiting
for CPU access, so concurrent cache eviction cannot invalidate persistence.
Snapshots evicted within a simulation batch are released after that batch is
submitted. The checkpoint owner also supports identity-ordered auxiliary state:
each section stays in its own GPU buffer and is appended after canonical particle
bytes in the persisted payload; import and adoption validate section sizes.
Persistent precompute flushes each checkpoint interval to IndexedDB before
advancing to the next interval, so older checkpoints survive GPU-cache eviction.
Readback and disk writes are sequential; quota failures stop the job and preserve
the successfully written prefix without claiming full completion. Cache pruning
reads only record keys, avoiding deserialization of obsolete particle arrays.
GPU retention uses a capacity-dependent budget: at least 16 MiB for small
snapshots, up to 256 MiB for multiple snapshots, or one complete snapshot when
that alone is larger. Particle, affine and trail bytes all count. Capture,
import, adoption and budget reductions enforce the same limit.

---

## Rendering

`SceneFlockLayer` joins the shared native scene. Opaque branches draw with
depth writes after voxels; additive/alpha branches draw after transparent
planes, depth-tested against everything opaque. Branches read the GPU state
buffers directly (no per-particle CPU copies):

- points and glyph quads in screen or world size with distance fade;
- instanced meshes oriented along velocity with phase-shifted swimming
  deformation; imported OBJ/FBX/glTF/GLB models are flattened, centered,
  scaled to the procedural body length and decimated above 20 000 triangles
  (no skeletal animation);
- screen-space line quads with near-plane clipping for links, vectors, curves
  and wire-cube glyphs;
- neighbor links are rebuilt from the simulation's spatial index, capped per
  particle and globally, deduplicated, and faded by distance; link distance is
  limited to twice the simulation neighborhood (reported, never by changing the
  simulation);
- trails are Catmull-Rom ribbons over stable identity subsets with taper, tail
  fade and breaks at rebirths or wraps;
- palettes map group, identity, position noise, speed or age to four colors;
- Points, Instances and Vectors offer an **Image** color mode ("data
  pigments"): the branch samples a project image (Pigment Image) at each
  particle's birth coordinate. Grid emitters map one image pixel per particle
  (row-major, top row first), so the picture stays readable while the
  particles move; other emitter shapes sample a stable random pixel.

### Data-sculpture canvas (Refik Anadol-style)

A Grid emitter lays its particles out as a flat canvas whose columns and rows
follow the emitter size aspect. **Curl Flow** is a divergence-free curl-noise
force (strength, frequency, evolution over source time, optional finer detail
octave), so neighboring particles move together and the canvas folds into
sheets instead of clumping. **Home Pull** springs every particle back to its
grid cell (other emitters: the emitter center), so the canvas breathes around
its rest pose; combine it with Drag for damping. Grid cells carry a stable per-particle
jitter (Grid Jitter, in cells, default 0.6) so dense canvases do not moire
against the pixel grid; Home Pull targets the same jittered rest position.
Points can draw up to 16 render-only **Sub-particles** per simulated particle:
on grid emitters they are placed bilinearly between a particle and its right,
lower and diagonal neighbors, so they stay on the folded surface; other
emitters scatter them within Sub-particle Spread. One million simulated
particles with eight sub-particles can draw about 8.4 million points. The
actual scene target limits sub-particles to about 1.5 points per pixel:
1,048,576 simulated particles request eight children but draw three at 1080p
and eight at 4K. **Screen** point sizes use a 1080p reference, so the same point
is twice as wide in a 4K frame. Small round sprites use one triangle; square
sprites and larger points retain quads. Emitter
capacity is 4,194,304 particles per clip; large scenes retain only the restart
snapshots that fit their GPU budget and reload persisted checkpoints as needed.

Opaque screen points with a maximum physical diameter of two pixels use compute
rasterization. Full-precision depth and a separate deterministic point-identity
pass select each pixel; a fullscreen resolve shades the winning point and writes
the shared scene depth, so Room, instances and other 3D layers still occlude it.
Alpha/additive points, world-sized points and larger sprites use the existing
triangle/quad path. A bounded scratch-buffer budget falls back to that path when
device limits cannot accommodate the pixel buffers. The point cache and raster
dispatch support two dimensions, including point populations above 16.7 million
when device buffer limits permit them.

Parent-particle shadows also use compute for footprints up to eight shadow texels
in radius; larger footprints and instance geometry keep the triangle path. The
shadow resolve shares the same shadow-map depth attachment with instance casters.

`getStats().flockGpu` reports the actual scene viewport, requested and drawn
children, simulated particles and shadow point counts. On devices supporting
`timestamp-query`, it also reports GPU milliseconds for simulation (including
any neighbor-grid construction), P2G (clear and normalization included), pressure
(divergence and projection included), G2P, point caches, shadows and main passes.
Each sample includes pass counts, completion time and a truncation flag; simulation
batch totals must be divided by their pass counts to compare individual steps.
Readback uses three bounded slots and skips samples while they are busy, without
waiting on the GPU. Unsupported devices keep rendering with no timing queries.
`computePoints` reports the number actually routed through compute. Additional
GPU pass labels are `clearPixels`, `pointDepth`, `pointWinner` and `shadowDepth`;
lighting for compute points runs in the main resolve, without a per-point
`cacheVisibility` pass.

**Room, light and shadows.** The **Room** render node draws an open-front
white gallery box (back wall, floor, ceiling, sides) with an optional flat
frame ring around the opening, so particles can spill out past the box edge.
Room also defines the key light (direction in simulation space, ambient,
shadow strength). Each lit flock clip renders its point and instance branches
into a 2048² orthographic shadow map framed around the room (or the emitters);
point shadows use only the simulated parent particles, with a wider footprint
based on the requested sub-particle count, independent of preview LOD.
Points with **Shading: Lit** draw sphere impostors that receive the light and
3x3 PCF shadows, lit Instances and the Room walls receive them too, and the
walls darken softly where they meet. Points **Relief** moves each point and
sub-particle along the emitter normal by Pigment Image brightness. Instances
keep their previous fixed-light look while no Room or lit Points branch
enables the key light.

Fluid sessions keep both simulation/interpolation states in a stable spatial order,
refreshed every four steps with a GPU cell-key radix sort. Forward and inverse
identity maps preserve spawning, pigment UVs, sub-particle neighbors, boid rules,
links and trails. Workgroups combine fixed-point face contributions before global
atomics, with bounded-probe fallback when their local table fills. Checkpoints and
diagnostic samples retain canonical identity order; checkpoint restore resets the
maps and rebuilds the spatial order. Ordinary substeps do not copy the complete
state into and out of an intermediate transfer buffer. On sort steps, only the
simulation input is reordered: the next simulation dispatch fully overwrites the
output, leaving both interpolation states in the same new order.

Sorting uses a reusable 64-byte-per-particle reorder buffer, permutation scratch
and two identity maps, included in runtime memory estimates. GPU timings separate
`fluidSort`, `order-keys`, `order-reorder` and `order-updateMapping` from P2G,
pressure and G2P. These pass samples exclude buffer-copy commands; use timestamps
around the complete command sequence when measuring total step costs.

**APIC Fluid.** The APIC Fluid behavior turns the particles into an
incompressible liquid inside a box domain (Domain Center/Size, Cell Size,
Pressure Iterations, Gravity, Affine Strength, Separation, Particle Spacing,
Position Jitter). Each particle stores a tightly
packed 3×3 velocity-gradient matrix (36 additional bytes), preserving local
rotation and shear across transfers. Each step, after forces and
advection, the GPU transfers particle velocities plus the affine contribution to a staggered MAC grid with
fixed-point atomics (order independent, so resimulation stays deterministic),
marks fluid cells, solves pressure with multigrid-preconditioned conjugate gradients (MGPCG), projects the grid
velocity and transfers it back with trilinear velocity interpolation and its
gradient, plus a position correction; the domain walls are solid. Two deterministic
extrapolation layers fill missing face velocities before pressure projection,
including corners whose interpolation weight is zero but derivative is nonzero. At truncated
walls the gradient differentiates normalized weights, so a constant tangential
velocity does not introduce artificial shear. Affine Strength defaults to 1
(APIC); 0 removes the affine contribution for more dissipative PIC behavior.
Separation (default 0.15) gently moves overlapping particles apart after G2P;
Particle Spacing (default 0.1) is measured in grid cells, with a maximum of 0.5.
Dense neighborhoods use a stable sample of at most 64 candidates per particle.
All corrections read the same particle state before being applied, are bounded,
and leave velocity unchanged. Separation zero skips the extra index and neighbor
passes. Position Jitter (default 0.002 grid cells) adds small, deterministic,
zero-centered position noise keyed by particle identity, generation and absolute
simulation step. Its amplitude scales with the square root of the timestep.
These controls are intended to reduce grid-aligned bands; they do not guarantee exact volume
preservation. CPU and GPU use the same rules. The GPU reuses the spatial sorter
and reorder scratch, adding only two cell-range arrays; separation still incurs
an additional sort and neighbor pass each active substep.
Fluid submissions scale their step count down with particle capacity. Preview
simulation waits for its preceding submission to finish before queuing more
steps, preventing a seek or playback catch-up from building an unbounded GPU
work backlog. This can leave the simulation behind the playhead on slow GPUs;
export still computes every required step.
The separate boid hash/sort buffers are sized for the population only when a
connected boid-rules node or neighbor-link render branch consumes them. Other
graphs keep 32 bytes of placeholder storage for the shared shader bindings.
Fluid's own stable cell sorter remains allocated. Adding/removing a neighbor
consumer changes graph topology and recreates the session with the appropriate
layout; animated boid weights retain the full index even when currently zero.
Simulation, boid hashing/sorting/cell ranges, trails and neighbor links support
two-dimensional compute dispatch. Each shader derives its linear particle index
from the dispatched row width, so partial final rows preserve identity and do
not revisit earlier particles. Fluid transfer and radix ordering already use
two-dimensional dispatch. This removes the one-row dispatch constraint without
raising the configured population ceiling or bypassing storage-binding limits.
GPU particle-to-grid transfers select power-of-two fixed-point scales per grid
face from current local particle counts and conservative velocity bounds,
including the affine contribution. Dense piles and fast motion therefore retain
signed sums without int32 wraparound. Both direct and workgroup transfers use the
same scales; ordinary low-density transfers retain the original precision. Bounds
use 16 extra bytes per grid cell and reuse existing face scratch for scales.

Affine Strength replaces the former FLIP Ratio; existing fluid nodes now use APIC, and older
simulation caches are invalidated. The affine matrix remains in identity order
through particle sorting, is reset on respawn/restart, and is included in CPU/GPU
checkpoints, persisted imports and precompute handoff (100 state bytes per
particle in a GPU checkpoint, before trails). Pressure Iterations is the maximum CG
iteration count (12 for new nodes); updates stop at a relative residual of 1e-5
or an absolute residual of 1e-6. The symmetric V-cycle uses Galerkin aggregates,
two damped-Jacobi sweeps before and after coarse correction, and 16 coarse sweeps.
It retains solid-wall and air boundaries, including odd grid sizes and thin fluid
regions. CPU and GPU use the same solver. Pressure scratch is included in memory
checks; changing the solver version invalidates older simulation checkpoints.
Domain and cell size are topology
(changing them rebuilds the grid and resimulates). Other forces still apply,
so Curl Flow adds swirl; bypass Home Pull for a free liquid. Pointing Gravity
into the box (for example 0, 0, -150) with a matching shallow Room makes the
liquid pour against the back wall. A CPU reference solver with the same
discretization backs tests and the low-count fallback. The grid is capped at
256 cells per axis and about 2 million cells. There is no particle
collision. A typical graph is Grid Emitter -> Curl Flow + Home Pull + Drag ->
Simulation (min speed 0) -> Points in Image color mode.

Flock clips render only in the main-thread render host (like all shared-scene
3D today). Color, masks and 2D clip effects are not offered for flock clips;
use nested compositions for image-space treatment.

---

## Audio modulation

**Audio Level** reads the existing loudness envelope of a timeline audio clip's
media (`audioAnalysisRefs.loudnessEnvelopeId`), mapped from flock source time
through both clips' timeline placement. Missing analysis is reported as
unavailable and outputs the floor value; a completed analysis load resimulates
the clip.

---

## Preview handles and thumbnails

With a flock clip selected, the preview draws guidance overlays for the graph:
emitter, vortex, attractor, boundary and obstacle centers are draggable handles
(one undo step per drag), paths and boundary volumes are shown as dashed
outlines. Timeline clips show a filmstrip rendered from the clip's simulation.

---

## AI tools

The editor exposes atomic flock tools (`src/services/aiTools/definitions/flock.ts`):

| Tool | Policy |
|---|---|
| `listFlockOperators`, `getFlockClip` | read-only |
| `createFlockClip`, `applyFlockPreset`, `addFlockNode` (optionally wired in the same step), `updateFlockNode`, `removeFlockNodes`, `connectFlockPorts`, `disconnectFlockEdge` | medium, undoable |
| `exposeFlockParam`, `unexposeFlockParam`, `scheduleFlockPrecompute`, `cancelFlockPrecompute` | low, undoable |
| `sampleFlockParticles` | read-only, dev bridge/console only (not offered to chat) |

Graph edits are planned on a copy and committed atomically; an invalid wiring
or parameter leaves the definition unchanged. `addKeyframe` accepts
`sourceTime` for `flock.node.*` properties, and keyframe results report
`timeBasis: 'source'` together with the clip-local time.

---

## Measured performance

Reference measurement (2026-09-13): AMD Radeon RDNA3 discrete GPU, Chrome 152,
1920×1080 scene target, *Free Swarm* graph (flock rules + turbulence + contain
boundary + soft points), uniform sphere distribution, 60 Hz step rate. Step
cost is measured end-to-end including GPU completion for 60 consecutive steps.

| Population | GPU memory (state + index) | Step cost |
|---|---|---|
| 10 000 | 2.5 MB | ~1 ms |
| 50 000 | 11.7 MB | ~8 ms |
| 100 000 | 23.3 MB | ~21.5 ms |

The spatial index (hash + bitonic sort + cell ranges) dominates at high counts;
it is skipped on steps without flock rules. Resulting tiers on this hardware:
interactive real-time playback at a 60 Hz step rate up to roughly 40 000
particles, and at a 30 Hz step rate up to about 100 000. Dense and fully
collapsed distributions stay bounded by the candidate budget (every particle is
stride-sampled; reported as *sampled particles* in Time & Quality). Larger
populations are admitted up to the device's storage-binding limit and still
export correctly, just slower than real time. Integrated and mobile GPU tiers
have not been measured yet.

## Limits and extensions

- Supported counts are GPU-dependent (see above); the showcase presets run
  20–24 k animals/particles. Higher counts are admitted up to device buffer limits.
- Not part of this release: visual density amplification (X1), mesh/SDF
  obstacles, formations and cross-clip interactions (X2), skeletal/animated
  instances and refraction (X3), a particle expression language (X4), a general
  procedural platform (X5).

## Source map

| Area | Location |
|---|---|
| Types | `src/types/flock.ts` |
| Operators, validation, compiler, evaluation, time, presets | `src/services/flock/` |
| Store actions | `src/stores/timeline/flockClipSlice.ts` |
| CPU reference solver, GPU sessions, shaders, renderer, registry | `src/engine/flock/` |
| Scene integration | `src/engine/native3d/passes/FlockPass.ts` |
| Properties tab | `src/components/panels/properties/flock/` |
| Node Workspace Flock group | `src/components/panels/nodes/flock/`, `src/services/nodeGraph/clipGraphFlockProjection.ts` |
| Tests | `tests/unit/flock*.test.ts`, `tests/unit/FlockTab.test.tsx` |

The Wind operator shares its directional-force contract and CPU/WGSL calculation
with Face Cables. Existing Flock defaults and deterministic gust modulation are
retained. See [Node Workspace](/features/node-workspace/) for the common canvas.
