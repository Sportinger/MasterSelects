# UI & Panels

[Back to Index](./README.md)

Dockable desktop panel system with an After Effects-style menu bar, unified clip properties, and a separate mobile shell for touch devices.

---

## Table of Contents

- [Menu Bar](#menu-bar)
- [Panel System](#panel-system)
- [Available Panels](#available-panels)
- [Slot Grid](#slot-grid)
- [Properties Panel](#properties-panel)
- [Dock Layouts](#dock-layouts)
- [MIDI Control](#midi-control)
- [Resolution Settings](#resolution-settings)
- [Settings Dialog](#settings-dialog)
- [Status Indicator](#status-indicator)
- [Context Menus](#context-menus)
- [Mobile UI](#mobile-ui)

---

## Menu Bar

### Structure

| Menu | Contents |
|------|----------|
| **File** | New Project, Open Project, Save, Save As, Project Info, Autosave, Clear All Cache and Reload |
| **Edit** | Copy, Paste, Settings |
| **View** | Panels submenu, Layouts submenu |
| **Output** | New Output Window, Open Output Manager, Active Outputs |
| **Info** | Where are you coming from?, Tutorials, Quick Tour, Timeline Tour, Changelog, About, Imprint, Privacy Policy, Contact |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New Project |
| `Ctrl+S` | Save Project |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open Project |

### Project Name

- Displayed at the left of the menu bar
- Click to edit or rename
- Shows an unsaved indicator when changes are pending

### File Menu Details

- **New Project** prompts for a project name and folder
- **Open Project** opens an existing project folder
- **Save / Save As** follow the folder-based project model
- **Autosave** still exposes enable/disable plus 1, 2, 5, and 10 minute intervals for interval-save mode
- **Save Mode** itself lives in Settings -> General, and the default branch behavior is continuous save with a short debounce after changes
- **Clear All Cache and Reload** clears localStorage, IndexedDB, caches, and service workers

### Info Menu

- **Where are you coming from?** reopens the welcome/onboarding chooser
- **Tutorials** opens the tutorial campaign picker
- **Quick Tour** starts the panel introduction campaign
- **Timeline Tour** starts the timeline deep dive campaign
- **Changelog** opens the changelog dialog
- **About** shows app and version information
- **Imprint / Privacy Policy / Contact** open the legal dialog pages

The welcome/onboarding chooser can also apply shortcut-preset defaults based on the editor background the user selects.

---

## Panel System

### Dockable Behavior

All docked panels can be:

- Dragged to rearrange
- Grouped in tabs
- Resized via split panes
- Closed and reopened from the View menu
- Floated as independent windows
- Maximized from the hovered tab with the fullscreen shortcut

### Tab Controls

| Action | Method |
|--------|--------|
| Switch tab | Click |
| Cycle tabs | Middle mouse scroll |
| Drag tab | Hold for 500 ms, then drag |
| Maximize hovered tab | Hover a dock tab and use the fullscreen shortcut |

### Floating Panels

- Floating panels keep their own position, size, and z-order
- They can be brought to the front by clicking
- They can be redocked by dragging onto a dock target

---

## Available Panels

MasterSelects currently exposes 17 dockable panel types, plus the Slot Grid overlay that sits on top of the Timeline.

| Panel | Type ID | Surface |
|-------|---------|---------|
| **Multi Preview** | `multi-preview` | 4-slot composition preview grid |
| **Preview** | `preview` | Main composition preview canvas |
| **Timeline** | `timeline` | Multi-track editor and playback surface |
| **Media** | `media` | Media browser, folders, and project items |
| **Properties** | `clip-properties` | Unified clip inspector |
| **Export** | `export` | Render and export controls |
| **MIDI Mapping** | `midi-mapping` | Editable list of assigned MIDI notes and trigger previews |
| **AI Chat** | `ai-chat` | Editing assistant chat |
| **AI Video** | `ai-video` | Classic generator plus FlashBoard workspace |
| **AI Segment** | `ai-segment` | Local SAM2 segmentation tools |
| **AI Scene Description** | `scene-description` | Scene list with playback sync |
| **Downloads** | `download` | URL search/download surface |
| **Multi-Cam** | `multicam` | Multicam sync and EDL tools |
| **Transitions** | `transitions` | Transition library |
| **Waveform** | `scope-waveform` | Waveform scope |
| **Histogram** | `scope-histogram` | Histogram scope |
| **Vectorscope** | `scope-vectorscope` | Vectorscope scope |

### View Menu Grouping

- **Panels** submenu: all dockable panels in one flyout
- Inside **Panels**, entries are grouped into Core, AI, Scopes, and Work in Progress
- Panel entries show their current visible/on state directly in the menu and update immediately when toggled
- **Layouts** submenu: named layouts, default layout selection, and loading saved layouts

### Preview Panel

- Main composition output canvas
- Source selector supports the active composition, a named composition, or a layer-index source
- Per-panel transparency grid toggle
- Multiple preview panels can be opened and floated
- Stats overlay is available

### Multi Preview Panel

- 4-slot grid for showing multiple compositions at once
- Can auto-distribute the active composition's layers or use custom per-slot assignments
- Per-panel transparency grid toggle

### Timeline Panel

- Multi-track video and audio editor
- Composition tabs for switching open compositions
- Playback controls, snapping, and ruler
- Slot Grid overlay is part of the timeline workflow

### Media Panel

- Media browser with folders, compositions, and generated project items
- Single toggle button switches between list view and grid view
- Reorderable column headers in list view
- Grid breadcrumb navigation for folder drilling
- Add menu for compositions, folders, text, 3D text, solids, cameras, splat effectors, mesh primitives, and Gaussian splat import
- Dragging files or folders from the OS recreates the folder structure inside the project
- Drag-to-timeline support
- Type-specific project items for text, solids, meshes, cameras, and splat effectors
- Board mode right-drag supports smooth edge autopan; dragging far out onto a timeline lane hands off to the same timeline drag preview/drop path as list-view media drags, then restores the item at its original board position

### Export Panel

- Encoder selection: WebCodecs or HTML Video
- WebCodecs and FFmpeg codec choices
- Container, resolution, frame rate, quality, and audio controls
- In/Out export and FCPXML export
- Stacked alpha export
- Progress with phase display

### MIDI Mapping Panel

- Open from `View -> Panels -> MIDI Mapping`
- Shows all currently assigned MIDI notes in one list
- Includes global transport bindings, per-marker bindings, and Slot Grid trigger bindings
- Each row shows the note, target, and resulting command behavior
- Click any mapping card to trigger the assigned action and preview what the MIDI note does
- `Edit` opens inline controls for manual channel/note changes and marker reassignment
- `Learn` and `Clear` remain available directly from the panel
- Marker bindings support `Jump To Marker`, `Play From Marker`, and `Jump To Marker And Stop`
- Slot bindings can be created from the Slot Grid filled-slot context menu, which opens this panel with a pending `Listening...` mapping

### AI Chat Panel

- GPT-backed editing assistant
- Model and provider selection
- Context-aware editing commands
- First-open onboarding card with example prompts and editor-mode guidance

### AI Segment Panel

- SAM2 object segmentation in the browser
- Point-based include/exclude workflow
- Real-time mask overlay
- Forward propagation for video

### AI Scene Description Panel

- Scene-by-scene video descriptions
- Search within descriptions
- Click-to-seek scene segments
- Playback-synced highlighting

### AI Video Panel

- Dual-mode surface:
  - Classic mode keeps the older prompt and history generator UI
  - Board mode embeds FlashBoard
- Service and provider selection reflect the active backend
- Generate and History tabs remain available at the top level
- Access overlay appears when no AI video credentials or cloud access are available
- Current generation backends are Kie.ai and MasterSelects Cloud; PiAPI remains primarily as legacy compatibility/catalog metadata rather than the main runtime description for the current panel

#### FlashBoard Workspace

- Top toolbar with board tabs, rename, delete, new board, and queue state
- `+ New Draft` action for creating draft nodes on the active board
- Canvas with pan, zoom, selection, drag/drop, resize handles, and a context menu
- Reference tray for start and end image slots
- Composer panel for prompt, duration, aspect ratio, mode, and multi-shot authoring
- Inspector-style node details for status, cost, references, progress, and retry/delete actions
- Completed generations are imported back into the media store and can be sent to the timeline
- Load failures fall back to classic mode via the error boundary

### Downloads Panel

- Paste URLs from major platforms
- Search YouTube videos via the YouTube Data API
- Preview thumbnails, titles, channels, and duration
- Download via Native Helper and yt-dlp
- The old `youtube` dock panel is now treated as a legacy alias and old layouts are normalized to `download`

### Multi-Cam Panel

- Camera sync and role assignment
- Transcript and EDL-oriented tooling
- Still marked WIP in the View menu

### Transitions Panel

- Transition library
- Drag-drop application surface
- Still marked WIP in the View menu

### Video Scopes Panels

Three independent GPU-rendered scopes:

| Panel | Function |
|-------|----------|
| **Histogram** | RGB distribution graph with channel modes |
| **Vectorscope** | Color vector analysis |
| **Waveform** | Luma/RGB waveform monitor |

- View mode buttons include RGB, R, G, B, and Luma
- IRE reference remains available
- The scopes are fully GPU-rendered

---

## Slot Grid

Resolume-style slot grid for simultaneous multi-layer composition playback. The grid overlays the Timeline panel and lets each slot run on its own wall-clock time.

### Grid Layout

- 4 rows by 12 columns
- Rows A through D represent playback layers
- Column headers let you activate an entire column
- Slots show a mini timeline preview of the assigned composition

### Opening the Slot Grid

| Method | Action |
|--------|--------|
| Toolbar toggle | Switches between the normal timeline and Slot Grid |
| `Ctrl+Shift+Scroll Down` | Zoom out from Timeline into Slot Grid view |
| `Ctrl+Shift+Scroll Up` | Zoom back into Timeline while hovering a filled slot |

### Slot Interaction

| Action | Behavior |
|--------|----------|
| Click a filled slot | Select slot clip settings, open the Slot Clip tab, and either open the comp in the editor or trigger it live depending on `useLiveSlotTrigger` |
| Re-click an active slot | Restart playback from the slot trim-in point |
| Click an empty slot | Deactivate that layer |
| Click a column header | Activate all compositions in that column |
| Drag a slot | Reorder or swap a composition position |
| Right-click a filled slot | Open in Editor, map MIDI to the slot, or Remove from Slot |

### Multi-Layer Playback

- Each layer tracks elapsed time independently
- Active layers loop automatically
- Background layer audio is muted by default
- Deactivating a layer returns control to the next active layer if needed
- Optional warm-deck badges show slot preparation state when `useWarmSlotDecks` is enabled

See [Slot Grid](./Slot-Grid.md) for the current live/deck behavior, slot-clip trimming, and context-menu actions.

---

## Properties Panel

The unified Properties panel adapts its tabs to the selected clip type and to slot-grid mode.

### Standard Video Clip Tabs

| Tab | Contents |
|-----|----------|
| **Transform** | Position, scale, rotation, opacity, blend mode, and speed |
| **Effects** | GPU effects list with parameters |
| **Masks** | Mask shapes with mode and feather controls |
| **Transcript** | Speech-to-text transcript with playback sync |
| **Analysis** | Focus, motion, face, and AI scene metadata |

### Audio Clip Tabs

| Tab | Contents |
|-----|----------|
| **Effects** | Audio effects and linked audio controls |
| **Transcript** | Speech-to-text transcript |

### Text and 3D Text Tabs

| Clip Type | Tabs |
|-----------|------|
| **Text** | Text, Transform, Effects, Masks |
| **3D Text** | 3D Text, Transform, Effects, Masks |

### Specialized Clip Tabs

| Clip Type | Tabs |
|-----------|------|
| **Lottie** | Lottie, Transform, Effects, Masks |
| **Gaussian avatar** | Blendshapes, Transform, Effects, Masks |
| **Gaussian splat** | Transform, Gaussian Splat, Effects, Masks |
| **Camera** | Transform, Camera |
| **Splat effector** | Transform, Effector |
| **Slot Grid clip** | Slot Clip |

### Solid Clip Behavior

- Solid clips show a color picker bar above the tabs
- The picker updates the clip color in place

### Tab Behavior

- Tabs switch automatically based on clip type
- Badge counts appear for effects, masks, transcripts, and analysis readiness
- Slot grid mode switches the panel to the Slot Clip tab
- The Slot Clip tab shows the slotted composition tracks, the configured trim window, and the current live layer playhead on one range timeline

---

## Dock Layouts

### Default Layout

The built-in desktop layout is a three-column dock:

- Left column: Media, AI Chat, AI Video, Downloads
- Center: Preview
- Right column: Export, Properties, Waveform, Histogram, Vectorscope
- Bottom: Timeline

Multi Preview is available from the View menu and can be floated or docked, but it is not pinned in the default layout.

### Layout Persistence

- The dock layout is persisted with Zustand and project state
- Floating panels are restored across sessions
- Invalid panel types are cleaned up on load
- Named layouts can be stored in the View menu and reused later
- A saved layout can be marked as the default layout

### Layout Actions

| Action | Location |
|--------|----------|
| Save Current Layout | View -> Layouts |
| Load Saved Layout | View -> Layouts |
| Set Current as Default | View -> Layouts |
| Set Saved Layout as Default | View -> Layouts |
| Load Default Layout | View -> Layouts |

---

## MIDI Control

### Enabling MIDI

Edit menu -> Settings -> MIDI

### Requirements

- Browser Web MIDI API support
- MIDI device connected
- Permission granted

### Status Display

```
MIDI Control (N devices)
```

### Mapping Overview

- `View -> Panels -> MIDI Mapping` opens the dedicated mapping panel
- The panel lists all assigned transport and marker bindings
- Clicking a binding previews the exact trigger path without needing a physical MIDI note
- Empty-state guidance points back to Settings and the marker right-click menu

---

## Resolution Settings

### Output Resolution

Configured in Settings -> Output.

| Preset | Dimensions |
|--------|------------|
| 1080p | 1920 x 1080 |
| 1440p | 2560 x 1440 |
| 4K | 3840 x 2160 |
| 9:16 | 1080 x 1920 |

Custom width and height are also supported. This applies to newly created compositions; the active composition can still be configured per item in the Media panel.

### Preview Quality

Configured in Settings -> Previews.

| Option | Render Size |
|--------|-------------|
| Full | 100% |
| Half | 50% |
| Quarter | 25% |

Lower preview quality reduces GPU workload and memory use on engine-backed preview targets. It does not change export resolution or the HTML-only source monitor.

---

## Settings Dialog

### Opening

Edit menu -> Settings

### Categories

| Category | Contents |
|----------|----------|
| **Appearance** | Theme selection and custom theme controls |
| **General** | Save mode, autosave interval/enable state, import copy behavior, and mobile/desktop view mode |
| **MIDI** | Browser MIDI permission state, transport learning, and device list |
| **Previews** | Preview resolution quality and transparency grid info |
| **Import** | Copy media to project folder toggle |
| **Transcription** | Provider selection and pricing |
| **Output** | Default resolution and frame rate for new compositions |
| **Performance** | GPU power preference, Native Helper, and decode settings |
| **API Keys** | OpenAI, AssemblyAI, Deepgram, Kie.ai, PiAPI (legacy/compat), and YouTube |

### API Keys

The current AI Video-relevant keys are:

- `Kie.ai` for the current local-provider classic and board-backed generation flow
- `PiAPI` for legacy compatibility and older catalog/pricing paths

Hosted cloud access is account/session based and does not depend on a user-entered API key in this dialog.

---

## Status Indicator

### WebGPU Status

Top-right of the toolbar:

```
WebGPU (Vendor)   when ready
Loading...        during init
```

### Native Helper Status

- Shows connection state when Native Helper is enabled
- Used for downloads, project file operations, and local AI bridge access

---

## Context Menus

### Behavior

- Right-click to open
- Stay within viewport bounds
- Close on outside click

### Common Options

- Rename
- Delete
- Settings
- Context-specific actions

---

## Mobile UI

MasterSelects includes a touch-optimized component tree for mobile devices.

### Root Component

`MobileApp.tsx` replaces the desktop dock layout on mobile.

### Components

| Component | Purpose |
|-----------|---------|
| `MobileApp` | Root layout, panel state, and gesture handling |
| `MobilePreview` | Always-visible preview canvas |
| `MobileTimeline` | Touch-optimized timeline with playhead and trim gestures |
| `MobileToolbar` | Cut, play/pause, precision mode, and timecode |
| `MobilePropertiesPanel` | Slide-up properties panel with Transform, Effects, and Audio tabs |
| `MobileMediaPanel` | Slide-in media browser and import surface |
| `MobileOptionsMenu` | File, export, and desktop-mode actions |

### Touch Gestures

| Gesture | Action |
|---------|--------|
| Edge swipe | Open side panels |
| Two-finger swipe left | Undo |
| Two-finger swipe right | Redo |
| Tap toolbar buttons | Cut, play/pause, precision mode |

### Feature Limits

- The mobile UI keeps preview, timeline, media, and basic properties
- It does not expose the full dock system, floating windows, or scopes
- The options menu can switch back to desktop mode

---

## Related Features

- `docs/Features/README.md`
- `docs/Features/Debugging.md`
- `docs/Features/Playback-Debugging.md`
