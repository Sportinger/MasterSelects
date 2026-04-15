# Keyboard Shortcuts

[<- Back to Index](./README.md)

Current shortcut bindings are routed through `shortcutRegistry`, so presets and per-action overrides update live from Settings.

---

## Presets

MasterSelects ships with 6 presets:

- MasterSelects
- Premiere Pro
- DaVinci Resolve
- Final Cut Pro
- After Effects
- Beginner

`Beginner` currently matches `MasterSelects`.

### Preset Differences

| Action | MasterSelects / Beginner | Premiere Pro | DaVinci Resolve | Final Cut Pro | After Effects |
|--------|--------------------------|--------------|-----------------|---------------|---------------|
| Loop | `Shift+L` | `Ctrl+L` | `Ctrl+/` | `Ctrl+L` | none |
| Cut tool | `C` | `C` | `B` | `B` | none |
| Split at playhead | `Shift+C` | `Ctrl+K` | `Ctrl+B` | `Ctrl+B` | `Ctrl+Shift+D` |
| Clear In/Out | `X` | `Ctrl+Shift+X` | `Alt+X` | `Alt+X` | none |
| Frame step | `Left/Right` | `Left/Right` | `Left/Right` | `Left/Right` | `PageUp/PageDown` or `Ctrl+Left/Right` |
| Add marker | `M` | `M` | `M` | `M` | `Numpad*` or `Shift+8` |
| New project | `Ctrl+N` | `Ctrl+Alt+N` | none | `Ctrl+N` | `Ctrl+Alt+N` |
| Open project | `Ctrl+O` | `Ctrl+O` | none | `Ctrl+O` | `Ctrl+O` |
| Save | `Ctrl+S` | `Ctrl+S` | `Ctrl+S` | none | `Ctrl+S` |
| Save As | `Ctrl+Shift+S` | `Ctrl+Shift+S` | `Ctrl+Shift+S` | none | `Ctrl+Shift+S` |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` | `Ctrl+Shift+Z` | `Ctrl+Shift+Z` | `Ctrl+Shift+Z` | `Ctrl+Shift+Z` |

On Mac, `Ctrl` maps to `Cmd` and `Alt` maps to `Option`.

---

## Current Bindings

### Playback

- `Space` toggles play/pause.
- `J` reverses playback.
- `K` pauses playback.
- `L` plays forward.
- `Shift+L` toggles loop playback in the default preset.
- `I` sets the in point at the playhead.
- `O` sets the out point at the playhead.
- `X` clears in/out in the default preset.

### Navigation

- `Shift+Scroll` pans horizontally.
- `Ctrl+Scroll` or `Alt+Scroll` zooms the timeline around the playhead.
- `Ctrl+Shift+Scroll` or `Cmd+Shift+Scroll` toggles slot-grid view.
- `Left` and `Right` arrows step one frame at a time.

### Editing

- `C` toggles the cut tool in the default preset.
- `Escape` exits cut mode.
- `Shift+C` splits the clip at the playhead in the default preset.
- `Ctrl+C` copies selected keyframes when any are selected; otherwise it copies selected clips.
- `Ctrl+V` pastes keyframes when the clipboard contains keyframes; otherwise it pastes clips.
- `Delete` / `Backspace` removes selected keyframes first, then clips.
- `M` adds a marker at the playhead.

### Selection

- Click selects a single clip.
- `Ctrl+Click` / `Cmd+Click` adds or removes a clip from the selection.
- `Shift+Click` toggles only the clicked clip.
- Normal click on a linked video clip selects the linked audio clip too.
- `Alt+drag` moves linked clips independently.

### Keyframes

- Click a diamond to select a keyframe.
- `Shift+Click` adds or removes keyframes from the selection.
- `Shift+drag` moves keyframes more slowly.
- Right-click a keyframe to change easing.
- Right-click a Bezier handle to reset it to its default position.

### Blend Modes

- `+` or `Numpad+` advances the blend mode on the selected clip(s).
- `-` or `Numpad-` moves to the previous blend mode.
- In After Effects preset mode, the blend-mode bindings follow the AE-style `Shift+=` / `Shift+-` layout.

### Project

- `Ctrl+N` creates a new project in presets that expose it.
- `Ctrl+O` opens a project in presets that expose it.
- `Ctrl+S` saves the current project.
- `Ctrl+Shift+S` saves as a new project name.
- `Ctrl+Z` undoes the last action.
- `Ctrl+Shift+Z` redoes the last action.
- `Ctrl+Y` is available in the default preset only.

### Preview

- `Tab` toggles preview edit mode on the active editable preview source.
- `1`, `2`, `3`, and `4` highlight the matching slot in the multi-preview panel.

### Panels

- The German-layout `u-umlaut` key toggles fullscreen for the hovered dock tab.

---

## Context-Specific Behavior

### Timeline Keyframes

- `Ctrl+C` / `Ctrl+V` obey the keyframe clipboard first.
- Paste uses the selected clip when exactly one clip is selected; otherwise it falls back to the original clip from the copied keyframes.

### Preview Edit Mode

- `Tab` only works when the preview source is editable.
- The preview panel ignores the shortcut when showing a non-editable source monitor.

### Docking

- `Escape` also cancels panel drag operations in the dock container.

### Inputs

- Most handlers ignore text inputs and content-editable fields.
- Save / Save As still prevent the browser default save dialog even when focus is inside an input.

---

## Customization

- Shortcuts can be changed in `Preferences -> Shortcuts`.
- Each action can store one or more combos.
- Conflicts are detected live in the UI.
- Custom named presets are saved locally.
- Resetting to a preset clears manual overrides.

---

## Related Docs

- [Timeline](./Timeline.md)
- [Keyframes](./Keyframes.md)
- [Preview](./Preview.md)
- [Effects](./Effects.md)
