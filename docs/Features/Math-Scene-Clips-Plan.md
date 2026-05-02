[Back to Index](./README.md)

# Math Scene Clips Plan

Math Scene Clips are a proposed MasterSelects-native clip type for building mathematical animations on the timeline without requiring users to write code.

The feature should feel closer to Desmos or GeoGebra inside a video editor than to a code-first Manim clone. Users should be able to create equations, parameters, points, tangents, labels, and simple explanatory animations from panels and presets, while an advanced code mode can arrive later.

---

## Product Goal

Add a new timeline clip type:

```text
Math Scene
```

A Math Scene is a small procedural scene that can contain:

- Axes and grids
- Function plots
- Parameter sliders
- Points bound to expressions
- Tangents and normals
- Areas under curves
- Formula and text labels
- Camera pan/zoom moves
- Reveal, sweep, trace, fade, and highlight animations

The clip should render through the normal MasterSelects preview and export pipeline, so transforms, masks, color correction, blend modes, effects, nested compositions, and final export all work like they do for text, solid, Lottie, and image clips.

---

## Naming

| Surface | Name |
|---|---|
| Dock panel | `Math` |
| Timeline clip | `Math Scene` |
| Timeline source type | `math-scene` |
| First object type | `Function Plot` |
| First properties tab | `Math` |
| Runtime service | `MathSceneRenderer` |

Avoid naming the whole feature `Graph Plot`, because graph plotting is only the first object family. The larger feature is a procedural math scene system.

---

## Version Roadmap

The `version: 1` field in `MathSceneDefinition` is the data schema version, not the full product roadmap. Product development should be staged separately so the first merge stays small and useful.

### V0 - Technical Spike

Goal: prove the render path.

Scope:

- Add a temporary Math Scene definition in code.
- Render axes and one hardcoded function to a canvas.
- Feed the canvas into the existing WebGPU layer path.
- Verify preview, scrub, and export use the same frame.

No user-facing panel is required in V0.

### V1 - MVP Math Scene Clip

Goal: first usable no-code math clip.

Scope:

- Create a `math-scene` timeline clip on a video track.
- Store a serializable `MathSceneDefinition`.
- Render axes, grid, and `y = f(x)` plots.
- Add scalar parameters.
- Animate a parameter linearly over the clip duration.
- Add a point bound to expressions, for example `P=(a,sin(a))`.
- Add a tangent at `x = a`.
- Add simple draw-on and fade animations.
- Edit the scene from a minimal Properties tab.
- Save, load, scrub, playback, and export deterministically.

V1 is enough to make clean explanatory graph animations without code.

### V2 - Real Math Panel

Goal: make the feature comfortable for repeated use.

Scope:

- Add the dedicated `Math` dock panel.
- Add object list, parameter list, animation list, and inspector.
- Add reusable Math Scene media items in the Media panel.
- Add preset buttons: function, point, tangent, area, label, camera move.
- Add timeline badges and better clip display.
- Add copy/paste and duplicate behavior for Math Scene objects.
- Add better validation and inline expression errors.

V2 turns the feature from a clip property into a real workspace.

### V3 - Rich Explanatory Animation

Goal: reach Manim-style educational animation quality without forcing code.

Scope:

- Formula rendering with KaTeX or an equivalent safe renderer.
- Area-under-curve sweeps.
- Parametric curves.
- Polar plots.
- Vector fields.
- Function morphs.
- Label callouts and leader lines.
- Camera follow and auto-frame controls.
- Better easing and sequencing controls inside the Math Scene.

V3 is where the feature starts to feel like a dedicated math animation tool inside MasterSelects.

### V4 - Advanced And AI-Assisted Mode

Goal: support power users and prompt-driven creation.

Scope:

- Advanced code mode, preferably constrained to a safe scene DSL rather than arbitrary JavaScript.
- AI tools for creating and editing Math Scene clips.
- Prompt-to-scene generation.
- Template library for common explanations: derivative, integral, unit circle, Fourier, vectors, matrix transform.
- Import/export of Math Scene presets.
- Possible worker or OffscreenCanvas rendering for heavy scenes.

V4 should not be required for the no-code workflow. It should extend it.

---

## User Experience

The Math panel should have four compact areas:

```text
Objects
  Axes
  Graph 1      y = sin(x)
  Point P      (a, sin(a))
  Tangent      at x = a
  Formula      f(x)=sin(x)

Parameters
  a            0 .. 6.28    step 0.01
  k            1 .. 10      step 1

Animation
  Graph 1      Draw On      0.3s -> 1.5s
  Point P      Follow a     1.0s -> 3.0s
  Tangent      Fade In      2.0s -> 2.5s
  Camera       Zoom to P    2.5s -> 4.0s

Inspector
  Selected object controls
```

The user writes math expressions, not JavaScript:

```text
y = sin(x)
P = (a, sin(a))
Tangent at x = a
Area from 0 to a
```

Parameter sliders should be created automatically when an expression references an undefined scalar such as `a`.

---

## No-Code Animation Model

The first implementation should avoid general keyframing inside Math Scene objects. Instead, expose a small set of animation presets:

| Preset | Applies To | Behavior |
|---|---|---|
| `Draw On` | Function plot, axes, formula strokes | Reveals from start to end over time |
| `Fade In/Out` | Any object | Animates opacity |
| `Trace Point` | Point | Moves along a function or parameter range |
| `Sweep Area` | Area | Reveals integral/filled region |
| `Follow Camera` | Camera | Centers on a point or bounding box |
| `Zoom` | Camera | Animates viewport scale |
| `Highlight` | Any object | Pulses stroke/fill emphasis |

This keeps the UI understandable while still supporting strong explanatory motion.

---

## Codebase Integration

The feature should follow the existing canvas-backed clip pattern used by text, solid, and Lottie.

Important existing files:

- `src/types/index.ts`
- `src/stores/timeline/types.ts`
- `src/stores/timeline/index.ts`
- `src/stores/timeline/textClipSlice.ts`
- `src/stores/timeline/solidClipSlice.ts`
- `src/stores/timeline/serializationUtils.ts`
- `src/services/layerBuilder/LayerBuilderService.ts`
- `src/engine/render/LayerCollector.ts`
- `src/components/panels/properties/index.tsx`
- `src/types/dock.ts`
- `src/components/dock/DockPanelContent.tsx`

---

## Data Model

Extend `TimelineSourceType`:

```ts
export type TimelineSourceType =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'solid'
  | 'model'
  | 'camera'
  | 'gaussian-avatar'
  | 'gaussian-splat'
  | 'splat-effector'
  | 'math-scene'
  | VectorAnimationProvider;
```

Add a serializable scene definition:

```ts
export interface MathSceneDefinition {
  version: 1;
  viewport: MathViewport;
  style: MathSceneStyle;
  parameters: MathParameter[];
  objects: MathObject[];
  animations: MathAnimation[];
}

export interface MathViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  showGrid: boolean;
  showAxes: boolean;
}

export interface MathParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  animation?: MathParameterAnimation;
}
```

Add clip data:

```ts
export interface TimelineClip {
  // existing fields
  mathScene?: MathSceneDefinition;
}
```

For runtime rendering, the clip source should stay canvas-backed:

```ts
source: {
  type: 'math-scene';
  textCanvas: HTMLCanvasElement;
  naturalDuration: number;
  mediaFileId?: string;
}
```

Using `textCanvas` keeps the first implementation small because `LayerCollector` can treat the source like an existing dynamic canvas source.

---

## Math Objects

Start with a conservative object union:

```ts
export type MathObject =
  | MathAxesObject
  | MathFunctionObject
  | MathPointObject
  | MathTangentObject
  | MathAreaObject
  | MathLabelObject;
```

Minimum function object:

```ts
export interface MathFunctionObject {
  id: string;
  type: 'function';
  name: string;
  expression: string; // example: sin(x)
  domain?: [number, number];
  samples: number;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  visible: boolean;
}
```

Minimum point object:

```ts
export interface MathPointObject {
  id: string;
  type: 'point';
  name: string;
  xExpression: string;
  yExpression: string;
  radius: number;
  fill: string;
  labelVisible: boolean;
  visible: boolean;
}
```

---

## Timeline Store

Add a timeline slice:

```text
src/stores/timeline/mathSceneClipSlice.ts
```

Actions:

```ts
export interface MathSceneClipActions {
  addMathSceneClip: (
    trackId: string,
    startTime: number,
    duration?: number,
    skipMediaItem?: boolean
  ) => string | null;

  updateMathScene: (
    clipId: string,
    updater: (scene: MathSceneDefinition) => MathSceneDefinition
  ) => void;

  addMathObject: (clipId: string, object: MathObject) => void;
  updateMathObject: (clipId: string, objectId: string, patch: Partial<MathObject>) => void;
  removeMathObject: (clipId: string, objectId: string) => void;
  updateMathParameter: (clipId: string, parameterId: string, patch: Partial<MathParameter>) => void;
}
```

The slice should mirror the text and solid clip slices:

- Require a video track.
- Create a canvas at the active composition size.
- Create a `TimelineClip` with `source.type = 'math-scene'`.
- Add a media item unless `skipMediaItem` is true.
- Invalidate timeline and layer caches after changes.
- Request a render after updates.

---

## Media Store

Add a reusable media item type:

```ts
export interface MathSceneItem extends MediaItem {
  type: 'math-scene';
  duration: number;
  mathScene: MathSceneDefinition;
}
```

Extend:

- `MediaType`
- `ProjectItem`
- `MediaState`
- media folder helpers if a dedicated generated-media folder is desired
- media panel drag/drop handlers
- file type icon/badge handling

This lets users keep Math Scene presets in the Media panel and drag them into timelines like text or solid clips.

---

## Renderer Service

Add:

```text
src/services/mathScene/
  types.ts
  defaultScene.ts
  expressionEvaluator.ts
  MathSceneRenderer.ts
  mathCanvasCache.ts
```

`MathSceneRenderer.render(scene, canvas, timeSeconds)` should:

1. Resolve clip-local time.
2. Evaluate animated parameter values.
3. Clear and fill background.
4. Resolve the active viewport/camera.
5. Draw grid and axes.
6. Sample function expressions into polylines.
7. Split discontinuities instead of connecting across infinities.
8. Draw points, tangents, areas, and labels.
9. Apply animation preset progress.

Do not use `eval`. Use a constrained expression parser/evaluator.

Candidate expression features for MVP:

- Numbers
- Variables: `x`, `t`, and named parameters
- Operators: `+`, `-`, `*`, `/`, `^`
- Parentheses
- Functions: `sin`, `cos`, `tan`, `sqrt`, `abs`, `log`, `exp`, `min`, `max`, `pow`
- Constants: `pi`, `e`

---

## LayerBuilder

In `LayerBuilderService`:

- Render active Math Scene clips before layer cache usage or mark their canvas source as dynamic.
- Add `syncActiveMathSceneClips(ctx)` similar in spirit to active Lottie sync.
- Add `buildMathSceneLayer(clip, layerIndex, ctx, opacityOverride?)`.
- Compute `clipLocalTime` via existing `getClipTimeInfo(ctx, clip)`.
- Pass `clipLocalTime` to `MathSceneRenderer.render(...)`.

The layer source can be:

```ts
source: {
  type: 'math-scene',
  textCanvas: clip.source.textCanvas,
  mediaTime: clipLocalTime
}
```

If the `LayerSource.type` union should stay limited, alternatively map it to `type: 'text'` internally while keeping `TimelineSourceType = 'math-scene'`. That is less semantically clean but minimizes render-pipeline changes.

---

## LayerCollector

Preferred small change:

```ts
if (sourceType === 'text' || sourceType === 'solid' || sourceType === 'math-scene') {
  if (source.textCanvas) {
    return this.tryTextCanvas(layer, source.textCanvas, deps);
  }
  return null;
}
```

This keeps Math Scene upload behavior identical to other Canvas2D-backed sources.

---

## UI Work

Add a dock panel:

```text
src/components/panels/MathPanel.tsx
src/components/panels/math/MathObjectList.tsx
src/components/panels/math/MathInspector.tsx
src/components/panels/math/MathParameterList.tsx
src/components/panels/math/MathAnimationList.tsx
src/components/panels/math/MathPanel.css
```

Wire it into:

- `src/types/dock.ts`
- `src/components/dock/DockPanelContent.tsx`
- `src/components/panels/index.ts`

Add a properties tab:

```text
src/components/panels/properties/MathSceneTab.tsx
```

The properties tab should show when the selected clip has `source.type === 'math-scene'`.

MVP controls:

- Scene name
- Duration
- Viewport bounds
- Show grid
- Show axes
- Add function
- Add parameter
- Function expression
- Function color
- Draw-on start/end

---

## Timeline UI

Update timeline helpers and display:

- Add a badge such as `MATH` or a compact function icon.
- Use the first function expression as the clip subtitle.
- Show generated thumbnails later; MVP can use a static badge.
- Ensure copy/paste includes `mathScene`.
- Ensure nested compositions preserve the clip.

Likely files:

- `src/components/timeline/TimelineClip.tsx`
- `src/components/timeline/utils/fileTypeHelpers.ts`
- `src/stores/timeline/clipboardSlice.ts`
- `src/stores/timeline/types.ts`

---

## Serialization

Update `src/stores/timeline/serializationUtils.ts`:

- Save `mathScene` on `SerializableClip`.
- Restore `mathScene` when `sourceType === 'math-scene'`.
- Recreate the runtime canvas on load.
- Render the restored frame at the current playhead.

Add to `SerializableClip`:

```ts
mathScene?: MathSceneDefinition;
```

Do not serialize:

- Canvas objects
- Parsed expression AST caches
- Sampled polylines
- Any DOM or GPU resources

---

## AI Tooling

Once the MVP works, expose AI tools:

- `createMathSceneClip`
- `addMathFunction`
- `addMathParameter`
- `animateMathParameter`
- `addMathPoint`
- `addMathTangent`
- `setMathViewport`

This allows prompts such as:

```text
Create a 5 second math scene showing y=x^2. Reveal the graph, move a point from x=-2 to x=2, and show the tangent.
```

Relevant areas:

- `src/services/aiTools/definitions/`
- `src/services/aiTools/handlers/`
- `src/services/aiTools/types.ts`

---

## MVP Scope

The first usable version should include:

- Create Math Scene clip on a video track.
- Render axes and grid.
- Render one or more `y = f(x)` function plots.
- Add scalar parameters.
- Animate a parameter linearly over clip time.
- Add a point bound to expressions.
- Add a tangent at a parameterized x value.
- Draw-on reveal for function plots.
- Edit core properties from a Math panel or Math properties tab.
- Save and load projects with Math Scene clips.
- Export Math Scene clips through the existing render pipeline.

Do not include in MVP:

- Full LaTeX formula layout
- 3D graphing
- Symbolic algebra
- Code editor
- Physics simulation
- Full GeoGebra-style construction tools
- Arbitrary JS execution

---

## Implementation Order

1. Add `MathSceneDefinition` types and default scene factory.
2. Add expression evaluator with unit tests.
3. Add `MathSceneRenderer` for Canvas2D axes and function plots.
4. Add timeline slice to create and update Math Scene clips.
5. Add serialization and load restore path.
6. Add LayerBuilder and LayerCollector support.
7. Add minimal Properties tab controls.
8. Add Math dock panel with object and parameter lists.
9. Add point, tangent, and draw-on animation.
10. Add timeline UI badges and copy/paste handling.
11. Add feature documentation and test coverage.

---

## Test Plan

Unit tests:

- Expression parser/evaluator
- Parameter animation interpolation
- Function sampling
- Discontinuity splitting
- Serialization roundtrip

Integration tests:

- Add Math Scene clip to video track.
- Update expression and verify canvas re-renders.
- Save/load restores the scene definition.
- Export path receives a canvas-backed layer.

Manual checks:

- Scrubbing updates graph animation deterministically.
- Playback and export match.
- Nested composition containing Math Scene renders correctly.
- Effects, masks, transforms, and opacity work on Math Scene clips.

---

## Risks

| Risk | Mitigation |
|---|---|
| Expression parsing becomes unsafe | Do not use `eval`; ship a constrained evaluator |
| Heavy scenes hurt playback | Cache parsed expressions and sampled geometry; cap samples in MVP |
| `tan(x)` and discontinuities draw bad lines | Split polylines on non-finite values and large jumps |
| Layer cache holds stale canvas | Mark source dynamic or render before cache checks |
| UI becomes too complex | Start with object list, parameter list, and preset animations only |
| Save/load breaks runtime resources | Serialize only `MathSceneDefinition`; recreate canvas on load |

---

## Open Decisions

- Should the Math panel be a full dock panel from day one, or should MVP start only as a Properties tab?
- Should `LayerSource.type` include `math-scene`, or should Math Scene render internally as `text` to minimize render changes?
- Should generated Math Scene items live in a dedicated Media panel folder?
- Should parameters use the existing keyframe system later, or remain local to the Math Scene definition?
- Which expression parser dependency, if any, is acceptable for bundle size and license?

---

## Definition Of Done

- A user can create a Math Scene clip on the timeline.
- The clip can render `y = sin(x)` with axes and grid.
- A parameter `a` can animate over the clip duration.
- A point can follow `(a, sin(a))`.
- A tangent can be shown at `x = a`.
- Scrub, playback, and export show the same deterministic animation.
- The project can be saved, reloaded, and exported with the Math Scene intact.
- Documentation is added to `docs/Features/`.
