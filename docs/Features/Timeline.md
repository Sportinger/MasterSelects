# Timeline

[<- Back to Index](./README.md)

The Timeline is the core editing interface for multi-track editing. It now covers video, audio, image, Lottie, Rive, text, solid, motion shape, mesh, composition, camera, and splat-effector clips, with keyframe lanes, transitions, multicam grouping, pick-whip parenting, and slot-grid playback.

---

## Track Types

### Video Tracks
- Hold video, image, Lottie, Rive, text, solid, motion shape, mesh, composition, camera, and splat-effector clips.
- Higher tracks render on top of lower tracks.
- Expanded tracks can show keyframe property rows and curve editors.
- Default layout starts with `Video 2` above `Video 1`.

### Audio Tracks
- Hold audio-only clips and audio-linked companions for video clips.
- Waveforms support compact, detailed, and spectral timeline display modes.
- Audio Focus mode expands audio lanes and compacts video lanes without switching to a separate editor window.
- Linked audio follows video movement unless moved independently with `Alt` drag.
- Default layout includes one audio track named `Audio`.

### Track Management
```ts
addTrack()          // Create a video or audio track
removeTrack()       // Delete a track and its clips
renameTrack()       // Rename on double-click
setTrackHeight()    // Resize a single track
scaleTracksOfType() // Resize all tracks of the same type together
setTrackLocked()    // Lock or unlock timeline editing for a track
setTrackParent()    // Parent tracks with cycle detection
getTrackChildren()  // Query child tracks
```

### Track Height
- Track height clamps to 20-600 px.
- Curve editors clamp to 80-600 px.
- Expanded track height depends on the selected clip, visible property rows, and open curve editors.

---

## Clip Types

### Video / Image
- Imported from the media panel or by dropping files on the timeline.
- Thumbnails and proxies are supported.
- In Video Focus, holding Ctrl/Strg while dragging inside a visual clip marks a clip-scoped video bake region. Double-click marks the full visible clip. Clip-scoped regions currently use the transient preview cache path and can be unbaked or removed from the clip overlay.
- Holding Ctrl/Strg while dragging on the ruler marks a composition-scoped video bake region. Baking a ruler region renders the visible composition into a compressed WebCodecs proxy and substitutes that single proxy layer during preview playback, so the generic RAM cache indicator is not the durable bake source.

### Audio
- Can exist alone or as linked audio for video clips.
- Fades are authored through `audio-volume` keyframes.
- In Audio Focus with detailed or spectral display, holding Ctrl/Strg while dragging inside the waveform creates an inline audio region selection. Plain left-drag keeps the normal clip move behavior.
- Double-clicking a detailed audio clip in Audio Focus highlights the full visible clip as an editable audio region.
- Left-dragging an already selected audio region moves that highlighted region along the clip without changing its duration; left-dragging outside the selected region keeps moving the whole clip.
- Dragging the selected audio region's left or right edge resizes the highlighted region.
- Matching audio edit operations move/resize in place with the highlighted region instead of being duplicated.
- The selected region exposes a horizontal gain line for direct level edits and side handles for fading that gain change in and out.
- Existing audio-region edit markers are displayed from the top of the clip downward when ranges overlap, and `Audio Region Markers` in the View menu hides/shows those markers without changing edit processing.
- Right-clicking the selected region opens direct Split/Cut/Copy/Paste actions first, then secondary non-destructive audio edit-stack operations in compact submenus such as silence, insert silence, delete silence, reverse, invert polarity, channel swap, mono sum, and Region FX presets. Split isolates the selected region as its own middle clip and selects that new clip. Cut removes the selected region from the track and leaves the original audio as left/right clip parts.
- Region FX presets are stored as region edit-stack operations, not ordinary whole-clip effects, so they stay attached to the selected source range when that region is moved or resized. Their exact waveform cache renders in the background while live playback routes the effect only when the playhead is inside the region.
- Simple detailed-waveform updates for those non-destructive region edits derive from the source waveform pyramid when possible, and region gain/silence preview is applied directly to the visible waveform columns while dragging. The lane keeps high-resolution detail without waiting for a full processed-audio render, and derivable processed-waveform refreshes run as background cache updates without showing the red waveform-generation border or progress bar. Scrub and playback preview also follow simple region gain/silence changes instead of always using the raw source level.
- Audio edit-stack chips appear on edited audio clips for quick state, while the selected clip Properties panel exposes an `Audio Edits` tab for inspection, bypass, removal, clear, bake, unbake, and bake history.
- Bake renders active region edits into a new WAV media source in the Media Panel `Baked Audio` folder, stores the project-local file under `Raw/Baked Audio/`, and resets the clip edit stack. Unbake restores the latest reversible bake to the original source media and the pre-bake region edit stack when that source media is still present in the project.

### Text
- Created through the timeline text slice.
- Supports typography, stroke, shadow, and path text.

### Vector Animation
- Lottie is imported from `.lottie` packages or Lottie JSON files from the Media Panel.
- Rive is imported from `.riv` files and rendered through the Rive WASM canvas runtime.
- Both providers use the same canvas-backed render path as text and solids, so preview, nested comps, and export stay aligned.
- Exposes per-clip loop, end behavior, playback mode, fit, render resolution, animation selection, and background controls in the Properties panel.
- State machines can be selected in the provider tab, with state changes stored as blue stepped keyframes when state names are available.
- Boolean and numeric state-machine inputs appear as normal stopwatch-keyframed properties.
- Rive Data Binding exposes view models, instances, static string/enum values, and keyframed numeric/boolean/color values.
- When loop is enabled, the clip can be extended beyond its source duration on the right trim edge without freezing on the first pass.

### Solid
- Flat color clips used for mattes and backgrounds.

### Motion Shape
- Rectangle and ellipse shape clips are timeline clips with JSON motion definitions.
- Video track-header context menus can add Motion Rectangle or Motion Ellipse clips at the current playhead position.
- Solid clip context menus expose Convert Solid to Motion Shape.
- The Motion tab exposes primitive, size, radius, fill, and stroke controls.
- Motion shape replicator controls can enable a grid, edit X/Y counts, edit X/Y spacing, and keyframe the per-instance fade.
- Solid clips can be converted in the store to motion rectangle clips while preserving timeline identity, timing, transform, effects, and keyframes.
- Motion shape rendering uses WebGPU SDF textures, then the normal compositor stack.

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
| Cut tool | `C` toggles Blade mode through the timeline tool palette; click clips to split them. |
| Split at playhead | `Shift+C` in MasterSelects, preset-specific alternatives elsewhere. |
| Split all at playhead | Available in the Cut flyout; runs through the shared timeline edit operation kernel. |
| Blade all tracks | Available in the Cut flyout as a mode; splits every unlocked visible clip crossing the click time. |
| Trim start/end to playhead | Available in the Cut flyout; trims selected clips through the operation kernel and keeps linked audio aligned. |
| Ripple delete | Available in the Cut flyout and clip context menu; deletes selected clips and closes the affected track gap through the operation kernel. |
| Delete gap | Available in the Cut flyout, clip context menu, and empty timeline right-click menu; closes an empty gap through the operation kernel. |
| Delete all gaps in this layer | Available from the empty timeline right-click menu; closes gaps on the clicked layer from the clicked empty space onward as one undoable operation. |
| Delete all gaps | Available from the empty timeline right-click menu; closes all gaps on unlocked visible tracks as one undoable operation. |
| Fit comp to window | Available from the zoom controls and empty timeline right-click menu. |
| Right-drag empty space or clips | Scrubs the playhead without opening the timeline context menu; context menus open only for a single right-click. |
| Lift range | Available in the Cut flyout after drawing a Range Selection; removes the range and leaves a gap. |
| Extract range | Available in the Cut flyout after drawing a Range Selection; removes the range and ripples following clips left. |
| Copy | `Ctrl+C` copies selected keyframes first, otherwise selected clips. |
| Paste | `Ctrl+V` pastes keyframes if the clipboard has them, otherwise pastes clips. |
| Delete | `Delete` / `Backspace` removes selected keyframes first, then clips. |
| Reverse | Available from the clip context menu and via clip state. |
| Create Subcomposition | Clip context menu action that moves the selected timeline clips into a new composition and inserts that composition back into the current timeline. |
| Blend mode | `+` / `-` cycles blend modes on selected clips. |

### Copy and Paste
- Copying clips includes linked audio automatically when the video clip is selected.
- Copy/paste preserves vector animation clip type and vector animation settings.
- Copy/paste preserves motion shape definitions.
- Copying keyframes stores them relative to the earliest copied keyframe.
- Pasting keyframes targets the selected clip when exactly one clip is selected; otherwise it falls back to the original clip from the clipboard data.

### Timeline Tool Palette
- The ruler/header strip contains a compact grouped timeline tool palette.
- Root groups are Selection, Cut, Trim, Placement, and Navigation/Marking.
- Clicking a root button activates the last enabled child tool for that group.
- Holding a root button, right-clicking it, or using its chevron opens an unclipped portal flyout.
- The first enabled tools are Select, Track Select Forward/Backward/Forward All Tracks, Range Selection, Blade, Blade All Tracks, Split at Playhead, Split All at Playhead, Trim Start/End to Playhead, Ripple Trim Start/End to Playhead, Ripple Delete, Delete Gap, Edge Trim, Ripple Trim, Rolling Edit, Slip, Slide, Rate Stretch, Position/Overwrite, Hand/Pan, Zoom, Marker, In Point, Out Point, and Pen/Keyframe. Planned tools are visible but disabled until their operation-kernel migration exists.
- Track Select Forward, Track Select Backward, and Track Select Forward All Tracks are enabled selection subtools; their clip clicks route through the shared pointer dispatcher and `select-clips-from-time` operation.
- Range Selection is an enabled selection mode. Dragging on timeline space stores a timeline range with the affected unlocked visible track IDs and leaves a persistent range overlay for later lift/extract/copy commands.
- Shared tool previews render through `TimelineToolOverlayLayer` for section-scrolled overlays such as Track Select highlights, Blade All Tracks cut lines, and blocked tool messages.
- Active pointer tools set a matching icon cursor so the selected tool remains visible at the mouse pointer. Blade, Range, track-selection, trim modes, Hand, Zoom, Marker, In/Out, and Pen/Keyframe expose custom SVG cursor glyphs with normal CSS fallbacks.
- Hand/Pan drags the timeline surface horizontally without moving clips. Zoom clicks around the pointer and uses `Alt` or `Shift` for zooming out.
- Tool selection is treated as non-mutating and remains available during export; mutating commands are blocked while export is active.

### Cut Tool
- `C` toggles Blade mode in the default preset.
- `Escape` exits cut mode.
- `Shift+C` performs a direct split at the playhead without entering cut mode.
- Blade hover/click is handled by the timeline tool pointer dispatcher, which writes shared preview state and commits through `applyTimelineEditOperation`.
- Split-at-playhead, AI single-clip split, AI bulk split-at-times/evenly, AI move, AI trim, and AI reorder all route through `applyTimelineEditOperation`.
- Lift Range and Extract Range also route through `applyTimelineEditOperation`; they split clip boundaries at the selected range and clear the range overlay after commit.
- Mutating operation-kernel commits and global undo/redo are blocked while export is active.
- Timeline edit operations expose replay descriptors for Guided Action playback, so Blade, Track Select, Trim, Slip/Slide, Placement, Lift/Extract, and related operation-kernel edits can be represented as semantic timeline replay targets without DOM clicks as the execution source.

### Trim Tools
- Trim-to-playhead and ripple-trim-to-playhead commands run through the shared operation kernel and preserve linked audio/video timing.
- Edge Trim, Ripple Trim, Rolling Edit, and Rate Stretch reuse the existing trim handles, but commit through `applyTimelineEditOperation` instead of direct clip mutations.
- Slip and Slide are available as registered operation-kernel modes. Dragging a clip body with either tool previews the slip/slide and commits through `applyTimelineEditOperation`; `Alt` slips independently from linked audio/video.
- Trim mode activation owns the edge handles before legacy clip drag, fade, and cut behaviors, so Blade/Hand/Zoom/Range clicks are no longer swallowed by trim/fade handles.

### Placement Tools
- Position/Overwrite is an enabled Placement mode. Dropping media in this mode uses the shared `place-timeline-range` operation to clear the target range before the new clip is created.
- The placement operation supports insert-style space creation and overwrite-style range clearing, including split/trim/delete behavior and linked video/audio split preservation.
- Normal Select-mode drops still use gap-aware placement. Position/Overwrite intentionally keeps the requested drop time and lets the kernel trim/delete the affected target range.
- Insert, Overwrite, Replace, Fit to Fill, Append, Place on Top, and Ripple Overwrite are enabled when the Media Panel or Source Monitor exposes a current source item. The commands resolve the source, prepare the affected range through the placement operation, then create the new clip on the target track.
- Replace, Fit to Fill, and Ripple Overwrite prefer the selected timeline range or selected compatible target clip. Insert and Overwrite use the playhead. Append uses the end of the compatible target track, and Place on Top uses a free upper video track or creates one.
- Source Monitor In/Out marks constrain the placement source duration and source in point. Clearing the marks returns placement to the full source duration.
- Source Monitor exposes a full-width source timeline with ruler, playhead, draggable In/Out handles, audio-file playback, and direct Insert, Overwrite, Replace, Fit, Append, and Top buttons, so source edit commands are available outside the timeline tool flyout.
- Clicking a track header targets that video or audio track for source edits and clip paste. Clicking the same highlighted track again clears that target.
- Hovering or focusing Placement commands in the timeline flyout or Source Monitor publishes a non-mutating placement preview. The shared overlay renders ghost clips on affected tracks and shows the source In/Out bounds used for the command.

### Pen / Keyframe Tool
- Pen/Keyframe is an enabled Navigation/Marking mode with a dedicated cursor.
- Clicking a visible keyframe property lane adds or updates a keyframe at the clicked time.
- The inserted keyframe value is sampled from the existing property lane by linear interpolation, so adding in-between keys preserves the current visible curve value before further edits.

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
- Vector animation state changes appear as `lottieState.{stateMachine}` lanes; state-machine inputs appear as `lottieInput.{stateMachine}.{input}` lanes. Rive Data Binding values appear as `riveData.{property}` lanes.
- Motion shape numeric lanes use registry paths such as `shape.size.w` and `appearance.{id}.stroke.width`.
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
- Selected clips can be converted into a new nested composition from the clip context menu.
- Composition switches trigger clip entrance/exit animations in the timeline UI.
- Vector animation clips inside nested comps render through the same canvas path used in the primary timeline and export flow.

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
- Lock for both track types; locked tracks block timeline edits such as move, trim, split, delete, keyframe edits, and dropping new clips.
- Track rename on double-click.
- Track expansion to reveal keyframe lanes.
- Right-click opens a track-header context menu with `Add Video Track`, `Add Audio Track`, `Duplicate Track`, and `Delete`.

Soloing multiple tracks is supported. Non-solo tracks dim visually when any solo state is active.

### Track Header Context Menu

- Math Scene and Motion Shape presets are created from the Media panel add/context menu and then dragged to video tracks.
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
- The ruler and lane grid use the active composition frame rate at deep zoom. The base time grid crossfades out while frame-accurate grid lines fade in with zoom before the ruler switches to frame timecode labels.
- `Alt+Scroll` or `Ctrl+Scroll` zooms the timeline around the mouse pointer by default; Preferences -> General -> Timeline can switch the zoom anchor to the playhead. Faster wheel gestures use larger zoom steps.
- `Shift+Scroll` pans horizontally.
- Vertical scroll snaps to track boundaries.
- `Ctrl+Shift+Scroll` or `Cmd+Shift+Scroll` toggles slot-grid view.
- The toolbar also exposes a dedicated slot-grid toggle button that flips between timeline bars and the 12x4 grid icon.
- The Navigation/Marking tool flyout exposes Marker, In Point, and Out Point commands for the current playhead position.

The timeline navigator below the tracks provides the same scroll and zoom control in a dedicated bar.

---

## Performance Features

- Thumbnails, waveforms, and transcript markers can each be toggled from the toolbar.
- RAM preview caches 30 fps frames.
- Composition video bake regions render a compressed preview proxy through the export pipeline and use it as a single layer during editor preview playback. Clip-scoped video bake regions still use the transient RAM preview path until per-layer alpha-capable bake artifacts are added.
- Video bake proxy artifacts are runtime-only; project persistence keeps the region marks and resets volatile bake status after reload or timeline cache invalidation.
- Proxy caching keeps proxy frame ranges warm in the background.
- Export progress is shown directly on the timeline.
- Slot-grid view is animated through the same `slotGridProgress` state that drives the timeline/grid transition.
- When `useWarmSlotDecks` is enabled, slot-grid tiles can show deck warmup badges (`C`, `Wi`, `Wa`, `H`, `F`, `D`) that reflect reusable background playback state.

---

## Store Architecture

The timeline store in `src/stores/timeline/index.ts` combines modular slices plus utility modules:

- `trackSlice`
- `clipSlice`
- `textClipSlice`
- `solidClipSlice`
- `mathSceneClipSlice`
- `motionClipSlice`
- `meshClipSlice`
- `cameraClipSlice`
- `splatEffectorClipSlice`
- `clipEffectSlice`
- `colorCorrectionSlice`
- `linkedGroupSlice`
- `downloadClipSlice`
- `audioEditSlice`
- `videoBakeSlice`
- `toolSlice`
- `editOperations`
- `playbackSlice`
- `ramPreviewSlice`
- `proxyCacheSlice`
- `selectionSlice`
- `keyframeSlice`
- `maskSlice`
- `markerSlice`
- `transitionSlice`
- `nodeGraphSlice`
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
- `TimelineClipCanvas.tsx` renders passive clip bodies, thumbnails, waveforms, spectrograms, labels, and canvas-only passive decorations.
- `ClipInteractionShell` modules render active clip affordances such as trim/fade handles, keyframe ticks, region controls, and context-menu shells.
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
