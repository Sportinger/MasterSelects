# Keyboard Shortcuts

[← Back to Index](./README.md)

Complete reference of all keyboard shortcuts (verified from codebase).

---

## Playback

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause toggle |
| `I` | Set In point at playhead |
| `O` | Set Out point at playhead |
| `X` | Clear In/Out points |
| `L` | Toggle loop playback |

---

## Timeline Navigation

| Shortcut | Action |
|----------|--------|
| `Scroll` | Vertical scroll |
| `Shift + Scroll` | Horizontal scroll |
| `Alt + Scroll` | Zoom (centered on playhead) |
| `←` / `→` | Frame-by-frame (if implemented) |

---

## Editing

| Shortcut | Action |
|----------|--------|
| `C` | Split all clips at playhead |
| `Delete` / `Backspace` | Delete selected (keyframes first, then clips) |
| `Escape` | Deselect all |

---

## Selection

| Action | Method |
|--------|--------|
| Single select | Click clip |
| Multi-select | `Ctrl + Click` |
| Marquee select | Drag on empty area |
| Extend marquee | `Shift + Drag` |
| Deselect | Click empty or `Escape` |

---

## Keyframes

| Action | Method |
|--------|--------|
| Select keyframe | Click diamond |
| Multi-select | `Shift + Click` |
| Fine drag | `Shift + Drag` (10x slower) |
| Easing menu | Right-click keyframe |

---

## Blend Modes

| Shortcut | Action |
|----------|--------|
| `Shift + +` | Next blend mode |
| `Shift + -` | Previous blend mode |

---

## Project

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | New Project |
| `Ctrl + S` | Save Project |
| `Ctrl + O` | Open (shows file menu) |
| `Ctrl + Z` | Undo |
| `Ctrl + Shift + Z` | Redo |

---

## Modifiers

### Shift Key
| Context | Effect |
|---------|--------|
| + Scroll | Horizontal scroll |
| + Drag playhead | Snap to keyframes |
| + Drag keyframe | Fine control (10x slower) |
| + `+`/`-` | Cycle blend modes |
| + Marquee | Extend selection |
| + Drag curve handle | Constrain horizontal |

### Alt Key
| Context | Effect |
|---------|--------|
| + Scroll | Zoom timeline |
| + Drag clip | Skip linked clip movement |
| + Drag in group | Skip group movement |

### Ctrl/Cmd Key
| Context | Effect |
|---------|--------|
| + Click | Add/remove from selection |
| + `Z` | Undo |
| + `Shift + Z` | Redo |
| + `S` | Save |
| + `N` | New Project |

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
| Drag center | Move layer |
| Drag corner | Scale layer |

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
│  Space = Play    I/O = In/Out points   │
│  X = Clear I/O   L = Loop              │
├─────────────────────────────────────────┤
│           EDITING                       │
│  C = Split       Del = Delete          │
│  Ctrl+Z = Undo   Ctrl+Shift+Z = Redo   │
├─────────────────────────────────────────┤
│           PROJECT                       │
│  Ctrl+N = New    Ctrl+S = Save         │
├─────────────────────────────────────────┤
│           NAVIGATION                    │
│  Alt+Scroll = Zoom                     │
│  Shift+Scroll = H-Scroll               │
├─────────────────────────────────────────┤
│           BLEND MODES                   │
│  Shift++ = Next  Shift+- = Previous    │
└─────────────────────────────────────────┘
```

---

## Related Features

- [Timeline](./Timeline.md) - Main editing
- [Keyframes](./Keyframes.md) - Animation
- [Preview](./Preview.md) - Playback
- [Effects](./Effects.md) - Blend modes

---

*Compiled from codebase analysis*
