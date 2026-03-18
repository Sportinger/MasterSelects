# Preview & Playback

[← Back to Index](./README.md)

WebGPU preview with RAM caching, multiple panels, edit mode, source monitor, overlay system, and multi-output management.

---

## Table of Contents

- [Preview Panel](#preview-panel)
- [Source Monitor](#source-monitor)
- [Playback Controls](#playback-controls)
- [Preview Quality](#preview-quality)
- [Transparency Grid](#transparency-grid)
- [RAM Preview](#ram-preview)
- [Multiple Previews](#multiple-previews)
- [Multi Preview Panel](#multi-preview-panel)
- [Edit Mode](#edit-mode)
- [Overlay System](#overlay-system)
- [Statistics Overlay](#statistics-overlay)
- [Unified RenderTarget System](#unified-rendertarget-system)
- [RenderScheduler](#renderscheduler)
- [Output Manager](#output-manager)
- [Slice & Warp System](#slice--warp-system)
- [Output Window Management](#output-window-management)
- [Output Manager Persistence](#output-manager-persistence)

---

## Preview Panel

### Features
- **Real-time GPU rendering** via WebGPU
- **Aspect ratio preserved** automatically via ResizeObserver
- **Close button** (`-`) to hide panel
- **Add button** (`+`) to open additional preview panels
- **Composition selector** dropdown (Active, or a specific composition)
- **Edit mode** toggle with zoom/pan
- **Source monitor** for viewing raw media files
- **Transparency grid** toggle (checkerboard for transparent areas)
- **Preview quality** selector (Full / Half / Quarter)

### Canvas Registration
All preview canvases register through the unified RenderTarget system (see [Unified RenderTarget System](#unified-rendertarget-system)):
1. Engine assigns a WebGPU context to the canvas via `registerTargetCanvas()`
2. A `RenderTarget` entry is created in `renderTargetStore` with source and destination metadata
3. If the source is independent (not the active composition), the `RenderScheduler` manages its render loop

### Component Hierarchy
```
Preview (panelId, compositionId, showTransparencyGrid)
  +-- PreviewControls          (top bar: edit mode, composition selector, +/- buttons)
  +-- SourceMonitor            (when sourceMonitorFile is active)
  +-- StatsOverlay             (FPS, decoder, timing)
  +-- canvas (WebGPU)          (main render canvas)
  +-- MaskOverlay              (SVG mask editing overlay)
  +-- SAM2Overlay              (AI segmentation overlay)
  +-- canvas (overlay)         (edit mode bounding boxes/handles)
  +-- PreviewBottomControls    (transparency grid toggle, quality selector)
```

---

## Source Monitor

The Source Monitor displays raw media files (video or image) directly in the Preview panel, bypassing the composition pipeline. Activated when a media file is selected for source preview.

### Features
- **Dual backend**: WebCodecs (preferred for local files) or HTML video fallback
- **Frame-accurate scrubbing** via scrub bar with mouse drag
- **Frame stepping**: Previous/Next frame buttons for frame-by-frame navigation
- **Playback controls**: Play/Pause, Go to Start, Go to End
- **Backend toggle**: Switch between WebCodecs and HTML backends
- **Timecode display**: Shows current time and total duration in `M:SS:FF` format
- **Image support**: Displays static images without transport controls

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `Escape` | Close source monitor |

### Implementation
```typescript
// WebCodecs backend: uses WebCodecsPlayer for frame-accurate decode
const player = new WebCodecsPlayer({ loop: false, onFrame, onReady, onError });
await player.loadFile(file);

// HTML backend: standard <video> element with timeupdate events
// Falls back to HTML if WebCodecs is unavailable or fails
```

---

## Playback Controls

### Timeline Toolbar Controls

| Control | Shortcut | Function |
|---------|----------|----------|
| **Stop** | - | Return to time 0 |
| **Play/Pause** | `Space` | Toggle playback |
| **Loop** | `Shift + L` | Toggle loop playback |

### In/Out Points

| Shortcut | Action |
|----------|--------|
| `I` | Set In point at playhead |
| `O` | Set Out point at playhead |
| `X` | Clear In/Out points |

### Implementation
```typescript
setInPoint(time)         // Validates against outPoint
setOutPoint(time)        // Validates against inPoint
clearInOut()             // Clear both markers
setInPointAtPlayhead()   // Convenience method
setOutPointAtPlayhead()  // Convenience method
```

---

## Preview Quality

Scale the internal render resolution for better performance on complex compositions or slower hardware.

### Location
Bottom-left of the Preview panel (quality dropdown button showing Full/Half/Quarter).

### Options

| Setting | Render Resolution | Performance | Memory |
|---------|-------------------|-------------|--------|
| **Full (100%)** | 1920x1080 | Baseline | 100% |
| **Half (50%)** | 960x540 | 4x faster | 25% |
| **Quarter (25%)** | 480x270 | 16x faster | 6% |

### What Gets Scaled
- Ping-pong composite buffers
- RAM Preview cache frames
- Scrubbing cache frames
- All GPU shader operations

### What Stays the Same
- Output/export resolution (always full)
- Aspect ratio
- UI element sizes

### Memory Savings at Half Resolution
| Resource | Full (1080p) | Half (540p) | Savings |
|----------|--------------|-------------|---------|
| Scrubbing cache (300 frames) | ~2.4 GB | ~600 MB | 75% |
| RAM Preview (900 frames) | ~7.2 GB | ~1.8 GB | 75% |
| GPU frame cache (60 frames) | ~500 MB | ~125 MB | 75% |

### When to Use Lower Quality
- Complex compositions with many layers
- Real-time effect adjustments
- Slower hardware or integrated GPU
- Large 4K source files
- Timeline scrubbing responsiveness

### Implementation
```typescript
// In settingsStore
setPreviewQuality(quality: 1 | 0.5 | 0.25)

// Applied in useEngine hook
const scaledWidth = Math.round(outputResolution.width * previewQuality);
const scaledHeight = Math.round(outputResolution.height * previewQuality);
engine.setResolution(scaledWidth, scaledHeight);

// Caches cleared automatically on quality change
```

---

## Transparency Grid

Per-tab checkerboard toggle to visualize transparent areas in the composition.

### Location
Bottom-left of the Preview panel (checkerboard icon button).

### Behavior
- Toggled per preview tab via `updatePanelData(panelId, { showTransparencyGrid })`
- Applied via CSS class `show-transparency-grid` on the canvas wrapper
- Stored in the `RenderTarget` entry as `showTransparencyGrid`
- Synced to the engine via `setTargetTransparencyGrid()` for GPU-side rendering

---

## RAM Preview

After Effects-style cached preview for smooth playback.

### Configuration
```typescript
RAM_PREVIEW_FPS = 30        // Target frame rate
FRAME_TOLERANCE = 0.04      // 40ms tolerance for seeks
```

### Cache Limits
| Cache Type | Max Frames | Memory Limit | Purpose |
|------------|------------|--------------|---------|
| Scrubbing | 300 | ~2.4 GB VRAM | Individual video frames (GPU textures) |
| Composite | 900 | 512 MB | Fully-rendered frames (ImageData on CPU) |
| GPU | 60 | ~500 MB VRAM | High-speed playback (GPU textures) |

### Algorithm
1. Enable via "RAM ON/OFF" button
2. Frames render **outward from playhead**
3. Only caches frames where clips exist
4. Skips empty areas
5. 3-retry seeking with verification

### Smart Seeking
```typescript
// Robust video seeking
- Retries up to 3 times
- Verifies position within FRAME_TOLERANCE
- Handles reversed clips properly
```

### Cache Management
```typescript
toggleRamPreviewEnabled()  // Enable/disable
startRamPreview()          // Begin caching
cancelRamPreview()         // Stop caching
clearRamPreview()          // Clear cache
getCachedRanges()          // For green indicator
```

### Visual Indicator
- Green bar on timeline shows cached ranges
- **Yellow indicator** on ruler shows proxy cache frames
- Progress indicator during caching
- 2-frame gap tolerance for ranges

### Video Warmup Button
- Cache button for preloading proxy frames before playback
- Ensures smoother initial playback of proxy content
- Shows progress during preload

---

## Multiple Previews

### Adding Preview Panels
1. View menu -> Panel visibility
2. Or use `+` button in preview panel top bar

### Composition Selection
Each preview can show a different composition:
- Dropdown selector in panel top bar
- "Active" follows the currently open composition
- Or select a specific saved composition

### Independent Rendering
Each additional preview panel participates in the unified RenderTarget system:
- Own canvas registered as a `RenderTarget`
- Independent sources rendered by the `RenderScheduler`
- Composition evaluation via `compositionRenderer`

### Layout
- Panels appear in the dock system
- Drag to rearrange
- Layout persists on save

---

## Multi Preview Panel

A specialized 2x2 grid panel for monitoring multiple sources simultaneously.

### Features
- **2x2 grid** of independent preview slots
- **Source modes**: "Custom" (per-slot composition selector) or auto-distribute (select a composition, first 4 layers distribute across slots)
- **Shared controls**: source dropdown, transparency toggle, quality selector
- **Slot highlight**: Press `1`/`2`/`3`/`4` to temporarily highlight a slot
- **Stats overlay**: shared over the whole panel

### Auto-Distribute Mode
When a composition is selected as source, each slot renders one layer from that composition:
- Slot 1 renders layer index 0
- Slot 2 renders layer index 1
- Slot 3 renders layer index 2
- Slot 4 renders layer index 3

Uses `layer-index` source type in the RenderTarget system. The `layer-index` source type allows isolating individual video tracks from a composition in any preview tab. Panels using this source type are added via `addPreviewPanel` and configured via `updatePanelData` in dockStore.

### Custom Mode
Each slot has its own composition dropdown:
- "Active" follows the current composition
- Or pick a specific composition

---

## Edit Mode

### Enabling Edit Mode
- Click "Edit" button in preview panel top bar
- Or press `Tab` to toggle edit mode on/off

### Layer Selection
- Click layer to select (also selects corresponding clip in timeline)
- Bounding box appears with corner and edge handles
- Non-selected layers shown with dashed white outlines
- Layer names displayed above bounding boxes

### Transform Handles
| Handle | Action | Effect |
|--------|--------|--------|
| Corner | Drag | Scale from corner |
| Edge | Drag | Scale from edge |
| Center | Drag | Move layer position |
| Corner + `Shift` | Drag | Scale with locked aspect ratio |

### Drag Operations
| Action | Effect |
|--------|--------|
| Drag center | Move layer position |
| Drag corner handle | Scale layer from corner |
| Drag edge handle | Scale layer from edge |
| `Shift` + drag corner | Lock aspect ratio during scale |

### Bounding Box
```typescript
calculateLayerBounds()
- Accounts for source aspect ratio (video/image dimensions)
- Applies position, scale, and rotation transforms
- Matches shader positioning
```

### Zoom & Pan
| Action | Method |
|--------|--------|
| Zoom | `Scroll` (mouse wheel) |
| Horizontal pan | `Alt + Scroll` |
| Pan | `Middle Mouse` or `Alt + Drag` |
| Reset | Reset button in top bar |

### Edit Mode Overlay
The overlay is a full-container canvas that:
- Draws a dark pasteboard area outside the composition bounds
- Renders bounding boxes for all visible layers
- Shows 8px blue handles (corners + edges) on the selected layer
- Displays crosshair at the selected layer's center
- Animates at 60fps during drag operations

### Visual Hint
A hint bar at the bottom shows: `Drag: Move | Handles: Scale (Shift: Lock Ratio) | Scroll: Zoom | Alt+Drag: Pan`

---

## Overlay System

The Preview panel supports multiple overlay types that render on top of the WebGPU canvas.

### MaskOverlay
SVG-based overlay for drawing and editing masks on clips.
- Activated when `maskEditMode !== 'none'`
- Supports vertex dragging, edge dragging, shape drawing, and whole-mask dragging
- Uses normalized coordinates mapped to canvas dimensions

### SAM2Overlay
AI segmentation overlay for SAM 2 (Segment Anything Model 2).
- Activated when `sam2Active` is true
- Left-click: add foreground point (green)
- Right-click: add background point (red)
- Renders live mask as a semi-transparent blue overlay
- Shows processing state indicator

### Edit Mode Overlay
Canvas-based overlay for layer manipulation (see [Edit Mode](#edit-mode)).

---

## Statistics Overlay

### Compact Mode
- **FPS** (color-coded: green >=55, yellow >=30, red <30)
- **Render time** in ms (green <10ms, yellow <16.67ms, red >=16.67ms)
- **Idle indicator** when engine is idle (saving power)
- **Decoder type** badge: `WC` (WebCodecs), `VF` (HTMLVideo VideoFrame), `NH` (NativeHelper), `PD` (ParallelDecode), `HTML` (HTMLVideoElement)
- **Frame drops** this second (red arrow indicator)
- **Audio status** icon with drift display
- **Output resolution** (e.g., 1920x1080)

### Expanded Mode (click to expand)
All compact info plus:
- FPS / target FPS
- Frame gap (RAF timing)
- Render total time
- **Pipeline breakdown bars** (Import, Render, Submit) as percentage of 16.67ms budget
- Engine state (Active / Idle)
- Layer count
- Decoder type (full name)
- Drops (last second + total)
- Last drop reason
- Bottleneck identification
- **Playback bottleneck** (Collector gaps, Pending seek, Decoder resets, Queue pressure)

### WebCodecs Debug Section (expanded only)
- Codec name
- Hardware acceleration status
- Decode queue size
- Sample index / total samples loaded

### Playback Debug Section (expanded only)
- Playback status (good / warn / bad, color-coded)
- Pipeline name
- Decoder resets count
- Pending seek (avg / max ms)
- Collector hold / drop counts

### Audio Section (expanded only)
- Audio status (Sync / Drift / Error / Silent)
- Number of playing tracks
- Drift amount in ms

### Bottleneck Detection
```
Video Import - GPU texture upload slow
GPU Render   - Compositing slow
GPU Submit   - Command submission slow
```

---

## Frame Caching

### ScrubbingCache Class

#### Tier 1: Scrubbing Frame Cache
```typescript
// GPU texture cache for instant scrubbing
// Key: "videoSrc:quantizedFrameTime" (quantized to 30fps boundaries)
// LRU eviction, max 300 frames, ~2.4GB VRAM at 1080p
```

#### Tier 2: Last Frame Cache
```typescript
// Keeps last valid frame visible during seeks
// One GPUTexture per video element
// Prevents flicker when seeking to uncached positions
```

#### Tier 3: RAM Preview Composite Cache
```typescript
// Fully composited frames stored as CPU-side ImageData
// Max 900 frames, 512MB memory limit
// LRU eviction by both frame count and byte size
```

#### Tier 4: GPU Frame Cache
```typescript
// GPU textures for instant RAM Preview playback (no CPU->GPU upload)
// Max 60 frames, ~500MB VRAM at 1080p
// LRU eviction
```

---

## Composition Rendering

### Service Methods
```typescript
prepareComposition(compositionId)
- Loads all video/image sources
- Waits for canplaythrough
- Handles both active and saved compositions

evaluateAtTime(compositionId, time)
- Returns layers ready for rendering
- Handles clip trimming
- Handles reversed clips
- Builds layer transforms
- Automatic video seeking
```

---

## Performance

### Frame Rate
- 60fps target for preview
- 30fps limit when video playing
- Frame drop detection (1.5x target)

### Optimization
- Skip caching during playhead drag
- Reuse already-cached frames
- Video paused during RAM Preview generation

---

## Unified RenderTarget System

All preview outputs (main preview, additional preview panels, multi-preview slots, output windows) use a unified RenderTarget system for rendering.

### RenderTarget

Each output is a `RenderTarget` with a source and a destination:

| Property | Description |
|----------|-------------|
| **Source** | What to display: active composition, specific composition, layer, layer-index, slot, or program mix |
| **Destination** | Where to display: `canvas`, `window`, or `tab` |
| **Enabled** | Toggle rendering on/off per target |
| **Fullscreen** | Toggle fullscreen mode per window |
| **ShowTransparencyGrid** | Per-target transparency checkerboard toggle |

### Source Types

| Source Type | Description |
|-------------|-------------|
| **Active Comp** (`activeComp`) | Follows whichever composition is currently open in the Timeline editor |
| **Composition** (`composition`) | Renders a specific composition by ID (independent of editor) |
| **Layer** (`layer`) | Renders specific layers by ID from a composition |
| **Layer Index** (`layer-index`) | Renders a specific layer by index from a composition (used by Multi Preview auto-distribute) |
| **Slot** (`slot`) | Renders a slot from the multi-layer slot grid |
| **Program** (`program`) | Main mix output (all layers composited) |

### Registration Flow
1. Canvas element registers via `registerTargetCanvas()`
2. Engine assigns a WebGPU context to the canvas
3. Target entry created in `renderTargetStore` with source/destination metadata
4. If source is independent (not active comp), `RenderScheduler` manages its render loop

### Store Actions
```typescript
registerTarget(target)              // Add a new render target
unregisterTarget(id)                // Remove and close associated window
deactivateTarget(id)                // Clear canvas/context/window refs
updateTargetSource(id, source)      // Change what a target displays
setTargetEnabled(id, enabled)       // Enable/disable rendering
setTargetCanvas(id, canvas, ctx)    // Bind GPU canvas context
setTargetWindow(id, win)            // Bind output window
setTargetTransparencyGrid(id, show) // Toggle checkerboard
getActiveCompTargets()              // All targets following active comp
getIndependentTargets()             // All targets needing independent rendering
resolveSourceToCompId(source)       // Resolve any source to a compositionId
```

---

## RenderScheduler

The RenderScheduler service manages a single shared render loop for all independent render targets (those not following the active composition).

| Feature | Description |
|---------|-------------|
| **Single shared RAF loop** | One `requestAnimationFrame` loop serves all independent targets, throttled to ~60fps |
| **Composition evaluation** | Evaluates layers at the correct time for each target's source via `compositionRenderer` |
| **Per-frame eval cache** | Each composition is evaluated only once per frame, even if multiple targets share it |
| **Nested composition sync** | Syncs child/parent composition playheads when compositions are nested in the timeline |
| **Active comp layer reuse** | Reuses pre-built layers from the main render loop for layer-filtered active-comp targets |
| **Nested texture copy** | Copies pre-rendered nested composition textures instead of re-rendering when possible |
| **Auto-preparation** | Automatically prepares compositions that aren't ready yet |
| **Cleanup** | Loop stops when all targets are unregistered |

---

## Output Manager

The Output Manager is a dedicated interface for managing multiple output targets, applying corner-pin warping (slices), and routing sources to different displays. Useful for projection mapping, multi-screen setups, and VJ performances.

### Opening the Output Manager
- Menu: **Output -> Output Manager**
- Opens in a new browser popup window (900x600, centered)

### Layout

| Area | Description |
|------|-------------|
| **Preview (left)** | Live preview canvas showing the selected target with slices applied, with Input/Output tab bar above |
| **Sidebar (right)** | Target list with nested slices, source selectors, controls |
| **Footer** | Zoom level display and Save & Exit button |

### Preview Area
- Zoom: mouse wheel (centered on cursor, range 0.25x-5x)
- Pan: middle mouse button drag
- Reset: double-click to reset zoom/pan

### Target Management

| Action | How |
|--------|-----|
| **Add Output Window** | `+ Output` button in sidebar header |
| **Add Slice** | `+ Slice` button (requires target selected) |
| **Add Mask** | `+ Mask` button (requires target selected) |
| **Select Source** | Dropdown per target: Active Comp, specific composition, slot |
| **Rename** | Double-click the target name to edit inline |
| **Enable/Disable** | ON/OFF toggle button per target |
| **Close Window** | X button (window becomes grayed out with Restore option) |
| **Remove** | Remove button on closed targets (deletes from list) |

### Save & Exit
- **Save & Exit** button saves all configurations and closes the Output Manager
- Configurations persist per-project in localStorage

### Component Architecture

| Component | Purpose |
|-----------|---------|
| `OutputManager.tsx` | Root component -- popup window layout with preview area and sidebar |
| `OutputManagerBoot.ts` | Popup window management -- handles opening, reconnection on page refresh, and re-injection of React root and styles into reconnected popups |
| `SliceInputOverlay` | Interactive overlay on the Input tab -- draggable corner points to select a sub-region of the source |
| `SliceOutputOverlay` | Interactive overlay on the Output tab -- draggable corner points to warp/stretch slices into quadrilaterals |
| `SliceList` | Slice management UI -- list of slices and masks per target with drag-and-drop reordering, rename, enable/disable, reset, and delete |
| `SourceSelector` | Render target source routing dropdown -- select Active Comp, specific composition, or slot as the source for each target |
| `TabBar` | Output window tab navigation -- switches between Input and Output views in the preview area |
| `TargetList` | Render target management sidebar -- lists all output targets with nested slices, add/remove/enable controls |
| `TargetPreview` | Live preview canvas for the selected target -- shows slices applied, supports zoom (mouse wheel) and pan (middle mouse) |

---

## Slice & Warp System

Slices map an input region (defined by 4 draggable corners) to a warped output quadrilateral. Each output target can have multiple slices and mask layers.

### How Slices Work

Each slice has:
- **inputCorners**: 4 corner points (TL, TR, BR, BL) in normalized 0-1 coordinates defining which region of the source to display
- **warp**: Defines the output shape, either:
  - **Corner Pin** (`cornerPin`): 4 output corner points (TL, TR, BR, BL), unclamped (can exceed 0-1 for warping)
  - **Mesh Grid** (`meshGrid`): Grid of `(cols+1) * (rows+1)` control points for finer warp control

### Input Tab
- Shows the source content with draggable corner points
- Drag corners to select a sub-region of the source
- Supports zoom (mouse wheel) and pan (middle mouse)
- Right-click context menu: "Match Input to Output Shape"

### Output Tab
- Shows the output canvas with draggable corner points
- Drag corners to warp/stretch the slice into any quadrilateral shape
- Outlines and vertices visible even outside the canvas bounds
- Right-click context menu: "Match Output to Input Shape"

### Slice Controls

| Action | How |
|--------|-----|
| **Add Slice** | `+ Slice` button in sidebar header |
| **Add Mask** | `+ Mask` button in sidebar header |
| **Rename** | Double-click the slice name |
| **Enable/Disable** | ON/OFF toggle per slice |
| **Reorder** | Drag handle for drag-and-drop reordering |
| **Reset** | Reset button to restore default corners |
| **Delete** | Del button per slice |

### Mask Layers

Mask layers are slices with `type: 'mask'` that control pixel visibility:

| Property | Description |
|----------|-------------|
| **Inverted mode** (default) | Pixels inside the mask quad are transparent |
| **Normal mode** | Pixels outside the mask quad are transparent |
| **Toggle** | `Inv` button on each mask to switch between modes |
| **Visual style** | Displayed as dashed red outlines; styled with red border in sidebar |
| **Default shape** | Created with corners at (0.25, 0.25) to (0.75, 0.75) |

---

## Output Window Management

### Creating Output Windows
- Click `+ Output` in Output Manager sidebar header to open a new popup window
- Each window is a full render target with its own source routing

### Window Restore-on-Close
| State | Appearance |
|-------|------------|
| **Open** | Active window with live rendering, green status dot |
| **Closed** | Grayed-out entry in sidebar with Restore and Remove buttons |
| **Restored** | Re-opens at previous position and size |

Window geometry (position, size) is preserved even after closing, so restored windows reappear in the same screen location.

### Window Reconnection
- On page refresh, output windows attempt to reconnect via localStorage flag (`masterselects-om-open`)
- Named popup windows (`output_manager`) allow the browser to find existing windows
- Re-injects React root + styles into reconnected popup
- Prevents duplicate windows from spawning on refresh

---

## Output Manager Persistence

### Auto-Save
- Slice configurations auto-save on every change (debounced 500ms)
- Saved per-project using localStorage key: `Outputmanager_{ProjectName}`
- Window geometry included in saved metadata

### What Gets Saved
| Data | Storage |
|------|---------|
| Slice configurations (inputCorners, warp, masks, inverted) | localStorage per project |
| Target metadata (name, source, window geometry, fullscreen) | localStorage per project |
| Selected slice state | Transient (not persisted) |

### Load on Boot
1. Output Manager mounts and loads saved config from localStorage
2. Closed targets restore as grayed-out entries in renderTargetStore
3. Window geometry preserved for restoration
4. Slice configs applied immediately to render pipeline

---

## Related Features

- [Timeline](./Timeline.md) - Main editing interface
- [Export](./Export.md) - Render to file
- [GPU Engine](./GPU-Engine.md) - Rendering details
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

## Tests

No dedicated unit tests -- this feature requires browser APIs (WebGPU/WebCodecs) that cannot be easily mocked.

---

*Source: `src/components/preview/Preview.tsx`, `src/components/preview/PreviewControls.tsx`, `src/components/preview/PreviewBottomControls.tsx`, `src/components/preview/SourceMonitor.tsx`, `src/components/preview/StatsOverlay.tsx`, `src/components/preview/MultiPreviewPanel.tsx`, `src/components/preview/MultiPreviewSlot.tsx`, `src/components/preview/MaskOverlay.tsx`, `src/components/preview/SAM2Overlay.tsx`, `src/components/preview/useEditModeOverlay.ts`, `src/components/preview/useLayerDrag.ts`, `src/components/outputManager/`, `src/stores/renderTargetStore.ts`, `src/stores/sliceStore.ts`, `src/services/renderScheduler.ts`, `src/types/renderTarget.ts`, `src/types/outputSlice.ts`*
