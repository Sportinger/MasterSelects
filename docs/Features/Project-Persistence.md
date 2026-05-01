# Project Persistence

[← Back to Index](./README.md)

Local project folder storage with continuous save by default, optional interval autosave, backups, and smart media relinking. Supports two backends: **File System Access API** (Chrome/Edge) and **Native Helper** (Firefox when the helper is connected).

---

## Table of Contents

- [Welcome Overlay](#welcome-overlay)
- [Storage Backends](#storage-backends)
- [Project Folder Structure](#project-folder-structure)
- [Auto-Save](#auto-save)
- [Backup System](#backup-system)
- [Media Relinking](#media-relinking)
- [What Gets Saved](#what-gets-saved)
- [Project Management](#project-management)

---

## Welcome Overlay

### First Launch
On first launch or when no project is open, the Welcome Overlay appears:
- Animated entrance with blur backdrop
- "Local. Private. Free." tagline (typewriter effect with deliberate typo correction)
- Two options: **New Project** or **Open Existing**
- **Start editing** button (or press Enter) to skip without persistence

### Browser Handling

| Browser | Behavior |
|---------|----------|
| Chrome / Edge / Chromium | Full FSA support -- folder picker opens natively |
| Firefox | Uses **Native Helper** backend for persistence when the helper is connected |
| Safari / other | **"Unsupported Browser"** warning with Chrome download link |

For Firefox users:
- The overlay checks if the Native Helper is running and connected
- If available, activates the native backend and shows "New Project" / "Open Existing" buttons (using the OS folder picker via Native Helper)
- If the helper cannot show an OS folder picker on the current platform, MasterSelects falls back to a manual path prompt seeded with the helper's project root
- If unavailable or outdated, persistence is unavailable until the helper is installed and connected

### Select Project Folder
1. Click **"New Project"**
2. Choose or create a folder for your project
3. App creates the project folder with `project.json` plus the standard subfolders (`Raw/`, `Downloads/`, `Proxy/`, `Cache/`, `Analysis/`, `Transcripts/`, `Renders/`, `Backups/`)
4. Folder handle stored in IndexedDB (FSA) or path stored in localStorage (`ms-native-last-project-path`) for future sessions

### Continue Without Saving
- Click **"Start editing"** or press **Enter**
- Work without persistence
- Project lost on refresh
- Useful for quick experiments

---

## Storage Backends

The project system supports two backends, selected automatically based on browser capabilities:

### FSA Backend (Chrome / Edge)
- Uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- `showDirectoryPicker()` for folder selection
- `FileSystemDirectoryHandle` + `FileSystemFileHandle` for all I/O
- Handles stored in IndexedDB (`fsHandles` store) for session persistence
- Permission re-requested on page reload if needed

### Native Helper Backend (Firefox)
- Uses a local Rust helper (`tools/native-helper`) communicating via WebSocket (port 9876) and HTTP (port 9877)
- OS folder picker via `NativeHelperClient.pickFolder()`
- Manual project path fallback via `ProjectFileService` when the helper reports that no native picker is available
- User-picked project paths are granted to the helper at runtime, so external drives and non-default project folders remain readable through both WebSocket and HTTP file routes
- File I/O via `NativeHelperClient.writeFile()` / `readFileText()` / `writeFileBinary()` plus `createDir()`, `deleteFile()`, `rename()`, `exists()`, `listDir()`, and `pickFolder()`
- Project files are written through the helper's path-based storage layer; the browser never needs a `FileSystemDirectoryHandle`
- Last project path stored in `localStorage` key `ms-native-last-project-path`
- No permission prompts needed -- the Native Helper has full filesystem access
- Project listing: `NativeProjectCoreService.listProjects()` scans the project root for directories containing `project.json`
- The default project root comes from the helper (`Documents/MasterSelects` when available, otherwise `Home/MasterSelects`, or `MASTERSELECTS_PROJECT_ROOT` when set to an absolute path)
- On Firefox refresh, `ProjectFileService.restoreLastProject()` now activates the Native backend before attempting restore, so it no longer depends on the Welcome Overlay running first

### Backend Switching
The `ProjectFileService` facade routes all calls to the active backend:
- `projectFileService.activeBackend` -- returns `'fsa'` or `'native'`
- `projectFileService.activateNativeBackend()` -- switches to Native Helper
- `projectFileService.activateFsaBackend()` -- switches back to FSA

*Source: `src/services/project/ProjectFileService.ts`*

---

## Project Folder Structure

Projects are stored in a local folder you choose:

```
MyProject/
+-- project.json           # Main project file
+-- project.autosave.json  # Fallback when browser FSA cannot update project.json
+-- .keys.enc              # Encrypted API keys (auto-saved with project)
+-- Raw/                   # Auto-copied media files (portable)
|   +-- Interview_01.mp4
|   +-- Music.wav
|   +-- hero/              # Imported GLB sequence frames
|   |   +-- hero000000.glb
|   |   +-- hero000001.glb
|   +-- scan/              # Imported PLY/splat sequence frames
|   |   +-- scan000000.ply
|   |   +-- scan000001.ply
+-- Downloads/             # Downloaded videos (platform subfolders)
|   +-- YT/
|   |   +-- video_title.mp4
|   +-- TikTok/
|   +-- Instagram/
|   +-- Twitter/
|   +-- Facebook/
|   +-- Reddit/
|   +-- Vimeo/
|   +-- Twitch/
+-- Backups/               # Auto-backup folder
|   +-- project_2026-01-11_14-00-00.json
|   +-- ... (last 20 backups)
+-- Proxy/                 # Generated proxy video/audio files
+-- Cache/                 # Cached derived data
|   +-- thumbnails/        # Media thumbnails (WebP, keyed by file hash)
|   +-- splats/            # Cached Gaussian splat runtimes
|   +-- waveforms/         # Waveform data (Float32Array binary)
+-- Analysis/              # Clip analysis data (per media file)
+-- Transcripts/           # Transcript data (per media file)
+-- Renders/               # Exported renders
```

Folder constants defined in `src/services/project/core/constants.ts`:

```typescript
const PROJECT_FOLDERS = {
  RAW: 'Raw',
  PROXY: 'Proxy',
  ANALYSIS: 'Analysis',
  TRANSCRIPTS: 'Transcripts',
  CACHE: 'Cache',
  CACHE_THUMBNAILS: 'Cache/thumbnails',
  CACHE_WAVEFORMS: 'Cache/waveforms',
  RENDERS: 'Renders',
  BACKUPS: 'Backups',
  DOWNLOADS: 'Downloads',
};
```

### Auto-Copy to Raw Folder
When importing media files (controlled by `copyMediaToProject` setting):
- Files are **copied** to the project's `Raw/` folder
- Numbered `.glb`, `.ply`, and `.splat` sequences are copied whenever a project is open, even when global auto-copy is off, so sequence frames survive reloads and project moves
- Sequence frames are stored under `Raw/<sequence-name>/` with their original frame filenames
- Original files remain untouched at their source location
- If a file with the same name and size already exists, reuses the existing copy
- If a file with the same name but different size exists, adds a numeric suffix
- The copied `Raw/` file becomes the canonical source for relinking when it exists
- Project becomes portable -- copy the folder to another machine

### Auto-Relink from Raw Folder
When opening a project with missing media files:
- App automatically scans the `Raw/` folder for matching files first
- Matches by **filename only** (case-insensitive)
- Files are restored from Raw without user intervention
- If the Raw copy is not available, it falls back to stored file handles in IndexedDB
- Includes retry logic for handles that may not be immediately ready

### Benefits of Local Storage
- **No browser storage limits** -- use as much disk space as needed
- **Portable projects** -- copy folder (including Raw/) to move between machines
- **External backup** -- use any backup tool on the folder
- **Version control** -- can use Git for project history

---

## Auto-Save

### How Auto-Save Works
There are two save modes in the current branch:

1. **Continuous save** (default): `projectLifecycle.ts` subscribes to the media, timeline, FlashBoard, dock, and download-related stores, marks the project dirty, and writes the project after a short debounce. Keyframe changes flush more aggressively.
2. **Interval save**: `Toolbar.tsx` can still run a timer-based autosave loop. In this mode, the timer creates a backup first and then saves the project.

Project JSON writes are serialized so continuous save, interval save, manual save, and page-unload flushes do not open overlapping writers for the same file. If Chromium's File System Access API cannot create the temporary swap file for `project.json`, the current state is written to `project.autosave.json`; project load prefers that file when it is newer than `project.json`.

### Autosave Configuration
Access via **Settings -> General** for save mode, plus **File -> Autosave** for the interval controls:

| Setting | Options | Default |
|---------|---------|---------|
| Save Mode | `continuous`, `interval` | **continuous** |
| Enable Autosave | On/Off | **On** |
| Interval | 1, 2, 5, 10 minutes | 5 min (interval mode only) |

Settings persist in `settingsStore` (localStorage).

### Automatic Dirty Marking
The `setupAutoSync()` function (in `projectLifecycle.ts`) subscribes to store changes and marks the project dirty when:
- Media files, compositions, or folders change (mediaStore)
- Clips or tracks change (timelineStore)
- YouTube panel state changes
- Dock layout changes
- Export settings or export presets change

### Manual Save
- `Ctrl+S` shortcut
- File menu -> Save
- Shows yellow "Saved" toast in center of screen
- Syncs all store state to project data, then writes `project.json`

### On Page Unload
In continuous-save mode, `beforeunload` flushes the pending store sync and kicks off a final best-effort project write. This still cannot fully guarantee the disk write completes before the page closes, but it is more aggressive than the old "memory only" unload path.

---

## Backup System

### How It Works
Before each **interval autosave** (the timer-driven File menu path), the current project file is automatically backed up:
1. Read current `project.json` content from disk
2. Copy to `Backups/` folder with timestamp name
3. Name format: `project_2026-01-11_14-30-00.json`
4. Then save the updated project to `project.json`

### Backup Storage
```
ProjectFolder/
+-- project.json          # Current project
+-- Backups/
    +-- project_2026-01-11_14-00-00.json
    +-- project_2026-01-11_14-05-00.json
    +-- ... (last 20 backups)
```

### Automatic Cleanup
- Keeps only the **last 20 backups** (`MAX_BACKUPS` constant)
- Oldest backups automatically deleted
- Sorted by file modification timestamp

### Restoring from Backup
1. Navigate to `ProjectFolder/Backups/`
2. Find backup by timestamp
3. Copy to `project.json` (rename existing first)
4. Reopen project

---

## Media Relinking

### Auto-Reconnect on Project Load
When opening a project, the app automatically:
1. Tries to get file handles from in-memory cache
2. Falls back to stored handles in IndexedDB
3. Checks read permission on restored handles
4. Scans the `Raw/` folder for missing files (exact filename match, case-insensitive)
5. Recursively scans the opened project folder and all subfolders for remaining missing files, with `Raw/` matches kept first if names collide
6. Also checks stored IndexedDB handles for files not found in the project folder
7. Regenerates missing object URLs for files that were restored successfully and rebuilds previews when the underlying `File` object is still available

Manual relink uses the same filename matching for normal media and sequence frames. For renamed single files, selecting one file directly assigns it to the clicked missing item.

### Reload All Button
In Media Panel toolbar:
- Click "Reload All" to restore file permissions
- Useful after browser restart
- Re-requests access to stored file handles

### Visual Indicators
| Indicator | Meaning |
|-----------|---------|
| Yellow badge | File needs reload (permission lost) |
| Red badge | File missing (needs relink) |
| Normal | File accessible |

---

## What Gets Saved

### Project Data (project.json)
```typescript
interface ProjectFile {
  version: 1;
  name: string;
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601

  settings: {
    width: number;       // Default 1920
    height: number;      // Default 1080
    frameRate: number;   // Default 30
    sampleRate: number;  // Default 48000
  };

  media: ProjectMediaFile[];
  compositions: ProjectComposition[];
  folders: ProjectFolder[];

  activeCompositionId: string | null;
  openCompositionIds: string[];
  expandedFolderIds: string[];

  slotAssignments?: Record<string, number>;
  mediaSourceFolders?: string[];
  youtube?: ProjectYouTubeState;
  uiState?: ProjectUIState;
}
```

### Per Composition
- All tracks and clips
- Timeline markers and per-marker MIDI bindings
- Clip positions and durations
- Trim points (inPoint/outPoint)
- Transform properties (position, scale, rotation, anchor, opacity, blend mode)
- Keyframe animations
- Effect parameters
- Mask shapes (vertices, mode, feather, opacity)
- Audio settings (volume, audioEnabled)
- Speed/reverse/disabled flags
- Nested composition references
- Text clip properties
- Solid clip color
- Vector animation settings (loop, end behavior, fit, animation selection, background)
- Transcript and analysis data per clip
- Scene description data

### Media Metadata
- File paths (relative to source folder)
- Duration, dimensions, FPS
- Codec, audio codec, container info
- Bitrate and file size
- hasAudio flag
- Proxy status
- Vector animation metadata (provider, animation names, default animation, frame count)
- Folder organization (folderId)
- `projectPath` when the file is copied into `Raw/`

### UI State (saved per project)
- Dock/panel layout
- Composition view state per composition (playhead, zoom, scroll, in/out points)
- Media panel column order and name width
- Transcript language preference
- Global MIDI state: enabled flag, transport bindings (`Play / Pause`, `Stop`), parameter mappings, mapping ranges, invert flags, and damping flags
- View toggles: thumbnails, waveforms, proxy, transcript markers
- Changelog preferences (`showChangelogOnStartup`, `lastSeenChangelogVersion`)
- Export panel state: live export settings, named export presets, and the selected preset

Temporary camera `NO KF` live offsets are intentionally not saved. They only affect the current preview session while the stored camera keyframes remain the project source of truth.

### Other Persisted Panels
- YouTube panel state is saved in `project.json`
- FlashBoard workspace state is saved in `project.json` when boards exist

### Stored in Project Folder
| Location | Contents |
|----------|----------|
| `project.json` | Main project data |
| `project.autosave.json` | FSA fallback copy used when `project.json` cannot be updated directly |
| `.keys.enc` | Encrypted API keys |
| `Backups/` | Auto-backup files |
| `Raw/` | Copied media files |
| `Downloads/` | Downloaded videos (per platform) |
| `Proxy/` | Proxy video/audio files |
| `Cache/thumbnails/` | Media thumbnails (WebP) |
| `Cache/waveforms/` | Waveform data |
| `Analysis/` | Clip analysis cache |
| `Transcripts/` | Transcript data |
| `Renders/` | Exported renders |

---

## Project Management

### New Project
- File menu -> New Project (`Ctrl+N`)
- Prompts for project name
- Opens folder picker (FSA) or OS folder picker (Native Helper)
- Creates project subfolder with `project.json` and all required subfolders

### Save Project
- `Ctrl+S` saves to project folder
- Shows yellow "Saved" toast
- Syncs all stores to project format, then writes `project.json`
- Also updates `.keys.enc` with current API keys

### Save As
- File menu -> Save As (`Ctrl+Shift+S`)
- Prompts for new project name
- Creates a new project in the same parent folder
- Current state synced to the new project

### Open Existing Project
- From Welcome Overlay: "Open Existing"
- Or File menu -> Open Project (`Ctrl+O`)
- Select folder containing `project.json`

### Rename Project
- Double-click the project name in the toolbar
- Validates name (no special characters `<>:"/\|?*`)
- If parent folder handle has write permission, renames the folder on disk
- Otherwise, updates only the display name in `project.json`

### Restore Last Project
On app load, attempts to restore the previously opened project:
- **FSA**: Retrieves `lastProject` handle from IndexedDB, checks permission
- **Native**: Activates the helper backend, reconnects to the helper with a bounded timeout, grants the stored project path to the helper, then reads path from `localStorage` key `ms-native-last-project-path`
- If permission is needed, shows a "Grant Access" prompt
- If the project folder no longer exists, the saved path is cleared and the user must choose/open another project

---

## Layout Persistence

### Dock Layout
Saved per project in `uiState.dockLayout` within `project.json`:
- Panel positions
- Tab arrangements
- Panel sizes

### View Toggle Persistence
View toggle states saved in the project file (`uiState`):
- Thumbnail visibility (on/off)
- Waveform visibility (on/off)
- Proxy enabled (on/off)
- Transcript markers visibility
- Restored when opening a project

### Output Manager Persistence
The Output Manager window state is tracked via `localStorage`:
- `masterselects-om-open` key stores whether the Output Manager was open
- On page refresh, the app detects the existing popup and reconnects via `reconnectOutputManager()`
- Uses `sessionStorage` guard to prevent false reconnection on fresh tabs
- Window position and size preserved by the browser's named window (`output_manager`)

### Composition Resolution Persistence
Each composition stores its own resolution (width/height) in the project file:
- Resolution is saved per composition, not globally
- Changing resolution adjusts clip transforms proportionally (auto-reposition)
- Restored when opening a project or switching compositions

### Actions
```typescript
saveNamedLayout()      // View -> Layouts
loadSavedLayout()      // View -> Layouts
setDefaultSavedLayout()// View -> Layouts
saveLayoutAsDefault()  // View -> Layouts
resetLayout()          // View -> Layouts
```

---

## Troubleshooting

### IndexedDB Error Dialog
If IndexedDB storage becomes corrupted, an error dialog appears automatically:
- Explains the issue and provides instructions for clearing site data
- Offers a "Refresh" button to reload the app after clearing
- Dismissable via Escape key or backdrop click
- Source: `src/components/common/IndexedDBErrorDialog.tsx`

### Project Not Loading
1. Check if `project.json` exists in folder
2. Verify folder permissions
3. Check browser console for errors
4. Verify project `version` is `1`

### Missing Media After Reload
1. Click "Reload All" in Media Panel
2. Check if source folder is accessible
3. Verify files exist in `Raw/` folder

### Restore from Backup
1. Navigate to `ProjectFolder/Backups/`
2. Find backup by timestamp
3. Copy to `project.json` (rename existing first)
4. Reopen project

---

## Storage Comparison

| Storage | Used For | Limits |
|---------|----------|--------|
| **Project Folder** | Project data, proxies, analysis, transcripts, cache, renders | Disk space |
| **IndexedDB** | File handles, media metadata, proxy frames (legacy), analysis cache, thumbnails | ~50MB |
| **localStorage** | App settings, autosave config, named/default dock layouts, dock layout fallback, Native Helper last project path | ~5MB |

---

## Architecture

### Service Structure
```
src/services/project/
+-- ProjectFileService.ts      # Facade -- routes to FSA or Native backend
+-- projectSave.ts             # Store -> project format conversion + save
+-- projectLoad.ts             # Project format -> store conversion + load
+-- projectLifecycle.ts        # Create/open/close + auto-sync subscriptions
+-- index.ts                   # Re-exports
+-- core/
|   +-- ProjectCoreService.ts       # FSA backend: create, open, save, backup, rename
|   +-- NativeProjectCoreService.ts # Native backend: same operations via WebSocket/HTTP
|   +-- FileStorageService.ts       # FSA file I/O primitives
|   +-- NativeFileStorageService.ts # Native file I/O primitives
|   +-- constants.ts                # Folder names, MAX_BACKUPS
+-- domains/
|   +-- RawMediaService.ts     # Raw folder + media import + downloads
|   +-- AnalysisService.ts     # Analysis file storage
|   +-- TranscriptService.ts   # Transcript file storage
|   +-- CacheService.ts        # Thumbnails + waveforms
|   +-- ProxyStorageService.ts # Proxy frames/video/audio
+-- types/
    +-- project.types.ts       # ProjectFile, ProjectSettings, ProjectUIState
    +-- media.types.ts         # ProjectMediaFile
    +-- composition.types.ts   # ProjectComposition, ProjectTrack, ProjectClip
    +-- timeline.types.ts      # ProjectTransform, ProjectEffect, ProjectMask, etc.
    +-- folder.types.ts        # ProjectFolder
```

### Related Services
| Service | File | Purpose |
|---------|------|---------|
| ProjectDB | `src/services/projectDB.ts` | IndexedDB for handles, media, proxies, analysis, thumbnails |
| FileSystemService | `src/services/fileSystemService.ts` | File picker, handle cache, permission management |
| NativeHelperClient | `src/services/nativeHelper/NativeHelperClient.ts` | WebSocket + HTTP client for Native Helper |

---

## Related Features

- [Media Panel](./Media-Panel.md) - Media management
- [Timeline](./Timeline.md) - Timeline data
- [Audio](./Audio.md) - Transcript persistence
- [UI Panels](./UI-Panels.md) - Layout saving

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`serialization.test.ts`](../../tests/unit/serialization.test.ts) | 86 | Serialize/deserialize, round-trip |
| [`historyStore.test.ts`](../../tests/stores/historyStore.test.ts) | 16 | Undo/redo |

Run tests: `npx vitest run`

---

*Source: `src/services/project/`, `src/services/projectDB.ts`, `src/services/fileSystemService.ts`, `src/stores/mediaStore/init.ts`, `src/components/common/Toolbar.tsx`, `src/components/common/WelcomeOverlay.tsx`*
