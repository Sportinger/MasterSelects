# 3D Layer System

MasterSelects authorable 3D content now resolves through one shared scene contract.

- The native WebGPU scene is the primary runtime for 3D planes, primitive meshes, 3D text, imported OBJ/glTF/GLB models, camera clips, and native gaussian-splat scene objects.
- Gaussian splat clips render through the native WebGPU scene path and stay inside the same scene camera, object-transform, and effector contract as the rest of the 3D system.
- The old `three.js` bridge has been removed. Native shared-scene rendering is the only active 3D runtime.

Legacy gaussian-avatar support still exists in code for migration and old project data, but new avatar import is disabled.

## Surface Status

| Surface | Status | Notes |
|---|---|---|
| Per-layer 3D toggle | Stable | Any normal video/image layer can be switched between 2D and 3D. |
| 3D video/image planes | Stable | `clip.is3D` video and image layers render as scene planes. |
| OBJ / glTF / GLB model import | Stable | Model clips are always 3D and render as shared-scene objects. |
| Primitive mesh clips | Stable | Cube, sphere, plane, cylinder, torus, cone, and 3D text render through the native shared scene. |
| Scene camera clips | Stable | Timeline camera clips drive preview and export scene navigation. |
| Gaussian splat clips | Stable | They render as normal shared-scene objects under the native WebGPU path. |
| Splat effector clips | Stable but specialized | They deform scene-driven splats live at playback time; 3D planes remain excluded in phase 1. |
| Gaussian avatar import | Legacy only | Import is blocked; existing projects may still expose blendshape editing. |
| Temporal / particle splat settings | Experimental | Wired in the engine/export path, but not yet exposed as a dedicated properties tab. |

## Rendering Model

```text
[2D layers] --------------------------------> Existing WebGPU compositor
        |
        +--> [3D planes / meshes / text / models / splats / cameras]
                   -> Scene layer collection
                   -> Shared scene camera resolution
                   -> NativeSceneRenderer
                   -> one synthetic 3D scene texture
                   -> compositor
```

Prepared splat runtime metadata, native splat rasterization, preview, nested compositions, preload, readiness, and export now all converge on the same scene-layer and scene-camera contract.

## Stable 3D Features

### Per-Layer 3D Toggle

- Any video or image clip can be toggled to 3D from the Transform panel.
- 3D layers become textured planes in the common 3D scene.
- Turning 3D off resets the 3D-specific transform state back to 2D defaults.

### 3D Model Import

- Supported import formats are `.obj`, `.gltf`, and `.glb`.
- Model clips are automatically marked `is3D: true` and cannot be switched back to 2D.
- Models are auto-centered and normalized to fit the viewport.
- Default lighting is Ambient plus Directional lighting.
- The Transform panel exposes a wireframe debug toggle for model clips.
- Imported models use a native runtime/cache path.

### Primitive Meshes and 3D Text

Create mesh clips from the Media Panel via `+ Add > Mesh` or the context menu:

| Primitive | Geometry | Notes |
|---|---|---|
| Cube | `BoxGeometry` | Default 0.6 x 0.6 x 0.6 |
| Sphere | `SphereGeometry` | Default radius 0.35 |
| Plane | `PlaneGeometry` | Default 0.8 x 0.8 |
| Cylinder | `CylinderGeometry` | Default radius 0.25, height 0.6 |
| Torus | `TorusGeometry` | Default radius 0.3, tube 0.1 |
| Cone | `ConeGeometry` | Default radius 0.3, height 0.6 |
| 3D Text | `text3d` mesh type | Editable text geometry with font, bevel, spacing, and scale controls |

- Mesh items live in a `Meshes` folder in the Media Panel.
- Dragging a mesh item to the timeline creates a 3D clip with `is3D: true` and `meshType`.
- All transform properties and keyframe animation are supported.
- Primitive meshes and 3D text render through the native shared scene contract.

### Scene Camera

There are two camera concepts in the product:

- Composition camera: project-level camera settings on the composition itself.
- Camera clips: timeline clips that drive the active shared scene camera.

Camera clips expose their own Properties tab with:

- FOV
- Near plane
- Far plane

The Transform tab becomes scene-navigation controls for the active camera clip. In FPS mode, the preview accepts WASD/QE navigation plus mouse look. Free scene navigation now belongs to camera clips rather than gaussian-splat clips.

## Gaussian Splats

Gaussian splat clips are imported from `.ply` and `.splat` files.

- Clips are created as `is3D: true`.
- The Gaussian tab exposes the native renderer status together with `maxSplats`, `sortFrequency`, `splatScale`, `orientationPreset`, `nearPlane`, and `farPlane`.
- Gaussian splats participate in scene cameras, object transforms, object-level effectors, preview, nested compositions, export, preload, and readiness checks through the same native shared-scene path.
- Sequence splats follow the same shared runtime contract and are no longer treated as a permanent legacy-only scene path.
- The Transform tab now exposes normal object transforms for gaussian splats. Scene navigation lives on camera clips.

Some gaussian-splat settings exist in the data model and export pipeline but are not yet surfaced as a full dedicated UI:

- `backgroundColor`
- temporal playback settings
- particle effect settings

Those are wired through the renderer and export code, but they should still be treated as in-progress surface area.

## Splat Effectors

Splat effector clips are timeline clips that affect scene-driven splats, including native gaussian-splat clips.

- Modes: `repel`, `attract`, `swirl`, and `noise`
- Controls: strength, falloff, speed, and seed
- Transform scale acts as the effector radius
- They do not render visible content on their own
- 3D planes remain excluded in phase 1 for parity with older projects

This is a specialized 3D feature that is stable in the UI and now follows the shared scene contract.

## Legacy Gaussian Avatars

Gaussian avatar import is now legacy-only:

- The import action is blocked in the current product surface.
- Existing projects can still carry legacy avatar clips.
- The Blendshapes tab remains available for those legacy clips.
- New work should use gaussian-splat clips instead.

If you see avatar-specific code paths in the renderer or AI tooling, treat them as migration/reference code rather than the recommended authoring path.

## Properties Tabs

| Clip type | Visible tabs |
|---|---|
| Regular 2D clip | Transform, Effects, Masks, Transcript, Analysis |
| Camera clip | Transform, Camera |
| Gaussian splat clip | Transform, Gaussian, Effects, Masks, Transcript, Analysis |
| Splat effector clip | Transform, Effector, Effects, Masks, Transcript, Analysis |
| 3D text clip | 3D Text, Transform, Effects, Masks |
| Legacy gaussian avatar clip | Transform, Blendshapes |

The Transform tab is context-sensitive:

- For normal 3D layers, it shows position, scale, rotation, opacity, blend mode, and 3D toggles.
- For camera clips, it becomes scene-navigation controls.
- For gaussian splats, it now behaves like a normal 3D object transform surface plus 3D effector toggle.
- The `Speed` field is explicitly marked WIP in the UI.

## Export

3D layers are included in export.

- Scene camera resolution, scene-layer collection, splat runtime preparation, preload, and readiness now share the same scene contract across preview, nested, and export.
- Gaussian splats can export through prepared or direct native scene modes while keeping identical scene-camera semantics.
- Export waits for shared 3D and splat readiness before capture so preview and export stay aligned.

## Key Files

| File | Purpose |
|---|---|
| `src/engine/native3d/NativeSceneRenderer.ts` | Shared native 3D scene renderer entrypoint |
| `src/engine/native3d/passes/MeshPass.ts` | Native primitive mesh, imported model, and 3D text render pass |
| `src/engine/native3d/assets/ModelRuntimeCache.ts` | Native OBJ / glTF / GLB runtime cache, centering, and normalization |
| `src/engine/native3d/assets/TextMeshCache.ts` | Native font-outline text mesh cache and extrusion generator |
| `src/engine/scene/types.ts` | Shared scene runtime and effector types |
| `src/engine/scene/SceneCameraUtils.ts` | Shared scene camera resolution |
| `src/engine/scene/SceneEffectorUtils.ts` | Renderer-neutral object-level effector math |
| `src/engine/scene/runtime/SharedSplatRuntimeUtils.ts` | Shared splat runtime request and readiness helpers |
| `src/engine/render/RenderDispatcher.ts` | Shared scene routing plus splat runtime/readiness integration |
| `src/engine/native3d/passes/EffectorCompute.ts` | Native gaussian-splat effector deformation pass |
| `src/services/layerBuilder/LayerBuilderService.ts` | Scene-layer construction for preview and nested rendering |
| `src/engine/export/ExportLayerBuilder.ts` | Export layer building for shared scene content |
| `src/engine/export/preloadGaussianSplats.ts` | Shared splat preload and export preparation |
| `src/components/panels/properties/TransformTab.tsx` | Context-sensitive 3D transform and scene-navigation controls |
| `src/components/panels/properties/GaussianSplatTab.tsx` | Gaussian splat render settings tab |
| `src/components/panels/properties/CameraTab.tsx` | Scene camera settings tab |
| `src/components/panels/properties/SplatEffectorTab.tsx` | Splat effector settings tab |

## Supported Formats

| Format | Current support | Notes |
|---|---|---|
| `.obj` | Supported | Imported as a 3D model clip in the shared scene contract. |
| `.gltf` | Supported | Imported as a 3D model clip in the shared scene contract. |
| `.glb` | Supported | Imported as a 3D model clip in the shared scene contract. |
| `.fbx` | Not supported | Do not rely on FBX import; no native FBX loader ships today. |
| `.ply` | Supported | Gaussian splat import. |
| `.splat` | Supported | Gaussian splat import. |
| `.ksplat` | Not yet supported | Parser stubs exist, but the file is rejected today. |
| `.gsplat-zip` | Not yet supported | Parser stubs exist, but the file is rejected today. |
| Gaussian avatar `.zip` | Legacy only | Import is blocked in the current product surface. |

## Limitations

- Temporal and particle splat controls are still only partially surfaced in the UI.
- Composition-level camera settings still remain available alongside camera clips.
- Legacy gaussian-avatar import is disabled.
- `ksplat` and `gsplat-zip` are not supported yet, even though loader code knows about them.
