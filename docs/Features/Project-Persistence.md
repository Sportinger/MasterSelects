# Project Persistence

[← Back to Index](./README.md)

IndexedDB storage with auto-save and file handle persistence.

---

## Table of Contents

- [Auto-Save](#auto-save)
- [Backup System](#backup-system)
- [What Gets Saved](#what-gets-saved)
- [IndexedDB Structure](#indexeddb-structure)
- [File System Access](#file-system-access)
- [Project Management](#project-management)

---

## Auto-Save

### Autosave Configuration
Access via **File → Autosave** submenu:

| Setting | Options | Default |
|---------|---------|---------|
| Enable Autosave | On/Off | Off |
| Interval | 1, 2, 5, 10 minutes | 5 min |

### Automatic Triggers
- Configurable interval (1-10 minutes)
- On page unload (beforeunload)
- When switching compositions
- After transcription completes
- After analysis completes

### Manual Save
- `Ctrl+S` shortcut
- File menu → Save
- Shows yellow "Saved" toast in center of screen

### No Data Loss
- Changes saved immediately
- Survives page refresh
- Survives browser restart

---

## Backup System

### How It Works
Before each **autosave**, the current project file is automatically backed up:
1. Copy current `project.json` to `Backups/` folder
2. Name format: `project_2026-01-11_14-30-00.json`
3. Then save to main `project.json`

### Backup Storage
```
ProjectFolder/
├── project.json          # Current project
├── Backups/
│   ├── project_2026-01-11_14-00-00.json
│   ├── project_2026-01-11_14-05-00.json
│   └── ... (last 20 backups)
```

### Automatic Cleanup
- Keeps only the **last 20 backups**
- Oldest backups automatically deleted
- Sorted by file timestamp

### Restoring from Backup
1. Navigate to `ProjectFolder/Backups/`
2. Find backup by timestamp
3. Rename to `project.json`
4. Replace main `project.json`
5. Reopen project

---

## What Gets Saved

### Project Data
```typescript
interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  compositions: Composition[];
  folders: Folder[];
  mediaFileIds: string[];
  openTabs: string[];
  expandedFolders: string[];
}
```

### Per Composition
- All tracks and clips
- Clip positions and durations
- Trim points (inPoint/outPoint)
- Transform properties
- Keyframe animations
- Effect parameters
- Mask shapes

### Media Files
- File blobs stored in IndexedDB
- Metadata (duration, dimensions)
- Thumbnails
- Waveform data

### Analysis Data
- Focus analysis per frame
- Motion analysis
- Brightness data
- Cached in IndexedDB

### Transcripts
- Word-level timestamps
- Speaker identification
- Language settings

---

## IndexedDB Structure

### Database: MASterSelectsDB (v4)

| Store | Contents |
|-------|----------|
| `mediaFiles` | File blobs + metadata |
| `projects` | Project definitions |
| `proxyFrames` | Proxy frame data (WebP) |
| `fsHandles` | FileSystemHandles |
| `analysisCache` | Clip analysis data |

### Storage Flow
```
User Action → Zustand Store → IndexedDB
                    ↓
Page Reload → IndexedDB → Zustand Store
```

---

## File System Access

### Persistent File Handles
When using File System Access API:
```typescript
// Stored in fsHandles store
interface FSHandle {
  fileId: string;
  handle: FileSystemFileHandle;
}
```

### Benefits
- "Show in Explorer" works
- Re-access files without re-import
- Proxy folder persistence

### Proxy Folder
```typescript
pickProxyFolder()           // User selects folder
saveProxyFrame(id, index, blob) // Write frame
getProxyFolderName()        // Display name
```

---

## Project Management

### New Project
```typescript
newProject()
- Confirmation dialog
- Clears all media
- Creates default composition
```

### Save Project
```typescript
saveProject(name?)
- Serializes all state
- Writes to IndexedDB
- Updates timestamp
```

### Load Project
```typescript
loadProject(projectId)
- Reads from IndexedDB
- Reconstructs File objects
- Restores blob URLs
- Opens composition tabs
```

### Recent Projects
File menu shows up to 10 recent:
- Sorted by last modified
- Delete button on each
- Click to load

### Delete Project
```typescript
deleteProject(projectId)
- Removes from IndexedDB
- Cleans up media files
```

---

## Layout Persistence

### Dock Layout
Separate from project data:
- Panel positions
- Tab arrangements
- Panel sizes
- Stored in localStorage

### Actions
```typescript
saveLayoutAsDefault()  // View menu
resetLayout()          // View menu
```

---

## Timeline Sync

### Composition ↔ Timeline
```typescript
// On composition switch
1. Save current timeline to composition.timelineData
2. Load new composition's timelineData
3. Restore tracks, clips, keyframes
```

### Auto-Sync Points
- Switching compositions
- Saving project
- Before page unload
- Every 30 seconds

---

## Data Migration

### Version Handling
```typescript
// projectDB.ts
const DB_VERSION = 4;

// Migration on upgrade
if (oldVersion < 4) {
  // Add analysisCache store
}
```

---

## Troubleshooting

### Data Not Restoring
1. Check DevTools → Application → IndexedDB
2. Look for MASterSelectsDB
3. Verify stores exist

### Corrupted Data
```javascript
// Clear and start fresh
indexedDB.deleteDatabase('MASterSelectsDB');
```

### Missing Media
- Re-import files
- Media stored as blob
- Original file not needed after import

---

## Memory vs Storage

| Location | Contents |
|----------|----------|
| **Zustand (RAM)** | Active state, file references |
| **IndexedDB** | Persistent blobs, projects |
| **localStorage** | Dock layout, settings |
| **File System** | Proxy folder (optional) |

---

## Related Features

- [Media Panel](./Media-Panel.md) - Media management
- [Timeline](./Timeline.md) - Timeline data
- [Audio](./Audio.md) - Transcript persistence
- [UI Panels](./UI-Panels.md) - Layout saving

---

*Source: `src/services/projectDB.ts`, `src/services/fileSystemService.ts`, `src/stores/mediaStore.ts`*
