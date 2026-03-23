# Keyboard Shortcuts

[← Back to Index](./README.md)

Complete reference of all keyboard shortcuts and NLE presets (verified from codebase + official documentation).

---

## Presets

MasterSelects ships with 6 shortcut presets. Switch in **Preferences → Shortcuts → Active Preset**.

| Preset | Based on | Key Differences from MasterSelects |
|--------|----------|-----------------------------------|
| **MasterSelects** | Custom | Default — balanced NLE layout |
| **Premiere Pro** | Adobe PPro | `Ctrl+K` split, `Ctrl+L` loop, `Ctrl+Shift+X` clear I/O, `Ctrl+Alt+N` new project |
| **DaVinci Resolve** | BMD Resolve | `B` blade tool, `Ctrl+B` split, `Ctrl+/` loop, `Alt+X` clear I/O, no New/Open Project |
| **Final Cut Pro** | Apple FCP | `B` blade tool, `Ctrl+B` split, `Ctrl+L` loop, `Alt+X` clear I/O, no Save/Save As |
| **After Effects** | Adobe AE | `B`/`N` in/out, `Ctrl+Shift+D` split, `PageUp/Down` frame step, `Shift+=/-` blend modes, no JKL shuttle, no razor tool |
| **Beginner** | MasterSelects | Same as MasterSelects — simplest layout |

### Preset Detail: Differences Per Action

| Action | MasterSelects | Premiere Pro | DaVinci Resolve | Final Cut Pro | After Effects |
|--------|--------------|--------------|-----------------|---------------|---------------|
| Play/Pause | `Space` | `Space` | `Space` | `Space` | `Space` |
| Pause | `K` | `K` | `K` | `K` | — |
| Play Forward | `L` | `L` | `L` | `L` | — |
| Play Reverse | `J` | `J` | `J` | `J` | — |
| Toggle Loop | `Shift+L` | `Ctrl+L` | `Ctrl+/` | `Ctrl+L` | — |
| Frame Forward | `→` | `→` | `→` | `→` | `PageDown` / `Ctrl+→` |
| Frame Backward | `←` | `←` | `←` | `←` | `PageUp` / `Ctrl+←` |
| Set In Point | `I` | `I` | `I` | `I` | `B` |
| Set Out Point | `O` | `O` | `O` | `O` | `N` |
| Clear In/Out | `X` | `Ctrl+Shift+X` | `Alt+X` | `Alt+X` | — |
| Add Marker | `M` | `M` | `M` | `M` | `Numpad *` / `Shift+8` |
| Split at Playhead | `Shift+C` | `Ctrl+K` | `Ctrl+B` | `Ctrl+B` | `Ctrl+Shift+D` |
| Delete | `Del` / `Backspace` | `Del` / `Backspace` | `Backspace` / `Del` | `Del` / `Backspace` | `Del` |
| Copy | `Ctrl+C` | `Ctrl+C` | `Ctrl+C` | `Ctrl+C` | `Ctrl+C` |
| Paste | `Ctrl+V` | `Ctrl+V` | `Ctrl+V` | `Ctrl+V` | `Ctrl+V` |
| Next Blend Mode | `+` / `Numpad+` | `+` / `Numpad+` | `+` / `Numpad+` | `+` / `Numpad+` | `Shift+=` |
| Prev Blend Mode | `-` / `Numpad-` | `-` / `Numpad-` | `-` / `Numpad-` | `-` / `Numpad-` | `Shift+-` |
| Cut/Razor Tool | `C` | `C` | `B` | `B` | — |
| New Project | `Ctrl+N` | `Ctrl+Alt+N` | — | `Ctrl+N` | `Ctrl+Alt+N` |
| Open Project | `Ctrl+O` | `Ctrl+O` | — | `Ctrl+O` | `Ctrl+O` |
| Save | `Ctrl+S` | `Ctrl+S` | `Ctrl+S` | — | `Ctrl+S` |
| Save As | `Ctrl+Shift+S` | `Ctrl+Shift+S` | `Ctrl+Shift+S` | — | `Ctrl+Shift+S` |
| Undo | `Ctrl+Z` | `Ctrl+Z` | `Ctrl+Z` | `Ctrl+Z` | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` / `Ctrl+Y` | `Ctrl+Shift+Z` | `Ctrl+Shift+Z` | `Ctrl+Shift+Z` | `Ctrl+Shift+Z` |

**—** = No binding (action not available or not mapped in that NLE).

> **Note:** On Mac, `Ctrl` maps to `Cmd` and `Alt` maps to `Option`. All presets handle this automatically.

---

## MasterSelects Default Shortcuts

### Playback

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause toggle |
| `J` | Reverse playback (press multiple times for faster) |
| `K` | Pause playback |
| `L` | Forward playback (press multiple times for faster) |
| `Shift + L` | Toggle loop playback |
| `I` | Set In point at playhead |
| `O` | Set Out point at playhead |
| `X` | Clear In/Out points |

### Timeline Navigation

| Shortcut | Action |
|----------|--------|
| `Scroll` | Vertical scroll (snaps to track boundaries) |
| `Shift + Scroll` | Horizontal scroll |
| `Ctrl + Scroll` or `Alt + Scroll` | Zoom (exponential 8% per step, centered on playhead) |
| `Ctrl + Shift + Scroll` | Toggle slot grid view (animated transition) |
| `←` / `→` | Frame-by-frame navigation |

### Editing

| Shortcut | Action |
|----------|--------|
| `C` | Toggle cut tool mode (click clips to split them) |
| `Shift + C` | Split clip at playhead position |
| `Ctrl + C` | Copy selected keyframes (or clips if no keyframes selected) |
| `Ctrl + V` | Paste keyframes at playhead (falls back to paste clips if no keyframes in clipboard) |
| `Delete` / `Backspace` | Delete selected (keyframes first, then clips) |
| `M` | Add marker at playhead |
| `Tab` | Toggle edit mode in preview |
| `Escape` | Exit cut tool mode (return to select tool) |

### Selection

| Action | Method |
|--------|--------|
| Single select | Click clip |
| Multi-select | `Shift + Click` |
| Add/remove from selection | `Ctrl + Click` |
| Linked clip select | Click (selects both video + audio) |
| Independent select | `Shift + Click` linked clip |
| Move multi-selection | Drag any selected clip |
| Deselect | Click empty area or marquee in empty area |

### Keyframes

| Action | Method |
|--------|--------|
| Select keyframe | Click diamond |
| Multi-select | `Shift + Click` |
| Fine drag | `Shift + Drag` (10x slower) |
| Copy keyframes | `Ctrl + C` (with keyframes selected) |
| Paste keyframes | `Ctrl + V` (at playhead on selected clip) |
| Move multi-select | Drag any selected keyframe |
| Easing menu | Right-click keyframe |

### Blend Modes

| Shortcut | Action |
|----------|--------|
| `+` | Next blend mode (any method: Shift+=, Numpad+, direct + key) |
| `-` | Previous blend mode (any method: -, Numpad-, Shift+_ ) |

Applies to all selected clips. Cycles through all blend modes.

### Project

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | New Project |
| `Ctrl + S` | Save Project |
| `Ctrl + Shift + S` | Save As (new project name) |
| `Ctrl + O` | Open Project |
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` | Redo |
| `Ctrl + Y` | Redo (alternative) |

---

## Modifiers

### Shift Key
| Context | Effect |
|---------|--------|
| + Scroll | Horizontal scroll |
| + Drag playhead | Snap to keyframes |
| + Drag keyframe | Fine control (10x slower) |
| + `C` | Split clip at playhead |
| + `L` | Toggle loop playback |
| + Marquee | Extend selection |
| + Drag curve handle | Constrain horizontal |

### Alt Key
| Context | Effect |
|---------|--------|
| + Scroll | Zoom timeline (same as Ctrl+Scroll) |
| + Drag clip | Skip linked clip movement |
| + Drag in group | Skip group movement |

### Ctrl/Cmd Key
| Context | Effect |
|---------|--------|
| + Scroll | Zoom timeline (same as Alt+Scroll) |
| + Shift + Scroll | Toggle slot grid view |
| + Click | Add/remove from selection |
| + `Z` | Undo |
| + `Shift + Z` | Redo |
| + `Y` | Redo (alternative) |
| + `S` | Save |
| + `Shift + S` | Save As |
| + `N` | New Project |
| + `O` | Open Project |

---

## Context-Specific

### Property Values
| Action | Effect |
|--------|--------|
| Left-click drag | Scrub value |
| Right-click | Reset to default |

### Track Headers
| Action | Effect |
|--------|--------|
| Double-click name | Edit track name |
| Click Eye | Toggle visibility |
| Click M | Toggle mute |
| Click S | Toggle solo |
| Click expand arrow | Show keyframe lanes |

### Clip Clips
| Action | Effect |
|--------|--------|
| Drag center | Move clip |
| Drag edges | Trim clip |
| Right-click | Context menu |

### Preview Edit Mode
| Action | Effect |
|--------|--------|
| `Tab` | Toggle edit mode on/off |
| Drag center | Move layer |
| Drag corner handle | Scale layer |
| Drag edge handle | Scale from edge |
| `Shift + Drag` | Lock aspect ratio during scale |

### Curve Editor
| Action | Effect |
|--------|--------|
| Drag keyframe | Move time + value |
| `Shift + Drag` | Constrain axis |
| Drag handle | Adjust bezier curve |
| Click empty | Deselect |

---

## Quick Reference Card

```
┌─────────────────────────────────────────┐
│           PLAYBACK                      │
│  Space = Play    J/K/L = Shuttle       │
│  I/O = In/Out    X = Clear I/O         │
│  Shift+L = Toggle Loop                 │
├─────────────────────────────────────────┤
│           EDITING                       │
│  C = Cut Tool    Shift+C = Split       │
│  M = Add Marker  Del = Delete          │
│  Ctrl+C = Copy   Ctrl+V = Paste        │
│  Ctrl+Z = Undo   Ctrl+Shift+Z = Redo   │
│  Ctrl+Y = Redo   Tab = Edit Mode       │
│  Esc = Exit Cut Tool                   │
├─────────────────────────────────────────┤
│           SELECTION                     │
│  Shift+Click = Multi-select            │
│  Ctrl+Click = Add/Remove               │
├─────────────────────────────────────────┤
│           PROJECT                       │
│  Ctrl+N = New    Ctrl+S = Save         │
│  Ctrl+O = Open   Ctrl+Shift+S = SaveAs │
├─────────────────────────────────────────┤
│           NAVIGATION                    │
│  Ctrl/Alt+Scroll = Zoom (exponential)  │
│  Shift+Scroll = H-Scroll               │
│  Ctrl+Shift+Scroll = Slot Grid Toggle  │
│  ← / → = Frame-by-frame               │
├─────────────────────────────────────────┤
│           BLEND MODES                   │
│  + = Next    - = Previous              │
│  (Numpad, Shift+=, or direct + key)    │
└─────────────────────────────────────────┘
```

---

## Customization

Shortcuts are fully customizable in **Preferences → Shortcuts**:

- **Preset selection:** Choose from MasterSelects, Premiere Pro, DaVinci Resolve, Final Cut Pro, After Effects, or Beginner
- **Per-key override:** Click any shortcut keycap in the list to record a new binding
- **Custom presets:** Save your current configuration as a named preset for later
- **Conflict detection:** The UI warns when two actions share the same key combination
- **Reset:** "Reset All to Preset" clears all overrides back to the active preset's defaults

Shortcut preferences are persisted in localStorage and survive page reloads.

---

## Related Features

- [Timeline](./Timeline.md) - Main editing
- [Keyframes](./Keyframes.md) - Animation
- [Preview](./Preview.md) - Playback
- [Effects](./Effects.md) - Blend modes

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`playbackSlice.test.ts`](../../tests/stores/timeline/playbackSlice.test.ts) | 16 | Playback shortcuts (space, JKL, in/out) |

Run tests: `npx vitest run`

---

*Updated March 2026 - verified against codebase + official NLE documentation*
