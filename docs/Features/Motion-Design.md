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
- `src/engine/motion/MotionRenderer.ts` renders rectangle and ellipse primitives into transparent `rgba8unorm` textures using analytic WGSL SDFs.
- `LayerBuilderService`, `NestedCompRenderer`, `RenderDispatcher`, and `ExportLayerBuilder` pass motion shape layers through the same compositor path as image/text/video textures.
- Numeric motion properties are evaluated through the keyframe store via the property registry before rendering.

## Not Yet Implemented

- Replicators are represented in the schema and registry, but no GPU instancing pipeline is wired.
- Texture fills, gradients, appearance blend modes, polygon/star rendering, viewport motion paths, and graph mode are not implemented yet.
- Adjustment layers remain blocked on the render graph work.

The next implementation slice should add user-facing creation affordances, pinned motion property lanes, and the first replicator controls while keeping adjustment layers deferred until the render graph work is ready.
