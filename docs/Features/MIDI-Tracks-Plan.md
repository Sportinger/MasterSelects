# MIDI Tracks — Implementation Plan

> Issue #182 · branch `182-create-midi-tracks`
> Status: **planning** (no code written yet)

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
| **Note timing** | Seconds-based. **Free placement, NO grid snapping.** Normal piano-roll drawing. A better/musical grid comes later, shared with the audio side. |
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
- Double-click handler on a MIDI clip in `TimelineClip.tsx` → `openPianoRoll(clip.id)`.

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

## 4. Phased delivery (checkpoint after each)

1. **Data model + Add MIDI Track** — types, `addTrack('midi')`, context-menu entries, basic MIDI lane rendering. Verify: can create a MIDI track.
2. **Pencil tool** — tool registration + draw-to-create MIDI clips. Verify: can paint clips on the MIDI track.
3. **Piano-roll detached window** — boot module + component + double-click, draw/delete notes, live playhead cursor. Verify: edit notes in a second window, cursor tracks playback.
4. **Synth + playback** — `MidiSynth`, transport scheduling, draw-preview. Verify: clips are audible during playback.
5. **Export + persistence** — offline render path + save/load. Verify: exports contain synth audio; project reload keeps tracks/clips/notes.

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
- `src/components/timeline/TrackContextMenu.tsx`, `Timeline.tsx`, `TimelineClip.tsx`
- `src/stores/timeline/toolDefaults.ts`, `toolSlice.ts` + toolbar/flyout
- `src/engine/audio/AudioMixer.ts` / `AudioExportPipeline.ts`
- `src/services/project/projectSave.ts`, `projectLoad.ts`, project/composition types

## 6. Open questions / future (explicitly out of scope now)

- Better/musical grid + snapping (shared with audio side) — later.
- Real DAW-style instruments (sampler, FM, multiple voices, effects) — later; the instrument abstraction leaves room.
- Hardware MIDI in/out — later.
- Velocity editing lane, CC automation, quantize — later.
