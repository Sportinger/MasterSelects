> Status: Completed archive. This file is kept for historical context and must not be treated as active work unless explicitly reopened.

# MIDI Tracks — Implementation Plan

> Issue #182 · branch `182-create-midi-tracks`
> Status: **in progress** — Phases 1–4 implemented; Phase 5 (export + persistence) remaining.

## 1. Goal

Add DAW-style MIDI tracks to MasterSelects:

- Right-click an empty area in the timeline's audio section → **Add MIDI Track**.
- A **pencil tool** paints MIDI clip regions onto a MIDI track (like a normal DAW).
- **Double-click** a MIDI clip → opens a **piano-roll editor in a detached browser window** (can live on a second monitor).
- In the piano roll, draw/delete notes freely, normal piano-roll style.
- A **simple synth** (triangle wave + ADSR) makes the MIDI clip audible during playback.

No real MIDI message I/O (no hardware in/out) for now — purely internal.

## 2. Locked-in decisions

These were decided with the user — do not re-litigate:

| Topic | Decision |
|-------|----------|
| **Note timing** | Seconds-based. **Free placement, NO grid snapping** (yet). A **visual** tempo-synced Bars+Time grid now exists (issue #249, reads the shared `TempoMap`); snap-to-grid is the only remaining piece and becomes trivial now that musical gridlines exist. |
| **Synth** | Throwaway-simple, just to hear sound: one triangle oscillator + ADSR envelope, polyphonic. Put behind a small instrument abstraction so future real DAW-style instruments slot in without rework. |
| **Piano-roll window** | A **real detached OS window** (`window.open`), reusing the same-origin popup pattern from `src/components/outputManager/OutputManagerBoot.ts`. Because the popup shares the JS heap, it reads the same Zustand stores + audio engine directly. |
| **Playhead cursor** | The piano-roll window subscribes to the same `useTimelineStore.playheadPosition`, so its cursor mirrors the timeline live with no cross-window messaging. |
| **MIDI I/O** | None for now (internal only). |

> Note: the existing `src/types/midi.ts` + `midiStore` are **hardware MIDI control input** (MIDI-learn / parameter bindings). That is unrelated. The track/clip/synth system is a separate subsystem.

## 3. Architecture

### 3.1 Data model

- **Track**: add `'midi'` to `TimelineTrack.type` (currently `'video' | 'audio'`). The instrument lives on the track:
  ```ts
  interface MidiInstrument {
    kind: 'simple-synth';          // extensible: future 'sampler' | 'fm' | ...
    waveform: OscillatorType;      // 'triangle' for now
    adsr: { attack: number; decay: number; sustain: number; release: number };
    gain: number;
  }
  ```
  Stored as e.g. `TimelineTrack.midiInstrument?: MidiInstrument`.
- **Clip**: a MIDI clip is a `TimelineClip` with `source.type = 'midi'` and note data on the clip:
  ```ts
  interface MidiNote {
    id: string;
    pitch: number;     // 0–127
    start: number;     // seconds, relative to clip start
    duration: number;  // seconds
    velocity: number;  // 0–1
  }
  interface MidiClipData { notes: MidiNote[]; }
  ```
  Stored as e.g. `TimelineClip.midiData?: MidiClipData`. Notes on the clip, instrument on the track (DAW convention).
- New types file: `src/types/midiClip.ts` (kept separate from the existing control-input `midi.ts`).

### 3.2 Track type union ripple

Adding `'midi'` to the track-type union touches ~50 spots that reference `'video' | 'audio'`. Strategy:
- Widen the canonical `TimelineTrack.type` and the `addTrack`/`generateTrackId` signatures.
- Treat MIDI tracks like audio tracks for layout (they live in the audio section, similar height) except where MIDI-specific behavior is needed.
- Audit each `type === 'audio'` / `type === 'video'` branch; default MIDI to audio-section behavior unless it must differ. Let `tsc` surface the exhaustive list.

### 3.3 Track creation & UI

- `trackSlice.addTrack('midi')`: create a MIDI track with a default `midiInstrument`, insert in the audio section (bottom), auto-expand.
- `TrackContextMenu.tsx`: add **+ Add MIDI Track** item; widen `trackType` to include `'midi'`.
- Empty-area context menu in the audio section (right-click empty space, right side): add the same **Add MIDI Track** entry.
- MIDI track header/lane styling so it's visually distinct.

### 3.4 Pencil tool (draw MIDI clips)

- Add a `pencil` (a.k.a. `midi-draw`) tool to the tool system: `toolDefaults.ts` (`TIMELINE_TOOL_IDS`, group mapping, mode set), `toolSlice.ts`, and the toolbar/flyout UI.
- Behavior: with the pencil active on a MIDI track, click-drag on empty lane space creates a new empty MIDI clip spanning the dragged time range (free placement, no snap).
- Clicking an existing MIDI clip with the pencil could extend/edit later (out of first scope).

### 3.5 Piano-roll detached window

- New boot module `src/components/pianoRoll/PianoRollBoot.ts`, modeled on `OutputManagerBoot.ts`:
  - `openPianoRoll(clipId)`: `window.open('', 'piano_roll_<clipId>', ...)`, copy app stylesheet, mount a React root rendering `<PianoRoll clipId=... />`.
  - Reconnect-after-refresh + close cleanup, same as the output manager.
- `PianoRoll` component:
  - Vertical axis = pitch (keyboard on the left), horizontal axis = time (seconds) across the clip duration.
  - Draw notes by click-drag (set pitch + start + duration), delete by click/right-click, move/resize notes.
  - Free placement — no snap.
  - **Live playhead cursor**: read `useTimelineStore.playheadPosition`, draw a vertical line at the corresponding time within the clip; only visible while the playhead is over the clip.
  - Edits write back to `clip.midiData` via a timeline store action (with history support).
- Double-click handling for MIDI clips routes through the canvas/shell timeline path in `Timeline.tsx`/`TimelineTrack.tsx` and opens `openPianoRoll(clip.id)`. Active targets should use `ClipInteractionShell`/`useMidiClipDraw`, not the deleted `TimelineClip.tsx` body.

### 3.6 Synth + playback

- `src/engine/audio/MidiSynth.ts`: a small WebAudio instrument.
  - `noteOn(pitch, velocity, when)` → `OscillatorNode(waveform)` + `GainNode` shaped by ADSR; `noteOff(pitch, when)` applies release.
  - Polyphonic (track active voices by note id).
  - Reuse `audioManager`'s `AudioContext` for the live transport clock.
- Transport integration: during playback, schedule a clip's notes against the AudioContext timeline as the playhead crosses them (look-ahead scheduler). Stop/flush voices on stop/seek.
- Preview: play a short note when drawing/clicking it in the piano roll.
- **Export**: render MIDI into the offline mix via `AudioMixer` / `AudioExportPipeline` so exports include the synth output. Mirror the live synth's ADSR/oscillator in an `OfflineAudioContext` pass.

### 3.7 Persistence

- Serialize MIDI tracks (`midiInstrument`) and MIDI clips (`midiData.notes`) in the project save/load path (`projectSave.ts` / `projectLoad.ts`, composition/timeline types). MIDI clips have no media file, so they serialize purely as data.

### 3.8 Timeline clip presentation (issue #232)

How a MIDI clip looks on the timeline (distinct from the piano-roll editor):

- **Track header / clip color**: MIDI tracks and clips share a blue identity derived from a single `--midi-color` token (`tokens.css`); MIDI track headers without a custom label color get a flat blue tint (`.track-header.midi.midi-default-tint`) so audio vs MIDI is distinguishable at a glance.
- **In-clip note preview** (`components/ClipMidiPreview.tsx`): a Cubase-style mini note view drawn on a canvas — one thin bar per note from note-on to note-off. **X is window-local time** (`x = (note.start − inPoint) × zoom`), so the preview tracks the clip's in/out window and lines up exactly with the timeline ruler (the canvas spans the whole clip; only the backing store is capped for very wide clips). **Y is pitch**, fit to the clip's own min..max range (DAW "fit notes to view") so the used register fills the height. A note whose tail crosses the clip end is clamped at the boundary, and a note outside the window is not drawn — mirroring the playback scheduler exactly. Only renders when the clip has notes.
- **Clip length rules the editor**: the piano roll's content width equals the clip's real duration (`contentWidth = clipDuration × pxPerSec`, `PianoRoll.tsx`) — no minimum padding — so the editor and the clip preview represent the same window. Composing more means resizing the clip on the timeline.
- **Two-axis zoom + custom scrollbars** (issue #249): the editor has independent horizontal (time) and vertical (note-height) zoom, Cubase-style. The old fixed `PX_PER_SEC`/`ROW_H` constants are now `pxPerSec` (12–1200) and `rowH` (5–48) state in `PianoRoll.tsx`; one pair of shared helpers (`zoomTimeTo`/`zoomNotesTo`) drives both input paths and keeps the point under the anchor stationary by stashing a corrected scroll offset that a `useLayoutEffect` applies once the grid has re-rendered to its new size. Inputs: **Ctrl+wheel** = time zoom, **Ctrl+Shift+wheel** = note zoom (both pointer-anchored), plus **−/+ buttons** at the far end of each scrollbar (center-anchored). A native non-passive `wheel` listener `preventDefault`s the gesture so the browser never page-zooms — required because the popup is a detached document the app's `usePageZoom` guard never reaches. The native scrollbars are hidden (`scrollbarWidth:none` + a `::-webkit-scrollbar` rule) and replaced by custom overlay bars (`PianoRollScrollbars.tsx`) that read/write the still-native scroll engine's `scrollLeft`/`scrollTop` (so wheel scroll, the sticky keyboard, and note-edit math are unchanged); the thumb geometry reserves the button zone so it tracks the real scroll position exactly.
- **FL-style keyboard + hover key highlight** (issue #249): the left strip renders like a real keyboard — full-width white keys with narrower black-key overlays (62%) and white-key seams everywhere, including through the **middle of each black key** (the seam between two white keys that have a black key between them). Each key row keeps an **opaque** fill so the sticky container's tall background is never exposed; exposing it produced a faint GPU-tiling shade seam on Mesa that scrolled with the content (`PianoRoll.tsx`). Moving the cursor over the grid lights up the matching key (`hoverPitch`, updated only when the row changes). The highlight respects the interlocking key shape: a white key's own row highlights full width, **and** it owns the right-hand white strip beside the black key above (its bottom half) and below (its top half), split at those black keys' middle seams — so the whole real key lights up with no gaps; a black key highlights only its own 62% overlay. The note grid itself is a single flat lane fill with sparse octave (per-C) reference lines, avoiding the same per-row/gradient compositor seam.
- **Bars + Time ruler + tempo-synced grid + scrubbing** (issue #249): the piano roll has a stacked **Time** (top) + **Bars** (below, accent-tinted like the timeline's selected lane) ruler and tempo-synced vertical gridlines, both locked to the editor's own horizontal time zoom (`pxPerSec`) yet reading the **same shared `TempoMap`** as the main timeline — so bar numbers and timecodes are **identical to the timeline** at the same musical positions. The bridge is a pure adapter (`components/pianoRoll/pianoRollGrid.ts`, `buildPianoRollGrid`): the piano-roll x-axis is clip-local content time, so it generates ruler ticks + gridlines over the **absolute** window `[clip.startTime, clip.startTime + clipDuration]` using the timeline's own pure generators (`iterateBarBeatLines`, `createBarsLaneTicks`, `createLinearLaneTicks` in `components/timeline/utils/timelineGrid.ts`), then maps each absolute time back to a pixel with `(time − clip.startTime) × pxPerSec` (the window's left edge is `clip.startTime` regardless of `inPoint`). The `formatTimelineClock` MM:SS.cc formatter is shared with the timeline hook so the Time labels are byte-identical. The adapter takes a `gridResolution` (lines-per-beat) param — 1 = beats today, future-proofed for 1/8·1/16·triplets — emitting bar/beat/sub tiers (`PianoRollGridLines.tsx`, `memo`'d, inline-styled). One `buildPianoRollGrid` call (memoized on geometry/tempo, **not** notes) feeds both the ruler (`PianoRollRuler.tsx`, presentational) and the gridlines, so they align by construction. The ruler sits **outside** the scroll viewport (a `KEYBOARD_W` corner spacer + a clipped track) and is slid by a pure **imperative `translateX(-scrollLeft)`** from a rAF-batched `onScroll` — no React state, so scrolling never re-renders the notes. Click/drag on the ruler **scrubs the global playhead** (`setPlayheadPosition`, clamped to the clip window; drag listeners on the popup's `ownerDocument`). Note: everything is **inline-styled**, not via the timeline's `.ruler-lane`/`.time-marker` CSS classes — `PianoRollBoot` mirrors only `<link rel="stylesheet">`, but Vite injects app CSS as `<style>` tags in dev, so those classes are absent in the popup during development. The old clip-local 1-second gridlines were replaced (they drifted from the absolute-time ruler whenever the clip didn't start on a whole second). Snapping stays out of scope; the grid is visual for now.
- **Editing tools + selection + clipboard + undo** (issue #249): the popup header has a 3-tool palette (shortcuts **1/2/3**, seam in `components/pianoRoll/pianoRollToolShortcuts.ts`) — **pointer** (draw/move/resize, right-click delete), **eraser** (click/swipe delete), **select** (marquee-pick, shift-click toggle, group-move, **Delete/Backspace** to remove). On the select tool: **Ctrl+C/Ctrl+X** copy/cut the selection, **Ctrl+V** pastes at the **playhead** (Cubase-style — the earliest copied note anchors to the playhead's content time, clamped into the clip window, rest keep their spacing), and **Ctrl+D** (with **Ctrl+B** as the FL-Studio alias) duplicates the selection to the right by its own span. The clipboard is a plain module-level array (`components/pianoRoll/pianoRollClipboard.ts`, like the media store's `mediaClipboardIds`) — shared across all open piano-roll popups via the common JS heap, holding note data minus ids; paste/duplicate mint fresh ids and the new notes become the selection. Paste/duplicate go through one batched store action `addMidiNotes(clipId, notes[])` (`midiClipSlice.ts`, mirrors `removeMidiNotes`) so a whole chord is **one undo step**. **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) is wired on the popup's own document: history was always recorded (every note CRUD calls `captureSnapshot`), but the global Ctrl+Z handler binds the *main* window, which never sees the detached popup's keystrokes, so the popup drives the shared `undo()`/`redo()` facade directly. Fixed a long-standing **double-capture** in the process: an explicit slice `captureSnapshot` now suppresses the trailing debounced *fallback* snapshot the same edit's store-subscription schedules (`historyStore` + `useGlobalHistory`), and `flushPendingCapture` drops (rather than materializes) that fallback inside the suppress window — otherwise one edit produced two undo steps (the user had to press Ctrl+Z twice).
- **Label**: MIDI clips show `"MIDI"` by default (the generic `"MIDI Clip"` name is treated as "unnamed") and hide the duration number — the note preview conveys content instead.
- **Rename**: right-click a MIDI clip → **Rename** (`TimelineContextMenu`, MIDI-only) enters inline edit in place of the label. State lives in the store as `clipRenameId`/`setClipRenameId`; the commit action is `renameMidiClip(clipId, name)` (history-tracked). Enter/blur commits, Escape cancels. A renamed clip shows its custom name.
- **Pencil draw fix**: `useMidiClipDraw` measures the drag against the lane's `.track-clip-row` (time-zero origin) rather than the outer track stack, so a drawn clip lands exactly on the dragged region instead of being shifted right by the header width.
- **Ghost notes from overlapping clips** (issue #232): a piano-roll window is bound to one **active** clip (its `clipId`); the active clip's notes are editable. Every *other* MIDI clip whose timeline span intersects the active clip's window is shown as read-only **ghost** bars (`components/pianoRoll/ghostNotes.ts` → `computeGhostNotes(activeClip, allClips)`). Each ghost is converted into the active clip's local time (`otherClip.startTime + note.start − activeClip.startTime`) and clamped to the window `[0, duration]`, so a note poking past either edge shows only its coexisting part. Ghosts carry **note data only** (pitch + timing, no velocity), render beneath the real notes as flat grey shaded bars with `pointerEvents: none` and no handlers (so they can't be selected/edited/resized) — editing each note happens in its own clip's editor. The active/ghost role is **per window**, so two open piano rolls each ghost the other's overlapping notes.
- **Resize from both edges — in/out window over a note canvas** (issue #232): a MIDI clip is an unbounded note canvas plus a movable window. `note.start` is **content time** (origin-relative, fixed); it only changes when the note itself is edited. `[clip.inPoint, clip.outPoint]` (`outPoint = inPoint + duration`) is the visible/playable window, and on the timeline a note at content time `t` plays at `startTime + (t − inPoint)`. The single source of truth is `services/midi/midiClipTiming.ts` (`noteAbsoluteStart`, `clipLocal↔contentTime`, `isNoteStartInWindow`), used by the scheduler, piano roll, clip preview, ghost notes, and the offline export renderer. Because every existing clip has `inPoint = 0`, the formulas reduce to the old `startTime + note.start`, so it's backward compatible. Both edges enlarge freely: MIDI is an **infinite trim source** (`utils/infiniteTrimSource.ts`, the *one* shared list used by the trim commit `useClipTrim`, the handle affordances `trimHandleDirections`, **and** the live on-timeline resize preview in `TimelineClip` — they must agree or the clip resizes on commit but not visibly during the drag). Enlarging left moves `startTime` + `inPoint` together (inPoint may go negative = empty pre-roll) so notes keep their absolute time; enlarging right grows `outPoint`. Notes outside the window are **hidden but preserved** — shrink then enlarge and they reappear. (This also fixed a latent bug where left-*shrinking* used to shift notes, because the scheduler read `startTime + note.start` while trim moved `startTime`/`inPoint`.)
- **Cut = two independent clips, not two windows** (issue #232): a media split keeps both halves pointing into one immutable source file via `inPoint`/`outPoint`, but a MIDI clip has no external source — the note data *is* the content. So `splitClip` (`stores/timeline/clipSlice.ts`) special-cases `source.type === 'midi'`: it partitions the notes into two standalone clips via `partitionMidiNotesAtCut` (`services/midi/midiClipTiming.ts`) instead of the shared-array window split. Each half owns only its own notes, **rebased to `inPoint = 0`** (left notes shift by `inPoint`, right notes by the cut), with absolute timeline positions unchanged. Notes are assigned **whole** by where their START falls (same rule as `isNoteStartInWindow`) and are **never sliced** — a note starting just before the cut stays in the left clip with its full duration and simply rings out past the cut, exactly as before the split; the right clip gets no fragment of it. Notes outside the visible window are dropped (already silent — a standalone clip keeps no ghosts). Because the data is genuinely separated, the clip preview, piano roll and scheduler each show/fit only that half's notes with no special-casing — which is why a cut now *reveals* each half as a real clip instead of looking like one drawing sliced in two. This is deliberately different from a **resize**, which still uses the reveal-on-enlarge window model above.
- **Glue = merge clips into one (Cubase-style tool)** (issue #232): the inverse of the cut. A `glue` timeline tool (in the **Cut** tool group, next to Blade, with a school-glue-bottle icon) lets you **click any MIDI clip to merge its contiguous run** — the clicked clip plus every clip that touches or overlaps it, expanding in both directions. So clicking *either* side of an adjacent pair glues the same run, and **a gap breaks the run** (glue never jumps a space; `GAP_EPSILON = 1e-3 s` treats only float noise as "touching"). **Alt-click** force-merges the clicked clip with *every* following clip on the track, gaps included (the gaps stay silent). Clicking an isolated clip (gaps on both sides) is a no-op. No multi-selection needed (a selection-based "Glue selected" menu can come later as a second entry point into the same logic). The pointer dispatcher (`tools/pointer/timelineToolPointerDispatcher.ts`, `isTimelineGlueTool`) emits a `merge-midi-clips` edit operation; `applyMergeMidiClipsOperation` (`stores/timeline/editOperations/mergeOperations.ts`) resolves the targets (the contiguous run via `contiguousRunContaining`, or anchor + all following for Alt) and builds one clip starting at the earliest `startTime` with `inPoint = 0`. Notes are combined via `mergeMidiNotes` (`services/midi/midiClipTiming.ts`), the exact inverse of `partitionMidiNotesAtCut`: every note keeps its **absolute timeline position** (`mergedStart + note.start = original absolute start`), only in-window notes are taken (no resurrected ghosts), overlapping clips contribute their notes as polyphony, and gaps stay silent because notes keep their real time. So **cut → glue round-trips cleanly**. Glue is MIDI-only for now (clicking a non-MIDI clip is a no-op); media has no glue because its halves are windows onto an immutable source file, not owned note data.
- **Overlap = coexist, not eat** (issue #232): on most tracks a dropped clip trims/deletes ("eats") whatever it overlaps. MIDI clips instead **cohabitate** — overlapping clips are both kept and both sound (the playback scheduler already loops over every clip on a track). This is driven by a single `getTrackOverlapPolicy(track)` helper (`stores/timeline/helpers/overlapPolicy.ts`): MIDI tracks resolve to `'stack'`, every other type keeps the legacy `'trim'`, so non-MIDI editing is byte-identical. `getPositionWithResistance` drops a stack-track clip at the exact requested position with `forcingOverlap=false` (no forced-overlap state, no bounce to another track) and `trimOverlappingClips` is a no-op on stack tracks. Edge **snapping is untouched**, so MIDI keeps its magnetism (clips click onto neighbours' edges) but pushing past the snap lands the clip overlapping. To silence one of two stacked clips, mute the track. The trim/stack default is intentionally hardcoded for now; if the general video/audio overlap rule changes, only `getTrackOverlapPolicy` needs to grow (e.g. a settings default + per-track override).

## 4. Phased delivery (checkpoint after each)

1. **Data model + Add MIDI Track** — ✅ done (commit `a2b43e41`).
2. **Pencil tool** — ✅ done (commit `a2b43e41`).
3. **Piano-roll detached window** — ✅ done (commit `a2b43e41`).
4. **Synth + playback** — ✅ implemented. `src/engine/audio/MidiSynth.ts` (triangle/osc + ADSR, polyphonic), `src/services/audio/midiPlaybackScheduler.ts` (look-ahead scheduler subscribed to transport, 1x-forward only, flush on stop/pause/seek), draw/click preview in the piano roll, `audioManager.getContext()/getMixerInput()` accessors. Verify: clips audible during playback.
5. **Export + persistence** — TODO. Offline render path (`AudioMixer`/`AudioExportPipeline`, `OfflineAudioContext`) + serialize `midiInstrument`/`midiData.notes` in projectSave/projectLoad/serializationUtils. Verify: exports contain synth audio; reload keeps tracks/clips/notes.

### Phase 4b — Mixer routing + instrument UI (issue #182, staged)
The synth no longer plays straight to the destination — each MIDI track gets a
**per-track synth bus** so it behaves like a normal mixer channel.

**Step 1 (done):**
- `midiPlaybackScheduler` builds, per MIDI track, `synth → pan → volume → analyser → destination` (+ stereo splitter meter taps). Volume (`getTrackVolumeDb`→linear), pan (`getTrackPan`), and mute/solo (`getTrackAudioMuted/Solo`) read from `track.audioState`; live meters publish via `updateRuntimeAudioMeter(track.id, …)`.
- `AudioMixerPanel` now lists MIDI tracks as channel strips (volume/pan/mute/solo + live meter work end-to-end).
- Properties panel: MIDI tracks show **TRACK Controls** (shared `AudioTrackControlsTab`) + a new **TRACK Instrument** tab (`MidiInstrumentTab`: synth picker, waveform, gain, ADSR) backed by the new `setTrackMidiInstrument` action.
- Piano-roll preview routes through the track bus (respects volume/pan).

**Step 2 (done):** Full mixer parity — EQ + the complete audio-effect stack + sends + master-bus routing for MIDI tracks.
- `audioRoutingManager` now exposes a **generalized node route**: `ensureSharedContext()`, `applyNodeEffects(key, sourceNode, volume, eqGains, pan, processors, master)`, `getNodeMeterSnapshot(key)`, `removeNodeRoute(key)`. The `AudioRoute.sourceNode` type was widened from `MediaElementAudioSourceNode` to `AudioNode`, so a generated source (the synth bus) reuses the **exact same** gain/FX/EQ/pan/meter chain and feeds the shared master bus — no duplicated effect engine.
- `audioGraphRouteSettings.createTrackLiveAudioRouteSettings({ track, masterAudioState })` builds the track + master route settings (volume, EQ gains, FX processors, sends-return gain, pan, mute) for a clip-less source, mirroring `createLiveAudioRouteSettings`.
- `midiPlaybackScheduler` shares the AudioRoutingManager context; each MIDI track's `MidiSynth → sourceGain` is handed to `applyNodeEffects` per tick, and the meter is published from `getNodeMeterSnapshot`. The old self-contained Step 1 bus (pan/volume/analyser/destination) is gone.
- Properties panel: the Effects + Sends tab buttons are now gated on `hasBusControls` (audio **or** MIDI), so MIDI tracks expose the full audio effect palette + sends UI (the content panels were never track-type-gated). MIDI tracks therefore have: Controls + Instrument + Effects + Sends, identical to audio tracks plus the synth instrument tab.

Still TODO: instrument **chip in the MIDI track header** (`TimelineTrack.tsx`) — the Properties Instrument tab covers "which synth is playing" for now.

### Phase 4 implementation notes
- `MidiSynth` is context-agnostic (accepts a `BaseAudioContext`), so the same `scheduleNote` path can later render into an `OfflineAudioContext` for export (Phase 5).
- The scheduler prefers the shared `audioManager` context but falls back to its own `AudioContext` (the master chain is not guaranteed to be `init()`ed), matching the stem-buffer-mixer / composition-mixer pattern.
- Scheduler is initialized once via `ensureMidiPlaybackScheduler()` from `useLayerSync`; it then drives playback purely through a store subscription (no per-frame RAF coupling).

## 5. Files (anticipated)

**New**
- `src/types/midiClip.ts`
- `src/components/pianoRoll/PianoRollBoot.ts`
- `src/components/pianoRoll/PianoRoll.tsx` (+ css)
- `src/engine/audio/MidiSynth.ts`
- `src/stores/timeline/midiClipSlice.ts` (note CRUD actions + history)

**Modified (non-exhaustive)**
- `src/types/index.ts` (track type union, `TimelineTrack`, `TimelineClip`, `TimelineSourceType`)
- `src/stores/timeline/trackSlice.ts`, `types.ts`, `helpers/idGenerator.ts`, `selectors.ts`
- `src/components/timeline/TrackContextMenu.tsx`, `Timeline.tsx`, `TimelineTrack.tsx`, `TimelineClipCanvas.tsx`, and `ClipInteractionShell` modules as needed.
- `src/stores/timeline/toolDefaults.ts`, `toolSlice.ts` + toolbar/flyout
- `src/engine/audio/AudioMixer.ts` / `AudioExportPipeline.ts`
- `src/services/project/projectSave.ts`, `projectLoad.ts`, project/composition types

## 6. Open questions / future (explicitly out of scope now)

- Better/musical grid + snapping (shared with audio side) — later.
- Real DAW-style instruments (sampler, FM, multiple voices, effects) — later; the instrument abstraction leaves room.
- Hardware MIDI in/out — later.
- Velocity editing lane, CC automation, quantize — later.
