# Timeline

[← Back to Index](./README.md)

The Timeline is the core editing interface, providing multi-track video and audio editing with composition support.

---

## Table of Contents

- [Track Types](#track-types)
- [Clip Types](#clip-types)
- [Clip Operations](#clip-operations)
- [Snapping & Resistance](#snapping--resistance)
- [Selection](#selection)
- [Compositions](#compositions)
- [Transitions](#transitions)
- [Multicam Support](#multicam-support)
- [Clip Parenting (Pick Whip)](#clip-parenting-pick-whip)
- [Track Controls](#track-controls)
- [Playback Controls](#playback-controls)
- [Context Menus](#context-menus)
- [Performance Features](#performance-features)
- [SlotGrid View](#slotgrid-view)
- [Store Architecture](#store-architecture)
- [Component Structure](#component-structure)

---

## Track Types

### Video Tracks
- Support video files, images, text clips, solid clips, and nested compositions
- Stack from top to bottom (top track = front layer)
- Expandable to show keyframe properties
- Default: 2 video tracks (`Video 2` at top, `Video 1` below)

### Audio Tracks
- Audio-only tracks at bottom of timeline
- Waveform visualization (50 samples/second)
- Linked audio follows video clip movement
- Default: 1 audio track

### Track Management
```
addTrack()           - Create video/audio track (video added at top, audio at bottom)
removeTrack()        - Delete track (and all clips on it)
renameTrack()        - Change track name (double-click)
setTrackHeight()     - Resize track (min 20px, max 200px)
scaleTracksOfType()  - Batch height adjustment (syncs all to max, then scales)
setTrackParent()     - Set parent track (AE-style layer parenting with cycle detection)
getTrackChildren()   - Get child tracks of a parent
```

### Track Height Limits
- Minimum: 20px (ultra-compact single-line view)
- Maximum: 200px
- Curve editor height: 80px - 600px (default 250px)

---

## Clip Types

### Video Clips
- Imported via drag from Media Panel or file drop
- Thumbnails generated in background (skipped for >500MB)
- Support proxy generation for performance

### Audio Clips
- Stand-alone or linked to video clips
- Waveform visualization
- Linked audio auto-placed on available audio track

### Text Clips
- Created via `addTextClip()` in textClipSlice
- Configurable properties: font family, size, weight, style, color, alignment, line height, letter spacing
- Stroke and shadow support
- Path text support (`pathEnabled`, `pathPoints`)
- Default duration: 5 seconds

### Solid Clips
- Created via `addSolidClip()` in solidClipSlice
- Color fill clips with configurable color
- Useful for backgrounds and color mattes

### Composition Clips
- Nested compositions dragged from Media Panel
- Orange outline for identification
- Double-click to enter and edit contents
- Boundary markers show clip start/end positions
- Content-aware thumbnails sample at clip boundaries
- Maximum nesting depth: 8 levels

### YouTube Download Clips
- Created via `addPendingDownloadClip()` in downloadClipSlice
- Show download progress and speed while downloading
- Automatically convert to full video clips on completion (`completeDownload()`)
- Error state handling with `setDownloadError()`

---

## Clip Operations

### Adding Clips
1. Drag from Media Panel to timeline
2. Shows dashed preview with actual duration during drag
3. Drop on empty area below tracks to auto-create a new track (NewTrackDropZone)
4. Thumbnails generated in background (skipped for >500MB)

### Operations Table

| Action | Method | Notes |
|--------|--------|-------|
| **Move** | Drag clip | Supports snapping + resistance |
| **Trim** | Drag edges | Left/right trim handles |
| **Cut Tool** | `C` key | Toggle cut tool mode (click on clip to split) |
| **Split** | `Shift+C` | Splits all clips at playhead |
| **Copy** | `Ctrl+C` | Copy selected clips or keyframes |
| **Paste** | `Ctrl+V` | Paste at playhead position |
| **Delete** | `Delete`/`Backspace` | Removes selected keyframes first, then clips |
| **Reverse** | Context menu | Shows reverse badge |
| **Blend Mode** | `+`/`-` keys | Cycle through blend modes on selected clips |

### Cut Tool
- **Toggle shortcut:** `C` (press again or `Escape` to return to select mode)
- **Legacy split:** `Shift+C` splits all clips at playhead without entering cut tool mode
- **Snapping:** Automatically snaps to clip edges (hold `Alt` to disable)
- **Linked clips:** Splits both video and audio together
- **Visual indicator:** Cut line extends across all linked clips

### Copy/Paste
- **Copy:** `Ctrl+C` copies selected keyframes (if any selected) or clips
- **Paste:** `Ctrl+V` pastes keyframes or clips at playhead position
- **Preserved:** Effects, keyframes, masks, thumbnails, waveforms, text properties, solid colors, composition references
- **Linked clips:** Copying a video clip also copies its linked audio
- **Undo support:** Full undo/redo for paste operations

### Clip Properties (Keyframeable)
- Position (X, Y, Z depth)
- Scale (X, Y)
- Rotation (X, Y, Z) - full 3D with perspective
- Opacity (0-100%)
- Blend mode (cycle with `+`/`-` keys)
- **Speed** (-400% to 400%)
- Pitch preservation toggle (`setClipPreservesPitch`)

### Speed Control
The Speed property controls playback rate with full keyframe support:

| Speed Value | Effect |
|-------------|--------|
| 100% | Normal playback |
| 50% | Slow motion (2x longer) |
| 200% | Fast forward (2x faster) |
| 0% | Freeze frame |
| -100% | Reverse playback |

**Features:**
- Keyframeable with bezier curves for smooth ramps
- Negative values play backwards
- Works with RAM Preview
- Speed changes affect source time through integration

**Implementation:**
- Source time = integral of speed curve over clip duration
- Supports smooth transitions between speeds
- Handles direction changes (forward to reverse)

### Linked Clips
- Video clips can have linked audio
- Alt+drag to move independently
- Split together with cut tool / `Shift+C`
- Visual indicator: linked clips move together
- **Linked selection:** Click a linked video/audio clip to select both
- **Independent selection:** Shift+click for selecting only one side

### Multi-Select Movement
- **Shift+Click** to select multiple clips
- Drag any selected clip to move all together
- Group boundary collision prevents clips from overlapping
- Visual preview shown for all selected clips during drag
- Audio/video stay in sync during multi-drag

---

## Snapping & Resistance

### Snap Toggle
Toolbar button to enable/disable magnetic snapping:
- Click magnet icon to toggle
- Active state shows highlighted button
- Tooltip shows current status

### Magnetic Snapping
When enabled:
- **Snap distance**: 0.15 seconds (`SNAP_THRESHOLD_SECONDS`)
- **Snap points**: Clip edges, timeline start (0s)
- Automatic edge-to-edge alignment

### Overlap Resistance
When dragging clips over others:
- **100px horizontal resistance** must be pushed through (`OVERLAP_RESISTANCE_PIXELS`)
- **100px vertical resistance** prevents accidental cross-track moves
- Visual `.forcing-overlap` feedback
- Auto-trims overlapped clips when forced
- Smart overlap prevention on track changes: find free track or create new one

### Implementation
```typescript
getSnappedPosition()        - Calculate snap-adjusted position
getPositionWithResistance() - Snap + resistance calculation (pixel-based)
trimOverlappingClips()      - Auto-trim when placing
findNonOverlappingPosition() - Find free position for a clip
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
- **Resolution**: Up to 7680x4320 (8K)
- **Frame rates**: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60 fps
- **Duration**: Editable in timeline controls (locks auto-extend when set manually)

### Nested Compositions
- Drag composition from Media Panel to Timeline
- Double-click to enter and edit contents
- Changes reflect in parent composition
- Recursive rendering for deep nesting (max depth: 8)
- **Orange outline** for easy identification
- **Boundary markers** show clip start/end positions
- **Content-aware thumbnails** sample at clip boundaries
- `refreshCompClipNestedData()` updates nested data when source composition changes

### Fade Curves (Bezier)
Visual opacity fade curves displayed directly on timeline clips:
- **Creating fades:** Add opacity keyframes at clip start/end
- **Bezier visualization:** Shows smooth fade curve on clip (via `useClipFade` hook)
- **Real-time updates:** Curves update instantly during adjustment
- **Fade handles:** Drag to adjust fade duration while preserving easing

### Composition Tabs
- Open compositions appear as tabs
- Click to switch between compositions
- Drag tabs to reorder
- Each composition has independent timeline data
- Switching triggers clip entrance/exit animations

---

## Transitions

### Transition System
Transitions blend between adjacent clips on the same track using compositor-based rendering (no keyframes):

```typescript
applyTransition()           - Apply transition between two adjacent clips
removeTransition()          - Remove transition and restore clip positions
updateTransitionDuration()  - Change duration of existing transition
findClipJunction()          - Find clip pairs at a given time position
```

### Applying Transitions
- **Drag and drop** from Transitions Panel onto clip junctions
- Clips must be on the same track, with clipB after clipA
- Duration clamped to valid range (cannot exceed 50% of either clip)
- Creates overlap by moving clipB earlier

### Visual Feedback
- Junction highlight when dragging a transition near eligible clip pairs
- Transition overlay rendered between clips via `TransitionOverlays` component
- Junction detection threshold: 0.5 seconds

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
- Visual indicator: linked group badge
- Stored offsets maintain sync timing

### Multicam Dialog
- Right-click multiple selected clips → "Combine Multicam"
- Full multicam dialog (`MulticamDialog.tsx`) for configuring sync

### Audio Sync
See [Audio](./Audio.md#multicam-sync) for cross-correlation sync.

---

## Clip Parenting (Pick Whip)

After Effects-style parent-child relationships between clips:

### Pick Whip
- Drag from pick whip icon on a clip to another clip to set parent
- Component: `PickWhip.tsx`
- Visual cables between parent and child: `ParentChildLink.tsx` (physics-based cable simulation)
- Parent-child link overlay rendered via `ParentChildLinksOverlay.tsx`

### Clip Parenting API
```typescript
setClipParent(clipId, parentClipId)  - Set or clear parent
getClipChildren(clipId)              - Get all child clips
```

---

## Track Controls

Each track header contains:

| Control | Function |
|---------|----------|
| **Eye** | Toggle track visibility |
| **M** | Mute track audio |
| **S** | Solo this track |
| **Name** | Double-click to edit |
| **Expand** | Show keyframe lanes |

### Solo Behavior
- Dims non-solo tracks visually
- Multiple tracks can be solo'd
- Quick way to isolate content
- Invalidates video cache when toggled

### Track Height
- Drag track dividers to resize with continuous scrolling (no fixed steps)
- Minimum 20px for ultra-compact view with single line of text
- Expanded tracks show property rows (18px per row, 20px per group header)
- Height auto-adjusts for curve editors

### Track Context Menu (Right-Click on Header)
- Add Video Track
- Add Audio Track
- Duplicate Track
- Delete Track (disabled if last track of that type, shows clip count warning)

---

## Playback Controls

Located in timeline toolbar:

| Control | Shortcut | Function |
|---------|----------|----------|
| Stop | - | Return to time 0 |
| Play/Pause | `Space` | Toggle playback |
| JKL Shuttle | `J`/`K`/`L` | Reverse / Pause / Forward (multi-press increases speed) |
| Loop | `Shift+L` | Toggle loop mode |
| In Point | `I` | Set at playhead |
| Out Point | `O` | Set at playhead |
| Clear I/O | `X` | Clear markers |
| Add Marker | `M` | Add timeline marker at playhead |
| Frame Back | `Left Arrow` | Move playhead one frame backward |
| Frame Forward | `Right Arrow` | Move playhead one frame forward |
| Go to Start | `Home` | Jump to beginning |
| Go to End | `End` | Jump to end |

### Duration Editing
- Click duration display to edit
- Enter new duration, press Enter
- Locks duration (`durationLocked`) so it won't auto-extend

### Timeline Navigator
- Horizontal scrollbar below the timeline with zoom handles
- Drag thumb to scroll, drag left/right edges to zoom
- Component: `TimelineNavigator.tsx`

### Fit to Window
- Button in toolbar to auto-fit zoom level to show all content

---

## Context Menus

### Clip Context Menu (Right-Click on Clip)
Available actions depend on clip type:

| Action | Availability | Notes |
|--------|-------------|-------|
| Show in Explorer (Raw/Proxy) | Video clips | Submenu with raw file and proxy paths |
| Generate Proxy / Stop Proxy | Video clips | Start or cancel proxy generation |
| Split at Playhead (C) | All clips | Same as `Shift+C` keyboard shortcut |
| Combine Multicam | 2+ clips selected | Opens MulticamDialog |
| Unlink from Multicam | Linked group clips | Remove from linked group |
| Reverse Playback | Video clips | Toggle reverse with checkmark |
| Generate Waveform | Audio clips | Generate or regenerate waveform data |
| Transcribe | Video/Audio clips | AI transcription (shows progress) |
| Delete Clip | All clips | Remove from timeline |

---

## Performance Features

### Thumbnails
- Auto-generated for video clips
- Toggle: "Thumb On/Off" button in toolbar
- Skipped for files >500MB
- Toggled via `toggleThumbnailsEnabled()`

### Waveforms
- Generated for audio clips
- Toggle: "Wave On/Off" button in toolbar
- 50 samples per second resolution
- Toggled via `toggleWaveformsEnabled()`

### Transcript Markers
- Toggle: via toolbar
- Shows transcript segment markers on clips
- Toggled via `toggleTranscriptMarkers()`

### Keyframe Tick Marks
- Small amber diamond markers at the bottom of clips
- Show keyframe positions without expanding tracks
- Visible at all zoom levels

### Timeline Zoom
- **Alt+Scroll**: Exponential zoom (8% per step) centered on playhead
- Consistent zoom feel at all zoom levels
- Zoom range: 0.1 (view ~2.7 hours) to 200 (pixels per second)

### Vertical Scroll Snapping
- Vertical scrolling snaps to track boundaries
- Each scroll step moves exactly one layer
- Component: `VerticalScrollbar.tsx`

### Video/Audio Separator
- Green divider line between video and audio tracks
- Clearer visual structure for track organization

### Clip Entrance Animations
- When switching compositions, clips animate in with entrance transitions
- Animation phases: `exiting` (old clips fade out) then `entering` (new clips animate in)
- Controlled by `clipEntranceAnimationKey` which increments on each composition switch
- Only clips present at the time of the switch receive the animation class

### Video Preloading
- `useVideoPreload` hook seeks and buffers upcoming clips 2 seconds ahead of playhead
- Prevents stuttering when playback transitions to a new clip
- Throttled to run every 500ms

### RAM Preview
- Toggle: "RAM ON/OFF" button
- Caches 30fps frames
- Green indicator shows cached ranges on timeline
- See [Preview](./Preview.md#ram-preview)

### Proxy Frame Cache
- Yellow indicator shows proxy-cached ranges on timeline
- Background preloading via `startProxyCachePreload()`
- Cancellable via `cancelProxyCachePreload()`
- Progress shown in toolbar

### Export Progress
- Blue/purple indicator shows export range on timeline
- Progress percentage displayed during export

---

## SlotGrid View

Resolume-style grid view for composition triggering:

- 12 columns x 4 rows (layers A-D)
- Slot size: 100px fixed
- Toggle between timeline and grid via `slotGridProgress` (0 = timeline, 1 = grid)
- Each row (layer) can have an active composition playing simultaneously
- Click slot to activate on layer and play from start
- Column header click activates all compositions in that column
- Mini-timeline shown for active compositions
- Component: `SlotGrid.tsx` with `MiniTimeline.tsx`
- Animation: `slotGridAnimation.ts`

---

## AI Action Feedback

Transient visual overlays for AI-driven editing actions:

- **Split glow lines** at cut positions
- **Delete ghost clips** fading out
- **Trim edge highlights**
- **Moving clip animations** (smooth position transitions)

Managed by `aiActionFeedbackSlice` with auto-cleanup after animation duration.
Components: `AIActionOverlays.tsx`

---

## Store Architecture

The timeline store (`src/stores/timeline/index.ts`) combines 17 slices + 2 utility modules:

| Slice | File | Purpose |
|-------|------|---------|
| **trackSlice** | `trackSlice.ts` | Track CRUD, visibility, solo, mute, parenting |
| **clipSlice** | `clipSlice.ts` | Core clip operations: add, move, trim, split, reverse |
| **textClipSlice** | `textClipSlice.ts` | Text clip creation and property updates |
| **solidClipSlice** | `solidClipSlice.ts` | Solid color clip creation and color updates |
| **clipEffectSlice** | `clipEffectSlice.ts` | Add/remove/update effects on clips |
| **linkedGroupSlice** | `linkedGroupSlice.ts` | Multicam linked group creation/removal |
| **downloadClipSlice** | `downloadClipSlice.ts` | YouTube pending download clips |
| **playbackSlice** | `playbackSlice.ts` | Play/pause/stop, JKL shuttle, zoom, tool mode, toggles |
| **ramPreviewSlice** | `ramPreviewSlice.ts` | RAM preview caching and range tracking |
| **proxyCacheSlice** | `proxyCacheSlice.ts` | Proxy frame cache preloading and invalidation |
| **selectionSlice** | `selectionSlice.ts` | Clip and keyframe selection |
| **keyframeSlice** | `keyframeSlice.ts` | Keyframe CRUD, interpolation, bezier handles, recording |
| **maskSlice** | `maskSlice.ts` | Mask creation, vertex editing, shape masks |
| **markerSlice** | `markerSlice.ts` | Timeline marker CRUD |
| **transitionSlice** | `transitionSlice.ts` | Clip-to-clip transitions (apply, remove, update) |
| **clipboardSlice** | `clipboardSlice.ts` | Copy/paste for clips and keyframes |
| **aiActionFeedbackSlice** | `aiActionFeedbackSlice.ts` | AI visual feedback overlays |

**Utility modules:**

| Module | File | Purpose |
|--------|------|---------|
| **positioningUtils** | `positioningUtils.ts` | Snapping, resistance, overlap detection |
| **serializationUtils** | `serializationUtils.ts` | State serialization/deserialization for project save/load |

**Helper subdirectories:**

| Directory | Contents |
|-----------|----------|
| `clip/` | `addVideoClip.ts`, `addAudioClip.ts`, `addImageClip.ts`, `addCompClip.ts`, `completeDownload.ts`, `upgradeToNativeDecoder.ts` |
| `helpers/` | `audioDetection.ts`, `audioTrackHelpers.ts`, `blobUrlManager.ts`, `clipStateHelpers.ts`, `idGenerator.ts`, `mediaTypeHelpers.ts`, `mp4MetadataHelper.ts`, `thumbnailHelpers.ts`, `waveformHelpers.ts`, `webCodecsHelpers.ts` |

---

## Component Structure

### Main Components (`src/components/timeline/`)

| Component | Purpose |
|-----------|---------|
| `Timeline.tsx` | Main timeline container (49K, orchestrates everything) |
| `TimelineTrack.tsx` | Individual track row rendering |
| `TimelineClip.tsx` | Individual clip rendering with badges, thumbnails, waveforms |
| `TimelineHeader.tsx` | Track headers with controls (visibility, mute, solo) |
| `TimelineControls.tsx` | Toolbar with playback controls and toggles |
| `TimelineRuler.tsx` | Time ruler above tracks |
| `TimelineKeyframes.tsx` | Keyframe diamond rendering in expanded tracks |
| `TimelineNavigator.tsx` | Horizontal scrollbar with zoom handles |
| `TimelineContextMenu.tsx` | Right-click context menu for clips |
| `TrackContextMenu.tsx` | Right-click context menu for track headers |
| `CurveEditor.tsx` | Bezier curve editor for keyframe animation |
| `CurveEditorHeader.tsx` | Header controls for curve editor |
| `MulticamDialog.tsx` | Dialog for configuring multicam groups |
| `SlotGrid.tsx` | Resolume-style grid view |
| `MiniTimeline.tsx` | Compact timeline used in SlotGrid |
| `PickWhip.tsx` | AE-style pick whip for clip parenting |
| `ParentChildLink.tsx` | Physics-based cable between parent/child clips |
| `PhysicsCable.tsx` | Cable rendering with spring physics |
| `VerticalScrollbar.tsx` | Custom vertical scrollbar |

### Sub-Components (`src/components/timeline/components/`)

| Component | Purpose |
|-----------|---------|
| `TimelineOverlays.tsx` | Snap lines, in/out markers, cache indicators, export progress |
| `TransitionOverlays.tsx` | Transition junction highlights and existing transition visuals |
| `AIActionOverlays.tsx` | AI action feedback (split glow, delete ghost, trim highlight) |
| `ClipAnalysisOverlay.tsx` | Focus/motion analysis graphs rendered on clips |
| `ClipWaveform.tsx` | Audio waveform visualization on clips |
| `FadeCurve.tsx` | Opacity fade curve visualization on clips |
| `NewTrackDropZone.tsx` | Drop zone for creating new tracks when dragging media |
| `ParentChildLinksOverlay.tsx` | Overlay layer for all parent-child link cables |
| `PickWhipCables.tsx` | Active pick whip drag cable rendering |
| `PickWhipOverlay.tsx` | Pick whip interaction overlay |

### Hooks (`src/components/timeline/hooks/`)

| Hook | Purpose |
|------|---------|
| `useClipDrag.ts` | Clip dragging with snapping, resistance, multi-select |
| `useClipTrim.ts` | Left/right edge trimming |
| `useClipFade.ts` | Fade curve computation and handle dragging |
| `useExternalDrop.ts` | Media file drop from Media Panel or OS |
| `useLayerSync.ts` | Sync timeline clips to engine render layers |
| `useMarqueeSelection.ts` | Rectangle selection on empty timeline area |
| `useMarkerDrag.ts` | In/out point and marker dragging |
| `usePickWhipDrag.ts` | Pick whip drag interaction for clip parenting |
| `usePlaybackLoop.ts` | Playback loop with requestAnimationFrame |
| `usePlayheadDrag.ts` | Playhead scrubbing interaction |
| `usePlayheadSnap.ts` | Playhead snapping to markers and clip edges |
| `useTimelineHelpers.ts` | Shared utility functions (time conversion, etc.) |
| `useTimelineKeyboard.ts` | Global keyboard shortcuts |
| `useTimelineZoom.ts` | Alt+scroll zoom with exponential scaling |
| `useTransitionDrop.ts` | Transition drag-and-drop onto clip junctions |
| `useVideoPreload.ts` | Upcoming clip preloading for smooth playback |
| `useAutoFeatures.ts` | Auto-enable features based on clip content |

### Utilities (`src/components/timeline/utils/`)

| File | Purpose |
|------|---------|
| `externalDragPlacement.ts` | Calculate placement for externally dragged media |
| `externalDragSession.ts` | Track state of external drag operations |
| `fileTypeHelpers.ts` | Detect file types for drag-and-drop |

---

## Related Features

- [Keyframes](./Keyframes.md) - Animate clip properties
- [Preview](./Preview.md) - Playback and RAM Preview
- [Audio](./Audio.md) - Audio tracks and multicam sync
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)

---

## Tests

| Test File | Tests | Coverage |
|-----------|-------|----------|
| [`clipSlice.test.ts`](../../tests/stores/timeline/clipSlice.test.ts) | 104 | Clip operations, split, trim, move, effects, speed, linked groups |
| [`trackSlice.test.ts`](../../tests/stores/timeline/trackSlice.test.ts) | 66 | Track management, auto-naming, scaling, cycle detection |
| [`selectionSlice.test.ts`](../../tests/stores/timeline/selectionSlice.test.ts) | 49 | Clip selection, multi-select, curve editor blocking |
| [`playbackSlice.test.ts`](../../tests/stores/timeline/playbackSlice.test.ts) | 88 | Playback, in/out points, zoom, JKL shuttle, RAM preview |
| [`markerSlice.test.ts`](../../tests/stores/timeline/markerSlice.test.ts) | 50 | Markers, boundaries, sort invariants |
| [`keyframeSlice.test.ts`](../../tests/stores/timeline/keyframeSlice.test.ts) | 94 | Keyframe CRUD, interpolation, bezier handles, recording, effects |
| [`maskSlice.test.ts`](../../tests/stores/timeline/maskSlice.test.ts) | 78 | Mask creation, vertex editing, rectangle/ellipse masks |

Run tests: `npx vitest run`

---

*Source: `src/components/timeline/`, `src/stores/timeline/`*
