# Keyframes

[<- Back to Index](./README.md)

The keyframe system animates clip properties over time using per-clip keyframe maps, curve editors, and Bezier handles. It supports transform properties, speed, and numeric effect parameters.

---

## Animatable Properties

### Transform Properties

| Property | Notes |
|----------|-------|
| `opacity` | 0-1 value, shown as percent in the UI. |
| `position.x` | Horizontal position. |
| `position.y` | Vertical position. |
| `position.z` | Depth / camera distance when the clip exposes it. |
| `scale.all` | Independent uniform multiplier applied on top of the axis scale values. Camera clips label this as Zoom. |
| `scale.x` | Horizontal scale. |
| `scale.y` | Vertical scale. |
| `scale.z` | Forward offset / camera zoom style depth control when visible. |
| `rotation.x` | Pitch-style rotation on 3D and camera-style clips. |
| `rotation.y` | Yaw-style rotation on 3D and camera-style clips. |
| `rotation.z` | Roll / 2D rotation. |
| `speed` | Playback rate; supports variable-rate integration and reverse playback. |

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
