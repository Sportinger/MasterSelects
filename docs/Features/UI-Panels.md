# UI & Panels

[← Back to Index](./README.md)

Dockable panel system with After Effects-style menu bar.

---

## Table of Contents

- [Menu Bar](#menu-bar)
- [Panel System](#panel-system)
- [Available Panels](#available-panels)
- [Dock Layouts](#dock-layouts)
- [MIDI Control](#midi-control)

---

## Menu Bar

### Structure
| Menu | Contents |
|------|----------|
| **File** | New, Save, Open Recent |
| **Edit** | Copy, Paste, Settings |
| **View** | Panels, Resolution, Layout |
| **Output** | New Output Window, Active Outputs |
| **Window** | MIDI Control |

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New Project |
| `Ctrl+S` | Save Project |
| `Ctrl+O` | Open (shows menu) |

### Project Name
- Displayed at left of menu bar
- Click to edit/rename
- Updates on save

---

## Panel System

### Dockable Behavior
All panels can be:
- Dragged to rearrange
- Grouped in tabs
- Resized
- Closed/opened

### Tab Controls
| Action | Method |
|--------|--------|
| Switch tab | Click |
| Cycle tabs | Middle mouse scroll |
| Drag tab | Hold 500ms + drag |

### Hold-to-Drag
```
1. Click and hold tab for 500ms
2. Glow animation indicates ready
3. Drag to new position
4. Drop to place
```

### Tab Slot Indicators
Resolume-style visual feedback:
- Shows valid drop locations
- Highlights target slot

---

## Available Panels

### Preview Panel
- Canvas for composition output
- Composition selector
- Edit mode toggle
- Close button
- Multiple panels supported

### Timeline Panel
- Multi-track editor
- Composition tabs
- Playback controls
- Ruler and tracks

### Media Panel
- Media browser
- Folder organization
- Composition list
- Add dropdown

### Effects Panel
- Effect list
- Parameter sliders
- Blend mode selector

### Clip Properties Panel
- Transform controls
- Position, Scale, Rotation
- Opacity slider

### AI Chat Panel
- Chat interface
- Model selector
- Default tab position

### Analysis Panel
- Real-time values
- Analysis graphs
- Per-clip data

### Audio Panel
- Volume slider
- 10-band EQ
- Keyframe toggles

### Export Panel
- Export settings
- Resolution options
- Progress indicator

### Transcript Panel
- Word-level transcript
- Real-time highlighting
- Editable entries

### Multicam Panel
- Camera management
- Sync controls
- EDL generation

### Layer Panel
- Layer list
- Visibility toggles
- Reordering

---

## Dock Layouts

### Default Layout (3-column)
```
┌─────────────────────────────────────────┐
│              Menu Bar                    │
├───────────┬─────────────────┬───────────┤
│  Media    │                 │  Effects  │
│  Panel    │    Preview      │  Panel    │
│           │                 │           │
│  Layers   │                 │  Props    │
│  Panel    │                 │  Panel    │
├───────────┴─────────────────┴───────────┤
│              Timeline                    │
└─────────────────────────────────────────┘
```

### Layout Persistence
- Auto-saved to localStorage
- Survives page refresh
- Multiple preview panels preserved

### Layout Actions
| Action | Location |
|--------|----------|
| Save as Default | View menu |
| Reset Layout | View menu |

### Panel Visibility
View menu → Panels:
- Checkbox for each panel type
- Toggle panels on/off

---

## MIDI Control

### Enabling MIDI
Window menu → MIDI Control

### Requirements
- Browser Web MIDI API support
- MIDI device connected
- Permission granted

### Status Display
```
✓ MIDI Control (N devices)
```

### Device Discovery
- Automatic device detection
- Shows device count when enabled

---

## Resolution Settings

### Output Resolution
View menu → Resolution:
| Preset | Dimensions |
|--------|------------|
| 1080p | 1920×1080 |
| 720p | 1280×720 |
| 4K | 3840×2160 |
| 16:10 | 1920×1200 |
| 4:3 | 1024×768 |

### Setting Resolution
```typescript
setResolution(width, height)
```

---

## Settings Dialog

### Opening
Edit menu → Settings

### Contents
- API key management
- Transcription provider
- Language selection
- Thumbnail/waveform toggles

### Storage
Settings persisted in localStorage.

---

## Status Indicator

### WebGPU Status
Top-right of toolbar:
```
● WebGPU Ready  (green)
○ Loading...    (gray)
```

---

## Context Menus

### Behavior
- Right-click to open
- Stay within viewport bounds
- Solid backgrounds
- Close on outside click

### Common Options
- Rename
- Delete
- Settings
- Context-specific actions

---

## Related Features

- [Timeline](./Timeline.md) - Timeline panel
- [Preview](./Preview.md) - Preview panel
- [Media Panel](./Media-Panel.md) - Media browser
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

*Source: `src/components/common/Toolbar.tsx`, `src/components/dock/`, `src/stores/dockStore.ts`*
