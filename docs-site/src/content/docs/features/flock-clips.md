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
| Population | Emitter (sphere/shell/box/disc/point/line, count, group, seed, burst/stagger births, lifetime, active fraction, heading/spread), Merge Emitters |
| Behavior | Flock Rules (cohesion, separation, alignment, radii, FOV, group interaction), Attractor, Vortex, Turbulence, Drag, Wind, Cruise Speed, Cluster Anchors, Compose Behavior |
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
- palettes map group, identity, position noise, speed or age to four colors.

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
