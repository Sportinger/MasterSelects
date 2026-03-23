# Media Panel

[← Back to Index](./README.md)

Import, organize, and manage media assets with folder structure, proxy generation, and dual view modes.

---

## Table of Contents

- [Importing Media](#importing-media)
- [View Modes](#view-modes)
- [Folder Organization](#folder-organization)
- [Compositions](#compositions)
- [Proxy Generation](#proxy-generation)
- [Selection](#selection)
- [Context Menu](#context-menu)
- [Media Properties](#media-properties)
- [Drag to Timeline](#drag-to-timeline)
- [Project Integration](#project-integration)
- [Media Relinking](#media-relinking)

---

## Importing Media

### Supported Formats

| Type | Formats |
|------|---------|
| **Video** | MP4, WebM, MOV, AVI, MKV, WMV, M4V, FLV |
| **Audio** | WAV, MP3, OGG, FLAC, AAC, M4A, WMA, AIFF, OPUS |
| **Image** | PNG, JPG/JPEG, GIF, WebP, BMP, SVG |

### Import Methods

#### Import Button
Click the **Import** button in the panel header. Uses the File System Access API when available (Chrome/Edge) for native file picker with persistent handles, or falls back to a standard file input.

#### Add Dropdown
Click the **+ Add** button for creating new items:
- **Composition** - New composition (uses active comp's output resolution)
- **Folder** - New folder for organization
- **Text** - New text item (placed in auto-created "Text" folder)
- **Solid** - New solid color item (placed in auto-created "Solids" folder)
- **Mesh** ▶ - Submenu with 3D primitive meshes (placed in auto-created "Meshes" folder):
  - Cube, Sphere, Plane, Cylinder, Torus, Cone
  - Creates a `MeshItem` which can be dragged to the timeline as a 3D clip
- **Adjustment Layer** - Coming soon

#### Drag and Drop
- Drag files directly from the OS file explorer into the Media Panel
- Multiple files supported
- Attempts to acquire file handles via `getAsFileSystemHandle` for persistence
- Falls back to standard File objects when handles are unavailable

### Import Pipeline

Imports use a two-phase approach:

1. **Phase 1 (instant):** A placeholder entry appears immediately in the panel with `isImporting: true`, showing file name and size
2. **Phase 2 (background):** Full processing runs in the background:
   - Media info extraction (dimensions, duration, FPS, codec, bitrate, audio detection)
   - Thumbnail generation (for video and image files)
   - File hash calculation (for deduplication and proxy matching)
   - Copy to project RAW folder (if enabled in settings)
   - Existing proxy detection (by file hash)

**Deduplication:** Files with matching name + size are automatically skipped.

**Batch processing:** When importing multiple files, up to 3 files are processed in parallel.

### File System Access API
When supported (Chrome/Edge):
- Native file picker via `showOpenFilePicker`
- Persistent file handles stored in IndexedDB
- Path information preserved
- Handles from drag-and-drop also captured when available

### Large File Handling
| Size | Behavior |
|------|----------|
| < 500MB | Full thumbnails generated |
| > 500MB | Thumbnail generation skipped |

### Solid Color Items
- Created via Add dropdown or context menu
- Uses active composition dimensions (fallback: 1920x1080)
- Default duration: 5 seconds
- Color picker for customization via Solid Settings dialog
- Placed in auto-created "Solids" folder
- Drag to timeline to create solid color clips

### Text Items
- Created via Add dropdown
- Default text: "New Text", font: Arial 48px white
- Default duration: 5 seconds
- Placed in auto-created "Text" folder
- Drag to timeline to create text clips
- **Note:** These are defaults for Media Panel text items (Arial, 48px). Timeline text clips use different defaults: Roboto, 72px (from `DEFAULT_TEXT_PROPERTIES` in `stores/timeline/constants.ts`).
- See [Text Clips](./Text-Clips.md) for full details

---

## View Modes

The panel supports two view modes, toggled via buttons in the header. The selected mode is persisted in `localStorage`.

### List View (default)
- Table layout with sortable, reorderable columns
- Nested folder tree with expand/collapse arrows
- Column headers for sorting and drag-to-reorder
- Resizable name column (120px - 500px range, saved to localStorage)

### Grid View
- Thumbnail grid with file names below each item
- Folder navigation via breadcrumb bar
- Double-click folders to navigate into them
- Breadcrumb shows full path from root, each segment is clickable
- Hover tooltip shows detailed metadata (resolution, duration, codec, bitrate, file size)
- Duration badge overlay on video and composition thumbnails
- Item count badge on folder thumbnails

---

## Folder Organization

### Creating Folders
1. Add dropdown -> Folder
2. Or right-click -> New Folder
3. Folders are created expanded by default

### Folder Features
- **Nested folders** supported
- **Drag-and-drop** items into folders (single or multi-select)
- **Expand/collapse** tree view (list mode) or navigate into (grid mode)
- **Cycle detection** prevents dropping a folder into itself or its descendants
- **Label colors** assignable to folders

### Operations
```typescript
createFolder(name, parentId?)     // Create folder (returns MediaFolder)
removeFolder(id)                  // Delete (moves children to parent)
renameFolder(id, name)            // Rename
toggleFolderExpanded(id)          // Toggle expand/collapse
moveToFolder(itemIds[], folderId) // Move items (null = root)
```

---

## Compositions

### Creating Compositions
1. Add dropdown -> Composition
2. Created with settings from `settingsStore.outputResolution`
3. Default duration: 60 seconds, frame rate: 30 fps
4. Starts with one Video track and one Audio track

### Composition Settings Dialog
Edit via right-click -> Composition Settings:
- Width and height
- Frame rate
- Duration
- Resizing adjusts clip transforms to maintain pixel positions

### Composition Operations
```typescript
createComposition(name, settings?)   // Create with optional overrides
duplicateComposition(id)             // Creates "Name Copy"
removeComposition(id)                // Delete
updateComposition(id, updates)       // Update settings
openCompositionTab(id, options?)     // Edit in timeline (with animation)
closeCompositionTab(id)              // Close tab
reorderCompositionTabs(from, to)     // Drag to reorder tabs
setActiveComposition(id)             // Switch active composition
getActiveComposition()               // Get current composition
getOpenCompositions()                // List open tabs
```

### Tab System
- Compositions open as tabs in the timeline
- Tab switching saves current timeline state and loads the new composition's state
- Animated transitions (exit/enter) when switching between compositions
- Synced playhead when navigating into/out of nested compositions

### Nested Compositions
- Drag composition to timeline to create a nested comp clip
- Double-click composition clip to navigate into it
- Playhead position syncs between parent and nested compositions
- Changes in nested comp reflect in parent timeline

### Source Monitor
- Double-click a video or image file to open it in the source monitor
- Sets `sourceMonitorFileId` in the store

---

## Proxy Generation

### Project-Based Proxy System
Proxies require an open project (via `projectFileService`). For large video files:
1. Right-click video -> Generate Proxy
2. Proxy frames are generated and stored in the project folder

### How It Works
- Video is decoded frame-by-frame using `proxyGenerator`
- Frames are saved individually to the project's proxy storage via `projectFileService`
- Audio is extracted separately in the background (non-blocking)
- Generation can be cancelled; partial proxies are preserved
- Resumed automatically if a partial proxy exists on disk

### Proxy Settings
```typescript
FPS: 30  // Constant frame rate for proxy
```

### Proxy Completion
A proxy is considered complete when >= 98% of expected frames are available:
```typescript
frameCount >= Math.ceil(duration * PROXY_FPS) * 0.98
```

### Progress Tracking
```typescript
interface MediaFile {
  proxyStatus: 'none' | 'generating' | 'ready' | 'error';
  proxyProgress: number;      // 0-100
  proxyFrameCount?: number;   // Total frames generated
  proxyFps?: number;          // Always 30
  hasProxyAudio?: boolean;    // Audio proxy extracted
}
```

### Proxy Mode
Toggle proxy playback mode via `proxyEnabled` / `toggleProxyEnabled()`:
- When enabled, mutes all video elements in the timeline
- Uses proxy frames instead of original video for playback

### Visual Indicators
| Badge | Meaning |
|-------|---------|
| **P** (blue) | Proxy ready |
| **P** (filling animation) + **X%** | Generating, with progress |

---

## Selection

### Click Selection
- **Click** - Select single item
- **Ctrl/Cmd + Click** - Toggle item in selection
- **Shift + Click** - Add to selection

### Marquee Selection
- Click and drag on empty space in the item list to draw a selection rectangle
- 4px movement threshold before marquee activates
- Hold **Ctrl/Cmd** while marquee selecting to add to existing selection
- Works in both list and grid view modes

### Label Colors
16 AE-style label colors assignable to any item (files, folders, compositions, text, solids):

`none`, `red`, `yellow`, `blue`, `green`, `purple`, `orange`, `pink`, `cyan`, `brown`, `lavender`, `peach`, `seafoam`, `fuchsia`, `tan`, `aqua`

Click the label dot in the list view to open the color picker. When multiple items are selected, the color is applied to all selected items.

---

## Context Menu

Right-click on items or empty space for context options.

### Always Available
- Import Media...
- New Composition
- New Folder
- New Text
- New Solid
- **Mesh** ▶ submenu: Cube, Sphere, Plane, Cylinder, Torus, Cone

### Single/Multi Selection
- **Rename** (single selection only)
- **Move to Folder** submenu (shows available folders + "Root")
- **Delete** (shows count for multi-selection)

### Video Files (single selection)
- **Generate Proxy** / **Stop Proxy Generation (X%)** / **Proxy Ready** (disabled)
- **Show in Explorer** submenu:
  - Raw (downloads file if no native path)
  - Proxy (disabled if no proxy)
- **Set Proxy Folder...**

### Compositions (single selection)
- **Composition Settings...** (opens settings dialog)

### Solid Items (single selection)
- **Solid Settings...** (opens color/dimension editor)

---

## Media Properties

### Column Display (List View)
The media list displays items in a table with the following columns:

| Column | Description | Example |
|--------|-------------|---------|
| **Name** | File name with AE-style file type icon | Video.mp4 |
| **Label** | Colored dot indicator (clickable) | colored circle |
| **Duration** | Clip length (m:ss) | 4:02 |
| **Resolution** | Width x Height | 1920x1080 |
| **FPS** | Frame rate (video) or composition frame rate | 25 |
| **Container** | File container format | MP4, MKV, WebM |
| **Codec** | Video codec | H.264, VP9, AV1 |
| **Audio** | Has audio track? | Yes / No |
| **Bitrate** | Data rate | 12.5 Mbps |
| **Size** | File size | 125.4 MB |

### Column Customization

**Sortable Columns:**
- Click column header to sort ascending
- Click again for descending
- Click a third time to remove sort
- Folders always sort separately (stay at top)

**Reorderable Columns:**
- Drag column headers to rearrange order
- Order is saved in localStorage (`media-panel-column-order`)

**Resize Name Column:**
- Drag the vertical resize handle on the right edge of the Name column
- Width range: 120px - 500px
- Width saved in localStorage (`media-panel-name-width`)

### Status Badges (in Name column)
| Badge | Meaning |
|-------|---------|
| **P** (blue) | Proxy ready |
| **P** (filling) + % | Proxy generating |
| **T** (green) | Fully transcribed - click to open transcript |
| **T** (filling) | Partially transcribed - shows coverage % |
| **A** (orange) | Fully analyzed - click to open analysis |
| **A** (filling) | Partially analyzed - shows coverage % |

Clicking transcript or analysis badges selects the corresponding clip in the timeline and opens the clip properties panel.

### Metadata Interface
```typescript
interface MediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  file?: File;               // Undefined when needs reload
  url: string;
  parentId: string | null;
  createdAt: number;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;              // Frame rate (video)
  codec?: string;            // H.264, VP9, AV1, ProRes, etc.
  audioCodec?: string;       // AAC, AC-3, Opus, etc.
  container?: string;        // MP4, MKV, WebM, etc.
  fileSize?: number;         // File size in bytes
  bitrate?: number;          // Bits per second
  hasAudio?: boolean;        // Whether video has audio tracks
  thumbnailUrl?: string;
  fileHash?: string;         // For dedup and proxy matching
  labelColor?: LabelColor;   // 16-color label system
  isImporting?: boolean;     // True during background import
  // Proxy
  proxyStatus?: ProxyStatus;
  proxyProgress?: number;
  proxyVideoUrl?: string;        // URL to proxy video
  proxyFrameCount?: number;
  proxyFps?: number;
  hasProxyAudio?: boolean;
  // Transcript
  transcriptStatus?: TranscriptStatus;
  transcript?: TranscriptWord[];
  transcriptCoverage?: number;
  transcribedRanges?: [number, number][]; // Time ranges that have been transcribed
  // Analysis
  analysisStatus?: AnalysisStatus;
  analysisCoverage?: number;
  // File System Access API
  hasFileHandle?: boolean;
  filePath?: string;
  absolutePath?: string;
  projectPath?: string;      // Path within project RAW folder
}
```

---

## Drag to Timeline

### Process
1. Select media in panel
2. Drag to timeline
3. Drop on appropriate track

### Drag Types
| Item Type | Drag Payload Kind | Data Transfer Key |
|-----------|-------------------|-------------------|
| Media file (video/image) | `media-file` | `application/x-media-file-id` |
| Media file (audio) | `media-file` (marked as audio) | `application/x-media-file-id` |
| Composition | `composition` | `application/x-composition-id` |
| Text item | `text` | `application/x-text-item-id` |
| Solid item | `solid` | `application/x-solid-item-id` |
| Mesh item | `mesh` | `application/x-mesh-item-id` |
| Folder | Internal move only (no timeline drop) | — |

### Drop Behavior
- Creates clip from media source
- Uses actual media duration
- Audio-only files restricted to audio tracks
- Files still importing or missing cannot be dragged to timeline
- Compositions cannot be dragged into themselves (active comp check)
- Mesh items create 3D clips with `is3D: true` and `meshType` (rendered via Three.js)

### Track Type Enforcement
| Media Type | Allowed Tracks |
|------------|----------------|
| Video/Image/Composition/Text/Solid/Mesh | Video tracks only |
| Audio | Audio tracks only |

---

## Project Integration

### Auto-Save
Media references saved with project to IndexedDB, including:
- File metadata (name, type, dimensions, duration, codec, etc.)
- File handles (for reload on next session)
- Folder structure
- Composition state with timeline data
- Text items and solid items (via localStorage)

### Restoration
On project load:
- Media metadata restored from IndexedDB
- File handles used to restore file access (with permission requests)
- Thumbnails restored from project folder (by file hash)
- Existing proxies detected automatically
- Existing transcripts loaded from project folder
- Blob URLs regenerated for available files
- Folder structure and expansion state restored

### Media File IDs
- Each media has a unique timestamp-based ID
- Clips reference media by `mediaFileId`
- Survives project reload
- File hash used for proxy and thumbnail deduplication across reimports

---

## Media Relinking

### Relink Dialog
When media files lose access (e.g., after browser restart):
1. **Automatic detection** - Panel shows "Relink (N)" button when files need reload
2. **Relink dialog** - Click the button to open the relink interface
3. Files dimmed in list with `no-file` styling when unavailable

### Reload Strategy
Files are reloaded in priority order:
1. **Project RAW folder** - If file was copied to project and project is open
2. **Stored file handle** - Request permission to re-access original file location

### Double-Click Reload
Double-clicking a file that has lost access triggers a single-file reload attempt with permission request.

### Visual Indicators
| State | Appearance |
|-------|------------|
| File missing/needs reload | Row dimmed, `no-file` class |
| File importing | `importing` class with loading state |
| Proxy available | Blue "P" badge |

---

## Store Architecture

The media store is split into modular slices:

| Slice | File | Responsibility |
|-------|------|----------------|
| **fileImportSlice** | `slices/fileImportSlice.ts` | Import via picker, drag-drop, handles |
| **fileManageSlice** | `slices/fileManageSlice.ts` | Remove, rename, reload files |
| **compositionSlice** | `slices/compositionSlice.ts` | CRUD, tabs, active composition switching |
| **slotSlice** | `slices/slotSlice.ts` | Resolume-style slot grid assignments |
| **multiLayerSlice** | `slices/multiLayerSlice.ts` | Multi-layer playback activation |
| **folderSlice** | `slices/folderSlice.ts` | Folder CRUD and expand/collapse |
| **selectionSlice** | `slices/selectionSlice.ts` | Selection, move-to-folder, label colors |
| **proxySlice** | `slices/proxySlice.ts` | Proxy generation, cancellation, progress |
| **projectSlice** | `slices/projectSlice.ts` | Save, load, init from DB |

**Inline actions (in `index.ts`):** `createTextItem`, `removeTextItem`, `getOrCreateTextFolder`, `createSolidItem`, `removeSolidItem`, `updateSolidItem`, `getOrCreateSolidFolder`, `createMeshItem`, `removeMeshItem`, `getOrCreateMeshFolder`, `getItemsByFolder`, `getItemById`, `getFileByName`.

**Boot Sequence:** `init.ts` handles IndexedDB initialization, timeline restore from saved state, status synchronization, auto-save interval setup, beforeunload handler, and audio cleanup via `disposeAllAudio()`.

Helper modules in `helpers/`:

| Module | Purpose |
|--------|---------|
| `importPipeline.ts` | Unified import processing -- orchestrates the two-phase import (placeholder then background processing) |
| `mediaInfoHelpers.ts` | Codec detection, metadata extraction (uses mp4box for MP4 container parsing) |
| `thumbnailHelpers.ts` | Thumbnail generation, deduplication by file hash, skip logic for large files |
| `fileHashHelpers.ts` | File hash calculation for deduplication and proxy matching |

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`fileManageSlice.test.ts`](../../tests/stores/mediaStore/fileManageSlice.test.ts) | 106 | Files, folders, solids, text items, selection, labels |
| [`compositionSlice.test.ts`](../../tests/stores/mediaStore/compositionSlice.test.ts) | 101 | Compositions |

Run tests: `npx vitest run`

---

## Not Implemented

- Cloud storage integration
- Asset library across projects
- Batch import settings
- Adjustment layers (UI placeholder exists)

---

## Related Features

- [Timeline](./Timeline.md) - Using media in edits
- [Audio](./Audio.md) - Audio media handling
- [Project Persistence](./Project-Persistence.md) - Saving
- [Export](./Export.md) - Rendering output

---

*Source: `src/components/panels/MediaPanel.tsx`, `src/stores/mediaStore/index.ts`, `src/stores/mediaStore/slices/`*
