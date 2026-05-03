# Keyframes

[<- Back to Index](./README.md)

The keyframe system animates clip properties over time using per-clip keyframe maps, curve editors, and Bezier handles. It supports transform properties, speed, numeric effect parameters, mask properties, vector-animation state/input properties, and numeric motion-shape properties.

---

## Animatable Properties

### Transform Properties

| Property | Notes |
|----------|-------|
| `opacity` | 0-1 value, shown as percent in the UI. |
| `position.x` | Horizontal position. |
| `position.y` | Vertical position. |
| `position.z` | World-space Z position when the clip exposes it. For camera clips this is the real camera eye Z. |
| `scale.all` | Independent uniform multiplier applied on top of the axis scale values. Camera clips keep the legacy value for project compatibility, but it is no longer part of the camera pose or exposed as a visible Zoom control. |
| `scale.x` | Horizontal scale. |
| `scale.y` | Vertical scale. |
| `scale.z` | Z scale for 3D objects when visible. Camera clips keep legacy values for compatibility, but `scale.z` is no longer a camera movement control. |
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

Audio fades are built from `audio-volume.volume` keyframes, and EQ lanes use the same effect-property naming pattern.

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
It interpolates between compatible neighboring paths and holds when the topology does not match.
The numeric mask properties use the same curve and easing behavior as transform and effect values.

### Vector Animation Properties

Lottie state machines use the same keyframe store as transform and effect properties:

```text
lottieState.{stateMachine}
lottieInput.{stateMachine}.{input}
```

`lottieState.*` keyframes are discrete named states. They render as blue diamonds and stepped curves because a state change should hold until the next state keyframe, not ease between values. Boolean and numeric `lottieInput.*` properties use the normal stopwatch/keyframe workflow.

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
- Transform panel stopwatch buttons are per value, including Position X/Y/Z, Scale All/X/Y/Z, and Rotation X/Y/Z. Group stopwatches are not used for these rows.
- `scale.all` does not overwrite `scale.x`, `scale.y`, or `scale.z`; render, export, and scene-gizmo paths multiply it into the final visible scale only at evaluation time.
- Camera stopwatch buttons are per camera value. FOV and mm both write `camera.fov`; Near, Far, Resolution X, and Resolution Y write their own camera properties.
- Mask panel stopwatch buttons are available for Feather, Feather Quality, Position X/Y, and the whole Mask Path.
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
- `Shift+drag` on a timeline diamond makes the drag 10x slower for fine control.
- Dragging a selected keyframe moves the whole selection by the same delta.
- Clip bars show a compact global keyframe marker for each clip-local time that has keyframes. Hovering the marker enlarges it, and dragging it moves all keyframes at that same clip-local time together.

### Curve Editor

- Double-click a property row to open the curve editor.
- Only one curve editor can be open at a time.
- The curve editor renders a value axis that auto-scales to the current keyframes.
- `Shift+wheel` resizes the curve editor height.
- Selected keyframes expose Bezier handles.
- Dragging a handle updates the stored handle position and switches the keyframe to Bezier mode.
- `Shift+drag` on a keyframe constrains movement to one axis in the curve editor.
- Right-clicking a handle resets it to the default 1/3-distance handle for that segment.
- Lottie state keyframes show state labels on the value axis and draw stepped segments instead of Bezier curves.
- Mask path rows expose timing and easing in the timeline; their value is a whole shape snapshot rather than a numeric scalar.

### Delete and Copy/Paste

- `Delete` removes selected keyframes.
- `Ctrl+C` with keyframes selected copies only the keyframes.
- `Ctrl+V` pastes keyframes relative to the current playhead.
- Keyframes are normalized on copy so pasted timing stays relative to the first copied keyframe.
- If the clipboard does not contain keyframes, paste falls back to the clip clipboard flow.

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
- Continuous / Orbit: preserve the raw angle delta, so values like `1x + 0deg` produce a full 360-degree turn.

Like easing, the rotation path is stored on the keyframe that starts the segment leading into the next keyframe. This lets one camera move use shortest-path aiming while the next segment performs a deliberate orbit.

Rotation keyframes that start a segment show the active path next to the keyframe: `S` for Shortest Path and `C` for Continuous / Orbit.

### Practical Notes

- The easing stored on a keyframe applies to the segment that leads into the next keyframe.
- If a handle exists, the curve editor treats the segment as custom Bezier even if the stored easing was previously one of the preset modes.

---

## Speed Integration

Speed is a first-class animatable property, not a special case in the UI.

- The store maps speed to source time through integration of the speed curve.
- Variable speed uses trapezoidal integration for smooth ramps.
- Negative values play the source backwards.
- The duration math uses absolute speed for inverse duration calculation and handles zero defensively.

This means speed keyframes can create ramps, reversals, and mixed-rate playback within a single clip.

---

## Track Expansion

- Expanding a track shows flat property rows for the selected clip in that track.
- The row order prefers transform properties first and effect properties after them.
- Audio EQ parameters are ordered by band frequency, with `volume` first.
- If a curve editor is open for a property, it adds additional height beneath the row.

The row-height constant is 18 px, and the curve editor height clamps to 80-600 px.

---

## Related Docs

- [Timeline](./Timeline.md)
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)
- [Preview](./Preview.md)
- [Effects](./Effects.md)
