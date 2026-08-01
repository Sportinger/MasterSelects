---
title: "Motion Design"
---

Motion Design is native MasterSelects timeline content, not an embedded external editor.

## Current Scope

- `src/types/motionDesign.ts` defines versioned motion layer data for shape, null, adjustment, and reserved group layers, plus appearance, replicator, modifier, and expression data.
- `TimelineSourceType`, `TimelineClip`, `SerializableClip`, and project clip persistence accept `motion-shape`, `motion-null`, and `motion-adjustment`.
- Motion definitions are plain JSON and survive timeline/project serialization.
- `src/services/properties/PropertyRegistry.ts` describes transform, effect, color, mask, vector-animation, and motion properties without owning Zustand state.
- `src/stores/timeline/motionClipSlice.ts` can create rectangle, ellipse, polygon, and star clips, null clips, adjustment clips, update motion definitions, and convert solid clips to motion rectangle clips.
- `src/components/panels/properties/MotionShapeTab.tsx` exposes primitive-specific point/radius/corner controls plus the ordered appearance editor.
- The appearance editor can add, remove, duplicate, reorder, show/hide, and edit color fills, strokes, linear/radial gradients, and texture fills. Items render bottom-to-top and retain stable ids when reordered.
- Gradient stops have stable ids and editable colors/offsets. The current renderer accepts up to 8 appearance items and 8 stops per gradient.
- Per-appearance opacity and the `normal`, `multiply`, `screen`, `add`, `overlay`, and `difference` blend modes render in the shape shader.
- The Media panel add/context menu can create all four Motion Shape primitives and drag them to video tracks.
- Solid clip context menus can convert the selected solid to a motion shape while preserving its clip id and timing.
- The Motion tab exposes Grid, Linear, and Radial Replicator layouts, including count, spacing or step, pattern offset, radial auto-orient, terminal transform, opacity, and author limit controls.
- `src/engine/motion/MotionRenderer.ts` renders all four primitives into transparent `rgba8unorm` textures using analytic WGSL SDFs.
- The renderer composes the bounded appearance stack and gradient stops in one draw, supports one bound texture-fill slot, and renders Grid, Linear, and Radial replicators through cached instance buffers. The runtime maximum is 100,000 instances; individual layers can set a lower persisted author limit.
- `getStats` exposes Motion Design clip/instance counts plus renderer cache, buffer-upload, and CPU encoding telemetry.
- `LayerBuilderService`, `NestedCompRenderer`, `RenderDispatcher`, and `ExportLayerBuilder` pass motion shape layers through the same compositor path as image/text/video textures.
- Numeric motion properties are evaluated through the keyframe store via the property registry before rendering.
- The Motion properties tab has a clip-aware registry browser. Exact property paths can be pinned per clip, while favorites and Motion view preferences remain per-user state.
- Timeline Graph mode is the universal multi-series curve editor. `G`, a keyframe double-click, or a parameter double-click opens the same graph over the canonical keyframe map; parameter rows can be shown, hidden, or soloed without creating copied animation data.
- Opening Graph mode can temporarily expand a short Timeline panel and restores its prior panel ratio when the graph closes.
- Selected editable 2D clips expose a separate viewport motion-path overlay with paired X/Y nodes, FPS-based onion positions, and focusable spatial Bezier handles. Node and handle edits write the existing scalar X/Y keyframes through one transaction and undo step; no separate spatial animation data is created.
- `src/services/motionDesign/appearancePresets.ts` serializes media-free appearance presets and remaps appearance/stop ids safely when applying a preset; presets reject texture fills.
- The Motion Design AI surface has 18 registered tools, including shape, appearance, template, null/parenting, adjustment, modifier, expression, and replicator operations. `getMotionCapabilities` reports capability version 2.
- `addKeyframe` accepts either a single entry or one prevalidated atomic sequence and returns the actual stable keyframe ids, canonical/stored values, and resolved clip-local times.
- Random, noise, oscillator, and radial-field modifiers support deterministic seeds, ordered editing, and rectangle/ellipse falloff references.
- Image and frozen-video texture fills are available in the appearance editor and AI tool surface; replicated tiles reuse decoded source frames by reuse key.
- Motion Null creation, Pick Whip parenting, and atomic create-null-and-parent operations preserve 2D child world transforms. Motion groups are not supported.
- Adjustment layers operate on lower layers through the shared compositor path. Brightness, Contrast, Saturation, Invert, and Gaussian Blur are the supported 1.0 effect matrix.
- The shape properties tab includes reusable templates and expressions. Templates are categorized and applied with dependency validation; expressions are parsed and evaluated without arbitrary code execution.
- Motion Design is always on.

## Usage Constraints

- Texture fills freeze image or video content at one selected time.
- Replicators duplicate the rendered shape texture.
- Appearance presets reject texture fills, and templates exclude expressions.
- Adjustment-layer transforms and color correction are disabled.
- Appearance blend modes outside the six listed modes fall back to normal in the Motion shader.
