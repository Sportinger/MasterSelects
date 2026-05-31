# GM Sampler — Implementation Plan

> Issue #193 · branch `193-gm-sound-for-midi-tracks`
> Status: **Phases 1 + 3 + 4 done** — factory seam; schema + GmSampleBank + WavetableSynth,
> GM selectable, hand-built test asset; preload orchestration (live on-select/on-start +
> export-before-clip-loop). Build/lint/test green; browser-verified (GM audible live and
> in export, first note no longer drops).
> **Phase 2 split** (per decision): schema-as-types landed inside Phase 3; the real
> `.sf2`→JSON converter + FluidR3 assets (2b) are deferred until the runtime is proven.
> Pending: **Phase 5** (drums), **6** (full asset set + UI), **2b** (converter).
> Builds on the MIDI Tracks subsystem (issue #182, see `MIDI-Tracks-Plan.md`).

## 1. Goal

Add a second, better-sounding instrument option alongside the current oscillator
synth. The user picks **per MIDI track** between **Simple Synth** (current) and a
**General MIDI** wavetable instrument. The architecture stays open so more
instruments (sampler, FM, SF2…) can be added later.

## 2. Locked-in decisions (per the ticket)

| Topic | Decision |
|-------|----------|
| **Engine** | **WebAudioFont-style wavetable**, but **our own code** (see Licensing). Its model `queueWaveTable(ctx, target, preset, when, duration, pitch, volume)` maps ~1:1 onto our existing `MidiSynth.scheduleNote(instrument, pitch, velocity, when, duration)` and works in `OfflineAudioContext` (export parity). Sample/wavetable based, full GM-128 + drums, main-thread (no AudioWorklet plumbing). |
| **NOT SpessaSynth** | `spessasynth_core` (real SF2/SF3/DLS, Apache-2.0) is the *future* "real DAW" upgrade. **Rejected for now** — bigger refactor (AudioWorklet live + separate buffer-fill offline path). Keep on the radar; do not implement it for #193. |
| **Sounds** | **FluidR3 GM (MIT)** — unlimited personal/commercial use — our default. GeneralUser GS (free commercial) is an alternative (ship our own copy, don't hot-link). |
| **We write the playback code** | Re-implement "play a looped sample with gain/envelope, scheduled at `when`" ourselves. Small; fits the existing `MidiSynth` pattern. **No GPL code shipped.** |
| **Asset source** | Convert from the original FluidR3 `.sf2` (MIT) ourselves, rather than copying surikov's pre-converted `.js` verbatim (that format is arguably his work). Same sounds, cleaner provenance. |
| **Asset format** | Static lazy-loaded **`.json`** (data, not executable `.js`) in `public/instruments/gm/`. Sample data + loop points / zones / envelope. Recommend storing **raw decoded PCM** (see §5) — load-bearing for the sync schedulers + export rate-matching. |
| **Hosting** | In-repo `public/` first (~few MB–15 MB, never bundled into JS); movable to Cloudflare/CDN later. |

### Licensing (critical, do not drift)

WebAudioFont = two separable things with two licenses:

- **Sounds** (wavetable data) → OK commercial. Extracted from free soundfonts:
  FluidR3 GM = **MIT** (our default, safest); GeneralUser GS = free commercial.
- **Player/loader code** → **GPL-3.0** (copyleft). Bundling it into MasterSelects
  (closed-source, paid) would arguably force the whole app to GPL. **Do not ship
  his code.**

The whole plan: **use the sounds, write our own small loader/scheduler.** Net —
better GM sounds, no GPL contamination, we own the playback code. (Bonus: writing
our own avoids WebAudioFont's known `OfflineAudioContext` gotcha, where its loader
calls `resume()`, which throws offline.)

## 3. Why this needed a design pass beyond "add a kind"

The ticket's minimal-change sketch (extend `MidiInstrument` with `kind:'gm'`, add a
`WavetableSynth` with the same interface, and a `createSynthForInstrument(...)`
factory) is directionally right but has **one structural blind spot**: wavetable
samples load **asynchronously**, while **both** consumers schedule notes
**synchronously**:

- `midiPlaybackScheduler.tick()` schedules notes inside a **120 ms** look-ahead
  window (`LOOKAHEAD_SECONDS = 0.12`). A fetch + parse is far slower → the first
  notes of any program would be **silent/dropped**.
- `renderMidiClipToBuffer` schedules notes then immediately calls
  `startRendering()`. If samples aren't loaded, **export renders silence**.

Plus three traps the minimal sketch glosses over: the renderer builds a **new synth
per clip** and the scheduler a **new synth per track** (so a per-synth cache
re-fetches each program N times); `decodeAudioData` **resamples to its context's
rate** (live ≠ export sample rate); and **drums** need per-pitch sample selection,
not pitch-shifting. The design below fixes all of these up front.

## 4. Architecture

```
                       ┌──────────────────────────────┐
                       │      GmSampleBank (singleton)  │
                       │  program → decoded Float32 PCM │  ← fetched once, cached,
                       │  + zone/loop/envelope metadata │    HMR-persisted
                       └───────────────┬────────────────┘
                                       │ buildSource(program, pitch, ctx)
        live ───────────┐             │             ┌─────────── offline export
                        ▼             ▼             ▼
          midiPlaybackScheduler   WavetableSynth   MidiClipRenderer
            (per-track bus)      (IMidiSynth impl)   (per-clip, OfflineCtx)
                        │             ▲             │
                        └──── createSynthForInstrument(instrument, ctx, dest) ────┘
```

The existing per-track bus, mixer parity (`applyNodeEffects`), meters, solo/mute,
1x-forward, and seek re-anchor in `midiPlaybackScheduler` all stay — only what
*produces* the audio at the head of the bus changes.

### 4.1 Shared synth interface (the real seam)

Today there are exactly **3** `new MidiSynth(...)` sites — `midiPlaybackScheduler.ts:109`
(preview), `:137` (per-track bus), `MidiClipRenderer.ts:92` (offline). All three
route through the factory.

```ts
// src/engine/audio/IMidiSynth.ts
export interface IMidiSynth {
  scheduleNote(inst: MidiInstrument, pitch: number, velocity: number,
               when: number, duration: number): void;
  previewNote(inst: MidiInstrument, pitch: number, velocity?: number,
              duration?: number): void;
  stopAll(): void;
  /** Ensure samples for the given GM programs are loaded. No-op for simple-synth. */
  preload(programs: number[]): Promise<void>;
  readonly voiceCount: number;
}
```

`MidiSynth` (existing) implements `preload` as a no-op. `WavetableSynth` (new)
implements it as `bank.ensureLoaded(programs)`.

```ts
// src/engine/audio/createSynthForInstrument.ts
export function createSynthForInstrument(
  instrument: MidiInstrument,
  ctx: BaseAudioContext,
  destination: AudioNode,
): IMidiSynth {
  switch (instrument.kind) {
    case 'gm':           return new WavetableSynth(ctx, destination);
    case 'simple-synth': return new MidiSynth(ctx, destination);
  }
}
```

> Pass the whole `instrument` (not just `kind`) so the per-note `scheduleNote`
> carries the live program; one track bus then follows instrument edits without
> being rebuilt.

### 4.2 `GmSampleBank` — shared singleton, raw PCM

One instance, shared by every `WavetableSynth` across live + offline,
HMR-persisted per the singleton pattern in `CLAUDE.md §9`.

- `ensureLoaded(programs: number[]): Promise<void>` — fetch + parse the JSON for
  any not-yet-loaded program; dedup in-flight fetches.
- Stores **decoded Float32 PCM** per zone (see §5), **not** `AudioBuffer` and
  **not** compressed audio.
- `buildSource(program, pitch, isDrum, ctx)` → selects the zone for `pitch`, builds
  an `AudioBuffer` **for the given context's sample rate** synchronously (raw PCM →
  `ctx.createBuffer` + copy), computes `playbackRate` from the zone's root pitch.
  Cache built buffers keyed by `(program, zone, sampleRate)`.

Why raw PCM, not `decodeAudioData`:

- `decodeAudioData` resamples to *that context's* rate. The live context (44.1/48 k)
  and the export `OfflineAudioContext` (export rate) differ → you'd decode twice and
  still fight rate mismatches.
- Raw PCM lets us build an `AudioBuffer` for **any** rate **synchronously** after
  preload — exactly what the sync schedulers (§4.4) need.
- Parsing (base64 → Float32) is pure and unit-testable with no WebAudio.

### 4.3 `WavetableSynth` — `IMidiSynth` over the bank

- `scheduleNote(inst, pitch, vel, when, dur)`:
  - `src = bank.buildSource(inst.program, pitch, inst.isDrum, ctx)`; if `null`
    (not yet loaded) → skip (the preload contract should prevent this live).
  - `AudioBufferSourceNode` → `GainNode` (envelope) → `destination`, mirroring
    `MidiSynth`'s gain-envelope shape (`MidiSynth.ts:80–94`).
  - Sustained programs: `source.loop = true` + `loopStart/loopEnd` so long notes
    hold; the gain release fades out at `when + dur`.
  - **Drums** (`inst.isDrum`): pick the sample for the *note number*, play at native
    rate (no pitch shift), no loop.
- `previewNote` / `stopAll` / `voiceCount`: same shape as `MidiSynth`.

### 4.4 Preload orchestration (closes the async↔sync gap)

- **Live** (`midiPlaybackScheduler`): on scheduler start and whenever a MIDI track's
  instrument changes, `synth.preload(programsOfAllMidiTracks)` **before** the first
  `tick`. Until a program resolves, that track is briefly silent (acceptable) rather
  than glitching.
- **Export** (`AudioExportPipeline.extractAllAudio`, `:449`): preload the bank
  **once before** the clip loop (collect all GM programs), so `renderMidiClipToBuffer`
  (`:468`, already `await`ed) finds samples ready. Each per-clip `OfflineAudioContext`
  then builds rate-correct buffers from cached PCM.
- **Preview** (piano-roll draw/click): kick off `preload([program])` on instrument
  select so the first blip has sound.

## 5. Asset format & pipeline

`public/instruments/gm/0000.json … 0127.json` (+ a drums file/folder), one wavetable
per GM program. Lazy-fetched at runtime → **not** in the JS bundle. Stored as `.json`
(data, not their `.js`).

Schema (designed for zones + loops **now**, even if v1 ships single-zone, so we never
regenerate ~15 MB of assets twice):

```jsonc
{
  "program": 0,
  "name": "Acoustic Grand Piano",
  "isDrum": false,
  "sampleRate": 44100,
  "zones": [
    {
      "loKey": 0, "hiKey": 127,     // pitch range this zone covers
      "rootKey": 60,                // MIDI note the sample was recorded at
      "loopStart": 12345,           // sample frames, -1 = no loop
      "loopEnd": 56789,
      "envelope": { "attack": 0.0, "decay": 0.0, "sustain": 1.0, "release": 0.3 },
      "pcm": "base64-float32-mono"  // RAW PCM (see §4.2)
    }
  ]
}
```

- **v1**: single zone per program, single sample, pitch-shift via `playbackRate`.
- **v2 (later, same schema)**: multiple zones to avoid extreme pitch-shift artifacts;
  multi-velocity layers.
- **Converter**: a Node script (`scripts/build-gm-instruments.*`) reads FluidR3 `.sf2`,
  extracts per-program samples + loop points + key ranges, decodes to Float32, writes
  the JSON. Keep this **out of the app bundle**; run it offline to generate assets.
  Document provenance + MIT license in the output folder. The source `.sf2` stays out
  of the repo; only the generated `.json` is committed.

### 5.1 Fetch path gotcha

Fetch relative to **`import.meta.env.BASE_URL`** (the codebase already uses this, e.g.
`elevenLabsService.ts:658`), **not** a leading-slash `/instruments/...`, or it breaks
under a deployed subpath. `build:deploy` copies the assets into the output; CDN later
if size matters. A missing program file must **degrade gracefully** (log + silent
track, no crash).

## 6. Data model — discriminated union

Turn `MidiInstrument` into a real union (cleaner than optional `program?` fields; `tsc`
then enumerates every branch that must handle GM):

```ts
// src/types/midiClip.ts
export interface SimpleSynthInstrument {
  kind: 'simple-synth';
  waveform: OscillatorType;
  adsr: MidiAdsr;
  gain: number;
}
export interface GmInstrument {
  kind: 'gm';
  program: number;     // 0–127 GM program
  isDrum?: boolean;    // true = percussion kit (per-note sample, native rate)
  gain: number;        // 0–1 output gain (envelope/loop come from the sample zone)
}
export type MidiInstrument = SimpleSynthInstrument | GmInstrument;
```

- `MIDI_INSTRUMENT_OPTIONS` gains `{ kind: 'gm', label: 'General MIDI' }` → it surfaces
  in the header dropdown + properties tab automatically.
- Add a **GM program list** (`GM_PROGRAM_NAMES`, 128 names grouped into the 16 GM
  families) + drum kits, separate from the kind list.
- `getMidiInstrumentLabel` returns the **program name** for GM instruments.
- Replace `createDefaultMidiInstrument()` with kind-aware `createDefaultMidiInstrument(kind?)`
  (default simple-synth; `'gm'` → program 0, gain 0.8).
- **Audit every `.adsr` / `.waveform` access** — no longer always present (`tsc` lists them).
- **Persistence is free** — instrument serializes via the track `{...track}` spread;
  `program`/`isDrum` are plain data. Add load-time clamping (`program` 0–127) and a
  fallback to simple-synth on unknown `kind`. Update `composition.types.ts:39` to the
  union and add a GM case to `tests/unit/midiPersistence.test.ts`.

## 7. Store + UI

- **Store** `setTrackMidiInstrument` (`trackSlice.ts:833`) currently **always** spreads
  `adsr` (`:844`) — must branch: if `patch.kind` differs → replace with
  `createDefaultMidiInstrument(patch.kind)` merged with provided fields (clean shape
  swap, no stale `adsr` on GM); same kind → shallow merge, touch `adsr` only when
  `kind === 'simple-synth'`.
- **`MidiInstrumentTab.tsx`**: branch on `instrument.kind` — `simple-synth` keeps the
  waveform/ADSR/gain controls; `gm` shows a **grouped** program `<select>` (16 GM
  `<optgroup>`s + Drums) + drum toggle + gain (hide waveform/ADSR).
- **`TimelineHeader.tsx`** instrument dropdown is already driven by
  `MIDI_INSTRUMENT_OPTIONS`; keep the program picker in the properties tab to keep the
  header compact.

## 8. Phased delivery (checkpoint after each)

1. **Types + factory seam** — discriminated-union `MidiInstrument`, `IMidiSynth`,
   `createSynthForInstrument`, route the 3 `new MidiSynth` sites through it (no behavior
   change; simple-synth still works). Verify: build + existing MIDI tests green.
2. **Asset format + converter + one program** — define the JSON schema, write the
   FluidR3 `.sf2` → JSON converter, generate program 0 (piano) + one drum kit.
   Unit-test the **pure** base64→PCM + zone-select logic (no WebAudio).
   > **Split in delivery:** the schema (`src/types/gmAsset.ts`) + the pure
   > parse/zone/rate tests shipped *inside Phase 3* (where they're first used). The
   > offline `.sf2`→JSON converter + real FluidR3 assets ("**2b**") are deferred
   > until the runtime is proven, so ~15 MB isn't generated against an unvalidated
   > format. Phase 3 runs on a hand-built placeholder sine (`public/instruments/gm/0000.json`).
3. **`GmSampleBank` + `WavetableSynth`** — singleton bank (raw PCM, per-rate buffer
   build), melodic path (loop + envelope). Verify: a GM piano track is audible live.
4. **Preload orchestration** — live preload-on-start/instrument-change; export
   preload-before-loop; preview preload-on-select. Verify: first notes sound, no dropped
   attacks; export contains GM audio.
5. **Drums** — per-note sample selection, native rate. Verify: a drum-kit track.
6. **Full program set + UI** — generate all 128 programs (+ kits), grouped program picker
   in `MidiInstrumentTab`, GM label in `getMidiInstrumentLabel`. Verify: save/reload keeps
   instrument selection.

> Like the SpessaSynth alternative, you can ship **Piano first** end-to-end (program 0
> only) before mass-producing assets — the dropdown can list all 128 names with only
> generated programs resolving to real files; missing files degrade gracefully.

## 9. Files

**New**
- `src/engine/audio/IMidiSynth.ts`
- `src/engine/audio/createSynthForInstrument.ts`
- `src/engine/audio/WavetableSynth.ts`
- `src/engine/audio/GmSampleBank.ts` (singleton, HMR-persisted)
- `src/types/gmPrograms.ts` (`GM_PROGRAM_NAMES` + families + drum kits)
- `public/instruments/gm/*.json`
- `scripts/build-gm-instruments.*` (offline `.sf2` → JSON converter)
- tests: `gmSampleBank.test.ts` (pure parse/zone-select)

**Modified**
- `src/types/midiClip.ts` (union, options, defaults, label)
- `src/services/audio/midiPlaybackScheduler.ts` (factory + preload, 2 synth sites)
- `src/engine/audio/MidiClipRenderer.ts` (factory + ensure-loaded, 1 synth site)
- `src/engine/audio/AudioExportPipeline.ts` (preload bank once before clip loop)
- `src/engine/audio/MidiSynth.ts` (implement `IMidiSynth`, no-op `preload`)
- `src/components/panels/properties/MidiInstrumentTab.tsx` (GM branch + program picker)
- `src/stores/timeline/trackSlice.ts` (`setTrackMidiInstrument` union branch)
- `src/services/project/types/composition.types.ts` (union type)

## 10. Testing discipline

Mirror the existing pure/impure split (`planMidiClipNotes` is pure and node-testable;
WebAudio is isolated). Keep **base64→PCM parsing, zone selection, and `playbackRate`
math pure and unit-tested**; isolate `createBuffer` / `AudioBufferSourceNode` /
`OfflineAudioContext` so the suite runs in node with no real WebAudio (matching
`midiSynth.test.ts` / `midiClipRenderer.test.ts`). Full gate (`build` + `lint` + `test`)
before commit.

## 11. Out of scope (future)

- **SpessaSynth / real SF2-SF3-DLS engine** (Apache-2.0, AudioWorklet) — the eventual
  "real DAW" upgrade. Keep on the radar; not #193.
- Multi-velocity layers, per-zone filters, GM2/GS/XG extensions.
- User-imported SoundFonts; CC / pitch-bend / expression automation.
- Piano-roll velocity editing (note path can be made velocity-ready now).
- Moving the bank to a CDN (kept as a hosting swap behind `GmSampleBank`).

## References

- WebAudioFont (GPL-3.0 code — **do not ship**) — github.com/surikov/webaudiofont
- FluidR3 GM (MIT sounds — **our default**) — member.keymusician.com/Member/FluidR3_GM/README.html
- GeneralUser GS (free commercial) — schristiancollins.com/generaluser.php
- SpessaSynth (Apache-2.0 — future engine, not now) — github.com/spessasus/spessasynth_core
</content>
