# 3D Layer System

MasterSelects supports After Effects-style 3D layers via an integrated Three.js renderer. Layers can be toggled between 2D and 3D mode, 3D model files (OBJ, glTF, GLB, FBX) can be imported directly as timeline clips, and primitive 3D meshes can be created from the Media Panel.

## Architecture

```
[2D Layers] --> Existing WebGPU Compositor (unchanged)
                        |
[3D Layers] --> Three.js Scene --> OffscreenCanvas --> copyExternalImageToTexture --> Compositor
                        ^
                [Camera + Lighting]
```

Three.js renders all 3D-flagged layers into an OffscreenCanvas. The result is imported into the existing WebGPU compositor as a single texture layer. 2D layers continue through the existing pipeline unchanged. Zero overhead when no 3D layers exist (Three.js is lazily loaded via dynamic import).

## Features

### Per-Layer 3D Toggle
- Any video/image layer can be toggled to 3D via the **"2D/3D" button** in the Transform panel
- 3D layers become textured planes in a Three.js scene with perspective camera
- Toggling back to 2D resets Position Z, Rotation X/Y to 0

### 3D Model Import
- Drag **OBJ, glTF, GLB, FBX** files into the timeline
- Model clips are automatically set to 3D (cannot be switched to 2D)
- Models are auto-centered and normalized to fit the viewport
- Default lighting: Ambient (0.6) + Directional (0.8)
- OBJ without MTL: gets default gray MeshStandardMaterial
- Wireframe debug toggle: **"Wire" button** in Transform panel (blue wireframe)

### Primitive Mesh Creation
Create 3D mesh primitives from the Media Panel via **+ Add > Mesh** or right-click context menu:

| Primitive | Three.js Geometry | Default Size |
|-----------|------------------|--------------|
| Cube | `BoxGeometry` | 0.6 x 0.6 x 0.6 |
| Sphere | `SphereGeometry` | radius 0.35, 32x24 segments |
| Plane | `PlaneGeometry` | 0.8 x 0.8 |
| Cylinder | `CylinderGeometry` | radius 0.25, height 0.6 |
| Torus | `TorusGeometry` | radius 0.3, tube 0.1 |
| Cone | `ConeGeometry` | radius 0.3, height 0.6 |

- Mesh items are stored in a "Meshes" folder in the Media Panel
- Drag to timeline creates a clip with `is3D: true` and `meshType`
- Default material: `MeshStandardMaterial` (color #aaaaaa, metalness 0.3, roughness 0.6)
- Wireframe toggle supported
- Default clip duration: 10 seconds (max 1 hour)
- All transform properties (position, rotation, scale) and keyframe animation supported

### Transform Controls (3D Mode)
| Property | 2D Mode | 3D Mode |
|----------|---------|---------|
| Position | X, Y | X, Y, Z |
| Scale | All, X, Y | All, X, Y (+ Z for models) |
| Rotation | Z | X, Y, Z (AE-style: `Nx + remainder`) |
| Opacity | Yes | Yes (compositor-level) |
| Blend Mode | Yes | Yes (all 37 modes) |

### AE-Style Rotation Display
Rotation values are displayed as `2x +30.0°` (2 revolutions + 30 degrees = 750°):
- **Multiplier (`2x`)**: Drag to change in 360° increments
- **Remainder (`+30.0°`)**: Fine rotation within the revolution
- Both are independently draggable and keyframeable

### Composition Camera
Per-composition camera with configurable properties:
- Position (x, y, z)
- Target / Look-at (x, y, z)
- FOV (default: 50°)
- Near/Far planes

Camera distance is auto-calculated so default-transform layers fill the viewport exactly.

## Keyframe Animation
All 3D properties are fully keyframeable:
- `position.z`, `rotation.x`, `rotation.y`, `rotation.z`, `scale.z`
- Keyframe lanes for 3D properties are hidden when clip is in 2D mode
- `scale.z` keyframes work for model clips

## Export
3D layers are included in video export. The export pipeline uses the same `engine.render()` → `RenderDispatcher` → `process3DLayers()` → Three.js path as the preview.

## Effect Support
GPU effects (blur, color correction, etc.) are applied as post-processing on the 3D scene output. They work identically to 2D layers since Three.js renders to a texture first.

## Effect Reordering
Effects can be reordered via drag-and-drop:
- Drag the **≡ handle** on each effect to reorder
- Only the handle initiates drag (sliders/controls are not blocked)
- Order affects render output (effects are chained sequentially)
- Undo/redo supported

## Key Files

| File | Purpose |
|------|---------|
| `src/engine/three/ThreeSceneRenderer.ts` | Three.js scene renderer (HMR singleton) |
| `src/engine/three/types.ts` | Layer3DData, CameraConfig types |
| `src/engine/render/RenderDispatcher.ts` | 3D layer routing (`process3DLayers`) |
| `src/engine/render/LayerCollector.ts` | Model layer passthrough |
| `src/stores/timeline/clip/addModelClip.ts` | Model clip creation (file-based) |
| `src/stores/timeline/meshClipSlice.ts` | Primitive mesh clip creation |
| `src/services/layerBuilder/LayerBuilderService.ts` | Model layer builder |
| `src/engine/export/ExportLayerBuilder.ts` | Export 3D layer support |
| `src/components/panels/properties/TransformTab.tsx` | 3D transform UI |
| `src/engine/featureFlags.ts` | `use3DLayers` flag |

## Supported File Formats

| Format | Loader | Notes |
|--------|--------|-------|
| `.obj` | OBJLoader | Blender default export, no materials without .mtl |
| `.gltf` | GLTFLoader | Khronos standard, text-based |
| `.glb` | GLTFLoader | Binary glTF, most common for web |
| `.fbx` | GLTFLoader (fallback) | Autodesk format, limited support |

## Limitations

- No PBR material editor yet (models use default or embedded materials)
- No shadow casting between layers
- Camera is per-composition, not keyframeable yet
- Single 3D layer: opacity/blend handled by compositor. Multiple 3D layers: opacity via Three.js material
- Model clips need file re-authorization after page refresh (same as video clips)
