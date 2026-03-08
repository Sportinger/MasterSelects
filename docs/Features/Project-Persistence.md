# Project Persistence

[← Back to Index](./README.md)

Local project folder storage with auto-save, backups, and smart media relinking. Supports two backends: **File System Access API** (Chrome/Edge) and **Native Helper** (Firefox).

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
| Firefox | Detected as WebGPU-capable; uses **Native Helper** backend for persistence |
| Safari / other | **"Unsupported Browser"** warning with Chrome download link |

For Firefox users:
- The overlay checks if the Native Helper is running and connected
- If available, activates the native backend and shows "New Project" / "Open Existing" buttons (using the OS folder picker via Native Helper)
- If unavailable or outdated, shows a message: "Project saving requires the Native Helper in Firefox. Install it for full project support, or use Chrome/Edge."

### Select Project Folder
1. Click **"New Project"**
2. Choose or create a folder for your project
3. App creates an `Untitled` subfolder with `project.json` and required subfolders
4. Folder handle stored in IndexedDB (FSA) or path stored in localStorage (Native) for future sessions

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
- File I/O via `NativeHelperClient.writeFile()` / `readFileText()` / `writeFileBinary()`
- Last project path stored in `localStorage` key `ms-native-last-project-path`
- No permission prompts needed -- the Native Helper has full filesystem access
- Project listing: `NativeProjectCoreService.listProjects()` scans the project root for directories containing `project.json`

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
+-- .keys.enc              # Encrypted API keys (auto-saved with project)
+-- Raw/                   # Auto-copied media files (portable)
|   +-- Interview_01.mp4
|   +-- Music.wav
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
- Original files remain untouched at their source location
- If a file with the same name and size already exists, reuses the existing copy
- If a file with the same name but different size exists, adds a numeric suffix
- Project becomes portable -- copy the folder to another machine

### Auto-Relink from Raw Folder
When opening a project with missing media files:
- App automatically scans the `Raw/` folder for matching files
- Matches by **exact filename** (case-insensitive)
- Files are restored from Raw without user intervention
- Also attempts to restore from stored file handles in IndexedDB
- Includes retry logic for handles that may not be immediately ready

### Benefits of Local Storage
- **No browser storage limits** -- use as much disk space as needed
- **Portable projects** -- copy folder (including Raw/) to move between machines
- **External backup** -- use any backup tool on the folder
- **Version control** -- can use Git for project history

---

## Auto-Save

### How Auto-Save Works
There are two layers of auto-save:

1. **Configurable autosave** (Toolbar): Managed in the `Toolbar.tsx` component via `setInterval`. When triggered on a dirty project, it first creates a backup, then saves.
2. **Internal dirty-check** (ProjectCoreService): A 30-second `setInterval` that saves if the project is marked dirty. This runs automatically when a project is opened/created.

### Autosave Configuration
Access via **File -> Autosave** submenu:

| Setting | Options | Default |
|---------|---------|---------|
| Enable Autosave | On/Off | **On** |
| Interval | 1, 2, 5, 10 minutes | 5 min |

Settings persisted in `settingsStore` (localStorage).

### Automatic Dirty Marking
The `setupAutoSync()` function (in `projectLifecycle.ts`) subscribes to store changes and marks the project dirty when:
- Media files, compositions, or folders change (mediaStore)
- Clips or tracks change (timelineStore)
- YouTube panel state changes
- Dock layout changes

### Manual Save
- `Ctrl+S` shortcut
- File menu -> Save
- Shows yellow "Saved" toast in center of screen
- Syncs all store state to project data, then writes `project.json`

### On Page Unload
The `beforeunload` handler saves the current timeline state to the active composition in memory and disposes audio resources. It does **not** write to disk (since async writes are unreliable during unload).

---

## Backup System

### How It Works
Before each **configurable autosave** (from the File menu interval), the current project file is automatically backed up:
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
5. Also checks stored IndexedDB handles for files not found in Raw

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
- Transcript and analysis data per clip
- Scene description data

### Media Metadata
- File paths (relative to source folder)
- Duration, dimensions, FPS
- Codec, audio codec, container info
- Bitrate and file size
- hasAudio flag
- Proxy status
- Folder organization (folderId)

### UI State (saved per project)
- Dock/panel layout
- Composition view state per composition (playhead, zoom, scroll, in/out points)
- Media panel column order and name width
- Transcript language preference
- View toggles: thumbnails, waveforms, proxy, transcript markers

### Stored in Project Folder
| Location | Contents |
|----------|----------|
| `project.json` | Main project data |
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
- **Native**: Reads path from `localStorage` key `ms-native-last-project-path`
- If permission is needed, shows a "Grant Access" prompt
- If project folder no longer exists, attempts to recreate an "Untitled" project in the parent folder

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
saveLayoutAsDefault()  // View menu
resetLayout()          // View menu
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
| **localStorage** | App settings, autosave config, dock layout (fallback), Native Helper last project path | ~5MB |

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
