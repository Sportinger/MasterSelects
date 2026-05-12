# Effects

[Back to Index](./README.md)

MasterSelects has a modular GPU effect system built around registered effect modules, shared WGSL utilities, and a compositor pipeline that can run inline color ops without extra passes.

## At A Glance

- 37 blend modes are implemented in `src/shaders/composite.wgsl`.
- 32 GPU effects are registered in `src/effects/`.
- Registered effect categories are `color`, `blur`, `distort`, `stylize`, `keying`, `generate`, `time`, and `transition`.
- `generate`, `time`, and `transition` currently have no registered effects and are hidden from the add-effect UI.

## Registry And UI

The effect registry is built from category exports in `src/effects/index.ts`. Each effect definition provides:

- `id`, `name`, and `category`
- WGSL shader source
- fragment `entryPoint`
- `uniformSize`
- parameter definitions
- `packUniforms(...)`
- optional `passes` and `customControls`

The production editor UI is `src/components/panels/properties/EffectsTab.tsx`.
`src/effects/EffectControls.tsx` is a generic fallback renderer.

## Current Effect Categories

- `color` (9): Brightness, Contrast, Saturation, Vibrance, Hue Shift, Temperature, Exposure, Levels, Invert
- `blur` (5): Box Blur, Gaussian Blur, Radial Blur, Zoom Blur, Motion Blur
- `distort` (7): Pixelate, Kaleidoscope, Mirror, RGB Split, Twirl, Wave, Bulge
- `stylize` (10): Vignette, Grain, Sharpen, Posterize, Glow, Edge Detect, Scanlines, Threshold, Acuarela, Rom1
- `keying` (1): Chroma Key

## Parameter Editing

`EffectsTab` renders effect parameters directly from the registry.

- Number parameters use a slider plus `DraggableNumber`.
- Boolean parameters use a checkbox.
- Select parameters use a dropdown.
- Parameters marked `quality: true` are grouped in a collapsible `Quality` section.
- Quality values can be dragged past the visible slider max in the editor.
- Parameters marked `animatable: false` are shown as static controls.

The registered quality parameters are currently:

- Gaussian Blur: `samples`
- Motion Blur: `samples`
- Radial Blur: `samples`
- Zoom Blur: `samples`
- Glow: `rings`, `samplesPerRing`

Right-click on a numeric control resets that parameter to its default.
The `performanceMonitor` service can also reset quality parameters to defaults when rendering becomes too slow.

## Inline Effects

These effects are applied directly in the composite shader instead of running as separate effect passes:

- Brightness
- Contrast
- Saturation
- Invert

That keeps them zero-overhead relative to the full ping-pong effect chain.

## Effect Pipeline

Non-inline effects are compiled from shared WGSL utilities plus the effect shader itself.
The pipeline creates one GPU render pipeline per registered effect and filters out disabled effects and `audio-` effects during application.

Effects with `uniformSize` 0 use no uniform buffer.
Most effects use a 16-byte-aligned uniform block; a few multi-parameter effects use larger blocks.

Effects can opt into temporal feedback through `usesFeedback`. Feedback effects sample their own previous output frame on binding 3 and the pipeline maintains a per-effect-instance feedback texture. Acuarela and the frozen Rom1 snapshot use this path to build a watery smoke trail from animated fractal UV offsets.

Wall-clock animated effects can also set `requiresContinuousRender`. The engine keeps rendering live frames for active continuous effects while the playhead is parked, and it bypasses RAM Preview frame reuse so the animated output does not freeze.

## Keyframing

Numeric effect parameters can be keyframed through the timeline using the property path format:

```ts
effect.{effectId}.{paramName}
```

`EffectsTab` reads interpolated values from the timeline store and writes animated numbers back through `setPropertyValue`.

The clip context menu supports Copy Effects and Paste Effects. This copies the full effect stack plus matching `effect.*` keyframes and pastes them onto the selected clip set.

## Current Notes

- `color` and `point` parameter types exist in the effect type system, but the current registered effects do not use them.
- The empty `generate`, `time`, and `transition` categories are present in the type system so they can be populated later without changing the registry shape.

## Related Docs

- [Masks](./Masks.md)
- [Text Clips](./Text-Clips.md)
- [Keyframes](./Keyframes.md)

