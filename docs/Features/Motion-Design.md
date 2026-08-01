[Back to Docs](./README.md)

# Motion Design

Status: MD0-MD2 are complete and evidence-backed. Rectangle, ellipse, polygon,
and star authoring share one GPU renderer and one ordered appearance stack
across preview, nesting, persistence, and export. The unified Global Graph and
viewport Motion Path edit the canonical keyframes used by preview and export.

Active completion work follows
[`docs/plans/motion-design-ai-completion-plan.md`](../plans/motion-design-ai-completion-plan.md).
The original architecture plan remains archived at
[`docs/completed/plans/motion-design-system-plan.md`](../completed/plans/motion-design-system-plan.md).
Motion Design is native MasterSelects timeline content, not an embedded external editor.

## Current Scope

- `src/types/motionDesign.ts` defines versioned motion layer data for shape, null, adjustment, and group layers.
- `TimelineSourceType`, `TimelineClip`, `SerializableClip`, and project clip persistence accept `motion-shape`, `motion-null`, and `motion-adjustment`.
- Motion definitions are plain JSON and survive timeline/project serialization.
- `src/services/properties/PropertyRegistry.ts` describes transform, effect, color, mask, vector-animation, and motion properties without owning Zustand state.
- `src/stores/timeline/motionClipSlice.ts` can create rectangle, ellipse, polygon, and star clips, null clips, adjustment clips, update motion definitions, and convert solid clips to motion rectangle clips.
- `src/components/panels/properties/MotionShapeTab.tsx` exposes primitive-specific point/radius/corner controls plus the ordered appearance editor.
- The appearance editor can add, remove, duplicate, reorder, show/hide, and edit color fills, strokes, linear gradients, and radial gradients. Items render bottom-to-top and retain stable ids when reordered.
- Gradient stops have stable ids and editable colors/offsets. The current renderer accepts up to 8 appearance items and 8 stops per gradient.
- Per-appearance opacity and the `normal`, `multiply`, `screen`, `add`, `overlay`, and `difference` blend modes render in the shape shader.
- The Media panel add/context menu can create all four Motion Shape primitives and drag them to video tracks.
- Solid clip context menus can convert the selected solid to a motion shape while preserving its clip id and timing.
- The Motion tab exposes a first Grid Replicator section with enable, count, spacing, and opacity fade controls.
- `src/engine/motion/MotionRenderer.ts` renders all four primitives into transparent `rgba8unorm` textures using analytic WGSL SDFs.
- The renderer composes the bounded appearance stack and gradient stops in one draw, then supports grid replication through the existing instance buffer, capped at 100 instances for the current MVP.
- `getStats` exposes Motion Design clip/instance counts plus renderer cache, buffer-upload, and CPU encoding telemetry.
- `LayerBuilderService`, `NestedCompRenderer`, `RenderDispatcher`, and `ExportLayerBuilder` pass motion shape layers through the same compositor path as image/text/video textures.
- Numeric motion properties are evaluated through the keyframe store via the property registry before rendering.
- The Motion properties tab has a clip-aware registry browser. Exact property paths can be pinned per clip, while favorites and Motion view preferences remain per-user state.
- Timeline Graph mode is the universal multi-series curve editor. `G`, a keyframe double-click, or a parameter double-click opens the same graph over the canonical keyframe map; parameter rows can be shown, hidden, or soloed without creating copied animation data.
- Opening Graph mode can temporarily expand a short Timeline panel and restores its prior panel ratio when the graph closes.
- Selected editable 2D clips expose a separate viewport motion-path overlay with paired X/Y nodes, FPS-based onion positions, and focusable spatial Bezier handles. Node and handle edits write the existing scalar X/Y keyframes through one transaction and undo step; no separate spatial animation data is created.
- `src/services/motionDesign/appearancePresets.ts` serializes media-free appearance presets and remaps appearance/stop ids safely when applying a preset.
- The six Motion Design AI tools report capability version 2. `createMotionShapeClip` accepts polygon/star geometry, while `updateMotionAppearances` supports atomic structured stack operations and returns all created appearance/stop ids.
- `addKeyframe` accepts either the legacy single entry or one prevalidated atomic sequence and returns the actual stable keyframe ids, canonical/stored values, and resolved clip-local times.
- Motion Design and its Grid MVP are always on; the old unused feature-flag placeholders have been removed.

## Not Yet Implemented

- Replicators have a grid MVP for shape clips, but no random/noise modifiers, radial/linear layouts, falloff, or direct media replicators are wired yet.
- Texture fills and media-backed appearance presets remain deferred to the direct-media Motion phase.
- Blend modes outside the six explicitly advertised appearance modes currently fall back to normal in the Motion shader.
- Adjustment layers remain blocked on the render graph work.

The MD2 Wave D evidence exercises the real Graph, Motion Path handle, panel
resize, AI sequence, undo/redo, and direct/nested preview/export paths. MD0-MD2
also have recorded disposable reports and PNG baselines under
[`docs/evidence/motion-design/`](../evidence/motion-design/).

`MDX0_BASELINE_CLOSED` is green. The next gated action is to register Wave 1
ownership and freeze the shared 1.0 contracts before the MD3 Replicator, MD6
Structure, and MD7 Render Graph foundations start.
