# Native 3D Shared Scene Migration Plan

## Status

- Completed on 2026-04-21.
- `src/engine/three/` has been removed.
- `three` and `@types/three` have been removed from the dependency graph.
- This document remains as the historical migration plan, so references to the old Three-based path below are intentional context, not active code dependencies.

## Goal

Replace the current `ThreeSceneRenderer` shared-scene path with a native WebGPU 3D scene so that the following render in one common scene with one common camera:

- gaussian splats
- point clouds
- 3D meshes
- 3D text
- 3D video and image planes
- imported 3D models

The branch focus is native 3D only. `three.js` should be removed, but only after the native path fully replaces preview, nested composition rendering, export, preload, and readiness checks.

## Locked Decisions

- Do not delete `three.js` first. Build the native replacement, switch call sites, then remove `three`.
- Point clouds stay on the existing `gaussian-splat` clip type for now. No new clip type in phase 1.
- A shared camera means camera clips and composition camera drive the whole 3D scene. Native splat clips must stop behaving like their own private camera.
- The compositor should still receive one synthetic 3D scene texture, not many unrelated 3D layer textures.
- `orientationPreset` for splats must survive the migration, and it must stay separate from import-time canonical basis correction.
- `splatRuntimeCache` is shared runtime infrastructure today. It must be extracted or moved to a renderer-neutral location before `src/engine/three/` can be deleted.
- Nested composition parity is a first-class migration requirement. It does not ship later as cleanup.
- Shared scene contracts are matrix-first. `worldMatrix` is the required runtime field. `worldTransform` may exist only as optional editor/debug metadata and must not be the renderer contract.
- Shared splat object placement must keep the current normalization semantics. Prepared splat runtime metadata such as bounds, centering, and normalization scale stays part of the shared contract until an equivalent renderer-neutral replacement exists. `worldMatrix` is applied on top of that local normalized scene space, not as a vague replacement for it.
- The native shared scene uses one real depth contract in phase 1: shared depth texture, documented pass order, splats depth-test but do not depth-write.
- Object-level 3D effectors keep current parity in phase 1: planes remain excluded unless a later feature explicitly expands support.
- Scene navigation becomes scene-generic through compatibility selectors and actions first. The actual backing-store field rename happens late, after the renderer migration is stable.
- `OBJ` and `glTF/GLB` are phase-1 targets. `FBX` is out of scope unless a real native loader exists, and the UI/docs must not overclaim support.
- Gaussian splat sequences are not allowed to remain a permanent legacy exception. If phase 1 keeps them on the old route temporarily, the migration plan must still converge on native shared-scene sequence support rather than preserving a hidden Three-only fallback.

## Current Architecture Findings

### Current 3D split

- Shared-scene 3D currently lives in `src/engine/render/RenderDispatcher.ts` -> `process3DLayers()` and `src/engine/three/ThreeSceneRenderer.ts`.
- Native gaussian splats currently live in `src/engine/render/RenderDispatcher.ts` -> `processGaussianSplatLayers()` and `src/engine/gaussian/core/GaussianSplatGpuRenderer.ts`.
- The current architecture is not one 3D system. It is two separate systems:
  - shared scene via Three.js
  - native fullscreen splat rendering via WebGPU

### Why the native path is not yet a shared scene

- The native splat path renders one clip to one fullscreen texture.
- In the native path, the clip transform is still used as camera navigation input.
- In `gaussianSplat.wgsl`, `visibilityCull.wgsl`, and `radixSort.wgsl`, splat positions are used directly without a per-object world transform.
- That means splats cannot currently exist as normal objects inside a shared scene.

### Nested composition reality

- `NestedCompRenderer.process3DLayersForNested()` currently uses `DEFAULT_CAMERA_CONFIG` rather than the same camera-solving path as preview/export.
- `LayerBuilderService.buildNestedClipLayer()` has no `gaussian-splat` branch and returns `null` after the `model` branch.
- Result: nested comps already diverge for native splats. This is not a late cleanup problem. It is a migration blocker.

### Export and preload are still coupled to Three

- Export readiness in `RenderDispatcher.ensureExportLayersReady()` still initializes `ThreeSceneRenderer` and waits for Three-backed splat runtime preparation.
- `src/engine/export/preloadGaussianSplats.ts` still uses Three-specific initialization and preload helpers.
- Sequence-frame splat export behavior already depends on this shared runtime prep. It cannot be rebuilt casually at the end.

### `splatRuntimeCache` is already shared infrastructure

- `src/engine/three/splatRuntimeCache.ts` is used by more than the Three renderer:
  - layer building and prewarm
  - media import / add-clip paths
  - export preload and readiness
- Treating it as a disposable Three-only helper is wrong. It must become shared runtime infrastructure before renderer deletion.

### Transform and unit semantics are mixed today

- `RenderDispatcher` currently converts some rotations from radians to degrees for the Three path.
- `ExportLayerBuilder` has special `preserveRotationDegrees` logic for native splats.
- `Preview.tsx`, `TransformTab.tsx`, and `LayerBuilderService` still treat native splats partly like camera-navigation surfaces instead of normal scene objects.
- Three shared-scene splats also depend on prepared runtime normalization from `splatRuntimeCache` (`rawBounds`, `normalizedBounds`, `normalizationScale`) before clip transforms are applied.
- The native splat path uploads raw canonical loader data directly, then interprets the clip transform as camera orbit input rather than as an object transform.
- A matrix-first scene contract is safer than trying to standardize on ad-hoc `position` / `rotation` / `scale` handling across preview, nested, and export.
- But matrix-first alone is not enough for splats: the migration also needs an explicit local-space contract that says how canonical basis correction, centering, normalization, and clip/object transforms compose.

### Current depth behavior is not shared-scene ready

- `GaussianSplatGpuRenderer` currently renders to a color target without a shared depth attachment.
- The current Three shared-scene path uses normal scene depth testing for meshes, planes, and splats.
- A native shared scene needs an explicit depth and pass-order contract, not just a color texture swap.

### Product and docs mismatches that the migration must not preserve by accident

- Object-level 3D effectors currently skip planes in the Three path. If planes should start responding to effectors, that is a deliberate feature change, not existing parity.
- UI/docs currently advertise `FBX` support in places even though the actual Three model loader only handles `OBJ` and `glTF/GLB`.

### What already exists and should be reused

- Camera math in `src/engine/gaussian/core/SplatCameraUtils.ts`
- Object-level effector math in `src/utils/threeDEffectors.ts`
- Prepared splat runtime and preload behavior in `src/engine/three/splatRuntimeCache.ts`
- PLY canonicalization and point-cloud scale estimation in `src/engine/gaussian/loaders/PlyLoader.ts`
- Import-time canonical basis correction in `src/engine/gaussian/loaders/index.ts`
- Gaussian particle compute patterns in `src/engine/gaussian/effects/ParticleCompute.ts`
- Existing export-readiness and preload tests that already cover parts of this path

## Current vs Target Data Flow

Current:

```text
LayerBuilderService
  -> RenderDispatcher
     -> process3DLayers() -> ThreeSceneRenderer -> shared 3D texture
     -> processGaussianSplatLayers() -> GaussianSplatGpuRenderer -> per-splat texture
     -> compositor merges unrelated 3D outputs

NestedCompRenderer
  -> separate Three path + default camera fallback

Export / preload / readiness
  -> Three init + splatRuntimeCache prep + export-only gating
```

Target:

```text
LayerBuilderService
  -> SceneLayerCollector
  -> SceneCameraResolver
  -> NativeSceneRenderer
     -> shared color target
     -> shared depth target
     -> one synthetic 3D scene texture for compositor

NestedCompRenderer
  -> same SceneLayerCollector
  -> same SceneCameraResolver
  -> same NativeSceneRenderer

Export / preload / readiness
  -> same shared runtime caches
  -> same SceneLayerCollector
  -> same SceneCameraResolver
  -> same NativeSceneRenderer (deterministic export mode only where needed)
```

## Target Architecture

Split the migration into two layers, not one:

- a renderer-neutral shared-scene foundation under `src/engine/scene/`
- the actual native renderer under `src/engine/native3d/`

Suggested top-level structure:

- `src/engine/scene/types.ts`
- `src/engine/scene/SceneCameraUtils.ts`
- `src/engine/scene/SceneLayerCollector.ts`
- `src/engine/scene/runtime/SharedSplatRuntimeCache.ts`
- `src/engine/native3d/NativeSceneRenderer.ts`
- `src/engine/native3d/passes/PlanePass.ts`
- `src/engine/native3d/passes/MeshPass.ts`
- `src/engine/native3d/passes/SplatPass.ts`
- `src/engine/native3d/passes/EffectorCompute.ts`
- `src/engine/native3d/assets/ModelRuntimeCache.ts`
- `src/engine/native3d/assets/TextMeshCache.ts`

The important structural point is this:

- scene contracts, camera solving, layer collection, and splat runtime preparation must not live in `src/engine/three/`
- only renderer implementation details should live in `src/engine/native3d/`

## Required Scene Contracts

Create a generic scene-layer contract that replaces `Layer3DData` from `src/engine/three/types.ts`.

Canonical shape:

- `kind: 'splat' | 'plane' | 'primitive' | 'text3d' | 'model'`
- `layerId`
- `clipId`
- `opacity`
- `blendMode`
- `threeDEffectorsEnabled`
- `worldMatrix`
- optional `worldTransform` for tooling/debugging only
- optional per-kind source payload
- optional render flags such as `alphaMode`, `doubleSided`, `castsDepth`, `receivesDepth`

Splat-specific local-space contract:

- prepared splat runtime owns canonical basis correction plus normalization metadata
- the runtime must expose the local-space basis needed by all renderers, either as:
  - normalized centers/axes plus `rawBounds` / `normalizedBounds` / `normalizationScale`
  - or an equivalent explicit `localNormalizationMatrix` / `localNormalizationInverse`
- `worldMatrix` applies after that local-space normalization step
- sequence splats must resolve against the same normalization reference frame or shared bounds contract in preview, nested, and export

Also create a shared camera contract:

- `viewMatrix`
- `projectionMatrix`
- `cameraPosition`
- `cameraTarget`
- `cameraUp`
- `fov`
- `near`
- `far`
- `viewport`

The shared contract should be camera-agnostic and renderer-agnostic. Preview free-nav, camera clips, composition camera, nested comp camera resolution, and export camera resolution should all end in the same `SceneCamera`.

## Shared Depth And Pass Contract

The native shared scene must define this explicitly before broad feature migration:

1. one shared depth attachment per scene render
2. one documented pass order for opaque, splat, and transparent work
3. one documented rule for whether splats only depth-test or also write depth
4. identical pass ordering in preview, nested, and export, except for deterministic export toggles that are explicitly documented

Minimum expectation:

- opaque meshes, models, text, and any depth-writing planes participate in the shared depth buffer
- splats render against the same camera and depth contract
- transparent planes or materials must have a documented ordering rule relative to splats

Phase-1 default:

- pass order is `opaque depth-writing geometry -> splats -> transparent planes/materials`
- splats depth-test against opaque depth but do not write scene depth
- transparent plane and splat interop is best-effort in phase 1, documented as not fully order-independent
- order-independent transparency is explicitly deferred until after parity migration

If this contract is left implicit, preview and export will drift again.

## Implementation Defaults

These defaults optimize for low migration risk, low churn, and parity-first correctness. Change them only with an explicit follow-up decision.

### 1. Runtime transform contract

- `worldMatrix` is the only required runtime transform field
- `worldTransform` may be carried alongside it for editor/debug introspection, but render passes, cull, sort, and compute stages consume `worldMatrix`
- `SceneLayerCollector` is responsible for converting clip transform data into the canonical matrix once
- for splats, `SceneLayerCollector` or shared runtime prep must also produce the canonical local-space normalization contract once, instead of re-deriving bounds/centering differently per renderer

Why:

- this removes repeated degree/radian and object/camera reinterpretation from downstream passes
- preview, nested, and export can share the same runtime contract without per-call transform glue
- it prevents the Three shared-scene route from keeping hidden centering/scale behavior that the native renderer forgets to reproduce

### 2. Phase-1 splat depth policy

- splats depth-test against the shared depth buffer
- splats do not write scene depth in phase 1
- opaque geometry writes depth before splats render
- transparent plane/material behavior relative to splats is documented as best-effort, not perfectly order-independent

Why:

- this matches current Three parity more closely
- it avoids shipping a half-correct splat depth-write path that creates worse halo and cutout artifacts than the current system

### 3. Plane effector policy

- planes remain excluded from object-level 3D effectors in phase 1
- if plane support is added later, treat it as a new feature with its own tests, docs, and migration note

Why:

- current behavior already excludes planes
- preserving that behavior avoids silent project changes during the renderer migration

### 4. Scene navigation rename strategy

- add scene-generic selectors and actions first
- keep `gaussianSplatNavClipId`, `gaussianSplatNavFpsMode`, `setGaussianSplatNavClipId()`, and `setGaussianSplatNavFpsMode()` as temporary backing API during migration
- migrate call sites to scene-generic accessors before renaming the backing fields themselves
- do the physical backing-field rename only in cleanup after preview, nested, and export are stable

Why:

- this avoids a large semantic churn across `Preview.tsx`, `TransformTab.tsx`, `RenderDispatcher.ts`, and `engineStore.ts` while core rendering is still moving
- one compatibility layer is cheaper than a repo-wide rename plus conflict surface during the risky phases

### 5. Sequence migration default

- if gaussian splat sequences must temporarily stay on the old shared-scene route during the early migration, that is a temporary checkpoint only
- the end state still requires sequence splats to use the same shared runtime contract and the same native shared-scene renderer
- do not leave `useNativeRenderer: false for sequences` as a permanent product rule after migration

Why:

- sequence-frame runtime selection is already part of export/readiness behavior and test coverage
- leaving sequences behind would preserve a hidden Three dependency after the supposed renderer migration

## Migration Phases

### Phase 0: Extract shared scene foundation

1. Add `src/engine/scene/` for renderer-neutral scene contracts, camera solving, and layer collection.
2. Move or wrap `src/engine/three/splatRuntimeCache.ts` into a shared runtime module.
3. Keep temporary adapters so current Three and current native splat paths can both consume the same prepared splat runtime and camera helpers.
4. Add parity tests for shared runtime prep and camera resolution before deeper rendering work starts.

### Phase 1: Build the native shared-scene shell

1. Add `src/engine/native3d/` with renderer shell, pass graph, and shared color/depth targets.
2. Resolve one shared `SceneCamera` for preview, nested, and export.
3. Add scene-generic navigation selectors and actions as compatibility APIs, but keep existing backing store names for now.
4. Document the scene pass graph with inline ASCII comments in the renderer.

### Phase 2: Convert native splats from camera-driven to object-driven

1. Add per-object world transform support to the native splat render path.
2. Update all splat stages to use transformed positions consistently:
   - main splat raster pass
   - visibility cull pass
   - sort pass
   - any compute-driven deformation path that feeds visible positions
3. Support `orientationPreset` inside native object transform handling.
4. Keep import-time canonical basis correction and clip-level `orientationPreset` as separate steps so they do not double-apply.
5. Keep point clouds on the same canonical splat buffer path.

This is the hard blocker. Without object-space splats, there is no real shared scene.

### Phase 3: Lock the depth and blending contract

1. Implement the shared depth attachment and explicit pass ordering.
2. Implement the phase-1 splat depth policy: depth-test on, depth-write off, and make it testable.
3. Add mesh-plane-splat occlusion tests that run through preview, nested, and export paths.
4. Keep deterministic export behavior as a renderer mode, not a separate export-only renderer.

### Phase 4: Add native 3D planes

1. Implement a plane pass for 3D video, image, and canvas-backed planes.
2. Reuse existing texture acquisition logic from the current compositor and Three plane texture update path.
3. Preserve current world-space fitting behavior so old projects do not visually jump.
4. Integrate plane rendering into the shared depth and transparent-pass contract.

This phase covers:

- `clip.is3D` videos
- `clip.is3D` images
- any future canvas-backed 3D planes

Why before effectors:

- planes are the broadest shared-scene 3D surface already used by normal editor content
- preview, nested, and export cannot fully swap to one native shared-scene path while the most common shared-scene 3D layer type still depends on Three

### Phase 5: Add native effectors

1. Port object-level effector math from `src/utils/threeDEffectors.ts` into an engine-neutral utility.
2. Build a native splat effector compute path that deforms splat data before cull, sort, and render.
3. Preserve current mesh, text, and model effector behavior.
4. Preserve current plane exclusion for parity in phase 1. If plane support is added later, treat it as a new feature with tests and docs.

### Phase 6: Add native primitive meshes

1. Port the current primitive definitions from `ThreeSceneRenderer.createPrimitiveGeometry()`.
2. Build vertex and index buffers natively for:
   - cube
   - sphere
   - plane
   - cylinder
   - torus
   - cone
3. Preserve wireframe debug behavior or add a native equivalent.

### Phase 7: Add native 3D text

1. Do not degrade 3D text into a billboard.
2. Reuse the same font sources currently imported by `ThreeSceneRenderer`.
3. Build a real native text mesh generator using those font outlines.
4. Match current properties:
   - text
   - font family
   - font weight
   - size
   - depth
   - bevel controls
   - line height
   - letter spacing
   - alignment

If triangulation support is required, vendor a small local triangulation helper instead of keeping Three.js only for text.

### Phase 8: Add native imported model rendering

1. Add a native model runtime and cache layer.
2. Support `OBJ` and `glTF/GLB` first.
3. Preserve:
   - centering
   - normalization to unit scale
   - default material fallback
   - model sequence support
4. Do not claim `FBX` support unless a real native loader exists.

### Phase 9: Replace preview and nested 3D integration together

1. Remove the split between:
   - `process3DLayers()`
   - `processGaussianSplatLayers()`
2. Replace both with one shared-scene native 3D pass in `RenderDispatcher`.
3. Replace the explicit Three.js nested path in `NestedCompRenderer` in the same migration window.
4. `LayerBuilderService.buildNestedClipLayer()` must gain real `gaussian-splat` support before this phase is considered complete.
5. Preview and nested must collect the same scene-layer contract and resolve the same camera rules.

Nested comp parity does not wait until the end.

### Phase 10: Replace export, preload, and readiness paths

1. Remove Three.js-specific readiness logic from export preparation.
2. Switch export preload to the shared runtime cache and shared scene collection modules.
3. Ensure export uses the same native shared-scene renderer and camera resolver as preview and nested.
4. Preserve sequence-frame splat runtime selection and deterministic export sorting.
5. Remove the old rule that sequence splats must stay on the Three shared-scene path.
6. Keep preview and export transform units identical by construction, not by scattered per-call conversions.

### Phase 11: Clean up UI semantics

1. Switch remaining UI and renderer call sites to scene-generic navigation APIs.
2. `TransformTab.tsx` must stop treating native gaussian splat clips as private camera controls.
3. `CameraTab.tsx` should describe the shared native scene camera, not the shared Three.js scene.
4. `GaussianSplatTab.tsx` should stop presenting "native vs shared scene" as two separate engines once the migration is complete.
5. `SplatEffectorTab.tsx` should stop saying "Shared Scene Only" in the old Three.js sense.
6. Preview navigation hint text in `Preview.tsx` must become scene-generic.
7. Rename the backing store fields to `sceneNavClipId` and `sceneNavFpsMode` only after all call sites already use the generic APIs.
8. Remove any remaining UI copy that suggests gaussian splat sequences are permanently shared-scene-only if that was only a migration bridge.

### Phase 12: Remove Three.js

Only after preview, nested comp, export, preload, and readiness all use the native shared-scene path:

1. delete `src/engine/three/`
2. remove `three` and `@types/three` from `package.json`
3. remove Three-specific tests or migrate them
4. update docs and support claims
5. remove or correct all remaining `FBX` support claims across file pickers, media classification, docs, comments, and import surfaces unless a real native FBX loader shipped

## Concrete File Changes

### New files

- `src/engine/scene/types.ts`
- `src/engine/scene/SceneCameraUtils.ts`
- `src/engine/scene/SceneLayerCollector.ts`
- `src/engine/scene/runtime/SharedSplatRuntimeCache.ts`
- `src/engine/native3d/NativeSceneRenderer.ts`
- `src/engine/native3d/passes/PlanePass.ts`
- `src/engine/native3d/passes/MeshPass.ts`
- `src/engine/native3d/passes/SplatPass.ts`
- `src/engine/native3d/passes/EffectorCompute.ts`
- `src/engine/native3d/assets/ModelRuntimeCache.ts`
- `src/engine/native3d/assets/TextMeshCache.ts`

### Files that must be changed

- `src/engine/render/RenderDispatcher.ts`
- `src/engine/render/NestedCompRenderer.ts`
- `src/engine/WebGPUEngine.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/engine/export/ExportLayerBuilder.ts`
- `src/engine/export/preloadGaussianSplats.ts`
- `src/components/preview/Preview.tsx`
- `src/components/panels/properties/TransformTab.tsx`
- `src/components/panels/properties/CameraTab.tsx`
- `src/components/panels/properties/GaussianSplatTab.tsx`
- `src/components/panels/properties/SplatEffectorTab.tsx`
- `src/components/panels/MediaPanel.tsx`
- `src/stores/engineStore.ts`
- `src/engine/gaussian/core/GaussianSplatGpuRenderer.ts`
- `src/engine/gaussian/core/SplatVisibilityPass.ts`
- `src/engine/gaussian/core/SplatSortPass.ts`
- `src/engine/gaussian/effects/ParticleCompute.ts`
- `src/engine/gaussian/shaders/gaussianSplat.wgsl`
- `src/engine/gaussian/shaders/visibilityCull.wgsl`
- `src/engine/gaussian/shaders/radixSort.wgsl`
- `src/engine/featureFlags.ts`
- `src/engine/three/splatRuntimeCache.ts`
- `docs/Features/3D-Layers.md`

### Files that should only be deleted after extraction and migration are complete

- `src/engine/three/ThreeSceneRenderer.ts`
- `src/engine/three/types.ts`
- `src/engine/three/splatSortPolicy.ts`
- `src/engine/three/splatRuntimeCache.ts`, but only after every caller uses the shared runtime cache location

## Build-AI Task Order

Use this order. Do not jump to cleanup early.

1. Extract renderer-neutral scene contracts, camera solving, and shared splat runtime prep.
2. Add a compatibility adapter for scene navigation state instead of renaming every caller immediately.
3. Build the native scene renderer shell with an explicit color/depth pass contract.
4. Convert native splats to object-space rendering.
5. Add native 3D planes.
6. Add native effector compute support.
7. Add native primitive meshes.
8. Add native 3D text.
9. Add native imported model rendering.
10. Replace preview `RenderDispatcher` and nested 3D integration together.
11. Replace export, preload, and readiness integration.
12. Update UI semantics, finish the late scene-nav backing-field rename, and correct docs/support claims.
13. Remove Three.js and dead code.

## Testing Requirements

At minimum, add or update unit coverage for:

- camera resolution parity for camera clips, composition camera, preview free-nav, nested comps, and export
- shared runtime cache behavior for base runtime, target runtime, and sequence-frame selection
- generic scene navigation adapter behavior during store rename
- native splat object transforms across raster, cull, sort, and compute deformation paths
- shared splat normalization parity so native shared-scene splats keep current centering, bounds, and scale semantics
- `orientationPreset` application without double-applying import-time canonical basis correction
- shared depth contract for mesh, plane, and splat occlusion
- plane effector behavior for the chosen parity decision
- 3D plane collection from `clip.is3D`
- text, mesh, and model layer collection into the scene contract
- nested composition gaussian-splat layer building and native 3D routing
- export readiness and preload without Three.js-specific branches
- deterministic export ordering with the shared runtime cache

Run before any commit:

- `npm run build`
- `npm run lint`
- `npm run test`

## Acceptance Criteria

- one camera clip can drive splats, point clouds, planes, primitive meshes, 3D text, and imported models in the same scene
- preview, nested comps, and export resolve the same scene camera and scene-layer contract for equivalent inputs
- shared runtime cache and preload paths no longer depend on `src/engine/three/`
- native splats and point clouds support object-space transforms with consistent cull, sort, and render behavior
- runtime render passes consume `worldMatrix` as the canonical transform contract
- splat local-space normalization is explicit and shared, so native and former-Three paths agree on centering and scale
- `clip.is3D` video and image layers render as native 3D planes
- object-level 3D effectors preserve current mesh, text, and model behavior, and planes remain excluded in phase 1
- nested compositions no longer depend on `ThreeSceneRenderer` or `DEFAULT_CAMERA_CONFIG` fallback for native splats
- export does not depend on Three.js preload or render code
- gaussian splat sequences do not require a permanent Three-only fallback
- scene navigation semantics are generic in the UI and renderer, and the old gaussian-specific backing names are gone by final cleanup
- UI and docs no longer claim `FBX` support unless a real native loader exists
- `three` and `@types/three` can be removed cleanly
- build, lint, and tests pass

## Non-Goals For Phase 1

- new clip types for point clouds
- full `FBX` support if no real native loader is implemented
- changing the existing timeline authoring model
- redesigning the compositor
- replacing unrelated 2D rendering systems

## Main Risks

### Risk: splat object transforms drift from cull and sort logic

Mitigation:

- implement world-transform support once and feed the same transformed positions into raster, cull, sort, and compute deformation paths

### Risk: shared runtime cache extraction breaks preview or export parity

Mitigation:

- move `splatRuntimeCache` early, not during deletion
- add parity tests around preload, readiness, and sequence-frame runtime selection before call-site migration

### Risk: nested comp parity slips behind preview work

Mitigation:

- treat nested support as part of the dispatcher swap, not a later cleanup phase
- add nested gaussian-splat collection tests before declaring the shared scene integrated

### Risk: depth ordering stays implicit and preview/export drift again

Mitigation:

- document one pass graph
- make occlusion behavior testable
- reuse the same renderer and pass ordering in preview, nested, and export

### Risk: old projects change appearance

Mitigation:

- preserve current world scaling conventions
- preserve current splat normalization and centering conventions, not only raw transforms
- preserve `orientationPreset`
- keep import-time canonical basis correction separate from clip-level transforms
- port default camera distance behavior before making visual improvements

### Risk: sequence splats accidentally remain a hidden Three.js island

Mitigation:

- keep sequence-frame runtime selection in the shared runtime contract from the beginning
- remove the current export/UI assumptions that sequences are forced onto the old shared-scene route before declaring migration complete

### Risk: 3D text migration becomes a hidden blocker

Mitigation:

- scope it explicitly as a real mesh task, not an afterthought
- allow a small vendored triangulation helper if needed

## Definition of Done

The migration is done only when:

- there is no render-time dependency on `src/engine/three/`
- preview, nested comps, and export all use the same native shared-scene renderer
- preload and readiness no longer depend on Three-specific runtime prep
- camera clips and splat effectors are scene-generic, not Three-specific
- docs reflect native shared-scene 3D as the only active path
