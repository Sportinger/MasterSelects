[Back to Features](./README.md) · [Node Workspace](./Node-Workspace.md)

# Node Catalog

Open **Nodes → Catalog** to search current definitions by name, ID or signal type.
Search also matches signal format descriptions. Filter by supported context and expand an entry for inputs, outputs, default
parameters and keyframe support. The inventory reads the registries at runtime;
it does not duplicate definitions. It is a reference; add operators from the
selected node's inspector or the appropriate domain's Add menu.

## Ownership and reuse

[`listNodeCatalog`](../../src/services/operators/operatorCatalog.ts) combines:

| Registry | Owner and scope |
|---|---|
| [`EFFECT_OPERATORS`](../../src/services/operators/operatorRegistry.ts) | Shared operator contracts, used by Face Cables and image-surface scenes |
| [`SCENE_OPERATORS`](../../src/services/operators/sceneOperators.ts) | Texture, UV, material, geometry, object transform and rendering |
| [`SURFACE_OPERATORS`](../../src/services/operators/surfaceOperators.ts) | Landmark mesh, depth calibration, depth mesh, seam merge and mesh collision |
| [`listFlockOperators`](../../src/services/flock/operators/flockOperatorRegistry.ts) | Flock's typed compiler and GPU simulation; `sharedOperator` identifies shared implementations |
| [`EFFECT_REGISTRY`](../../src/effects/index.ts) | Existing image effects and composite effect groups |

The catalog reports actual supported contexts. A common port name does not imply
that every domain can execute every operator. Color grading, audio analysis and
field-backed camera/light settings remain documented in their own feature pages;
they are visible in the clip graph but are not yet registered in this inventory.
Model/splat/Flock/voxel renderers have not been replaced by the image-surface
executor. This inventory deliberately distinguishes what exists from what still
needs a compatible executor adapter.

## Face and depth processing

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
