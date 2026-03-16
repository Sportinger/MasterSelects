# UI & Panels

[← Back to Index](./README.md)

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
- [What's New Dialog](#whats-new-dialog)
- [Native Helper Dialog](#native-helper-dialog)
- [Relink Dialog](#relink-dialog)
- [Mobile UI](#mobile-ui)

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
- **Changelog on Startup**: Toggle to show/hide the What's New dialog on application startup (connected to `showChangelogOnStartup` setting)
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
- **List view** and **Grid view** toggle via a single button with icon swap (persisted in localStorage)
- Grid view shows thumbnail previews of media files
- **Folder breadcrumb navigation** in grid view: click breadcrumb segments to navigate folder hierarchy

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
- **Stacked Alpha**: When enabled, doubles output height with RGB on top and alpha grayscale on bottom. Useful for compositing in external tools like TouchDesigner
- **Single frame export**
- **Progress indicator with phase display**

### Multi-Cam Panel (WIP)
- Camera clip management
- Audio-based sync controls
- EDL generation
- Group linking controls

### AI Chat Panel
- Chat interface with GPT models
- Model/provider selector
- Context-aware editing commands
- 76 available tools

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

Spotlight-based interactive tutorial system with **14 campaigns** organized into 4 categories. Each campaign walks through a specific feature area using animated spotlight highlights and a Clippy mascot companion.

### Campaign System

The tutorial uses a campaign-based architecture defined in `tutorialCampaigns.ts`. Users select campaigns from the `TutorialCampaignDialog.tsx` dialog, which groups campaigns by category.

### 4 Categories, 14 Campaigns

#### Basics (3 campaigns)

| Campaign | ID | Steps | Description |
|----------|----|-------|-------------|
| **Interface Overview** | `interface-overview` | 4 | Main panels and layout (Timeline, Preview, Media, Properties) |
| **Timeline Controls** | `timeline-controls` | 6 | Playback, timecode, tools, in/out points, tracks, navigator |
| **Preview & Playback** | `preview-playback` | 4 | Preview canvas, controls, quality settings, composition selector |

#### Editing (4 campaigns)

| Campaign | ID | Steps | Description |
|----------|----|-------|-------------|
| **Media & Import** | `media-import` | 4 | Media panel, add button, columns, drag to timeline |
| **Editing Clips** | `clip-editing` | 5 | Track management, playhead, cut tool, markers, selection |
| **Audio Mixing** | `audio-mixing` | 3 | Audio tracks, audio properties, JKL shuttle playback |
| **Downloads** | `download-panel` | 3 | Download panel, search/quality, add to timeline |

#### Creative Tools (4 campaigns)

| Campaign | ID | Steps | Description |
|----------|----|-------|-------------|
| **Keyframes & Animation** | `keyframes-animation` | 4 | Transform properties, keyframe toggles, curve editor, easing modes |
| **Effects & Color** | `effects-color` | 4 | Effects tab, add effects, blend modes, real-time preview |
| **Text & Titles** | `text-titles` | 3 | Text tracks, text properties, text styling |
| **Masks & Compositing** | `masks-compositing` | 4 | Masks tab, shape tools, mask modes, mask editing in preview |

#### Output & Analysis (3 campaigns)

| Campaign | ID | Steps | Description |
|----------|----|-------|-------------|
| **Export & Delivery** | `export-delivery` | 4 | Export panel, settings, start export, export range |
| **Video Scopes** | `video-scopes` | 3 | Histogram, vectorscope, waveform monitor |
| **Slot Grid (Live)** | `slot-grid` | 3 | Slot grid overview, layers A-D, column activation |

### Completion Tracking

- Campaign completion is tracked via `completedTutorials` in `settingsStore`
- Per-campaign progress is supported (partial completion tracked)
- Completed campaigns show a checkmark in the campaign selection dialog
- The original Part 1 (panel introduction) and Part 2 (timeline deep-dive) tutorials still exist as the `interface-overview` and `timeline-controls` campaigns within the Basics category

### Automatic Launch

The tutorial campaign dialog starts automatically on first launch (when `hasSeenTutorial` is false). If a What's New changelog dialog is shown, the tutorial starts after it is closed. Once completed or skipped, it does not appear again unless manually triggered.

### Campaign Step Types

Each campaign step can use one or both spotlight mechanisms:

| Mechanism | Description |
|-----------|-------------|
| **Panel spotlight** | SVG mask cutout that dims the interface and highlights a panel group (`panelGroupId`) |
| **Element highlight ring** | Yellow ring overlay on a specific UI element within the spotlighted panel (`selector`) |

Steps can also auto-activate a panel tab (`panelType`) before displaying.

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
| **Skip button** | Available on every step; plays the Clippy outro animation, then dismisses |
| **Progress dots** | Visual indicator showing current step and completed steps |

### Re-triggering Tutorials

Campaigns can be launched from the menu bar:

| Menu Location | Action |
|---------------|--------|
| Info menu -> Tutorials | Opens the tutorial campaign selection dialog |
| Info menu -> Quick Tour | Starts the `interface-overview` campaign (Basics) |
| Info menu -> Timeline Tour | Starts the `timeline-controls` campaign (Basics) |

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

## What's New Dialog

The `WhatsNewDialog` shows a changelog of recent updates when the application starts or when triggered manually.

### Features

| Feature | Description |
|---------|-------------|
| **Filter tabs** | All, New, Fixes, Improved, Refactor -- filter changelog entries by change type |
| **Release calendar heatmap** | Visual calendar showing release frequency, generated from `src/version.ts` calendar functions (`getChangelogCalendar`) |
| **YouTube video embed** | Featured video embed for major releases (configured via `FEATURED_VIDEO` in version.ts) |
| **Build/WIP notice cards** | Informational cards for build status and work-in-progress features (`BUILD_NOTICE`, `WIP_NOTICE`) |
| **Commit links** | GitHub commit links for each changelog entry |
| **"Don't show on startup" checkbox** | Connected to `showChangelogOnStartup` setting in settingsStore |

### Triggering
- Automatically shown on startup if `showChangelogOnStartup` is enabled
- Can be toggled via Info menu -> Changelog on Startup
- Changelog entries are grouped by time period via `getGroupedChangelog()`

---

## Native Helper Dialog

The Native Helper dialog provides status and installation information for the optional Rust native helper (`NativeHelperStatus.tsx`).

### Toolbar Button
A status indicator in the toolbar shows connection state when Native Helper is enabled in settings.

### Dialog Contents

| Section | Description |
|---------|-------------|
| **Enable/Disable toggle** | Turn the native helper connection on or off |
| **Connection status** | Real-time connection state (connected, disconnected, error) |
| **Install guide** | Platform-specific installation instructions (Windows MSI, macOS app, Linux binary) |
| **Capability pills** | Status indicators for available features: decode, encode, download (yt-dlp), file system commands, AI bridge |
| **GitHub release checking** | Checks for new releases from the GitHub releases API and shows download links |
| **Version display** | Current helper version and compatibility info |

---

## Relink Dialog

The `RelinkDialog` handles reconnecting missing media files when opening a project where source files have moved.

### Features

| Feature | Description |
|---------|-------------|
| **Auto-scan** | Automatically scans the project's Raw folder for missing files on open |
| **Recursive folder scanning** | User can select a folder to recursively search for missing files by name |
| **Multi-file picker** | Allows manually selecting replacement files for individual missing items |
| **Per-file status tracking** | Each missing file shows its status: `missing`, `found`, or `searching` |
| **Batch relink** | Apply all found matches at once to restore file references |

---

## Mobile UI

MasterSelects includes a mobile-optimized interface for touch devices, implemented as a separate component tree.

### Root Component
`MobileApp.tsx` serves as the root component, replacing the desktop dock layout with a mobile-friendly arrangement.

### Components

| Component | Purpose |
|-----------|---------|
| `MobileApp` | Root layout with panel state management and gesture handling |
| `MobileTimeline` | Touch-optimized timeline with horizontal scrolling |
| `MobilePreview` | Preview canvas sized for mobile viewports |
| `MobileToolbar` | Bottom toolbar with essential editing actions (cut, undo/redo, panels) |
| `MobilePropertiesPanel` | Slide-up properties panel with tap-to-activate sliders |
| `MobileMediaPanel` | Slide-up media browser |
| `MobileOptionsMenu` | Settings and options overlay |

### Touch Gestures

| Gesture | Action |
|---------|--------|
| **Edge swipe** | Open/close side panels (properties, media) |
| **Two-finger swipe left** | Undo |
| **Two-finger swipe right** | Redo |
| **Tap toolbar buttons** | Cut at playhead, open panels, toggle options |

### Precision Mode
A precision mode for fine adjustments: when activated, slider movements are scaled down for frame-accurate control of properties like position, scale, and opacity.

### Feature Limitations vs Desktop
The mobile UI provides core editing functionality but does not include the full dock system, floating panels, MIDI control, output manager, or video scopes. It focuses on essential timeline editing, preview, and media management.

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

*Source: `src/components/panels/PropertiesPanel.tsx`, `src/components/panels/properties/index.tsx`, `src/components/dock/`, `src/stores/dockStore.ts`, `src/stores/settingsStore.ts`, `src/types/dock.ts`, `src/components/timeline/SlotGrid.tsx`, `src/services/layerPlaybackManager.ts`, `src/components/common/TutorialOverlay.tsx`, `src/components/common/TutorialCampaignDialog.tsx`, `src/components/common/tutorialCampaigns.ts`, `src/components/common/WhatsNewDialog.tsx`, `src/components/common/NativeHelperStatus.tsx`, `src/components/common/RelinkDialog.tsx`, `src/components/common/Toolbar.tsx`, `src/components/common/SettingsDialog.tsx`, `src/components/mobile/MobileApp.tsx`, `src/components/mobile/` (directory)*
