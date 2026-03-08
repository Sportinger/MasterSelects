# UI & Panels

[<- Back to Index](./README.md)

Dockable panel system with After Effects-style menu bar and unified Properties panel.

---

## Table of Contents

- [Menu Bar](#menu-bar)
- [Panel System](#panel-system)
- [Available Panels](#available-panels)
- [Slot Grid (Multi-Layer Composition)](#slot-grid-multi-layer-composition)
- [Properties Panel](#properties-panel)
- [Tutorial System](#tutorial-system)
- [Dock Layouts](#dock-layouts)
- [MIDI Control](#midi-control)

---

## Menu Bar

### Structure
| Menu | Contents |
|------|----------|
| **File** | New Project, Open Project, Save, Save As, Project Info, Autosave, Clear All Cache & Reload |
| **Edit** | Copy, Paste, Settings |
| **View** | Panels (with AI and Scopes sub-menus), New Output Window, Save Layout as Default, Reset Layout |
| **Output** | New Output Window, Open Output Manager, Active Outputs |
| **Window** | MIDI Control |
| **Info** | Tutorials, Quick Tour, Timeline Tour, About |

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New Project |
| `Ctrl+S` | Save Project |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open Project |

### Project Name
- Displayed at left of menu bar
- Click to edit/rename
- Shows unsaved indicator (bullet) when changes pending
- Updates on save

### File Menu Details
- **New Project**: Prompts for name, user picks directory
- **Open Project**: Opens existing project folder
- **Save / Save As**: Standard save behavior with folder-based projects
- **Autosave**: Sub-menu with enable toggle and interval options (1, 2, 5, 10 minutes)
- **Clear All Cache & Reload**: Clears all localStorage, IndexedDB, caches, and service workers

### Info Menu
- **Tutorials**: Opens the tutorial campaign selection
- **Quick Tour**: Starts Part 1 panel introduction tutorial
- **Timeline Tour**: Starts Part 2 timeline deep-dive tutorial
- **About**: Shows version and app info dialog

---

## Panel System

### Dockable Behavior
All panels can be:
- Dragged to rearrange
- Grouped in tabs
- Resized via split panes
- Closed/opened via View menu
- Floated (detached from dock) as independent windows

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
- Shows valid drop locations (center, left, right, top, bottom)
- Highlights target slot

### Floating Panels
Panels can be detached from the dock layout and floated as independent windows:
- Movable by dragging
- Resizable
- Z-order management (click to bring to front)
- Can be re-docked by dragging to a dock target

---

## Available Panels

MASterSelects has 17 dockable panel types (plus the Slot Grid overlay, see [Slot Grid](#slot-grid-multi-layer-composition)):

| Panel | Type ID | Purpose |
|-------|---------|---------|
| **Preview** | `preview` | Composition output canvas |
| **Multi Preview** | `multi-preview` | 4-slot multi-layer preview grid |
| **Timeline** | `timeline` | Multi-track editor |
| **Media** | `media` | Media browser, folders, and compositions |
| **Properties** | `clip-properties` | Unified clip editing (Transform, Effects, Masks, Audio, Transcript, Analysis, Text) |
| **Export** | `export` | Render settings, codec selection, and progress |
| **Multi-Cam** | `multicam` | Camera sync and EDL (WIP) |
| **AI Chat** | `ai-chat` | GPT-powered editing assistant |
| **AI Video** | `ai-video` | AI video generation (PiAPI) |
| **AI Segment** | `ai-segment` | AI object segmentation using SAM 2 (WIP) |
| **AI Scene Description** | `scene-description` | AI-powered video content description with timeline-synced highlighting |
| **YouTube** | `youtube` | Alias for Downloads panel |
| **Downloads** | `download` | Search and download videos from YouTube and other platforms |
| **Transitions** | `transitions` | Drag-drop transition library (WIP) |
| **Histogram** | `scope-histogram` | GPU-accelerated histogram scope |
| **Vectorscope** | `scope-vectorscope` | Color vector analysis scope |
| **Waveform** | `scope-waveform` | Luma/RGB waveform monitor |

### View Menu Grouping

Panels are organized in the View menu as follows:
- **Panels**: Preview, Multi Preview, Timeline, Properties, Media, Export, YouTube, Downloads
- **AI** (sub-menu): AI Chat, AI Video, AI Segment, AI Scene Description
- **WIP** (grayed out with bug icon): Multi-Cam, Transitions, AI Segment
- **Scopes** (sub-menu): Waveform, Histogram, Vectorscope

### Preview Panel
- Canvas for composition output
- Composition selector dropdown
- Edit mode toggle for direct manipulation
- Per-tab transparency grid toggle (checkerboard button)
- Multiple preview panels supported
- Statistics overlay option

### Multi Preview Panel
- 4-slot grid showing different layers or compositions simultaneously
- Source composition selector (auto-distribute layers or per-slot custom)
- Per-slot composition assignment
- Transparency grid toggle

### Timeline Panel
- Multi-track video/audio editor
- Composition tabs for switching
- Playback controls toolbar
- Snap toggle button
- Ruler with time display
- Track headers with controls

### Media Panel
- Media browser with thumbnails
- Folder organization tree
- Composition list
- Add dropdown (Import, Composition, Folder)
- Drag-to-timeline support
- **List view** and **Grid view** toggle (persisted in localStorage)
- Grid view with folder breadcrumb navigation

### Properties Panel
See [Properties Panel](#properties-panel) section below for details.

### Export Panel
- **Encoder selection**: WebCodecs (fast) or HTML Video (precise)
- **WebCodecs codecs**: H.264, H.265, VP9, AV1
- **FFmpeg codecs**: ProRes (multiple profiles), DNxHR (multiple profiles), MJPEG
- **Container formats**: MP4, WebM
- **Resolution**: Composition resolution or custom
- **Frame rate**: Composition FPS or custom
- **Quality/bitrate settings** with rate control options
- **Audio export**: Sample rate, bitrate, normalization options
- **In/Out point export**: Export only the marked region
- **FCPXML export**: Export timeline as Final Cut Pro XML
- **Single frame export**
- **Progress indicator with phase display**

### Multi-Cam Panel (WIP)
- Camera clip management
- Audio-based sync controls
- EDL generation
- Group linking controls

### AI Chat Panel
- Chat interface with GPT-4
- Model/provider selector
- Context-aware editing commands
- 33 available tools

### Downloads Panel
- Paste URLs from YouTube, TikTok, Instagram, Twitter/X, Facebook, Reddit, Vimeo, Twitch, and more
- Search YouTube videos via YouTube Data API
- Video thumbnails, titles, channels, duration display
- Quality/format selection before download
- Download via Native Helper (yt-dlp)
- Downloads organized in platform-specific subfolders (Downloads/YT/, Downloads/TikTok/, etc.)

### AI Segment Panel (WIP)
- AI object segmentation using Meta's SAM 2 (Segment Anything Model 2)
- Runs locally in-browser via ONNX Runtime + WebGPU (no API key required)
- One-time model download (~184 MB), cached in OPFS
- Point-based segmentation: left-click to include, right-click to exclude
- Real-time mask overlay with adjustable opacity, feather, and invert
- Video propagation: forward propagation up to 150 frames

### AI Scene Description Panel
- AI-powered scene-by-scene content description for video clips
- Real-time highlighting of active scene segment during playback
- Click to seek to any scene segment
- Search within descriptions

### AI Video Panel
- Text-to-video generation
- Image-to-video animation
- PiAPI integration for AI-powered video creation
- Model/duration/aspect ratio selection
- CFG scale and camera controls
- Generation queue with status

### Transitions Panel (WIP)
- Library of available transitions (crossfade)
- Drag-drop to apply between clips
- GPU-accelerated transition rendering

### Video Scopes Panels
Three independent scope panels with GPU-accelerated rendering:

| Panel | Function |
|-------|----------|
| **Histogram** | RGB distribution graph with R/G/B/Luma view modes |
| **Vectorscope** | Color vector analysis with smooth phosphor glow |
| **Waveform** | DaVinci-style waveform with sub-pixel distribution |

- View mode buttons: RGB, R, G, B, Luma
- IRE legend for broadcast reference
- Zero readPixels overhead -- fully GPU-rendered

---

## Slot Grid (Multi-Layer Composition)

Resolume-style slot grid for simultaneous multi-layer composition playback. The grid overlays the Timeline panel and allows triggering multiple compositions on independent layers, each running on its own wall-clock time.

### Grid Layout

The slot grid is a 4-row by 12-column grid:

| Element | Description |
|---------|-------------|
| **Row labels** | Letters A through D on the left edge, each representing one playback layer |
| **Column headers** | Numbers 1 through 12 along the top, clickable to activate an entire column |
| **Slots** | 100px cells displaying a mini-timeline preview of the assigned composition |
| **Corner cell** | Empty top-left corner where row labels and column headers meet |

Compositions are automatically assigned to slots in order, or can be dragged to any position. Each slot shows:
- A mini-timeline preview with track/clip layout
- The composition name
- A live playhead indicator (red line) when the composition is active
- A "PRV" preview strip button for previewing without activating

### Opening the Slot Grid

| Method | Action |
|--------|--------|
| `Ctrl+Shift+Scroll Down` | Zoom out from Timeline into Slot Grid view |
| `Ctrl+Shift+Scroll Up` | Zoom back into Timeline (only when hovering a filled slot) |

The transition between Timeline and Slot Grid uses a 250ms ease-out cubic animation. During transition, the Timeline scales back slightly and fades out while the grid fades in.

### Slot Interaction

| Action | Behavior |
|--------|----------|
| **Click a filled slot** | Activate the composition on that slot's layer (A-D) and start playback from the beginning |
| **Re-click an active slot** | Restart playback from the beginning |
| **Click an empty slot** | Deactivate that layer entirely |
| **Click a column header** | Activate all compositions in that column simultaneously across all layers |
| **Drag a slot** | Reorder/move a composition to a different slot position (swap if target is occupied) |
| **Click "PRV" strip** | Toggle preview mode for that composition without activating it on a layer |

### Multi-Layer Playback

Each layer (A through D) can have one active composition playing at the same time. All active layers are composited together in the render output.

| Feature | Detail |
|---------|--------|
| **Independent wall-clock time** | Each background layer tracks elapsed time independently using `performance.now()`, not the global playhead |
| **Automatic looping** | When a background composition reaches its end, it loops back to the start |
| **Media hydration** | Background layers load their own video, audio, and image elements independently |
| **Background audio** | Background layer audio is muted by default |
| **Layer deactivation** | Clicking an empty slot deactivates that layer; if it was the editor-active composition, the editor switches to the next active layer |

### Visual States

| State | Appearance |
|-------|------------|
| **Editor-active** | Highlighted slot (the composition currently open in the Timeline editor) |
| **Layer-active** | Secondary highlight for compositions playing on background layers |
| **Previewed** | Distinct highlight for the composition in preview mode |
| **Drag-over** | Drop target indicator when dragging a slot |
| **Empty** | Dim, unfilled slot |

---

## Properties Panel

The unified Properties panel consolidates clip editing into a single tabbed interface. It automatically adapts its tabs based on the selected clip type (video, audio, text, solid).

### Video Clip Tabs

| Tab | Contents |
|-----|----------|
| **Transform** | Position, Scale, Rotation, Opacity, Blend Mode, Speed |
| **Audio** | Volume controls and 10-band EQ for linked audio |
| **Effects** | GPU effects list with parameters |
| **Masks** | Mask shapes with mode and feather controls |
| **Transcript** | Speech-to-text transcript with word-level playback sync |
| **Analysis** | Focus/motion/face analysis + AI scene descriptions |

### Audio Clip Tabs

| Tab | Contents |
|-----|----------|
| **Volume** | Volume slider + 10-band parametric EQ |
| **Effects** | Audio effects (future expansion) |
| **Transcript** | Speech-to-text transcript |

### Text Clip Tabs

| Tab | Contents |
|-----|----------|
| **Text** | Typography controls (font, size, color, alignment, etc.) |
| **Transform** | Position, Scale, Rotation, Opacity, Blend Mode |
| **Effects** | GPU effects list with parameters |
| **Masks** | Mask shapes with mode and feather controls |

### Solid Clip Tabs

| Tab | Contents |
|-----|----------|
| **Transform** | Position, Scale, Rotation, Opacity, Blend Mode |
| **Effects** | GPU effects list with parameters |
| **Masks** | Mask shapes with mode and feather controls |

Solid clips also show a color picker bar above the tabs for changing the solid color.

### Transform Tab Features
- **Position**: X, Y, Z (depth) sliders
- **Scale**: X, Y with link toggle
- **Rotation**: X, Y, Z (3D rotation)
- **Opacity**: 0-100% slider
- **Blend Mode**: Dropdown with 37 modes grouped by category (Normal, Darken, Lighten, Contrast, Inversion, Component, Stencil)
- **Speed**: Playback speed control
- Keyframe toggles on each property

### Volume Tab Features
- **Volume Slider**: -60dB to +12dB
- **10-Band EQ**: 31Hz to 16kHz
- **Per-Band Gain**: -12dB to +12dB
- Keyframe toggles for animation
- EQ automatically added on first use

### Effects Tab Features
- **Add Effect**: Dropdown with available effects
- **Effect List**: Expandable sections
- **Parameter Sliders**: With keyframe toggles
- **Remove Button**: Per-effect deletion

### Masks Tab Features
- **Add Mask**: Rectangle, Ellipse, Pen tool
- **Mask List**: With expand/collapse
- **Mode Selector**: Add, Subtract, Intersect
- **Feather Slider**: 0-100px GPU blur
- **Expansion**: -100 to +100px
- **Invert Toggle**: Flip mask selection
- **Vertex Selection**: Edit mask points

### Transcript Tab Features
- Word-level transcript display with speaker diarization
- Real-time word highlighting during playback
- Click any word to seek to that position
- Search within transcript
- Language selection (Auto, Deutsch, English, Espanol, Francais, Italiano, Portugues)
- Transcription provider selection (Local Whisper, OpenAI, AssemblyAI, Deepgram)

### Analysis Tab Features
- Focus, motion, and face detection per frame
- Current values at playhead display
- AI scene descriptions with time-synced segments
- Analyze and describe actions to trigger analysis

### Text Tab Features
- Font family selection with Google Fonts support
- Font size, color, and alignment controls
- Text content editing
- Typography parameter adjustments

### Tab Title Display
- Shows selected clip name in tab title
- Example: "Properties - Interview_01.mp4"
- Updates automatically on clip selection
- Badge counts for effects, masks, and transcripts

---

## Tutorial System

Spotlight-based interactive tutorial that introduces new users to the interface. The tutorial uses a Clippy mascot companion and walks through panels and timeline elements with animated spotlight highlights.

### Automatic Launch

The tutorial starts automatically on first launch (when `hasSeenTutorial` is false). If a What's New changelog dialog is shown, the tutorial starts after it is closed. Once completed or skipped, it does not appear again unless manually triggered.

### Welcome Screen (Part 1 Start)

Before the tutorial steps begin, a centered welcome dialog asks the user about their editing background:

| Option | Description |
|--------|-------------|
| **Premiere Pro** | Coming from Adobe Premiere Pro |
| **DaVinci Resolve** | Coming from DaVinci Resolve |
| **Final Cut Pro** | Coming from Final Cut Pro |
| **After Effects** | Coming from Adobe After Effects |
| **Beginner** | New to video editing |

The selection is saved to personalize the experience. A "Skip Tutorial" button is available to dismiss the entire tutorial immediately.

### Part 1 -- Panel Introduction

After the welcome screen, the tutorial highlights each main panel one at a time using an SVG spotlight mask:

| Step | Panel | Description |
|------|-------|-------------|
| 1 | **Timeline** | Arrange and edit clips on tracks. Drag to move, trim edges, add keyframes and transitions. |
| 2 | **Preview** | Live preview of the composition. Play, pause, and scrub in real-time. |
| 3 | **Media** | Import and organize media files. Drag clips onto the Timeline to start editing. |
| 4 | **Properties** | Adjust transforms, effects, and masks for the selected clip. |

Each step:
- Dims the rest of the interface with a 75% opacity dark overlay
- Cuts out the highlighted panel with a rounded rectangle mask
- Activates the corresponding panel tab so it is visible
- Shows a tooltip with step number, title, description, and progress dots
- Advances on click anywhere

### Part 2 -- Timeline Deep-Dive

Part 2 starts automatically after Part 1 finishes (unless Part 2 was already seen). It zooms into individual Timeline elements with a yellow highlight ring:

| Step | Element | Description |
|------|---------|-------------|
| 1 | **Playback** | Play, Stop, and Loop controls |
| 2 | **Timecode** | Current position and total duration display (click duration to edit) |
| 3 | **Tools & Zoom** | Snapping, Cut tool, Zoom, and Fit controls |
| 4 | **In/Out Points** | Set In (I) and Out (O) points for the export range |
| 5 | **Tracks** | Add video, audio, or text tracks |
| 6 | **Navigator** | Scroll and zoom the Timeline; drag edges to zoom in/out |

Part 2 highlights individual UI elements within the Timeline panel using CSS selectors. The Timeline panel itself remains fully visible (spotlight mask), while the target element gets a yellow highlight ring overlay.

### Clippy Mascot

An animated Clippy companion appears alongside tutorial tooltips:

| Phase | Behavior |
|-------|----------|
| **Intro** | One-shot WebM animation when the tutorial first opens |
| **Loop** | Continuous looping idle animation during tutorial steps |
| **Outro** | Exit animation when the tutorial is closed or skipped |

Falls back to a static WebP image if WebM video is not supported by the browser.

### Navigation and Controls

| Action | Behavior |
|--------|----------|
| **Click anywhere** | Advance to the next step |
| **Escape** | Close the tutorial |
| **Skip button** | Available on every step and the welcome screen; plays the Clippy outro animation, then dismisses |
| **Progress dots** | Visual indicator showing current step and completed steps |

### Re-triggering Tutorials

Both tutorial parts can be re-launched manually from the menu bar:

| Menu Location | Action |
|---------------|--------|
| Info menu -> Tutorials | Opens tutorial campaign selection |
| Info menu -> Quick Tour | Start Part 1 (panel introduction) |
| Info menu -> Timeline Tour | Start Part 2 (timeline deep-dive) |

---

## Dock Layouts

### Default Layout (3-column)
```
+------------------------------------------+
|              Menu Bar                     |
+----------+------------------+------------+
| Media    |                  | Export     |
| AI Chat  |    Preview       | Properties |
| AI Video |                  | Waveform   |
| Downloads|                  | Histogram  |
|          |                  | Vectorscope|
+----------+------------------+------------+
|              Timeline                     |
+------------------------------------------+
```

Left column (15%): Media, AI Chat, AI Video, Downloads (tabbed)
Center: Preview
Right column: Export, Properties, Waveform, Histogram, Vectorscope (tabbed, Waveform active by default)
Bottom: Timeline

Top section is 60%, Timeline is 40% of total height.

### Layout Persistence
- Auto-saved to localStorage via Zustand persist middleware
- Survives page refresh
- Multiple preview panels preserved
- Auto-cleanup of invalid/removed panel types on load
- Project-level layout persistence (saved/loaded with project files)

### Layout Actions
| Action | Location |
|--------|----------|
| Save Layout as Default | View menu |
| Reset Layout | View menu (restores saved default or built-in default) |

### Panel Visibility
View menu -> Panels:
- Checkbox for each panel type
- Toggle panels on/off
- AI panels grouped in sub-menu
- Scopes grouped in sub-menu
- WIP panels shown grayed out with bug icon

---

## MIDI Control

### Enabling MIDI
Window menu -> MIDI Control

### Requirements
- Browser Web MIDI API support
- MIDI device connected
- Permission granted

### Status Display
```
MIDI Control (N devices)
```

### Device Discovery
- Automatic device detection
- Shows device count when enabled

---

## Resolution Settings

### Output Resolution
Configured in Settings -> Output:

| Preset | Dimensions |
|--------|------------|
| 1080p | 1920x1080 |
| 1440p | 2560x1440 |
| 4K | 3840x2160 |
| 9:16 | 1080x1920 |

Custom width (up to 7680) and height (up to 4320) can also be set. This applies only to newly created compositions; active composition resolution is set per composition in the Media Panel.

### Preview Quality
Configured in Settings -> Previews:

| Option | Render Size | Performance |
|--------|-------------|-------------|
| **Full (100%)** | 1920x1080 | Best quality |
| **Half (50%)** | 960x540 | 4x faster, 75% less memory |
| **Quarter (25%)** | 480x270 | 16x faster, 94% less memory |

Preview Quality scales the internal render resolution while maintaining the output aspect ratio. Lower quality settings significantly reduce GPU workload and memory usage -- ideal for complex compositions or slower hardware.

**Memory Savings at Half Resolution:**
- Ping-pong buffers: 75% reduction
- RAM Preview cache: 75% reduction (7.2GB -> 1.8GB)
- Scrubbing cache: 75% reduction

### Setting Resolution
```typescript
setResolution(width, height)
setPreviewQuality(quality) // 1, 0.5, or 0.25
```

---

## Settings Dialog

### Opening
Edit menu -> Settings

### Design
- After Effects-style sidebar navigation
- 8 categorized settings sections
- Draggable dialog (no dark overlay)
- Save and Cancel buttons

### Categories

| Category | Contents |
|----------|----------|
| **Appearance** | Theme selection (Dark, Light, Midnight, System, Crazy You, Custom), custom hue and brightness sliders |
| **General** | Autosave enable/disable and interval (1/2/5/10 min), mobile/desktop view toggle |
| **Previews** | Preview resolution quality (Full/Half/Quarter), transparency grid info |
| **Import** | Copy media to project folder toggle |
| **Transcription** | Provider selection (Local Whisper, OpenAI, AssemblyAI, Deepgram) with descriptions and pricing |
| **Output** | Default resolution for new compositions (presets + custom), frame rate display |
| **Performance** | GPU power preference (discrete/integrated), Native Helper enable/disable, native decode toggle, WebSocket port, connection status |
| **API Keys** | Consolidated key management: OpenAI, AssemblyAI, Deepgram (Transcription), PiAPI (AI Video), YouTube Data API v3. Keys encrypted in IndexedDB. |

### Storage
- Non-sensitive settings persisted in localStorage
- API keys encrypted in IndexedDB via apiKeyManager
- API keys also backed up to project `.keys.enc` file

---

## Status Indicator

### WebGPU Status
Top-right of toolbar:
```
WebGPU (Vendor)   (green, when ready)
Loading...         (gray, during init)
```

### Native Helper Status
Top-right of toolbar (when enabled):
- Shows connection status to the native helper (Turbo Mode)

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

- [Timeline](./Timeline.md) - Timeline panel details
- [Preview](./Preview.md) - Preview panel details
- [Media Panel](./Media-Panel.md) - Media browser
- [Effects](./Effects.md) - Effect parameters
- [Audio](./Audio.md) - Volume and EQ details
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

## Tests

No dedicated unit tests -- this feature covers React component-level UI that requires a browser environment.

---

*Source: `src/components/panels/PropertiesPanel.tsx`, `src/components/panels/properties/index.tsx`, `src/components/dock/`, `src/stores/dockStore.ts`, `src/stores/settingsStore.ts`, `src/types/dock.ts`, `src/components/timeline/SlotGrid.tsx`, `src/services/layerPlaybackManager.ts`, `src/components/common/TutorialOverlay.tsx`, `src/components/common/Toolbar.tsx`, `src/components/common/SettingsDialog.tsx`*
