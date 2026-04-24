# Timeline

[<- Back to Index](./README.md)

The Timeline is the core editing interface for multi-track editing. It now covers video, audio, image, Lottie, text, solid, mesh, composition, camera, and splat-effector clips, with keyframe lanes, transitions, multicam grouping, pick-whip parenting, and slot-grid playback.

---

## Track Types

### Video Tracks
- Hold video, image, Lottie, text, solid, mesh, composition, camera, and splat-effector clips.
- Higher tracks render on top of lower tracks.
- Expanded tracks can show keyframe property rows and curve editors.
- Default layout starts with `Video 2` above `Video 1`.

### Audio Tracks
- Hold audio-only clips and audio-linked companions for video clips.
- Waveforms can be shown at 50 samples per second.
- Linked audio follows video movement unless moved independently with `Alt` drag.
- Default layout includes one audio track named `Audio`.

### Track Management
```ts
addTrack()          // Create a video or audio track
removeTrack()       // Delete a track and its clips
renameTrack()       // Rename on double-click
setTrackHeight()    // Resize a single track
scaleTracksOfType() // Resize all tracks of the same type together
setTrackParent()    // Parent tracks with cycle detection
getTrackChildren()  // Query child tracks
```

### Track Height
- Track height clamps to 20-200 px.
- Curve editors clamp to 80-600 px.
- Expanded track height depends on the selected clip, visible property rows, and open curve editors.

---

## Clip Types

### Video / Image
- Imported from the media panel or by dropping files on the timeline.
- Thumbnails and proxies are supported.

### Audio
- Can exist alone or as linked audio for video clips.
- Fades are authored through `audio-volume` keyframes.

### Text
- Created through the timeline text slice.
- Supports typography, stroke, shadow, and path text.

### Lottie
- Imported from `.lottie` packages or Lottie JSON files from the Media Panel.
- Uses the same canvas-backed render path as text and solids, so preview, nested comps, and export stay deterministic.
- Exposes per-clip loop, end behavior, fit, animation selection, and background controls in the Properties panel.
- When loop is enabled, the clip can be extended beyond its source duration on the right trim edge without freezing on the first pass.

### Solid
- Flat color clips used for mattes and backgrounds.

### Mesh
- Primitive 3D meshes such as cube, sphere, plane, cylinder, torus, and cone.
- Rendered as 3D clips with full transform and keyframe support.

### Composition
- Nested compositions can be dropped from the media panel.
- Double-click enters the nested comp for editing.

### Camera and Splat Effector
- Camera clips and splat-effector clips are first-class clip types in the store and copy/paste flow.
- Camera/native-gaussian clips expose camera-oriented property labels in the keyframe UI.

### YouTube Download
- Pending download clips are represented in the timeline while the download is in progress.

---

## Clip Operations

| Action | Current Behavior |
|--------|------------------|
| Move | Drag a clip or a multi-selection. |
| Trim | Drag clip edges. |
| Cut tool | `C` toggles cut mode; click clips to split them. |
| Split at playhead | `Shift+C` in MasterSelects, preset-specific alternatives elsewhere. |
| Copy | `Ctrl+C` copies selected keyframes first, otherwise selected clips. |
| Paste | `Ctrl+V` pastes keyframes if the clipboard has them, otherwise pastes clips. |
| Delete | `Delete` / `Backspace` removes selected keyframes first, then clips. |
| Reverse | Available from the clip context menu and via clip state. |
| Blend mode | `+` / `-` cycles blend modes on selected clips. |

### Copy and Paste
- Copying clips includes linked audio automatically when the video clip is selected.
- Copy/paste preserves Lottie clip type and vector animation settings.
- Copying keyframes stores them relative to the earliest copied keyframe.
- Pasting keyframes targets the selected clip when exactly one clip is selected; otherwise it falls back to the original clip from the clipboard data.

### Cut Tool
- `C` toggles the cut tool in the default preset.
- `Escape` exits cut mode.
- `Shift+C` performs a direct split at the playhead without entering cut mode.

---

## Selection

- Click selects a clip.
- `Ctrl+Click` adds or removes a clip from the selection.
- `Shift+Click` toggles only the clicked clip, which is different from the normal linked-selection behavior.
- Normal click on a linked video clip selects both the video and linked audio clip.
- Click empty space to clear selection.
- Marquee selection works from empty timeline space.
- Keyframe selection uses the same shift-toggle pattern.

### Keyframe Selection
- Select keyframes by clicking the diamond.
- `Delete` removes selected keyframes before it removes clips.
- See [Keyframes](./Keyframes.md) for curve and property details.

---

## Keyframe Lanes

- Expanded track headers show a flat list of property rows, not nested folders.
- The current clip's keyframes decide which rows are visible.
- The UI hides `rotation.x`, `rotation.y`, `position.z`, and `scale.z` for 2D clips.
- Camera clips and native-render gaussian splats keep the camera-style property model visible.
- Numeric effect parameters appear as `effect.{effectId}.{paramName}` lanes.
- Audio EQ lanes sort `volume` and the band parameters first.

### Curve Editor
- Double-click a property row to open the curve editor.
- Only one curve editor can be open at a time.
- The curve editor shows Bezier curves, auto-scales the value axis, and supports `Shift+wheel` resizing.
- Selected keyframes expose in/out handles; right-click on a handle resets it to the default 1/3-distance handle.

---

## Compositions and Transitions

### Nested Compositions
- Composition clips can be nested to a depth of 8.
- Composition changes propagate into nested render data.
- Composition switches trigger clip entrance/exit animations in the timeline UI.
- Lottie clips inside nested comps render through the same canvas path used in the primary timeline and export flow.

### Transitions
- Transitions operate between adjacent clips on the same track.
- The transition system moves the second clip earlier to create the overlap.
- Junction highlights are shown when dragging a transition near a valid pair.

### Multicam
- Multiple selected clips can be combined into a linked multicam group.
- Linked group movement preserves offsets so sync timing stays intact.

### Pick Whip Parenting
- Clips and tracks support parent-child relationships.
- Parent-child links are rendered as overlays with the pick-whip interaction.

---

## Track Controls

Each track header exposes:

- Visibility for video tracks.
- Mute for audio tracks.
- Solo for both track types.
- Track rename on double-click.
- Track expansion to reveal keyframe lanes.
- Right-click opens a track-header context menu with `Add Video Track`, `Add Audio Track`, `Duplicate Track`, and `Delete`.

Soloing multiple tracks is supported. Non-solo tracks dim visually when any solo state is active.

### Track Header Context Menu

- `Duplicate Track` currently creates a new empty track of the same type.
- `Delete` is blocked for the last remaining track of that type.
- Deleting a populated track shows the affected clip count in the menu label/tooltip.

---

## Playback and Zoom

The toolbar and wheel gestures still drive playback and navigation:

- Space toggles play/pause.
- `J`, `K`, `L` shuttle reverse, pause, and forward.
- `I` and `O` set in/out points.
- `X` clears in/out.
- `M` adds a marker at the playhead.
- Right-clicking a marker opens marker transport and MIDI actions.
- Markers can be turned into `Stop Marker`s that automatically pause playback when crossed.
- Marker MIDI bindings support `Jump To Marker`, `Play From Marker`, and `Jump To Marker And Stop`.
- Left/Right arrows step frame by frame.
- `Alt+Scroll` or `Ctrl+Scroll` zooms the timeline around the playhead.
- `Shift+Scroll` pans horizontally.
- Vertical scroll snaps to track boundaries.
- `Ctrl+Shift+Scroll` or `Cmd+Shift+Scroll` toggles slot-grid view.
- The toolbar also exposes a dedicated slot-grid toggle button that flips between timeline bars and the 12x4 grid icon.

The timeline navigator below the tracks provides the same scroll and zoom control in a dedicated bar.

---

## Performance Features

- Thumbnails, waveforms, and transcript markers can each be toggled from the toolbar.
- RAM preview caches 30 fps frames.
- Proxy caching keeps proxy frame ranges warm in the background.
- Export progress is shown directly on the timeline.
- Slot-grid view is animated through the same `slotGridProgress` state that drives the timeline/grid transition.
- When `useWarmSlotDecks` is enabled, slot-grid tiles can show deck warmup badges (`C`, `Wi`, `Wa`, `H`, `F`, `D`) that reflect reusable background playback state.

---

## Store Architecture

The timeline store in `src/stores/timeline/index.ts` combines 20 slices plus 2 utility modules:

- `trackSlice`
- `clipSlice`
- `textClipSlice`
- `solidClipSlice`
- `meshClipSlice`
- `cameraClipSlice`
- `splatEffectorClipSlice`
- `clipEffectSlice`
- `linkedGroupSlice`
- `downloadClipSlice`
- `playbackSlice`
- `ramPreviewSlice`
- `proxyCacheSlice`
- `selectionSlice`
- `keyframeSlice`
- `maskSlice`
- `markerSlice`
- `transitionSlice`
- `clipboardSlice`
- `aiActionFeedbackSlice`

Utility modules:

- `positioningUtils`
- `serializationUtils`

Important guard:

- `timelineSessionId` is incremented when the timeline is cleared or reloaded so stale async callbacks do not write back into the wrong session.

---

## Component Structure

Core timeline components live in `src/components/timeline/`:

- `Timeline.tsx` orchestrates the full timeline.
- `TimelineTrack.tsx` renders track rows and property lanes.
- `TimelineHeader.tsx` renders track headers and property controls.
- `TimelineClip.tsx` renders clips, badges, and overlays.
- `TimelineKeyframes.tsx` renders keyframe diamonds in track lanes.
- `CurveEditor.tsx` and `CurveEditorHeader.tsx` handle curve editing.
- `TimelineControls.tsx`, `TimelineRuler.tsx`, and `TimelineNavigator.tsx` handle navigation and toolbar controls.
- `SlotGrid.tsx` and `MiniTimeline.tsx` handle slot-grid mode.
- `PickWhip.tsx`, `ParentChildLink.tsx`, and `PhysicsCable.tsx` handle parenting visuals.

The main hooks are `useClipDrag`, `useClipTrim`, `useClipFade`, `useTimelineKeyboard`, `useTimelineZoom`, `useExternalDrop`, `useTransitionDrop`, `usePickWhipDrag`, `useMarqueeSelection`, `usePlayheadDrag`, `usePlayheadSnap`, `useMarkerDrag`, `usePlaybackLoop`, `useLayerSync`, and `useAutoFeatures`.

---

## Related Docs

- [Keyframes](./Keyframes.md)
- [Keyboard Shortcuts](./Keyboard-Shortcuts.md)
- [Slot Grid](./Slot-Grid.md)
- [Preview](./Preview.md)
- [Audio](./Audio.md)
