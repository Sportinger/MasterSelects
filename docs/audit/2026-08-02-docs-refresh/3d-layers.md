# 3D-Layers.md — audit 2026-08-02

## Verified (spot checks that held)

- The native shared WebGPU scene is the active renderer for 3D planes, meshes, text, models, lights, cameras, and splats. `src/engine/native3d/NativeSceneRenderer.ts`, `src/engine/render/RenderDispatcher.ts`, and `src/engine/render/dispatcher/sharedScene3DProcessor.ts` are present; no `three.js` import/reference remains under `src/` outside historical changelog text.
- Model import accepts OBJ, FBX, glTF, and GLB (`src/stores/timeline/helpers/mediaTypeHelpers.ts`), creates `is3D: true` model clips (`src/stores/timeline/clip/addModelClip.ts`), and the native cache/parser implementation is at `src/engine/native3d/assets/ModelRuntimeCache.ts` with OBJ, FBX, and glTF helpers beneath it.
- The documented primitive set and dimensions match `src/engine/native3d/passes/meshPass/primitiveGeometry.ts`; primitive mesh items use the `Meshes` folder (`src/stores/mediaStore/index.ts`).
- Scene lights have Point, Panel, and Environment variants and persist shadow controls, while the current native pass does not implement shadow maps. Evidence: `src/components/panels/properties/LightTab.tsx`, `src/types/light.ts`, and `src/engine/native3d/passes/MeshPass.ts`.
- Gaussian-splat formats and the SuperSplat-compatible reader path are real: `src/components/panels/media/panel/useMediaPanelAddImportCommands.ts`, `src/stores/timeline/helpers/mediaTypeHelpers.ts`, and `src/engine/gaussian/loaders/SplatTransformLoader.ts`. Legacy gaussian-avatar creation/import is blocked in `src/stores/mediaStore/slices/fileImport/gaussianImportActions.ts` and `src/stores/timeline/clip/addClipAction.ts`.
- The key-file table paths all exist, including `NativeSceneRenderer.ts`, `MeshPass.ts`, `ModelRuntimeCache.ts`, `TextMeshCache.ts`, the scene utilities, renderer/loader files, and the listed property-tab components.

## Outdated or wrong (claim → reality, with file evidence)

- “Video and image clips that still use the default `position.z = 0` start slightly behind the scene target when first toggled to 3D” → toggling a plane preserves its existing Z value; the default is still `0`, with no offset applied. `src/stores/timeline/clipSlice.ts` (`toggle3D`) and `src/stores/timeline/constants.ts`.
- “Create mesh clips … via `+ Add > Mesh`” → the current hierarchy is `+ Add > 3D > Mesh`; 3D Text is a separate `+ Add > 3D > 3D Text` action. `src/components/panels/media/import/MediaAddItemsMenu.tsx` and `src/components/panels/media/panel/useMediaPanelAddImportCommands.ts`.
- “Splat effector clips … affect scene-driven splats” → the UI and native mesh transforms also apply them to imported models, primitive meshes, and 3D text; splats deform directly. `src/components/panels/properties/SplatEffectorTab.tsx`, `src/engine/native3d/passes/meshPass/transforms.ts`, and `src/engine/scene/SceneEffectorUtils.ts`.
- “Shadow settings are stored/keyframeable” and “Shadow fields are persisted for projects and keyframes” → the shadow toggle (`castsShadows`) is persisted but not keyframeable; only `shadowStrength` has a keyframe control. `src/components/panels/properties/LightTab.tsx` and `src/types/light.ts`.
- The Properties Tabs table listed Transcript tabs and omitted current Color/Analysis tabs for several clip types → the current strip has no Transcript button; it exposes the tab combinations now documented in the refreshed table. `src/components/panels/properties/index.tsx` (tab-strip conditions and render routing).

## Noteworthy / unusual

- `src/components/panels/properties/CameraTab.tsx` still exists, but the properties panel deliberately routes camera selections and `camera` tab requests to Transform only (`src/components/panels/properties/index.tsx`). This is a dead-looking naming remnant, not the active camera surface.
- The gaussian-splat settings type and renderer/export paths retain `backgroundColor`, temporal, and particle settings, but `GaussianSplatTab.tsx` exposes only renderer, scale, orientation, max splats, sorting, and clipping planes. The doc’s “partially surfaced” limitation is therefore material, not merely planned work.
- The current add-menu nests all 3D actions under `3D`, but generated primitive meshes and 3D text are stored differently by default: primitives go to `Meshes`, while 3D Text goes to the normal Text folder. `src/components/panels/media/panel/useMediaPanelAddImportCommands.ts`.
