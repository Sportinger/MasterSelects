# Project Persistence

[← Back to Index](./README.md)

IndexedDB storage with auto-save and file handle persistence.

---

## Table of Contents

- [Auto-Save](#auto-save)
- [What Gets Saved](#what-gets-saved)
- [IndexedDB Structure](#indexeddb-structure)
- [File System Access](#file-system-access)
- [Project Management](#project-management)

---

## Auto-Save

### Automatic Triggers
- Every 30 seconds
- On page unload (beforeunload)
- When switching compositions
- After transcription completes
- After analysis completes

### Manual Save
- `Ctrl+S` shortcut
- File menu → Save

### No Data Loss
- Changes saved immediately
- Survives page refresh
- Survives browser restart

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
