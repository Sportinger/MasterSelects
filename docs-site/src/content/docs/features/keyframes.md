---
title: "Keyframes"
---

[<- Back to Index](/features/readme/)

The keyframe system animates clip properties over time using per-clip keyframe maps, Graph mode, and Bezier handles. It supports transform properties, speed, numeric effect parameters, color, masks, text bounds, camera and light settings, custom-node parameters, vector-animation state/input properties, and numeric motion-shape properties.

The [Node Workspace](/features/node-workspace/#keyframe-nodes) shows independent curves
in a compact **Animation** area on their parameter's owning node. Existing
projects appear this way automatically, including previously saved independent
keyframe nodes. The area shows a curve count, mini curve, current value and time
cursor; value changes briefly highlight it. Click it to choose and edit a curve
in the inspector, or **Extract as keyframe node** to share it with other parameters.

Explicitly extracted and shared **Keyframe Nodes** remain separate. Their cables
appear when selecting the animation node or a receiving node. Compatible
parameters can share values, with explicit scale/offset mapping where needed.
Removing a separate node preserves its animation and shows it at the owning
parameter again. Opening the graph changes neither project data nor keyframes.
Timeline, node-inspector and AI edits still update the same curves; the AI's
`getKeyframes` result includes their bindings.

Bypassed face/lip stabilization and 3D Clip Transform keys appear gray in timeline rows, clip markers
and curve editors; bypassed curve segments are dashed. Selection remains visible
and the keys stay editable. This reflects the clip's stabilization or transform bypass without
changing or deleting the keys. Manual transform and effect animation retain their
normal colors; a grouped clip marker stays active if it also contains active keys.

`Keyframe.hold` keeps a value until the next key. The node inspector uses this for
discrete boolean channels and offers Hold for continuous channels. Timeline curve
paths, speed integration, project save/load and keyframe clipboard preserve it.

---

## Animatable Properties

### Transform Properties

| Property | Notes |
|----------|-------|
| `opacity` | 0-1 value, shown as percent in the UI. Static edits and keyframe writes are clamped to 0-100%, so neither timeline controls nor Graph mode can store negative opacity. |
| `position.x` | Horizontal position. |
| `position.y` | Vertical position. |
| `position.z` | World-space Z position when the clip exposes it. For camera clips this is the real camera eye Z. |
| `scale.all` | Independent uniform multiplier applied on top of the axis scale values. Camera clips retain this value for project compatibility. |
| `scale.x` | Horizontal scale. |
| `scale.y` | Vertical scale. |
| `scale.z` | Z scale for 3D objects when visible. Camera clips retain this value for project compatibility. |
| `rotation.x` | Pitch-style rotation on 3D and camera-style clips. |
| `rotation.y` | Yaw-style rotation on 3D and camera-style clips. |
| `rotation.z` | Roll / 2D rotation. |
| `speed` | Playback rate; supports variable-rate integration and reverse playback. |

### Camera Lens Properties

Camera clips add keyframable lens settings:

| Property | Notes |
|----------|-------|
| `camera.fov` | Vertical field of view in degrees. The mm lens field edits this same property through full-frame-equivalent conversion. |
| `camera.near` | Near clipping plane. |
| `camera.far` | Far clipping plane. |
| `camera.resolutionWidth` | Camera gate width, shown as Resolution X. |
| `camera.resolutionHeight` | Camera gate height, shown as Resolution Y. |

The FOV and mm fields are two views of the same lens value. They are not independent properties, so keyframes, MIDI, lens-field edits, and curve editing all resolve through `camera.fov`.
Resolution X/Y controls the camera gate aspect used by the edit-view camera frame.

### Effect Properties

Any numeric effect parameter can be keyframed with the pattern:

```text
effect.{effectId}.{paramName}
```

Examples:
- `effect.effect_123.shift`
- `effect.effect_123.volume`
- `effect.effect_123.band1k`

Audio fades are built from `effect.{volumeEffectId}.volume` keyframes. Flexible EQ lanes use nested effect-property paths so band and advanced numeric controls can be animated without flattening the EQ schema:

- `effect.effect_123.eq.audible.bands.presence.frequencyHz`
- `effect.effect_123.eq.audible.bands.presence.gainDb`
- `effect.effect_123.eq.audible.bands.presence.q`
- `effect.effect_123.eq.audible.bands.presence.dynamic.thresholdDb`
- `effect.effect_123.eq.audible.bands.presence.spectralDynamics.attackMs`

The selected EQ band exposes individual stopwatches plus an all-numeric-band stopwatch. The EQ stack item header exposes an all-numeric-EQ stopwatch that writes keyframes for every numeric band parameter at the current playhead.

### Color Properties

Color correction parameters use the color graph namespace:

```text
color.{versionId}.{nodeId}.{paramName}
```

The Color panel can enable every color stopwatch for the active grade version at the current playhead. Timeline Copy Color and Paste Color copy the grade state together with its `color.*` keyframes.

### Text, Light, and Custom-node Properties

Text bounds use `textBounds.path` for the complete bounds shape and `textBounds.position.x` / `textBounds.position.y` for numeric offsets.

Text clips also animate `text.fontSize`, `text.lineHeight`, `text.letterSpacing`, `text.strokeWidth`, `text.shadowOffsetX` / `.Y`, `text.shadowBlur`, and `text.value` — the number printed by `{value}` tokens in the text (see [Text Clips](/features/text-clips/#animated-numbers-value-tokens)).

Light clips expose `light.intensity`, `light.diameter`, `light.shadowStrength`, and `light.color.r` / `.g` / `.b`. Exposed custom-node parameters use `node.{nodeId}.{paramName}`; color parameters are stored as per-channel paths.

### Mask Properties

Masks use flat keyframe property names scoped by mask id:

```text
mask.{maskId}.path
mask.{maskId}.position.x
mask.{maskId}.position.y
mask.{maskId}.feather
mask.{maskId}.featherQuality
```

`mask.*.path` stores the whole path as one keyframe value: all vertices, bezier handles, handle modes, and the closed/open state.
It interpolates between neighboring paths and handles added or removed vertices by tweening them from or into a collapsed neighbor point.
The numeric mask properties use the same curve and easing behavior as transform and effect values, but the Mask tab presents `mask.*.path` as the primary stopwatch for shape animation.

### Vector Animation Properties

Vector animation state machines and Rive Data Binding use the same keyframe store as transform and effect properties:

```text
lottieState.{stateMachine}
lottieInput.{stateMachine}.{input}
riveData.{property}
```

`lottieState.*` keyframes are discrete named states. They render as blue diamonds and stepped curves because a state change should hold until the next state keyframe, not ease between values. Boolean and numeric `lottieInput.*` properties use the normal stopwatch/keyframe workflow. Rive Data Binding properties use `riveData.*` for numeric, integer, boolean, and color values; string and enum bindings remain static clip settings.

### Motion Shape Properties

Motion shape clips use flat property paths from the property registry:

```text
shape.size.w
shape.size.h
shape.cornerRadius
appearance.{appearanceId}.opacity
appearance.{appearanceId}.color.r
appearance.{appearanceId}.color.g
appearance.{appearanceId}.color.b
appearance.{appearanceId}.color.a
appearance.{appearanceId}.stroke.width
replicator.count.x
replicator.count.y
replicator.spacing.x
replicator.spacing.y
replicator.offset.opacity
```

Numeric motion properties are interpolated before `MotionRenderer` draws the shape texture, so preview, nested compositions, and export evaluate the same frame state. Enum-like fields such as primitive and stroke alignment are currently static controls.

### Visibility Rules

- 2D clips hide `rotation.x`, `rotation.y`, `position.z`, and `scale.z` in the timeline UI.
- Camera clips and native-render gaussian splat clips keep the camera-style property model visible.

---

## Creating Keyframes

### Property Row Controls

Each property row in the track header exposes:

- Previous keyframe jump.
- Add / update keyframe at the current playhead.
- Next keyframe jump.

The diamond button writes a keyframe at the playhead. If a keyframe already exists at that exact time for that property, the store updates it instead of creating a duplicate.

### Value Scrubbing

- Dragging the value scrubber updates the static property value when the property is not already keyframed.
- If recording is enabled for that clip/property, or if keyframes already exist for that property, the same scrub updates keyframes instead of the static value.
- Right-click on the value field resets the property to its default value.
- Transform panel stopwatch buttons are per value, including Position X/Y/Z, Scale All/X/Y/Z, and Rotation X/Y/Z.
- `scale.all` does not overwrite `scale.x`, `scale.y`, or `scale.z`; render, export, and scene-gizmo paths multiply it into the final visible scale only at evaluation time.
- Camera stopwatch buttons are per camera value. FOV and mm both write `camera.fov`; Near, Far, Resolution X, and Resolution Y write their own camera properties.
- Mask panel stopwatch buttons are available for the whole Mask Path, Feather, and Feather Quality. Position X/Y remain animatable for compatibility and automation, but the visible mask-shape workflow uses the Mask Path stopwatch.
- Motion shape stopwatch buttons are available for size, corner radius, fill opacity, and stroke width in the Motion tab.

### Recording Mode

Recording is tracked per `clipId:property` entry.

When recording is enabled:
- The current value at the playhead is written as a keyframe.
- Existing keyframes at that time are updated.
- New keyframes are created automatically when needed.

---

## Editing Keyframes

### Timeline Keyframe Diamonds

- Click a diamond to select the keyframe.
- `Shift+Click` toggles additional selection.
- Drag left or right to move in time.
- `Shift+drag` on a timeline diamond snaps the movement delta to other keyframes in the same clip.
- Dragging a selected keyframe moves the whole selection by the same delta.
- Clip bars show a compact global keyframe marker for each clip-local time that has keyframes. Hovering the marker enlarges it, and dragging it moves all keyframes at that same clip-local time together.

### Curve Editor

![Bezier curve editor with selected keyframe handles](/assets/keyframes/bezier-curve-editor.png)

- Double-click a property row or keyframe diamond to open Graph mode.
- Graph mode shows the selected clip's animated numeric properties as selectable curve series; only one property is expanded in the track header at a time.
- The active curve renders a value axis that auto-scales to its current keyframes.
- Selected keyframes expose Bezier handles.
- Dragging a handle updates the stored handle position and switches the keyframe to Bezier mode.
- `Shift+drag` on a keyframe constrains movement to one axis in the curve editor.
- Vector animation state keyframes show state labels on the value axis and draw stepped segments instead of Bezier curves.
- Mask path rows expose timing and easing in the timeline; their value is a whole shape snapshot rather than a numeric scalar.

Regenerate the documentation image with:

```powershell
npm run docs:screenshots -- --id=keyframes-bezier-curve-editor
```

### Delete and Copy/Paste

- `Delete` removes selected keyframes.
- `Ctrl+C` with keyframes selected copies only the keyframes.
- `Ctrl+V` pastes keyframes relative to the current playhead.
- Keyframes are normalized on copy so pasted timing stays relative to the first copied keyframe.
- Pasting replaces existing keys within each pasted property's time range, including keys at the same time. Keys outside that range and other properties stay intact; repeated paste does not create duplicates.
- Copying whole clips preserves audio edits and effect automation, retargets curves to the copied effects, and gives each copy independent Bezier handles.
- If the clipboard does not contain keyframes, paste falls back to the clip clipboard flow.
- Removing an effect also removes every `effect.{effectId}.*` keyframe owned by that effect, so deleted effect curves disappear from Graph mode immediately.

### Disable / Toggle Off

- Turning off keyframes for a property preserves the current value as the new static value.
- All keyframes for that property are removed.
- Recording for that clip/property is also disabled.

---

## Easing

The UI exposes four preset easing choices in the context menu:

- Linear
- Ease In
- Ease Out
- Ease In-Out

The data model also supports `bezier` easing. A keyframe becomes Bezier-driven once its in/out handles are edited.

### Rotation Path

Rotation keyframes also expose a segment path option in the right-click context menu:

- Shortest Path: rotate through the smallest angular difference. Camera clips use this by default.
- Continuous / Orbit: preserve the raw angle delta, so values like `1x + 0deg` produce a full 360-degree turn. Camera positions recorded with Preview Orbit follow the circular path around the shared world pivot instead of cutting straight between the keyed eye positions.

Like easing, the rotation path is stored on the keyframe that starts the segment leading into the next keyframe. This lets one camera move use shortest-path aiming while the next segment performs a deliberate orbit.

Rotation keyframes that start a segment show the active path next to the keyframe: `S` for Shortest Path and `C` for Continuous / Orbit.

### Practical Notes

- The easing stored on a keyframe applies to the segment that leads into the next keyframe.
- If a handle exists, the curve editor treats the segment as custom Bezier regardless of the stored preset easing mode.

---

## Speed Integration

Speed is a first-class animatable property in the UI.

- The store maps speed to source time through integration of the speed curve.
- Variable speed uses trapezoidal integration for smooth ramps.
- Negative values play the source backwards.
- The duration math uses absolute speed for inverse duration calculation and handles zero defensively.

This means speed keyframes can create ramps, reversals, and mixed-rate playback within a single clip.

---

## Track Expansion

- Expanding a track shows flat property rows for the selected clip in that track.
- The row order prefers transform properties first and effect properties after them.
- Audio EQ parameters are ordered by band frequency, with `volume` first; nested flexible-EQ rows include frequency, gain, Q, dynamic EQ, and Spectral Dynamics numeric parameters.

The row-height constant is 18 px.

---

## Related Docs

- [Timeline](/features/timeline/)
- [Keyboard Shortcuts](/features/keyboard-shortcuts/)
- [Preview](/features/preview/)
- [Effects](/features/effects/)

## Dense tracking and stabilization keys

Expanded timeline rows draw every key in the horizontal viewport (plus a small
overscan). Dense rows use one main-thread 2D canvas per property instead of one
DOM element per point. Overlapping keys are all painted, with selected points
on top; pointer hit testing finds the nearest original key for selection, drag,
double-click, and context-menu actions. Zoom exposes individually spaced points.
Canvas backing stores are viewport-sized and capped at 4096 pixels in width.
Stored keys, interpolation, export, marquee selection, and group edits retain
every keyframe. Sparse rows keep their existing DOM controls.

Interpolation shares a weakly cached property/time index for each immutable
keyframe array and finds adjacent keys by binary search. Editing or undoing
creates a new array and therefore a fresh index; old indexes can be collected.
