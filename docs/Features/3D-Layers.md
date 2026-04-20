# 3D Layer System

MasterSelects now has two distinct 3D paths:

- Stable shared-scene 3D via Three.js for models, primitive meshes, 3D text, camera clips, and the default gaussian-splat route.
- A native WebGPU gaussian-splat renderer that can be enabled per clip when needed.

Legacy gaussian-avatar support still exists in code for migration and old project data, but new avatar import is disabled.

## Surface Status

| Surface | Status | Notes |
|---|---|---|
| Per-layer 3D toggle | Stable | Any normal video/image layer can be switched between 2D and 3D. |
| OBJ / glTF / GLB / FBX model import | Stable | Model clips are always 3D and render through Three.js. |
| Numbered GLB sequences | Stable | Numbered `.glb` frames import as a single 30fps model-sequence clip. |
| Primitive mesh clips | Stable | Cube, sphere, plane, cylinder, torus, cone, and 3D text are created from the Media Panel. |
| Scene camera clips | Stable | Timeline camera clips control the shared Three.js scene. |
| Gaussian splat clips | Stable but specialized | Default route is shared-scene Three.js; native WebGPU rendering is optional. |
| Numbered PLY / SPLAT sequences | Stable | Numbered `.ply` / `.splat` frames import as one shared-scene gaussian-splat sequence clip. |
| 3D effector clips | Stable but specialized | They influence shared-scene 3D layers live at playback time. |
| Gaussian avatar import | Legacy only | Import is blocked; existing projects may still expose blendshape editing. |
| Temporal / particle splat settings | Experimental | Wired in the engine/export path, but not yet exposed as a dedicated properties tab. |

## Rendering Model

```text
[2D layers] -------------------------------> Existing WebGPU compositor
        |
        +--> [3D model / mesh / text / camera / shared-splat layers]
        |          -> Three.js scene -> OffscreenCanvas -> compositor
        |
        +--> [Native gaussian-splat clips]
                   -> GaussianSplatGpuRenderer -> texture -> compositor
```

Three.js is used as the shared 3D scene for classic 3D layers and for the default gaussian-splat route. The native gaussian-splat renderer is a separate WebGPU path, enabled by the clip-level `useNativeRenderer` setting.

Camera clips and 3D effectors only affect the shared Three.js scene. They do not drive the native gaussian-splat renderer.

## Stable 3D Features

### Per-Layer 3D Toggle

- Any video or image clip can be toggled to 3D from the Transform panel.
- 3D layers become textured planes in the Three.js scene.
- Turning 3D off resets the 3D-specific transform state back to 2D defaults.

### 3D Model Import

- Supported import formats are `.obj`, `.gltf`, `.glb`, and `.fbx`.
- Model clips are automatically marked `is3D: true` and cannot be switched back to 2D.
- Models are auto-centered and normalized to fit the viewport.
- Default lighting is Ambient plus Directional lighting.
- The Transform panel exposes a wireframe debug toggle for model clips.
- Numbered `.glb` files like `frame000000.glb`, `frame000001.glb`, `frame000002.glb` are grouped into one model-sequence asset during import.
- GLB sequences currently default to 30fps and use frame-based playback through the existing model clip path.

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

### Scene Camera

There are two camera concepts in the product:

- Composition camera: project-level camera settings on the composition itself.
- Camera clips: timeline clips that control the shared Three.js scene.

Camera clips expose their own Properties tab with:

- FOV
- Near plane
- Far plane

The Transform tab also turns into camera-orbit controls for the active scene camera. In FPS mode, the preview accepts WASD/QE navigation plus mouse look.

## Gaussian Splats

Gaussian splat clips are imported from `.ply` and `.splat` files.

- Clips are created as `is3D: true`.
- The clip-level render tab exposes `useNativeRenderer`, `maxSplats`, `sortFrequency`, `splatScale`, `orientationPreset`, `nearPlane`, and `farPlane`.
- The default renderer is the shared Three.js scene path.
- Native WebGPU rendering is optional and off by default.
- Numbered `.ply` or `.splat` files like `scan000000.ply`, `scan000001.ply`, `scan000002.ply` are grouped into one gaussian-splat sequence asset during batch import.
- Gaussian-splat sequences currently stay on the shared Three.js scene path even if a clip was previously set to native render.
- The shared-scene route participates in scene cameras and 3D effectors.
- The native route uses its own camera-style navigation controls in the Transform tab.
- A per-clip `3D Effector` toggle in the Transform tab lets you opt shared-scene splat/model layers in or out.

Some gaussian-splat settings exist in the data model and export pipeline but are not yet surfaced as a full dedicated UI:

- `backgroundColor`
- temporal playback settings
- particle effect settings

Those are wired through the renderer and export code, but they should still be treated as in-progress surface area.

## 3D Effectors

3D effector clips are non-rendering timeline clips that influence shared-scene 3D layers.

- Modes: `repel`, `attract`, `swirl`, and `noise`
- Controls: strength, falloff, speed, and seed
- Transform scale acts as the effector radius
- They do not render visible content on their own
- Shared-scene gaussian splats use the direct splat deformation path
- Shared-scene gaussian-splat sequences also use that direct splat deformation path frame by frame
- Models, primitive meshes, and 3D text receive object-level motion
- Native gaussian splats ignore 3D effectors because they do not run in the shared Three.js scene

This is a shared-scene 3D feature that is stable in the UI, but it does not extend into the native gaussian-splat renderer.

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
| 3D effector clip | Transform, Effector, Effects, Masks, Transcript, Analysis |
| 3D text clip | 3D Text, Transform, Effects, Masks |
| Legacy gaussian avatar clip | Transform, Blendshapes |

The Transform tab is context-sensitive:

- For normal 3D layers, it shows position, scale, rotation, opacity, blend mode, and 3D toggles.
- For camera clips, it becomes scene-navigation controls.
- For native gaussian splats, it behaves like orbit/FPS camera controls.
- The `Speed` field is explicitly marked WIP in the UI.

## Export

3D layers are included in export.

- Shared-scene 3D models, meshes, text, and default gaussian splats render through the Three.js path.
- Native gaussian splats are handled as a separate WebGPU render target path.
- Export waits for 3D and splat readiness before capture so preview and export stay aligned.

## Key Files

| File | Purpose |
|---|---|
| `src/engine/three/ThreeSceneRenderer.ts` | Shared Three.js scene renderer |
| `src/engine/three/types.ts` | Shared-scene 3D and effector runtime types |
| `src/engine/render/RenderDispatcher.ts` | Route selection for Three.js, native splats, and effectors |
| `src/engine/render/LayerCollector.ts` | Collects renderable layer sources |
| `src/stores/timeline/clip/addModelClip.ts` | Model clip creation |
| `src/stores/timeline/meshClipSlice.ts` | Primitive mesh and 3D text clip creation |
| `src/stores/timeline/cameraClipSlice.ts` | Timeline camera clip creation |
| `src/stores/timeline/clip/addGaussianSplatClip.ts` | Gaussian splat clip creation |
| `src/stores/timeline/splatEffectorClipSlice.ts` | 3D effector clip creation |
| `src/components/panels/properties/TransformTab.tsx` | Context-sensitive 3D transform and camera controls |
| `src/components/panels/properties/GaussianSplatTab.tsx` | Gaussian splat render settings tab |
| `src/components/panels/properties/CameraTab.tsx` | Scene camera settings tab |
| `src/components/panels/properties/SplatEffectorTab.tsx` | 3D effector settings tab |
| `src/components/panels/properties/BlendshapesTab.tsx` | Legacy gaussian-avatar blendshapes tab |
| `src/engine/featureFlags.ts` | 3D feature flags |

## Supported Formats

| Format | Current support | Notes |
|---|---|---|
| `.obj` | Supported | Imported as a Three.js model clip. |
| `.gltf` | Supported | Imported as a Three.js model clip. |
| `.glb` | Supported | Imported as a Three.js model clip. Numbered `.glb` frames are grouped into a model-sequence clip. |
| `.fbx` | Supported | Imported as a Three.js model clip. |
| `.ply` | Supported | Gaussian splat import. Numbered `.ply` frames are grouped into a shared-scene sequence clip. |
| `.splat` | Supported | Gaussian splat import. Numbered `.splat` frames are grouped into a shared-scene sequence clip. |
| `.ksplat` | Not yet supported | Parser stubs exist, but the file is rejected today. |
| `.gsplat-zip` | Not yet supported | Parser stubs exist, but the file is rejected today. |
| Gaussian avatar `.zip` | Legacy only | Import is blocked in the current product surface. |

## Limitations

- Native gaussian splats remain an optional path, not the default.
- Temporal and particle splat controls are still partially surfaced in the UI.
- Camera clips control the shared scene; they do not replace composition-level camera settings.
- Legacy gaussian-avatar import is disabled.
- `ksplat` and `gsplat-zip` are not supported yet, even though the loader code knows about them.
