[Back to Docs](./README.md)

# Motion Design

Status: shape MVP in progress. The data model, property registry, shape editing tab, GPU rectangle/ellipse renderer, persistence, nested composition path, and export layer path are wired.

The motion design system follows `docs/plans/motion-design-system-plan.md`. It is native MasterSelects timeline content, not an embedded external editor.

## Current Scope

- `src/types/motionDesign.ts` defines versioned motion layer data for shape, null, adjustment, and group layers.
- `TimelineSourceType`, `TimelineClip`, `SerializableClip`, and project clip persistence accept `motion-shape`, `motion-null`, and `motion-adjustment`.
- Motion definitions are plain JSON and survive timeline/project serialization.
- `src/services/properties/PropertyRegistry.ts` describes transform, effect, color, mask, vector-animation, and motion properties without owning Zustand state.
- `src/stores/timeline/motionClipSlice.ts` can create rectangle/ellipse shape clips, null clips, adjustment clips, update motion definitions, and convert solid clips to motion rectangle clips.
- `src/components/panels/properties/MotionShapeTab.tsx` exposes primitive, size, corner radius, fill, and stroke controls for motion shape clips.
- Video track-header context menus can create Motion Rectangle and Motion Ellipse clips at the playhead.
- Solid clip context menus can convert the selected solid to a motion shape while preserving its clip id and timing.
- The Motion tab exposes a first Grid Replicator section with enable, count, spacing, and opacity fade controls.
- `src/engine/motion/MotionRenderer.ts` renders rectangle and ellipse primitives into transparent `rgba8unorm` textures using analytic WGSL SDFs.
- The renderer supports grid-replicated rectangle/ellipse shapes through a per-shape instance buffer and instanced draws, capped at 100 instances for the current MVP.
- `LayerBuilderService`, `NestedCompRenderer`, `RenderDispatcher`, and `ExportLayerBuilder` pass motion shape layers through the same compositor path as image/text/video textures.
- Numeric motion properties are evaluated through the keyframe store via the property registry before rendering.

## Not Yet Implemented

- Replicators have a grid MVP for shape clips, but no random/noise modifiers, radial/linear layouts, falloff, or direct media replicators are wired yet.
- Texture fills, gradients, appearance blend modes, polygon/star rendering, viewport motion paths, and graph mode are not implemented yet.
- Adjustment layers remain blocked on the render graph work.

The next implementation slice should add pinned motion property lanes or media texture fills while keeping adjustment layers deferred until the render graph work is ready.
