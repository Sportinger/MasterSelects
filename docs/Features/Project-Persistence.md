# Project Persistence

[← Back to Index](./README.md)

Local project storage with manual saving and interval autosave (five minutes by default), backups, and media relinking. Projects can use a user-selected folder through the **File System Access API**, **browser storage (OPFS)**, or the **Native Helper**.

---

## Table of Contents

- [Choose Project](#choose-project)
- [Storage Backends](#storage-backends)
- [Recent Projects](#recent-projects)
- [Project Folder Structure](#project-folder-structure)
- [Auto-Save](#auto-save)
- [Save Status](#save-status)
- [Backup System](#backup-system)
- [Media Relinking](#media-relinking)
- [What Gets Saved](#what-gets-saved)
- [Project Management](#project-management)

---

## Choose Project

The **Choose project** dialog offers **New project** (Empty timeline), **Open existing**, and remembered recent projects.

### Create a Project

1. Select **New project**.
2. Enter a **Project name** and select **Continue**.
3. Choose the parent folder when a system picker is available. Browser-storage projects are created directly in OPFS.
4. The app creates the named project folder, its `.msproj` package, and companion folders, then opens the editor.

Invalid names and creation failures remain visible in the dialog. Cancelling the name form returns to the chooser; cancelling folder selection keeps the entered name available for another attempt.

### Open a Project

- With browser folder pickers, **Open existing** opens a project-folder picker.
- Without those pickers, it shows projects **Stored on this device** in browser storage. Select a project name to open it.
- Recent-project cards reopen their remembered location and may require folder permission again.
- Storage access and listing failures appear as errors. An empty stored-project list is reported separately.

*Source: `src/components/common/EditorProjectSelectionOverlay.tsx`*

---

## Storage Backends

Storage is selected from available capabilities. Browser folder pickers use FSA. Without them, project creation and restoration try the connected Native Helper and fall back to OPFS when the helper is unavailable.

### FSA Backend
- Uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- `showDirectoryPicker()` for folder selection
- `FileSystemDirectoryHandle` + `FileSystemFileHandle` for all I/O
- Handles stored in IndexedDB (`fsHandles` store) for session persistence
- Requests persistent browser storage before caching project handles in IndexedDB, reducing the risk that the browser evicts recent-project links under storage pressure
- Permission re-requested on page reload if needed

### Browser Storage (OPFS)

- Uses the origin-private filesystem through `navigator.storage.getDirectory()` without a system folder picker
- Stores named project folders within this browser profile and site origin
- Uses the same project package and file-storage code as the FSA backend
- Requires `FileSystemFileHandle.createWritable()` to create or save projects; the chooser reports missing write support
- Remembers the project folder name and reacquires its handle from the OPFS root when reopening; OPFS restoration does not depend on cloning directory handles into IndexedDB
- Requests persistent browser storage, but access remains subject to browser quota, eviction, and clearing site data
- Retries a transient OPFS root acquisition failure once before reporting it; permission and quota errors remain failures

Project database operations reopen a cached IndexedDB connection if it starts closing before its close event arrives. Recovery is limited to one replacement connection and only runs when a new transaction cannot start. Saving still waits for transaction commit; aborted writes, quota failures and schema errors are not replayed.

Persistent-storage permission applies to the browser origin, covering both OPFS and IndexedDB. It does not prevent users or browser settings from clearing site data; FSA project files remain in their selected filesystem folders, but cleared IndexedDB handles must be selected again.

### Native Helper Backend
- Uses a local Rust helper (`tools/native-helper`) communicating via WebSocket (port 9876) and HTTP (port 9877)
- OS folder picker via `NativeHelperClient.pickFolder()`
- Manual project path fallback via `ProjectFileService` when the helper reports that no native picker is available
- User-picked project paths are granted to the helper at runtime, so external drives and non-default project folders remain readable through both WebSocket and HTTP file routes
- File I/O via `NativeHelperClient.writeFile()` / `readFileText()` / `writeFileBinary()` plus `createDir()`, `deleteFile()`, `rename()`, `exists()`, `listDir()`, and `pickFolder()`
- Project files are written through the helper's path-based storage layer; the browser never needs a `FileSystemDirectoryHandle`
- Last project path stored in `localStorage` key `ms-native-last-project-path`
- Uses the helper's granted project paths instead of browser FSA permission prompts
- Project listing: `NativeProjectCoreService.listProjects()` scans the project root for directories containing `project.json`
- The default project root comes from the helper (`Documents/MasterSelects` when available, otherwise `Home/MasterSelects`, or `MASTERSELECTS_PROJECT_ROOT` when set to an absolute path)
- When the helper is available, `ProjectFileService.restoreLastProject()` activates the Native backend before restoring its remembered project

### Backend Switching
The `ProjectFileService` facade routes calls to the browser or Native Helper backend:

- `projectFileService.activeBackend` -- returns `'fsa'` for the browser core (including OPFS), or `'native'`
- `projectFileService.activateNativeBackend()` -- switches to Native Helper
- `projectFileService.activateFsaBackend()` -- switches back to the browser core
- `resolveProjectRootMode()` -- distinguishes browser folder pickers (`'fsa'`), browser storage (`'opfs'`), and unavailable storage (`'none'`)

*Source: `src/services/project/ProjectFileService.ts`, `src/services/project/core/projectRootAccess.ts`*

---

## Recent Projects

Recent projects are tracked in browser storage and exposed through **File -> Open Recent**.

- Opening, creating, or renaming a project updates the recent-project list.
- FSA projects store browser `FileSystemDirectoryHandle` references in IndexedDB and keep lightweight metadata in `localStorage`.
- OPFS projects remember their folder name and reopen it from the browser's private filesystem.
- Native Helper projects store normalized project paths in `localStorage`.
- Selecting an FSA recent project re-requests read/write permission if the browser has dropped it.
- Missing or unreadable recent entries are removed when opening them fails.
- The list is capped at 12 entries and can be cleared from the Open Recent flyout.

Implementation:
- `src/services/project/recentProjects.ts` stores and normalizes recent metadata.
- `ProjectFileService.openRecentProject()` routes a selected entry to its FSA, OPFS, or Native location.
- `Toolbar.tsx` renders the File menu flyout and listens for recent-project updates.

---

## Project Folder Structure

Projects are stored in a local folder you choose:

```
MyProject/
+-- project.json           # Main project file
+-- project.autosave.json  # Fallback when browser FSA cannot update project.json
+-- .keys.enc              # Encrypted API keys (auto-saved with project)
+-- Raw/                   # Auto-copied media files (portable)
+-- Raw/Baked Audio/       # Baked audio media
|   +-- Interview_01.mp4
|   +-- Music.wav
|   +-- hero/              # Imported GLB sequence frames
|   |   +-- hero000000.glb
|   |   +-- hero000001.glb
|   +-- scan/              # Imported PLY/splat sequence frames
|   |   +-- scan000000.ply
|   |   +-- scan000001.ply
+-- Downloads/             # FSA download copies (platform subfolders)
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
+-- Proxy/                 # Generated proxy video frame folders and proxy media
+-- Audio Proxies/         # Current WAV audio proxy files
+-- Cache/                 # Cached derived data
|   +-- thumbnails/        # Media thumbnails (WebP, keyed by file hash)
|   +-- face-thumbnails/   # Cached face thumbnails
|   +-- splats/            # Cached Gaussian splat runtimes
|   +-- waveforms/         # Waveform data (Float32Array binary)
|   +-- artifacts/         # Signal IR artifacts, sharded by SHA-256 hash
+-- Analysis/              # Clip analysis data (per media file)
+-- Transcripts/           # Transcript data (per media file)
+-- Renders/               # Exported renders
+-- Prompts/               # Project prompt files
+-- AI/Chat/               # FlashBoard chat journal files
```

Folder constants defined in `src/services/project/core/constants.ts`:

```typescript
const PROJECT_FOLDERS = {
  RAW: 'Raw',
  RAW_BAKED_AUDIO: 'Raw/Baked Audio',
  PROXY: 'Proxy',
  AUDIO_PROXIES: 'Audio Proxies',
  ANALYSIS: 'Analysis',
  TRANSCRIPTS: 'Transcripts',
  CACHE: 'Cache',
  CACHE_THUMBNAILS: 'Cache/thumbnails',
  CACHE_FACE_THUMBNAILS: 'Cache/face-thumbnails',
  CACHE_SPLATS: 'Cache/splats',
  CACHE_ARTIFACTS: 'Cache/artifacts',
  CACHE_WAVEFORMS: 'Cache/waveforms',
  RENDERS: 'Renders',
  BACKUPS: 'Backups',
  DOWNLOADS: 'Downloads',
  PROMPTS: 'Prompts',
  AI_CHAT: 'AI/Chat',
};
```

### Signal Artifacts
Universal Signal IR imports persist metadata in `project.json` under `signals`. When a File System Access project is open, artifact bytes are stored content-addressed under `Cache/artifacts/sha256/<shard>/<hash>/` with a `manifest.json` and `artifact.bin`. IndexedDB keeps a manifest index for fast lookup/source-ref queries and also provides a content-addressed `artifactBlobs` fallback when no project folder is available.

### Auto-Copy to Raw Folder
When importing media files (controlled by `copyMediaToProject` setting):
- Automatic copying is **disabled by default**; imports keep using their selected source location unless the user enables the setting
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
There are two save modes:

1. **Interval save** (default): save changed projects at the configured interval, five minutes by default. The timer defers while imports or editing gestures are active.
2. **Manual save**: only an explicit Save command writes the project. Individual edits update the unsaved status without triggering a save.

Legacy continuous-save preferences migrate to interval or manual mode. Loading an unchanged project does not start a save. Project writes are serialized; edits made during a write remain dirty until included in a later successful save.

Large terrain geometry and linked artifacts are persisted separately and reused when unchanged. A save still writes the project metadata snapshot; it does not rewrite every mesh or audio artifact for a small keyframe edit. Restore and history snapshots share retained geometry rather than cloning the full mesh for each clip.

Packaged artifact batches report persistence failures to their caller. If both
processing and saving fail, both errors are retained. Media-panel imports show
these failures to the user; cancelling a file picker remains silent.

### Autosave Configuration
Access **Settings -> General**, or **File -> Autosave** for timer controls:

| Setting | Options | Default |
|---------|---------|---------|
| Save Mode | Manual, Interval | Interval |
| Enable Autosave | On/Off | On |
| Interval | 1, 2, 5, 10 minutes | 5 min |

Settings persist in `settingsStore` (localStorage).

### Automatic Dirty Marking
The `setupAutoSync()` function (in `projectLifecycle.ts`) subscribes to store changes and marks the project dirty when:
- Media files, compositions, or folders change (mediaStore)
- Clips or tracks change (timelineStore)
- MIDI state changes
- FlashBoard workspace and chat state changes
- Storyboard state changes
- Dock layout changes
- Export settings or export presets change

### Manual Save
- `Ctrl+S` shortcut
- File menu -> Save
- Shows yellow "Saved" toast in center of screen
- Syncs all store state to project data, then writes `project.json`

### On Page Unload
Unsaved edits retain the browser leave-page warning. Save explicitly before closing when you want to retain them; unloading does not reintroduce continuous saving.

The active composition and clip selection (including the focused Properties clip) are remembered in tab-local session storage and restored after a refresh. Selection recovery needs no explicit Save, does not dirty the project, and only selects clips still present in the loaded project. It does not save unsaved timeline edits.

---

## Save Status

The toolbar shows an uncreated project, unsaved changes, an active write, a failed save, or the last successful save time for the current session. Failures remain visible until a successful retry; clicking the status invokes Save. Newly edited state remains unsaved even when an earlier in-flight write succeeds.

Local development builds do not display the browser's unsaved-work confirmation
on reload, including Vite refreshes. This does not trigger a save or change the
configured save mode. Production builds retain the unsaved-work confirmation.

Status is runtime-only and scoped to the FSA handle or native project path, not persisted in project data. Manual FSA saves request read/write permission directly from the user gesture before serialization. Failed writes and recovery-protected skipped writes do not show a success toast or advance the saved timestamp. Recovery protection leaves the recoverable autosave untouched.

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

Imported files also persist a privacy-safe source reference in `project.json`: a generated source-root ID plus the file's relative path inside that root. The browser's directory handle itself remains in IndexedDB because browser security does not allow serializing an absolute filesystem path or a live handle into JSON. If browser storage was cleared, the relink dialog or **Preferences > Import > Connect source folder** lets the user choose that root again; all matching media are then reconnected recursively from their stored relative paths.

- Chromium desktop and Android use a persistent File System Access directory handle when available.
- Safari on iPhone and iPad uses the folder-upload fallback (`webkitdirectory`) and reconnects the current session from the selected directory tree.
- No absolute local path is written to the project file.

Manual relink uses the same filename matching for normal media and sequence frames. For renamed single files, selecting one file directly assigns it to the clicked missing item.

### Relink Button
In Media Panel toolbar:
- Click `Relink (n)` when one or more media files need attention
- Opens the relink dialog for restoring access or selecting replacement media
- Opening a missing item directly can also invoke its reload path

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
  mediaSourceRoots?: Array<{
    id: string;
    name: string;
  }>;
  signals?: ProjectSignalState;
  audio?: ProjectAudioState;
  uiState?: ProjectUIState;
  flashboard?: ProjectFlashBoardState;
  storyboard?: StoryboardProjectState;
}
```

### Per Composition
- All tracks and clips
- Timeline markers and per-marker MIDI bindings
- Composition annotations (`annotations`: timed notes, optionally linked to a clip; media files carry their own `sourceAnnotations`, see [Annotations](./Annotations.md))
- Clip positions and durations
- Trim points (inPoint/outPoint)
- Transform properties (position, independent `scaleAll`/axis scale, rotation, anchor, opacity, blend mode)
- Keyframe animations
- Effect parameters
- Mask shapes (vertices, mode, feather, opacity)
- Audio settings (volume, audioEnabled)
- Speed/reverse/disabled flags
- Nested composition references, using the child composition's full source duration when restoring trimmed or split clips
- Text clip properties
- Solid clip color
- Vector animation settings (loop, end behavior, fit, animation selection, background)
- Motion design definitions for shape/null/adjustment clips
- Transcript and analysis data per clip
- Scene description data

### Media Metadata
- Source-root ID and file path relative to that source folder
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
- Legacy changelog preference fields (`showChangelogOnStartup`, `lastSeenChangelogVersion`) remain readable for project compatibility but no longer drive any UI.
- Export panel state: live export settings, named export presets, and the selected preset
- Media-panel view mode and board viewport/layout state
- Serialized undo/redo history

Temporary camera `NO KF` live offsets are intentionally not saved. They only affect the current preview session while the stored camera keyframes remain the project source of truth.

### Other Persisted Project State
- FlashBoard workspace state is saved in `project.json` when present; its chat journal is also mirrored as `AI/Chat/history.json` with an `history.autosave.json` fallback.
- Storyboard plans, scenes, candidates, decisions, variants, and templates are saved in `project.json`.
- Generated text, solid, mesh, camera, light, splat-effector, math-scene, and motion-shape items are saved in `project.json`.

### Stored in Project Folder
| Location | Contents |
|----------|----------|
| `project.json` | Main project data |
| `project.autosave.json` | FSA fallback copy used when `project.json` cannot be updated directly |
| `.keys.enc` | Encrypted API keys |
| `Backups/` | Auto-backup files |
| `Raw/` | Copied media files |
| `Downloads/` | Downloaded videos (per platform) for File System Access projects; Native Helper projects import completed downloads through `Raw/` |
| `Proxy/` | Proxy video frame folders and proxy media |
| `Audio Proxies/` | Current WAV audio proxy files |
| `Cache/thumbnails/` | Media thumbnails (WebP) |
| `Cache/waveforms/` | Waveform data |
| `Cache/artifacts/` | Signal artifact files |
| `Analysis/` | Clip analysis cache |
| `Transcripts/` | Transcript data |
| `Renders/` | Exported renders |
| `Prompts/` | Project prompt files |
| `AI/Chat/` | FlashBoard chat journal and fallback journal |

---

## Project Management

### New Project
- File menu -> New Project (`Ctrl+N`)
- Opens the in-app project setup dialog; spaces are supported and invalid filesystem characters are reported inline
- Keeps the dialog open with the entered name when folder selection or project creation fails
- Shows the unsaved-work warning inside the dialog instead of a browser-native confirmation
- Opens a folder picker (FSA or Native Helper), or creates directly in browser storage (OPFS)
- Creates a project subfolder with its `.msproj` package and required companion folders
- Clears the previous project's tracking assets and selection before resetting media and writing the first blank-project snapshot. Large terrain reconstructions are not copied into the new project.
- Cancelling folder selection leaves the current tracking data intact; Save and Save As preserve it as part of the current edit.

### Save Project
- `Ctrl+S` saves to project folder
- Shows yellow "Saved" toast
- Syncs all stores to project format, then writes `project.json`
- Also updates `.keys.enc` with current API keys

### Save As
- File menu -> Save As (`Ctrl+Shift+S`)
- Reuses the in-app project-name dialog instead of a browser-native prompt
- Creates a new project in the same parent folder
- Current state synced to the new project

### Open Existing Project
- From **Choose project**: **Open existing**
- Or File menu -> Open Project (`Ctrl+O`)
- Select a project folder containing a `.msproj` package or legacy `project.json`; the chooser lists stored project names when browser folder pickers are unavailable

### Open Recent
- File menu -> Open Recent
- Shows projects remembered by the browser
- FSA entries reuse stored IndexedDB handles and may ask for folder permission again
- Native Helper entries reopen by stored path
- The flyout includes "Clear Recent Projects" for clearing the browser-side list

### Rename Project
- File menu -> Rename Project
- Reuses the in-app project-name dialog used by New Project and Save As
- Validates name (no special characters `<>:"/\|?*`)
- If parent folder handle has write permission, renames the folder on disk
- Otherwise, updates only the display name in `project.json`

### Restore Last Project
On app load, attempts to restore the last opened project:
- Restores the saved project name into editor state, including the Color workspace header and bridge session metadata. Opening another project replaces the previous name.
- **FSA**: Retrieves `lastProject` handle from IndexedDB, checks permission
- **OPFS**: Reopens the remembered project folder name from browser storage. Older projects can fall back to a recent name or a single stored project when the choice is unambiguous.
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
saveNamedLayout()          // View -> Layouts; stores dock layout, timeline focus, track slots, heights, and visibility
saveCurrentNamedLayout()   // View -> Layouts; overwrites the active named layout
loadSavedLayout()          // View -> Layouts; restores layout with a 500ms dock transition
setDefaultSavedLayout()    // View -> Layouts
toggleFavoriteSavedLayout()// View -> Layouts, center header quick switcher
saveLayoutAsDefault()      // View -> Layouts; stores dock layout, timeline focus, track slots, heights, and visibility
resetLayout()              // View -> Layouts
```

The hardcoded factory layouts are `VIDEO EDIT`, `AUDIO EDIT`, and `3D EDIT`. `VIDEO EDIT` is the default
layout with Media on the left, Preview in the center, Properties/Export/History on the right
with Export active, and Timeline at the bottom. It stores balanced timeline focus with two
visible 70 px video tracks and one visible 48 px compact audio track, and first empty loads
mark it as the active named layout. `AUDIO EDIT` stores audio focus with Timeline above
Media, Audio Mixer, and Properties/History, using two visible 40 px video context tracks and
one visible 96 px audio track. Saved layouts keep per-type track slot counts, per-slot height
and visibility, and per-track-id height/visibility for exact project restores. Loading
a layout creates missing tracks to satisfy the saved slot count, but it does not delete extra
existing tracks because that could remove clips.

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
1. Click `Relink (n)` in the Media Panel
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
| **IndexedDB** | File handles, recent FSA project handles, media metadata, proxy frames, analysis cache, thumbnails, Signal artifact manifests and fallback blobs | Browser quota |
| **localStorage** | App settings, autosave config, named/default dock layouts, dock layout fallback, recent project metadata, Native Helper project paths | ~5MB |

---

## Architecture

### Service Structure
```
src/services/project/
+-- ProjectFileService.ts      # Facade -- routes to FSA or Native backend
+-- recentProjects.ts         # Browser-side recent project registry
+-- projectSave.ts             # Store -> project format conversion + save
+-- projectLoad.ts             # Project format -> store conversion + load
+-- projectLifecycle.ts        # Create/open/close + auto-sync subscriptions
+-- flashBoardChatProjectJournal.ts # Mirrored FlashBoard chat journal
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
| RecentProjects | `src/services/project/recentProjects.ts` | Recent project metadata plus FSA handle keys |
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
| [`serialization.test.ts`](../../tests/unit/serialization.test.ts) | Multiple | Serialize/deserialize, round-trip |
| [`historyStore.test.ts`](../../tests/stores/historyStore.test.ts) | Multiple | Undo/redo and project-history persistence |

Run tests: `npx vitest run`

---

*Source: `src/services/project/`, `src/services/projectDB.ts`, `src/services/fileSystemService.ts`, `src/stores/mediaStore/init.ts`, `src/components/common/Toolbar.tsx`, `src/components/common/EditorProjectSelectionOverlay.tsx`*

## Dense terrain and save responsiveness

Continuous saving waits for pointer/native drag gestures to finish and for a 1.5-second quiet period. Further edits reset that delay. Explicit saves remain available; pending writes are serialized and redundant queued requests are coalesced without dropping edits made during an active write.

Dense terrain meshes are immutable and shared across serialization, clipboard, and undo snapshots. History comparisons use runtime geometry identity rather than stringifying every coordinate. FSA projects store compressed meshes once under `<Project> Media/Geometry/terrain/`, and `manifest.json` declares `terrainStorage: linked-media-v1`. The media folder must travel with the project. New geometry is fully written before publishing references; legacy inline and package-embedded meshes still load. The Native Helper can read linked geometry and emits embedded geometry when writing a package.

Ordinary saves reuse these files, serialize compact project metadata, and batch ZIP output into 1 MiB FSA writes. Identical artifact sidecars, already-published analysis pointers, and unchanged chat journals do not trigger timestamp-only package rewrites. Failed sidecar writes remain retryable. For packaged projects, journal updates stage entries in memory and mark the project dirty; a successful journal update alone does not mean a disk save. Manual or timed project saves write the package, and failed saves retain the dirty state and staged journal for retry. Legacy folder journals write their separate files directly.

### IndexedDB write acknowledgement and connection recovery

Browser database writes are acknowledged only after their transaction commits. A transaction aborted after a successful request still rejects the save, including aborts without an error object. Batch cache and artifact writes use the same completion handling. Closed or version-changing database connections are discarded and reopened on the next access; this does not grant revoked filesystem permissions or recover storage removed by the browser.

Project creation treats remembering the selected parent folder in IndexedDB as optional. If that cache is unavailable, it still writes the project to the selected filesystem folder; reopening through remembered locations may require selecting the folder again. Actual project-file write failures still fail creation.


### Database-open recovery

Project database initialization shares a single attempt among concurrent callers.
An AbortError receives one immediate retry. If opening still fails, the original
error is retained and new accesses are throttled for five seconds; a later access
can reopen storage without reloading the editor. Synchronous browser denial is
reported through the same failure state. No database is deleted during recovery.
The storage-error dialog does not assume corruption or recommend clearing site
data, which may contain browser-stored projects. It asks users to protect their
work before refreshing.


Database-open callbacks validate the browser's database result and upgrade
transaction. A missing result or migration exception rejects initialization
explicitly, aborts any partial upgrade and closes a late connection. Project
storage and the YouTube credential database share this open lifecycle while
retaining their separate schemas. Errors include the affected database name;
this prevents a global callback crash or an indefinitely pending caller, but
cannot restore storage that the browser itself refuses to provide.


### Package file acquisition recovery

Before streaming a `.msproj` archive, stale file-state errors and swap-file
creation aborts receive up to three writable-acquisition attempts, with 150/300ms
backoff and a newly requested file handle each time. Permission, quota and other
errors fail immediately. Once streaming starts, any failure aborts the writable
without automatically replaying the write. Save diagnostics record the failing
phase to distinguish opening, artifact persistence, streaming and closing.


### Read-only browser file-storage capability

Opening the browser's private filesystem does not prove that it can save
projects. Before creating a project in OPFS, the editor checks for the
FileSystemFileHandle writable-stream API. If it is missing, creation stops
before directory/file creation and the project chooser explains that the
browser needs updating. Existing project discovery remains available. The package writer also guards
legacy migration before any sidecar or package file is created. Native
Helper creation still follows its separate backend. This is a capability
check, not an in-place writer fallback that would weaken atomic save behavior.

### Browser project-list access failures

Opening the browser-stored project list distinguishes an empty root from denied access or failed directory enumeration. Access/listing failures reach the chooser error state instead of claiming that no projects exist; the user can retry after storage access is restored. Cancelling a system folder picker remains a cancellation. This does not bypass browser storage restrictions or recover files the browser has removed.
