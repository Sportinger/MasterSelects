# Timeline

[← Back to Index](./README.md)

The Timeline is the core editing interface, providing multi-track video and audio editing with composition support.

---

## Table of Contents

- [Track Types](#track-types)
- [Clips](#clips)
- [Snapping & Resistance](#snapping--resistance)
- [Selection](#selection)
- [Compositions](#compositions)
- [Multicam Support](#multicam-support)
- [Track Controls](#track-controls)

---

## Track Types

### Video Tracks
- Support video files, images, and nested compositions
- Stack from top to bottom (top track = front layer)
- Expandable to show keyframe properties
- Default: 2 video tracks

### Audio Tracks
- Audio-only tracks at bottom of timeline
- Waveform visualization (50 samples/second)
- Linked audio follows video clip movement
- Default: 1 audio track

### Track Management
```
addTrack()           - Create video/audio track
removeTrack()        - Delete track
renameTrack()        - Change track name (double-click)
setTrackHeight()     - Resize track
scaleTracksOfType()  - Batch height adjustment
```

---

## Clips

### Adding Clips
1. Drag from Media Panel to timeline
2. Shows dashed preview with actual duration during drag
3. Thumbnails generated in background (skipped for >500MB)

### Clip Operations

| Action | Method | Notes |
|--------|--------|-------|
| **Move** | Drag clip | Supports snapping + resistance |
| **Trim** | Drag edges | Left/right trim handles |
| **Split** | `C` key | Splits all clips at playhead |
| **Delete** | `Delete` key | Removes selected clips |
| **Reverse** | Context menu | Shows ↻ badge |

### Clip Properties (Keyframeable)
- Position (X, Y, Z depth)
- Scale (X, Y)
- Rotation (X, Y, Z) - full 3D with perspective
- Opacity (0-100%)

### Linked Clips
- Video clips can have linked audio
- Alt+drag to move independently
- Split together with `C` key
- Visual indicator: linked clips move together

---

## Snapping & Resistance

### Magnetic Snapping
- **Snap distance**: 0.1 seconds
- **Snap points**: Clip edges, timeline start (0s)
- Automatic edge-to-edge alignment

### Overlap Resistance
When dragging clips over others:
- **100 pixel resistance** must be pushed through
- Visual `.forcing-overlap` feedback
- Auto-trims overlapped clips when forced

### Implementation
```typescript
getSnappedPosition()      - Calculate snap-adjusted position
getPositionWithResistance() - Snap + resistance calculation
trimOverlappingClips()    - Auto-trim when placing
```

---

## Selection

### Clip Selection
| Action | Effect |
|--------|--------|
| Click | Select single clip |
| Ctrl+Click | Add/remove from selection |
| Click empty | Deselect all |
| Escape | Deselect all |

### Marquee Selection
- Click and drag on empty timeline area
- Rectangle selects all clips it touches
- Shift+marquee extends/subtracts selection
- Live visual feedback during drag

### Keyframe Selection
- Click keyframe diamond to select
- Shift+click for multi-select
- `Delete` removes selected keyframes (priority over clips)
- See [Keyframes](./Keyframes.md) for details

---

## Compositions

### Creating Compositions
1. Media Panel → Add → Composition
2. Set name, resolution, frame rate
3. Composition appears in Media Panel

### Composition Settings
- **Resolution**: Up to 7680×4320 (8K)
- **Frame rates**: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60 fps
- **Duration**: Editable in timeline controls

### Nested Compositions
- Drag composition from Media Panel to Timeline
- Double-click to enter and edit contents
- Changes reflect in parent composition
- Recursive rendering for deep nesting

### Composition Tabs
- Open compositions appear as tabs
- Click to switch between compositions
- Drag tabs to reorder
- Each composition has independent timeline data

---

## Multicam Support

### Linked Groups
Multiple clips can be grouped for synchronized movement:

```typescript
createLinkedGroup()  - Group clips with offsets
unlinkGroup()        - Remove group relationship
```

### Group Behavior
- All clips in group move together
- Alt+drag to skip group movement
- Visual indicator: ⊝ badge
- Stored offsets maintain sync timing

### Audio Sync
See [Audio](./Audio.md#multicam-sync) for cross-correlation sync.

---

## Track Controls

Each track header contains:

| Control | Function |
|---------|----------|
| **Eye** (👁) | Toggle track visibility |
| **M** | Mute track audio |
| **S** | Solo this track |
| **Name** | Double-click to edit |
| **Expand** (▶) | Show keyframe lanes |

### Solo Behavior
- Dims non-solo tracks visually
- Multiple tracks can be solo'd
- Quick way to isolate content

### Track Height
- Drag track dividers to resize
- Expanded tracks show property rows
- Height auto-adjusts for curve editors

---

## Playback Controls

Located in timeline toolbar:

| Control | Shortcut | Function |
|---------|----------|----------|
| Stop | - | Return to time 0 |
| Play/Pause | `Space` | Toggle playback |
| Loop | `L` | Toggle loop mode |
| In Point | `I` | Set at playhead |
| Out Point | `O` | Set at playhead |
| Clear I/O | `X` | Clear markers |

### Duration Editing
- Click duration display to edit
- Enter new duration, press Enter
- Locks duration (won't auto-extend)

---

## Performance Features

### Thumbnails
- Auto-generated for video clips
- Toggle: "Thumb On/Off" button
- Skipped for files >500MB

### Waveforms
- Generated for audio clips
- Toggle: "Wave On/Off" button
- 50 samples per second resolution

### RAM Preview
- Toggle: "RAM ON/OFF" button
- Caches 30fps frames
- Green indicator shows cached ranges
- See [Preview](./Preview.md#ram-preview)

---

## Related Features

- [Keyframes](./Keyframes.md) - Animate clip properties
- [Preview](./Preview.md) - Playback and RAM Preview
- [Audio](./Audio.md) - Audio tracks and multicam sync
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

*Source: `src/components/timeline/`, `src/stores/timeline/`*
