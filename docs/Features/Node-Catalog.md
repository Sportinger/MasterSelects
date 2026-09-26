[Back to Features](./README.md) · [Node Workspace](./Node-Workspace.md)

# Node Catalog

## Agent discovery

Codex Direct and Fast receive `editorNodeCatalog` before the first model action of each turn. This is the complete compact inventory of registered operators, visual effects, Flock nodes, audio effects, parameter sources, Color nodes and common field-backed clip stages, not a search result limited to a few entries. Rows contain the exact catalog ID, name, input/output signal types and availability, grouped by kind and owning context. Project-local custom definitions are outside this base inventory.

Two read-only tools provide more detail:

Requests containing `node`, `nodes`, Node compounds or German `Knoten` compounds also receive all full definitions in `editorNodeCatalog.definitions` before the first action: exact ports, parameters, defaults, ranges and choices. Other requests retain the compact inventory. No top-N truncation or mandatory discovery call is applied.

- `searchNodeCatalog({ query?, kind?, context?, inputType?, outputType?, offset?, limit? })` returns compact summaries, a total count and `nextOffset`. The default page has 12 entries, with at most 30. Exact IDs and names rank first; all whitespace-separated search terms must match.
- `getNodeDefinitions({ ids })` reads up to eight exact IDs together, returning underlying type IDs, ports, parameter defaults, ranges, choices and declared animation support. Unknown IDs appear in `missingIds`.

Catalog IDs distinguish parameter-control versions from image operators with the same underlying ID. For example, `control:values.number` and `values.number` retain their own parameter contracts. Built-in clip stages have source-dependent contracts; their empty static port/parameter lists do not imply that they have no editable controls. Fixed anchors and internal render primitives are marked explicitly. Signal filters are discovery aids, not proof that a connection is valid for a particular graph owner. Normal domain validation still applies when editing.

`focusNodeGraph({ clipId })` selects an existing timeline clip and pins a Nodes panel to it beside Preview, so a separately docked AI Studio stays visible while the graph changes. The assignment survives selection changes. Existing panels pinned to other clips and detached windows remain untouched. Every panel can return to selection-following **Active** through its source selector. It requires the editor and a docked Preview. Clip creation remains a separate operation when no suitable clip exists.

These discovery/focus tools do not create or mutate graphs. Shaders, implementation functions and internal composition bodies are excluded from discovery results. Existing Codex Direct conversations start a fresh protocol thread after this catalog-tool update so the new tools are available.

## Codex Direct node stream

Direct receives the `nodeGraphStream` version-1 contract alongside the inventory. An exact `ms-nodegraph-v1` fenced block contains newline-delimited JSON. Its first record is `{"op":"begin","schemaVersion":1,"clipId":"<existing clip ID>"}`. Only after receiving that complete record does the browser select the clip and open Nodes beside Preview automatically; no separate focus call is necessary. A new clip must be created before the stream, using its returned ID.

The fenced text protocol is optional: Codex Direct can also call the atomic editor tools. Both paths yield a browser presentation frame after each edit, so consecutive connections, node moves, and other tool mutations become visible one step at a time even when the provider emits several tool calls together. `executeBatch` reports and presents each contained action before starting the next. A registered compound operator may still expand into many visual nodes in one atomic edit; its nodes and cables enter in a short staggered wave without splitting the saved edit or undo point. Prompt guidelines alone cannot guarantee that a provider chooses the text protocol.

Each subsequent `tool` record has a consecutive `seq` starting at 1, a unique `ref`, an allowed `tool` and `args`. The browser supplies the pinned `clipId`. Earlier scalar tool results can be referenced with `{"$ref":"alias","field":"effectId"}` or `nodeId`. `{"op":"end","lastSeq":N}` and a closing fence terminate the stream. Partial lines never execute, and ordinary prose/code fences do not trigger graph changes.

Supported operations are visual-effect add/update/remove, Flock node add/update/remove/connect/disconnect, `createImageNodeGraph` and `editOperatorGraph`, using deterministic handlers, policy, audit and undo boundaries. Color and parameter-source graph authoring are not yet supported by this stream. The Fast/kernel route still uses its normal operation plans. Invalid records, owner errors, denied tools or cancellation stop later work; completed steps remain visible and undoable. A reload does not replay streamed mutations. Limits are 128 operations, 64 KiB per line and 1 MiB per block.

`createImageNodeGraph({ clipId, name? })` creates a neutral source-to-output graph using the existing image-effect runtime. `editOperatorGraph` adds/removes/moves registered operators, sets parameters, connects/disconnects ports and configures local numeric sliders. Each call is one atomic edit, also usable in node-code records. The same tool edits existing effect-owned graphs. Incomplete intermediate wiring is explicitly reported and execution pauses until repaired. Native domains retain their existing owner restrictions.

`getOperatorGraph({ clipId })` lists effect graph owners and status. Add `effectId` for actual nodes, values and edges. Add `nodeIds`, `hops: 0..4` and `direction: upstream|downstream|both` to inspect only a region. Boundary cables and omitted-node counts make the selection explicit. It reads saved graph state, not GPU telemetry, and remains available in plan mode.

### Exposing Value nodes

A `Value` node (`values.number` / `values.integer`) can be published to the clip's **Effects** tab. Select the node and enable **Effects tab** in its inspector; an optional **Exposed name** labels the row. The effect then shows a **Graph values** section with a keyframeable row per exposed node, and its keyframes drive the node output through the effect parameter `<nodeId>_value` (animatable property `effect.<effectId>.<nodeId>_value`). Turning the toggle off in an image graph writes the current base value back into the node as a literal and removes that parameter's keyframes; the edit is undoable. Audio graphs and values already owned by a built-in effect parameter cannot be exposed.

The agent uses `editOperatorGraph` with `action: "expose"`, `nodeId`, `exposed: true|false` and an optional `label`, or passes `exposed: true` (and optional `label`) when adding a Value node. `slider` on an exposed node sets the Effects tab row range. `getOperatorGraph` returns the node's `exposed` field.

The chat Work Log records the received text-delta count, operations applied before `turn/completed`, and relative timestamps for the first operation and provider completion. The `CodexNodeStream` logger adds the first 16 chunk sizes/timestamps without prompt or answer contents. An operation preceding provider completion proves incremental execution; the visible Nodes panel is the rendering check.

Open **Nodes → Catalog** to search current definitions by name, ID or signal type.
Search also matches signal format descriptions. Filter by supported context and expand an entry for inputs, outputs, default
parameters, keyframe support, canonical family/variant, backend, fusion, state and invalidation. Where a registry exposes numeric
ranges or signal formats, the same values flow into the catalog. Remaining local implementations are marked from their owning
registry rather than maintained as a parallel migration checklist. The inventory reads the registries at runtime;
it does not duplicate definitions. It is a reference; add operators from the
selected node's inspector or the appropriate domain's Add menu.

## Ownership and reuse

The parameter-control menu includes **Audio envelope** (`control.audio-envelope`).
It reads mixed RMS, momentary LUFS or short-term LUFS from existing analysis;
it does not use live FFT or the playback AudioContext. The selected clip ID,
time basis, interpolation and dB normalization are stored in the control graph.
Slit Scan exposes Delay, Map mix and Noise amount as scalar targets. Use Remap
to convert the normalized audio value into a desired delay range. Audio source
and export integration have unit coverage; live end-to-end verification is pending.

Image effects expose six reusable motion operators through **Add node**:

| Node | Contract |
| --- | --- |
| Optical Flow | Reference image, target image, signed target-minus-reference interval. Outputs RG velocity in UV/second, B confidence, A validity. |
| Source Motion | Source-video UV, delay, analysis interval (0–1 graph seconds), declared lookback and Time factor. Explicit source times, independent of playback history; requires a video clip. |
| Temporal Deformation | Motion field, delay gradient in seconds/output-pixel and resolution. Outputs maximum/minimum stretch, confidence and signed Jacobian determinant. |
| Motion Field Consistency | Confidence-weighted neighboring motion vectors; disagreement reduces confidence before measuring deformation. Radius is a fraction of the longest image edge. |
| Directional Smoothing | Image, pixel-space direction, radius and strength mask; nine weighted taps, preserving pixels at zero strength. |
| Mask Overlay | Image, scalar mask, RGB color and opacity. Preserves alpha; normally renders in exports as well. |

Optical Flow uses bounded low-resolution image passes. Source Motion uses shared
source decoding and a separate bounded analysis atlas. Its **DIS cached source
pairs** option uses real adjacent source PTS instead of the connected interval:
an independent WebGPU fast DIS implementation with Gaussian pyramids, overlapping
patch search, dense aggregation and forward/backward consistency. Cached fields
are sampled at each output pixel's source time. The original local estimator
remains the default for existing consumers. Slit Scan enables DIS for its stretch
mask and disables the red overlay during export. These estimates can fail at
occlusions, weak texture or large motion; they do not reconstruct missing frames.
Earlier local-estimator probes do not validate DIS. Build/test execution is paused;
live DIS quality and performance have not yet been verified.

The catalog includes the 15 Fisheye processing groups, the shared coordinate
compositions and the expandable HSV-based Hue Shift composition. To insert one,
select an image effect or an internal node and use
**right-click → Reusable Nodes**, or the inspector's **Add node** selector.
Each entry exposes its typed boundary and can be expanded after insertion.

The Sampling category adds Texel Offset, Gaussian Weight, and Normalize Weighted
RGBA as versioned compositions of existing operators. Their boundary inputs are
explicit: pixel offset/resolution, offset/sigma, and accumulated RGBA/total weight.
They have no hidden bindings to an effect's Radius or Samples controls. Gaussian
weight requires nonzero sigma; normalization requires nonzero total weight.
Kernel indices still need a surrounding reducer scope. These contracts are shared
building blocks, not replacements for the existing kernel or sequence reducers.

### Text in any image graph

**Text Atlas** renders its own typed characters (up to 256, in order) with a
selectable font and weight into a cached glyph atlas. It needs no glyph effect or
effect-owned ramp, so it can be added to every general image graph, including
graphs created with `createImageNodeGraph`. Its outputs are the atlas image,
glyph count, columns and rows.

**Glyph Sample** draws one glyph from any connected atlas: it takes the atlas and
its columns/rows, a glyph **Index** (0 = first character, rounded to the nearest
glyph) and a **Local UV** in 0–1 (top-left origin), and returns the glyph coverage.
The atlas row is derived from the glyph centre, so computed integer indices stay
exact on the GPU. Typical use: cell ID → index math → Glyph Sample → mix a text
color over the background. Compute image effects (Voronoi, Pixel Sort, Quadtree
Zoom, Contour) and Analog Signal Lab do not offer Text Atlas.

Further reusable processing recipes are available in the same menu:

| Category | Blocks | Boundary contract |
| --- | --- | --- |
| Sampling | Bounded Sample Count | Explicit count, minimum and maximum; integer truncation remains with the reducer. |
| Coordinates | Scale From Center | Direction, scalar scale and center; no hidden UV or resolution source. |
| Color | Luma Saturation; Contrast Around Midgray | RGB processing only; clamping and alpha remain with the caller. Saturation uses Rec.601 luminance. |
| Color | Soft Bright Pass; Sobel Magnitude | Explicit threshold edges and image, or eight neighboring luminance values; no hidden sampling pass. |
| Glyph | Glyph Cell Grid; Tone to Glyph Index; Glyph Atlas Alpha | Explicit UV/resolution/cell size, tone/invert/count, and atlas image/dimensions/index/local UV/clamp bounds. Atlas loading stays outside the recipes. |
| Feedback | Decay & Max RGBA | Componentwise `max(current, previous * decay)`; both images and decay are inputs. The block is stateless and never advances history. |
| Coordinates | Radial UV Curvature | Normalized UV, curvature coefficient and amount; no implicit clamping or image sampling. |
| Color | RGB Stripe Mask | Horizontal UV, image width in pixels, stripe width and low/high channel levels; stripe width is bounded to at least one pixel. |
| Signal | Sine Gain | `base + amplitude * sin(phase)` in that operand order; phase is in radians and time stays external. |
| Sampling | Clamped Image Sample | Image, UV and explicit minimum/maximum UV; samples RGBA through the existing image sampler. |

These versioned definitions extract existing primitive regions rather than adding
effect-specific GPU implementations. Exact structural recognition can share them
across compatible effects without crossing saved group boundaries. Expanding a
block exposes its ordinary nodes; editing its interior detaches that instance.
Supplying an atlas or previous frame still requires a compatible resource-owning
effect; inserting a processing block does not enable unsupported resources.

CRT Screen reuses Sine Gain twice, for its scanlines and flicker. Glitch can reuse
the same Clamped Image Sample as CRT wherever its exact clamp/sample boundary
matches. The recipe extractor can keep selected literal controls as public
inputs, so curvature and mask levels are not hidden effect-specific bindings.
The screen recognition revision does not reapply earlier detached recipes.

All graph editors use the shared node canvas and connection contract. Domain
registries remain responsible for executable operators and parameter schemas;
adapters map existing saved definitions to the common ports and endpoints. Shared
validation checks signal semantics, supported formats, single versus repeated
inputs, recorded dependencies and cycles before a connection is changed.

Math and vector split/combine families can declare adaptive ports. Connecting a
different signal selects an executable variant for the current owner and, where
necessary, propagates through connected adaptive nodes. Existing cables and fixed
boundaries constrain the choice; incompatible edits are rejected atomically. No
image/audio/geometry conversion is inferred. The Add selector shows one entry per
adaptive family, while the catalog retains its concrete variants.

**Audio Math Graph** lifts the shared Add, Subtract, Multiply, Divide, Min, Max,
Clamp, Abs, Sin, Cos, Floor, Fract and Mix operations over audio samples. Constants
broadcast across the samples in each channel. Sample processing has its own audio
executor; matching labels do not route image shaders into audio or mesh processing.

[`listNodeCatalog`](../../src/services/operators/operatorCatalog.ts) combines:

| Registry | Owner and scope |
|---|---|
| [`EFFECT_OPERATORS`](../../src/services/operators/operatorRegistry.ts) | Shared operator contracts, used by Face Cables and image-surface scenes |
| [`SCENE_OPERATORS`](../../src/services/operators/sceneOperators.ts) | Texture, UV, material, geometry, object transform and rendering |
| [`SURFACE_OPERATORS`](../../src/services/operators/surfaceOperators.ts) | Landmark mesh, depth calibration, depth mesh, seam merge and mesh collision |
| [`VOXEL_OPERATORS`](../../src/services/operators/voxelOperators.ts) | Grid, box, instancing, relief camera/light and rendering |
| [`SCALAR_FIELD_OPERATORS`](../../src/services/operators/scalarField.ts) | Luminance and scalar field arithmetic, fused into the relief GPU pass |
| [`listFlockOperators`](../../src/services/flock/operators/flockOperatorRegistry.ts) | Flock's typed compiler and GPU simulation; `sharedOperator` identifies shared implementations |
| [`EFFECT_REGISTRY`](../../src/effects/index.ts) | Existing image effects and composite effect groups |
| [`IMAGE_OPERATORS`](../../src/services/operators/imageOperators.ts) | Stateless image-local operations lowered by the fused image DAG compiler |
| [`AUDIO_OPERATORS`](../../src/services/operators/audioOperators.ts) | Shared math families applied independently to audio samples and channels |

The catalog reports actual supported contexts. A common port name does not imply
that every domain can execute every operator. Color grading, audio analysis and
field-backed camera/light settings remain documented in their own feature pages;
they are visible in the clip graph but are not yet registered in this inventory.
Model/splat/Flock/voxel renderers have not been replaced by the image-surface
executor. This inventory deliberately distinguishes what exists from what still
needs a compatible executor adapter.

The matrix reports `unspecified` or `unknown` when an older registry definition has not yet
declared fusion, state, unit, value format, consumer, or implementation-ownership metadata. It does not infer capabilities from labels.
Port formats come directly from shared signal contracts; numeric ranges and steps
come directly from parameter definitions. “Local” means an owning compiler or
effect registry still has an implementation pending consolidation, while “shared”
is only shown when its registry declares or references one.
Existing effect entries expose their registered pipeline kind and feedback flag;
their “local” marker means the effect registry still owns that implementation,
not that a compatible operator migration has already been completed.

## Composed coordinate nodes

The image context includes three reusable definitions with explicit public ports:
Cartesian to Polar (position and center to radius and angle), Mirror Repeat
(value and period to a reflected value), and Polar to Cartesian (radius, angle
and center to position). Angles use radians. Their bodies contain ordinary
coordinate and math nodes and expand inline in the image compiler. Matching
primitive patterns can adopt the same definitions across image effects.
The numeric Value family exposes Float and Integer variants in the inspector;
Integer truncates toward zero and keeps the number-port contract.

## Face and depth processing

`source.face-landmarks` and `source.saved-depth` are executable references to
existing source artifacts. The canvas exposes them as Video Source outputs;
connecting one creates a clip/effect-local reference inside the receiving graph.
Landmarks retain normalized XYZ; saved scene depth is already calibrated and
connects to `geometry.depth`, bypassing estimation and calibration. No payload is
copied into the reference. Saved depth keeps its original calibration and must pass
the bake's source/timing/pose/mapping checks. It currently belongs to its owning
cable effect; copying that effect keeps the reference local to the copied bake.

```text
media.source → tracking.face → tracking.smooth → tracking.anchors → simulation.rope
                                     └───────→ geometry.face ─────────────────┐
media.source → depth.estimate → depth.calibrate → geometry.depth ──────────────┤
                               ↑ reference                                  ↓
                               └── geometry.face                 geometry.merge-surface
                                                                            ↓
                                                          collision.mesh / render.cables
```

| Operator | Contract | Implementation / adapter |
|---|---|---|
| `media.source` | Clip source → image | Source timing and decoded frames |
| `tracking.face` | Image → landmarks | Precise MediaPipe tracking series in `landmarkTracking/` |
| `tracking.smooth` | Landmarks → landmarks | `samplePreciseFace` in `preciseFaceSampling.ts`; shared result feeds consumers |
| `tracking.anchors` | Landmarks → anchors | Cable endpoint configuration; consumes the same landmark source |
| `geometry.face` | Landmarks + topology → UV geometry | [`landmarksToMesh`](../../src/services/operators/geometry/mesh.ts); topology supplied by the face adapter |
| `depth.estimate` | Image → relative depth | Existing local depth worker/model; no mesh or landmark replacement |
| `depth.calibrate` | Relative depth + optional reference geometry → calibrated depth | `calibrateCableDepth`; reference disconnection uses image-relative normalization |
| `geometry.depth` | Calibrated depth → UV geometry | [`depthToMesh`](../../src/services/operators/geometry/depthMesh.ts) |
| `geometry.merge-surface` | Primary mesh + depth mesh → geometry | [`mergeSurfaceMeshes`](../../src/services/operators/geometry/mergeSurfaceMeshes.ts); outline cut, clipped exterior, seam blend and subdivision |
| `collision.mesh` | Geometry → collider | [`meshCollision`](../../src/services/operators/geometry/meshCollision.ts); indexed mesh, independent of MediaPipe |
| `forces.wind` | Direction, strength, gust + optional scalar → force | [`wind.ts`](../../src/services/operators/wind.ts); shared with Flock |
| `forces.gravity`, `forces.drag` | Strength/damping → force/drag | Shared force evaluator |
| `values.number`, `values.oscillator` | Parameters → scalar | Shared value evaluator |
| `simulation.rope` | Anchors + forces + drag + colliders → curves | Cable solver |
| `render.cables` | Curves + surface geometry → scene | 2D cable pass or saved native 3D geometry |
| `scene.transform`, `scene.output` | Scene → clip contribution | Face Cables group boundary and existing clip transform |

The geometry functions have no clip/store/effect ownership. The bake adapter maps
landmarks and depth into a common coordinate system. Native rendering and depth
collision both consume the same merged exterior, including clipping at image
edges. Primary geometry retains its exact tracked coordinates and UVs. This is a
surface-specific stitch, displayed as **Stitch Surfaces**, not a general solid-mesh
Boolean union or a simple concatenation of meshes. The stable saved operator ID
`geometry.merge-surface` is unchanged.

## Port contracts and reusable families

[`portContracts.ts`](../../src/services/operators/portContracts.ts) defines semantic
types, supported intermediate representations and per-port constraints. The same
contracts feed canvas labels/colors, hover and keyboard details, catalog entries,
connection dropdowns and operator graph validation. For example, a relative depth
grid and a calibrated depth grid both have type Depth but are not interchangeable
at the depth-to-mesh input. Stitch Surfaces requires a primary face mesh with a
closed UV outline and background depth geometry in the same coordinate space.
Collapsed boundary ports preserve these restrictions.

Transform and smoothing belong to typed families that preserve their input signal.
Current executable variants are **UV transform** (UV to UV), **Clip Transform**
(scene to scene, applying the owning clip's matrix/keyframes) and **Smooth
Landmarks** (landmarks to landmarks, temporal motion-adaptive filtering). The
landmark filter uses neighboring samples, preserves fast motion and avoids missing
detections or timing gaps. These definitions do not yet provide arbitrary mesh
transforms, selectable smoothing methods, mesh smoothing or image smoothing through
one polymorphic operator. Such variants require their own supported data contracts
and executable adapters; adding a catalog label alone is insufficient.

The cable executor currently supports one tracked face, one relative depth branch
and a rope solver. Additional surface instances can reuse incoming values and be
connected within those constraints. Inconsistent landmark sources or collision
geometry are rejected instead of silently executing another graph.

## Image-surface scene operators

`image.frame` provides the decoded image. `texture.uv` composes UV transforms;
`texture.image` maps the frame to a texture. `material.surface` applies tint and
opacity or a solid color. `geometry.plane` creates a sized plane;
`geometry.source` references the clip's baked geometry. `scene.mesh` pairs geometry
with material. `scene.clip-transform` applies the clip matrix and keyframes once;
`scene.render` outputs the object using timeline camera/light references.

[`compileSceneGraph`](../../src/services/operators/sceneGraph.ts) follows connected
ports, independent of node order/layout. The resulting plan reaches both native
plane and Face Cables shaders. Definitions are stored under `clip.nodeGraph.scene`;
Face Cables definitions and groups remain in `effect.params.operatorGraph`.
Only definitions and portable bake data are saved, never GPU/runtime handles.

## Extending the system

1. Search the live catalog and these registries before adding a new operator.
2. Reuse the existing pure implementation or extend its contract with explicit
   compatible defaults. Add a domain adapter only where execution is supported.
3. Define typed ports, parameter defaults, keyframe support and invalidation in
   the registry. Add controls through shared inspector primitives.
4. Validate graph structure and executor constraints before committing a mutation.
   Keep history, persistence, preview and export on the same definition.
5. Test a real output change, project compatibility and relevant UI connections.

Legacy `surface.hybrid`, `collision.face` and `collision.surface` IDs are retained
only for migration. They are expanded/replaced on read, hidden from the catalog,
and saved in the new form on the next graph mutation or successful bake. Migration
does not replace a saved depth artifact or run MediaPipe again.
