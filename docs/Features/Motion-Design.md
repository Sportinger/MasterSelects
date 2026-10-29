[Back to Docs](./README.md)

# Motion Design

Motion Design is native MasterSelects timeline content, not an embedded external editor.

## Current Scope

- `src/types/motionDesign.ts` defines versioned motion layer data for shape, null, adjustment, and reserved group layers, plus appearance, replicator, modifier, and expression data.
- `TimelineSourceType`, `TimelineClip`, `SerializableClip`, and project clip persistence accept `motion-shape`, `motion-null`, and `motion-adjustment`.
- Motion definitions are plain JSON and survive timeline/project serialization.
- `src/services/properties/PropertyRegistry.ts` describes transform, effect, color, mask, vector-animation, and motion properties without owning Zustand state.
- `src/stores/timeline/motionClipSlice.ts` can create rectangle, ellipse, polygon, star, and path clips, null clips, adjustment clips, update motion definitions, and convert solid clips to motion rectangle clips.
- `src/components/panels/properties/MotionShapeTab.tsx` exposes primitive-specific point/radius/corner controls plus the ordered appearance editor. Path clips expose a numeric point editor, segment splitting, a closed toggle, and trim/dash controls; there is no viewport vertex editor yet.
- The appearance editor can add, remove, duplicate, reorder, show/hide, and edit color fills, strokes, linear/radial gradients, and texture fills. Items render bottom-to-top and retain stable ids when reordered.
- Gradient stops have stable ids and editable colors/offsets. The current renderer accepts up to 8 appearance items and 8 stops per gradient.
- Per-appearance opacity and the `normal`, `multiply`, `screen`, `add`, `overlay`, and `difference` blend modes render in the shape shader.
- The Media panel add/context menu can create all four Motion Shape primitives and drag them to video tracks.
- Solid clip context menus can convert the selected solid to a motion shape while preserving its clip id and timing.
- The Motion tab exposes Grid, Linear, and Radial Replicator layouts, including count, spacing or step, pattern offset, radial auto-orient, terminal transform, opacity, and author limit controls.
- `src/engine/motion/MotionRenderer.ts` renders all five primitives into transparent `rgba8unorm` textures using WGSL SDFs — analytic for rectangle/ellipse/polygon/star, flattened-polyline via a read-only storage buffer for freeform paths.
- The `path` primitive is a freeform cubic-bezier vertex list (up to 128 authoring vertices, flattened to at most 512 polyline points with arc lengths), open or closed. Stroke trim (`shape.path.trim.start/end/offset`, normalized 0..1) and dash (`shape.path.dash.length/gap/offset`, pixels) are animatable numeric property paths; vertex lists are set at creation (e.g. `createMotionShapeClip` with `vertices`/`closed`) and are not keyframeable.
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
- A rotated Motion Null turns its children rigidly in composition pixels and in the compositor's direction (positive `rotation.z` is counter-clockwise on screen). Structure evaluations carry the owning `compositionSize` (`{ width, height }`, optional, square when omitted, rejected as `MD6_PARENT_EVALUATION_INVALID` when malformed); the timeline adapter, preview transform drags, and the viewport Null handle always pass it, and the viewport handle draws its crosshair arms in the same direction.
- Adjustment layers operate on lower layers through the shared compositor path. They take every video effect of the registry that can work on the composite below them (see [Effects on adjustment layers](#effects-on-adjustment-layers)).
- The shape properties tab includes reusable templates and expressions. Templates are categorized and applied with dependency validation; expressions are parsed and evaluated without arbitrary code execution.
- Motion Design is always on.

## Usage Constraints

- Texture fills freeze image or video content at one selected time.
- Replicators duplicate the rendered shape texture.
- Appearance presets reject texture fills, and templates exclude expressions.
- Adjustment layers always cover the whole frame: a transform, 3D, a crop rectangle or a transition on one is skipped and named (see [Layer properties of adjustment layers](#layer-properties-of-adjustment-layers)).
- Effects that need a source clip of their own are unavailable on adjustment layers (see above).
- Appearance blend modes outside the six listed modes fall back to normal in the Motion shader.
- Path trim/dash affect stroke appearances only; open paths render no fill, and fills on closed paths ignore trim/dash.

## Effects on adjustment layers

An adjustment layer has no pixels of its own: its effects process the composite of the layers
below it (the accumulated frame), and the result replaces that frame by the layer's coverage
(opacity and masks) with its blend mode, instead of being composited over it (`composite.wgsl`,
adjustment replace mix). Pixels an effect leaves transparent therefore stay transparent, as they
would on a clip: Fisheye corners, a Chroma Key screen or dissolved particles no longer show the
unprocessed frame through. Preview, nested compositions, target previews and export all render it through the same
generic effect chain as a clip (`Compositor.ts`), so any effect that reads only its input image
works there. `adjustmentEffectClassification.ts` sorts every registry effect into one of three
behaviours:

| Behaviour | Effects | On an adjustment layer |
|---|---|---|
| Accumulated frame | All color, blur, distort, stylize, halftone, analog, pixel, glyph and geometry effects, generators (Color Wheel, Perspective Grid, Stick Figure), Chroma Key, Pixel Particle Disintegrate | Works as on a clip. |
| Previous-output feedback | Acuarela, Rom1, Voxel Relief, ASCII Ghost | Works: the history these effects read is their own previous output on this layer. |
| Unavailable | Slit Scan, Time Stack (source-video history); Subject Highlight, Tracked Scene, HUD Tracker, CCTV, Rain Reveal, Stardust, Hand Particles, Motion Trails, Face Cables (landmarks tracked in a clip's own video); Flocking, Weave, Splat Exploration (draw into a 3D scene); AI Edge Fill (fill generated from a clip's own image) | Not offered in the pickers; when present (pasted, older project, tool) the effect alone is bypassed with its reason. |

Admission is per effect (`adjustmentEffectRenderAdmission.ts`, shared by the layer builders, the
inspector and the tools): one effect that cannot run, or carries malformed data, is bypassed on its
own and the rest of the layer renders, in preview and export alike. The reason is shown on the
effect card, in the adjustment tab's status ("Effects bypassed"), in the `MotionAdjustmentLayerBuilder`
log (once per layer and effect; a replaced value once per parameter, never per frame) and in tool
results. The compositor repeats the check for layers
that reach it by other paths and bypasses such an effect with a `Compositor` warning instead of
skipping the layer.

Parameters are checked against each effect's own definitions by type: numbers must be finite,
booleans, selects, colors and text must have their type, and parameters the definition does not list
(exposed graph values, runtime travel values in saved projects) pass when they are plain values.
Numbers are not clamped by the admission: the effect clamps to its own `renderMin`/`renderMax` as on
a clip, so a keyframe overshoot or a node driver renders the same on an adjustment layer as on a
clip, and the card and tool results name what renders (`paramRangeNotes`). On the render path a
value of the wrong type renders with its default and is named; on the tool and contract paths it is
rejected. Text values may be long (a Stick Figure choreography, Guided Perspective guides): the
contract budget is 1 MiB per string value and 16 MiB of strings per contract, while keys keep their
4 KB limit (`contractLimits.ts`). The original five effects (Brightness, Contrast, Saturation,
Invert, Gaussian Blur, and the retired `blur`) keep their frozen parameter policy, so saved projects
load exactly as before; a value outside that policy (keyframe overshoot) renders as set instead of
dropping the effect.

`editMotionAdjustment` and the generic `addEffect`/`updateEffect` tools accept every admitted
effect; new effects store their defaults and recipe graphs as `addClipEffect` does. Unavailable
effects fail with `MD7_ADJUSTMENT_UNSUPPORTED_EFFECT` and the reason. `editMotionAdjustment` refuses
a parameter name the effect does not define with the valid names (`MD7_ADJUSTMENT_INVALID_EFFECT`),
as `updateEffect` does, and its result carries `warnings` with the same parameter notes
`updateEffect` gives (a value above the rendered range, a value the effect cannot show). An effect already on a layer
that the renderer bypasses (older or pasted project) does not block `editMotionAdjustment`: the tool
admits existing effects per effect like the renderer, so an agent can still move, trim or configure
the layer, for example to replace the effect list. The receipt's `before`/`after` snapshots list such
effects under `bypassedEffects` with their reason.

The Playwright journey `tests/playwright/effects/adjustment-all-effects.spec.ts` checks every
registry effect on an adjustment layer in the real preview: each admitted effect is added through the
effect picker and switched off and on once with its card's bypass button, then it must change the
picture (a strength value is raised when the default does nothing on the test pattern) and match the
same effect applied directly to the clip; unavailable ones must be missing from the picker, refused by
the tool and, when injected, bypassed alone with a card notice and a log line. Its export cases render
Hue Shift, Mirror and Pixelate, Pixel Sort Bands after a bypass toggle, and a Color tab grade (compared
with the same grade on the clip) from the layer. The phone journey
`tests/playwright/mobile/m2-adjustment-graph-export.spec.ts` runs the production path for every
graph/texture effect (Pixel Sort Bands, Block Dissolve, Block Silhouette, Data HUD, Block Cloud,
Flow Mosh): nothing selected, Effects sheet, card, off and on in the stack, Done, export through the
export sheet; frames before the layer read their frame code in order and match the source, frames
under it differ from the source. A last case grades a selected layer with Adjust and a filter.

## Layer properties of adjustment layers

An adjustment layer renders its effects (effect graphs and recipes included), its colour correction,
its masks, its opacity and one of five blend modes (Normal, Multiply, Screen, Overlay, Add). The
colour correction grades the composite below in the layer's stack position, exactly as a clip grades
its own picture (`Compositor.ts`; the grade never writes into the view it reads). It is edited in the
Color tab of the adjustment layer and on the phone with Adjust and Filters (Looks are effect stacks).
The node graph of the clip (`clip.nodeGraph`) is presentation and driver data: group layout, previews,
canvas placements, parameter sources and keyframe nodes render as on a clip. Switching an effect off
collapses its node group and so writes node-graph layout; until 3.3.9 the layer admission refused any
node graph, so one off-and-on of an effect on a phone adjustment layer made the export stop with
"Motion adjustment layer uses unsupported render properties" and the preview leave the layer out.

What an adjustment layer cannot render is skipped property by property
(`adjustmentLayerRenderAdmission.ts`, shared by the preview, nested-composition, target-preview and
export layer builders, the inspector, the phone sheets, the export notes and the tools). The layer
renders without it; nothing else changes:

| Property | Renders as |
|---|---|
| Position, scale or rotation not neutral | Identity: the layer covers the whole frame |
| Opacity outside 0..1 or not a number | Clamped to 0..1 (100 % when not a number) |
| Blend mode outside the five | Normal |
| 3D | Flat |
| Crop rectangle (`sourceRect`) | Ignored; a mask limits where the layer works |
| Transition (`transitionRender`) | Ignored |
| 3D scene in the node graph, shared scene output | Ignored |
| Custom (AI) nodes in the node graph | Ignored (they process a clip's own picture) |

Each skipped property is named in the Adjustment tab status ("Properties skipped"), above the effect
cards ("Skipped on this adjustment layer, the rest renders: ..."), in the phone Effects sheet, in the
export notes of the phone export sheet and the desktop Export panel ("Adjustment layer ... exports
without ..."; bypassed effects are named there too), once per layer and property in the
`MotionAdjustmentLayerBuilder` log, and in tool results: `getClipDetails` reports `adjustmentRender`
(`skippedProperties`, `bypassedEffects`), `addEffect` and `editMotionAdjustment` add a warning per
skipped property. Only a broken layer definition (not an adjustment motion definition) stops the layer:
the preview leaves it out and the Adjustment tab says "Render blocked" with the reason, and the export
stops with `Adjustment layer "<name>" cannot render: <reason>` instead of producing different media.

`editMotionAdjustment` edits layers with a colour correction or node-graph data. Its frozen v1 stack
contract still refuses layers in the composition that are 3D, have a crop rectangle, a transition or
a parent (`MD7_ADJUSTMENT_UNSUPPORTED_STATE`); the renderer skips those properties as above.

The opt-in worker render host modes still draw only the original five with their 4×5 color
matrix and separable blur (`WORKER_GPU_ADJUSTMENT_EFFECT_TYPES`) and no colour correction. A stack
with any other effect or a graded adjustment layer throws `WorkerGpuAdjustmentFallbackError`
(`colour correction` is named like an effect type): worker export frames go to the main compositor and the
`WorkerExportHost` log names the reason once; strict worker-only frames fail with that reason, and
the adjustment tab says so while such a mode is selected. The default render path never uses the
worker executor.

## Inactive preview paths

Preview motion-path authoring evaluates eligibility before generating nodes, samples, handles or onion positions. Disabled paths, camera/3D clips, playback and other ineligible modes use an empty geometry input. Selecting a dense solved camera therefore does not sample an invisible 2D path. Returning to eligible 2D editing restores the normal editable path. Pure node/handle edit operations live in `src/components/preview/motionPathEditOperations.ts`.
