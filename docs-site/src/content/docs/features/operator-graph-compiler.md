---
title: "Operator Graph Compiler"
---

The local image compiler is the first shared compiler IR for image effects. It lowers the reachable, typed DAG to one inline WGSL function and a CPU reference plan; graph granularity therefore does not add render passes. Invert is expressed structurally as one shared scalar `1`, three `math.subtract.scalar` nodes, and typed Vec4 split/combine rather than a color-specific arithmetic primitive.

## Reuse gate

- `image.frame` remains the existing canonical decoded-frame source from `sceneOperators.ts`.
- `values.number` remains the canonical scalar value node and resolves its existing effect-parameter binding; a node may alternatively carry a clip-local literal in `constants`.
- Existing `math.subtract` in `scalarField.ts` operates on a per-voxel `field`. It cannot be reused for a uniform scalar without weakening port compatibility, so the image compiler registers the typed family variant `math.subtract.scalar` using the existing `number` signal.
- `math.subtract.rgb` remains an available typed family variant, while the default graph exposes each channel through scalar subtraction. No implicit cross-type broadcast is accepted.
- `vector.split.vec2|vec3|vec4` and matching combine variants are generated from one registry family. Image pixels cross explicit `convert.image-to-vec4` and `convert.vec4-to-image` boundaries; UI may present Vec4 components as R/G/B/A without changing persisted port IDs.
- The compiler was checked against the register-program approach in `scalarField.ts` and the real-edge traversal in `sceneGraph.ts`. It similarly evaluates shared reachable nodes once and rejects missing, duplicate, incompatible, or cyclic wiring.
- Existing inline invert in the compositor remains the rendering integration target. The compiler produces `evaluateImageGraph(vec4f) -> vec4f`, so the graph can replace its boolean branch without adding a pass.

RGB values preserve the source texture's color encoding; this first package does not introduce a color-space conversion. Alpha is straight alpha and is carried on an explicit edge around RGB inversion.

Worker presentation retains external-texture sampling for known opaque VideoFrame formats. Alpha-bearing or unknown formats use an explicit texture upload with `premultipliedAlpha: false`: the tested Chromium external-texture path returned premultiplied RGB even for a raw straight-RGBA fixture. This upload adds no render pass, but does incur a texture copy. It avoids a shader-side alpha division that would corrupt implementations already returning straight RGB. The browser GPU probe checks source pixels independently, then compares the edited graph output against the CPU reference for both VideoFrame and ImageBitmap inputs.

## Current boundary

Invert uses this graph in both the existing inline compositor and ordered fullscreen effect chains. Editing connections, constants, or bypass changes the compiled program. The default graph keeps alpha unchanged and retains the existing number of render passes.

Graphs are stored in `effect.operatorGraph`; `effect.params` retains parameter and keyframe ownership. Old serialized `params.operatorGraph` values are validated and migrated on load. Invalid data never silently selects a default graph. Graph layout, groups, and local constants travel with the graph through save/load and history. Incomplete wiring remains visible and pauses execution until repaired.

A graph-local numeric constant uses one Min/Max/Default preference in both its inline control and inspector. These control preferences stay local to the editor and do not duplicate the value in project data; the current value remains in the node's `constants` inside `effect.operatorGraph`. Registry bounds and defaults are used until the user customizes them. `values.number` accepts any finite literal within the chosen UI range, while operators with domain limits continue to enforce their registry bounds.

This is the initial image-effect migration. Other effect families and the persistent Color Nodes model still require migration. The existing specialized Voxel and Face Cables compilers consume the canonical graph through adapters; their GPU and simulation implementations are retained.

Analog Signal Lab also stores its editable chain in `effect.operatorGraph`. Its canonical path is Frame → PAL Encode → RF Channel → VHS Transport → Receiver Analyze → PAL Decode → Display Resolve → Image Output. The existing effect parameter IDs remain the bindings for numeric controls, decoder mode and tape speed, so the same project values feed graph preview, playback and export. Disconnecting a required stage leaves the saved graph visibly incomplete and pauses that effect until repaired.

Brightness, Contrast and Saturation use the same canonical image graph owner. Their default graphs expose reusable RGB add, subtract, multiply, mix, clamp, scalar conversion and Rec.601 luminance nodes; alpha travels directly from split to combine. The existing `amount` parameter remains the sole value/keyframe owner with its original default and range. Brightness evaluates `clamp(rgb + amount)`, Contrast evaluates `clamp((rgb - 0.5) * amount + 0.5)`, and Saturation evaluates `clamp(mix(luma, rgb, amount))`.

Exposure, Levels, Hue Shift, Temperature and Vibrance use that owner as well. Their default DAGs reproduce the legacy shaders: Exposure applies `exp2`, offset, nonnegative gamma power and clamp; Levels performs IEEE range division, input clamp, reciprocal gamma and component output mix without a final clamp; Hue Shift converts through HSV and wraps hue with `fract`; Temperature builds the exact red/green/blue affine offsets; Vibrance derives channel range saturation, Rec.601 gray and an adaptive mix before clamping. Each original parameter ID, range, default and keyframe binding remains authoritative, and alpha bypasses all color math.

Threshold and Posterize are canonical pointwise graphs too. Threshold computes Rec.709 luminance and uses a strict greater-than comparison, so a value equal to the level remains black. Posterize evaluates `floor(rgb * max(levels, 2)) / (max(levels, 2) - 1)` without a final clamp; consequently white can remain above `1.0` until the render target conversion. Both retain source alpha and their original parameter bindings.

Vignette is a canonical contextual image graph. Its normalized fragment-coordinate source is distinct from texture-transform UV: the graph centers and aspect-scales that coordinate, computes the legacy smooth edge factor, and multiplies only RGB while preserving alpha. Its Amount, Size, Softness and Roundness bindings retain the original schemas and keyframes. Because the graph requires fragment context, Vignette remains on the existing fullscreen effect path rather than the pixel-only inline stack.
