# Simple Synth → Subtractive Synth Upgrade Plan

Status: **draft / planning** — no code yet.

Turns the "Simple Synth" (`kind: 'simple-synth'`) from a bare oscillator + amp
ADSR into a real subtractive synth: resonant lowpass filter, dedicated filter
envelope, LFOs, an additive mod-matrix, a curated set of piano-roll CC lanes,
timeline automation of every parameter, and a small preset bank.

This is a **quality upgrade to our own in-app instrument**, not a
Serum/Vital competitor. Keep it lean; build the real architecture but not more
synth than the editor needs.

The **Wavetable Synth** (`kind: 'gm'`) is untouched. The name **"Simple Synth"**
stays.

---

## 1. Current state (grounded)

- `src/engine/audio/MidiSynth.ts` (154 LOC) — one `OscillatorNode` → `GainNode`
  (amp ADSR) → destination, per voice. **No filter, no LFO, no modulation.**
- Pure Web Audio node graph; the **same code renders in `OfflineAudioContext`**
  for export (`src/engine/audio/MidiClipRenderer.ts`).
- Three note producers route through the `IMidiSynth` seam: the live look-ahead
  scheduler `src/services/audio/midiPlaybackScheduler.ts` (399 LOC, Chris-Wilson
  two-clock, `LOOKAHEAD_SECONDS = 0.12`; re-anchors/flushes on seek + loop),
  the piano-roll `previewNote` blip, and the offline `MidiClipRenderer`.
- **Schedule-ahead model:** `scheduleNote(inst, pitch, velocity, when, duration)`
  bakes the whole envelope onto AudioParams up front; there is **no live
  note-off**. The scheduler today passes **exactly** those five args — no CC /
  expression / automation channel exists yet.
- **No voice cap / no voice stealing** — every note is its own voice.
- Data model `SimpleSynthInstrument` in `src/types/midiClip.ts`:
  `{ kind, waveform, adsr, gain }` — plain serializable, lives on the **track**
  (`track.midiInstrument`). Notes carry only `{ pitch, start, duration, velocity }`.
- UI: `src/components/panels/properties/MidiInstrumentTab.tsx` (waveform select +
  4 ADSR sliders + gain).
- Piano roll already has a controller-lane system:
  `src/components/pianoRoll/controllerLanes/` (`PianoRollControllerArea.tsx`,
  `pianoRollLaneTypes.ts`, `PianoRollVelocityLane.tsx`). **But it is velocity-only
  today**: the single lane is a `note-property` lane editing `note.velocity` via
  `updateMidiNote`. `LaneKind = 'note-property' | 'cc'` exists as a type, but
  **no `'cc'` lane and no breakpoint/automation data model exist** — `'cc'` is a
  placeholder. Adding the four CC lanes is therefore **new breakpoint-envelope
  editing**, not an extension of velocity editing (see §6C).

## 2. Hard constraints (do not violate)

- **Offline-export parity:** every feature must render identically in
  `OfflineAudioContext`. Favor native nodes; **`BiquadFilterNode` first**,
  AudioWorklet deferred to Phase 2.
- **Schedule-ahead:** modulation and automation are *baked onto AudioParams* at
  schedule time using known note duration + automation data. No reliance on live
  note-off events.
- **Serializable durable data:** instrument config + presets stay plain JSON. No
  runtime handles (nodes, contexts) in stores/project data (CLAUDE.md §6).
- **700 LOC product-source ceiling** — the synth will need to be split into a
  small module set (see §6), not one growing file.

## 3. Design decisions (locked)

- **Additive mod-matrix.** Every destination has a base value; filter envelope,
  LFOs, velocity, CC lanes, and timeline automation all **sum** onto it. In Web
  Audio this is literal: multiple modulation source `GainNode`s
  `.connect()` into the same target AudioParam (e.g. `filter.frequency`), and the
  API sums them with the param's intrinsic value.
- **Piano-roll CC lanes = exactly four** (the "performed" gestures):
  1. Mod wheel → **vibrato depth**
  2. Expression → **amp**
  3. **Filter cutoff** (CC74)
  4. **Pitch bend**
  Everything else (LFO rate, resonance, env times, osc mix, keytracking amount…)
  is edited in the synth panel and automatable on the **timeline**, but is *not*
  a piano-roll lane.
- **CC lanes vs mod-matrix — one model, no double-routing.** The four CC lanes
  are **not** a separate hardwired system layered on top of the mod-matrix; each
  lane is simply a `source` the mod-matrix already knows (`modWheel`,
  `expression`, `cutoffCC`, `pitchBend`), pre-populated with its standard
  destination row. So "mod wheel → vibrato depth" **is** the matrix row
  `modWheel → lfo0.depth`; it must not also appear as a second, independent
  routing. The lane draws the source's time curve; the matrix row decides where
  that source lands and with what amount. One source, one routing.
- **PWM: out of scope.**
- **BiquadFilter-first**, per-voice; AudioWorklet ladder/SVF filter is a
  documented Phase-2 upgrade if we want analog-grade resonance.
- **LFO = per-voice by default, with a per-LFO "global" toggle** (global = one
  shared free-run/phase-locked LFO for all voices).
- **Synth UI stays in the Properties tab for now**, but built as **layout-
  agnostic section components** (`OscillatorSection`, `FilterSection`,
  `EnvelopeSection` reused for amp + filter env, `LfoSection`,
  `ModMatrixSection`) — each takes `(instrument, onChange)` and knows nothing
  about where it is mounted. The tab stacks them in a scroll column now; a future
  dedicated synth editor re-hosts the *same* components in a signal-flow layout.
  No rewrite, just re-mounting.
- **Automation is stored on the CLIP** as time-based breakpoint envelopes
  (`clip.automation = { cutoff, mod, expression, pitchBend }`), not per-note.
  Matches the controller-lane UI, the real MIDI-CC model, and the schedule-ahead
  renderer. Per-note MPE is a possible *separate* future feature, not this.

## 3a. Durable vs disposable — the DSP is a placeholder

**The JS Web Audio node graph is throwaway.** The DSP is expected to be replaced
later by **a compiled DSP core running inside an AudioWorklet** — most likely
authored in **FAUST** (which compiles to WASM and whose standard web target is
exactly a WASM module in an AudioWorklet), *not* hand-written WASM or JS. This is
a direction, not a committed plan; the whole point below is that Phase 1 does not
depend on which tool wins. So do **not** invest in generalizing or sharing the JS
DSP node code between the two synths — keep it simple and Simple-Synth-specific;
it gets replaced wholesale.

Invest instead in the layers that **survive that DSP swap untouched** — they are
implementation-agnostic (the seam takes a note + automation window in and audio
out; it does not care whether FAUST, WASM, or JS produces the audio):

1. **Patch schema** — the serializable `SimpleSynthInstrument` (oscillator,
   filter, envelopes, LFOs, mod-matrix routing). A WASM engine reads the *same
   JSON*.
2. **Clip automation data** — the four CC lanes + pitch-bend curves.
3. **UI** — the layout-agnostic section components above.
4. **The `IMidiSynth` seam** — the swap point. A FAUST/WASM AudioWorklet DSP core
   is just a new `IMidiSynth` implementation; nothing above it changes.

Consequence for the seam: extend the schedule signature so a note is passed
**together with its automation window** (not just `pitch/velocity/when/duration`),
so a future compiled engine can consume a note + its modulation in one call
without reshaping the API. Phase 2 = "the DSP core moves into an AudioWorklet"
(FAUST-compiled WASM being the likely tool); it is a future direction, not
committed scope.

**Write-set for the seam change (all of these, in one packet):**
- `IMidiSynth.scheduleNote` gains an optional trailing `automation` window arg.
- **Both** implementations change: `MidiSynth` (consumes it) **and**
  `WavetableSynth` (accepts + ignores it — it also `implements IMidiSynth`).
- **All three callers**: `midiPlaybackScheduler.ts` slices `clip.automation` to
  the note's `[start, start+duration]` window and passes it (it already holds the
  `clip` for dedup, so the data is in hand); `MidiClipRenderer` passes the clip's
  full automation; `previewNote` passes `undefined` (no clip context — preview is
  patch-only, no performed automation, which is fine).
- Keep the arg **optional** so the Wavetable path and preview compile unchanged
  and the diff stays additive.

## 4. Per-voice node graph (v1)

```
OscillatorNode ──▶ BiquadFilterNode(lowpass) ──▶ GainNode(amp ADSR) ──▶ dest
                        ▲ .frequency                ▲ .gain
```

**Read this before writing the graph — it is the single most important DSP
detail.** In Web Audio an AudioParam's value is its **intrinsic** value (what
`setValueAtTime` / ramps / `setValueCurveAtTime` write) **plus the sum of every
connected input node**. You therefore **cannot** bake more than one automation
writer onto the same param's intrinsic value: `setValueCurveAtTime` throws
`NotSupportedError` if it overlaps other scheduled events. Filter env **and**
cutoff automation **and** keytrack all targeting `filter.frequency` directly
would collide.

**So the additive matrix is built with carrier nodes, not by scripting the
param.** Each destination param keeps a **constant intrinsic value = its base**,
and every modulator is its own node summed via `.connect()`:

```
filter.frequency.value = base cutoff (constant)   ◀── never scripted directly
   + filterEnvCarrier   (ConstantSourceNode.offset, ADSR ramps) → Gain(envAmount)
   + cutoffLfo          (OscillatorNode → Gain(depthHz))
   + cutoffAutoCarrier  (ConstantSourceNode.offset, setValueCurveAtTime) → Gain
   + keytrackConst      (ConstantSourceNode.offset = f(pitch) · keytrack)
osc.frequency.value    = note pitch (setValueAtTime)
   + vibratoLfo         (OscillatorNode → Gain(depthCents→Hz))
   + pitchBendCarrier   (ConstantSourceNode.offset, setValueCurveAtTime → Hz)
amp.gain               = ampADSR ramps (intrinsic — single writer, OK)
   × expression/tremolo  (see note below)
```

- **Filter env / automation ride on `ConstantSourceNode.offset`**, not on
  `filter.frequency`. The env's ADSR ramps and the automation curve write the
  *carrier's* offset; the carriers sum into `filter.frequency` alongside base +
  LFO + keytrack. This is what makes the matrix genuinely additive.
- **Filter env uses `linearRampToValueAtTime`, NOT exponential.** `envAmount`
  can be **negative** (per §10 schema) and a carrier offset legitimately crosses
  or hits 0 — exponential ramps can't target/cross 0. (The **amp** env stays
  exponential; `amp.gain` is a single intrinsic writer and never reaches 0.)
- **Amp `.gain` is the one param with a single intrinsic writer** (the amp ADSR),
  so it may keep `exponentialRampToValueAtTime` as today. Expression/tremolo
  scaling of amp is applied via a **second gain stage in series** (amp ADSR gain
  → expression gain → dest), not by summing onto `amp.gain` — amplitude scaling
  is multiplicative, not additive.
- **LFO** = `OscillatorNode` → `GainNode(depth)` → target param. Free-run or
  tempo-synced (rate derived from BPM). **Per-voice by default** (retrigger +
  true vibrato), with a per-LFO **global** toggle (shared, phase-coherent).
- All carriers are `ConstantSourceNode`s (or `OscillatorNode`s) with `.start()` /
  `.stop()` bounded to the voice window — deterministic in both live and offline,
  and torn down with the voice.

## 5. Voice management

Per-voice filters cost more (each voice is now osc + filter + amp + carriers +
LFOs), and there is currently **no ceiling**. Add a voice cap (~32,
configurable) — but note it needs **two distinct mechanisms**, because live and
offline are different worlds:

- **Live path (scheduler):** runtime **voice stealing** — oldest / quietest-in-
  release first — as voices are created on the fly. Clean teardown with the
  existing 20 ms de-zipper fade in `stopAll`.
- **Offline path (export):** there is **no runtime stealing**. `MidiClipRenderer`
  schedules *every* note into one `OfflineAudioContext` up front and never calls
  `stopAll`, so "currently sounding voices" doesn't exist. The cap must be
  enforced **analytically at plan time** in `planMidiClipNotes`: compute note
  overlap/concurrency and drop or truncate the lowest-priority overlapping notes
  **before** scheduling, using the same priority as live stealing so export
  matches playback. **This is a hard offline-parity requirement — a live-only
  stealing policy would make exports diverge from what the user hears.**

The two mechanisms should share one priority function (oldest / quietest-in-
release) so both paths make the same choices.

## 6. Workstreams

**A. Synth DSP — disposable placeholder** (`src/engine/audio/`)
- Extend the per-voice builder to `osc → filter → amp`.
- Filter ADSR (schedule-ahead) + keytracking.
- Per-voice LFO source(s) + tempo sync + global toggle.
- Additive summing buses into shared AudioParams.
- Voice cap + stealing.
- **Keep it Simple-Synth-specific and simple — do NOT generalize/share DSP node
  code with the Wavetable synth.** This layer may be replaced by a compiled
  AudioWorklet core (likely FAUST→WASM) later (see §3a). Split only as needed to
  stay under the ceiling.

**B. Data model + mod-matrix — DURABLE** (`src/types/midiClip.ts`, stores)
- Extend `SimpleSynthInstrument`: `filter { cutoff, resonance, envAmount,
  keytrack }`, `filterEnv { a,d,s,r }`, `lfos[]` (each with stable `id` +
  `global` flag), `modMatrix[]` (source → destination → amount).
- **Type the mod-matrix routing — do not use dotted strings.** This is the
  durable layer that survives the WASM migration (§3a), so `destination` must be
  a typed discriminated union (e.g. `{ kind: 'lfoDepth', lfoId }`,
  `{ kind: 'filterCutoff' }`, `{ kind: 'filterEnvAmount' }`, …) and LFOs are
  referenced by **stable id, not positional `lfo0`** (positional indices rot when
  LFOs reorder). `tsc` must be able to check every routing.
- Add **clip-level** automation data: `clip.automation = { cutoff, mod,
  expression, pitchBend }` as time-based breakpoint envelopes (NOT per-note).
  `TimelineClip` has **no `automation` field today** (only an unrelated mixer
  `automationMode` in `audio.ts`) — add it on both the runtime and serializable
  `TimelineClip` variants in `src/types/timeline.ts`, and a new mutating action
  in `src/stores/timeline/midiClipSlice.ts` (today it only touches `.notes`).
- Extend the **`IMidiSynth` schedule seam** to pass a note **plus its automation
  window** (see the §3a write-set — touches both synths + all three callers).
- History/undo wiring: `HistoryTimelineClipEditState` already snapshots
  `midiData`/`midiInstrument`; add `automation` in **two places** in
  `historyTimelineEditState.ts` (the interface ~L102 and
  `toHistoryTimelineClipEditState` ~L495). It **must be plain JSON-serializable**
  (no runtime handles / `undefined` / payload keys) or the boundary assertion
  (~L267) throws.

**C. UI — DURABLE** (piano roll + properties panel + timeline)
- Build **layout-agnostic section components** (`OscillatorSection`,
  `FilterSection`, `EnvelopeSection`, `LfoSection`, `ModMatrixSection`); mount
  them in `MidiInstrumentTab.tsx` now, re-host in a dedicated editor later.
- **Build a breakpoint-envelope lane editor** — this is genuinely new, not an
  extension. The existing `controllerLanes/` system is **velocity-only and
  per-note** (`updateMidiNote`); it has no continuous-curve editing. The four CC
  lanes are clip-level breakpoint envelopes drawn/dragged as points on a curve
  and stored on `clip.automation` (§6B). Scope this as a new lane `kind: 'cc'`
  with its own draw/drag/interpolate interaction, coexisting with the per-note
  velocity lane in the same area. This is the largest single piece of UI work.
- Wire timeline/clip automation for the remaining parameters.

**D. Presets — DURABLE**
- Serializable JSON patch = the full `SimpleSynthInstrument` shape.
- Small built-in bank + user save/load. Concrete starter values in §10.

## 7. Phasing

- **Phase 1 (node graph, ships the feature):** BiquadFilter + filter env + LFO +
  additive mod-matrix + 4 CC lanes + timeline automation + presets. Offline-safe,
  no AudioWorklet.
- **Phase 2 (future direction, NOT committed scope):** replace the JS node-graph
  DSP with a **compiled DSP core running inside an AudioWorklet** — likely
  authored in **FAUST** (→ WASM), not hand-written WASM/JS — behind the same
  `IMidiSynth` seam. Patch schema, clip automation, mod-matrix, presets, and UI
  carry over **unchanged** — that is the whole point of §3a. The tool choice is
  open; Phase 1 is deliberately built so it doesn't matter.

## 8. Resolved decisions (were open questions)

- **LFO default:** per-voice, with a per-LFO global toggle. ✔
- **Synth UI home:** stays in the Properties tab now, built as layout-agnostic
  section components so it can move to a dedicated editor with no rewrite. ✔
- **Automation storage:** clip-level breakpoint lanes (`clip.automation`), not
  per-note. ✔
- **Sharing DSP with the Wavetable synth:** no — the JS DSP is a disposable
  placeholder (a compiled AudioWorklet core, likely FAUST→WASM, may replace it
  later); invest in the durable schema/UI/seam instead, not in reusable DSP node
  code. ✔

Still genuinely open:
- Automation-curve resolution / breakpoint density + interpolation for
  `clip.automation` lanes.
- Exact voice-cap number and stealing heuristic (tune against dense MIDI).

## 9. Risks

- BiquadFilter instability when modulating `.frequency` fast / at high Q — clamp
  ranges, de-zipper.
- `exponentialRampToValueAtTime` cannot target 0 (already handled in amp env;
  apply same care to filter env / mod).
- Voice-cap regressions on dense MIDI — needs a focused test.
- Offline vs live divergence — every feature validated in both paths.

## 10. Preset bank (concrete starting values)

### Patch shape (serializable — the durable schema)

```jsonc
{
  "kind": "simple-synth",
  "gain": 0.8,                    // 0..1 master
  "waveform": "sawtooth",         // sine | triangle | sawtooth | square
  "adsr": {                       // amplitude envelope, seconds (sustain 0..1)
    "attack": 0.01, "decay": 0.15, "sustain": 0.8, "release": 0.2
  },
  "filter": {
    "cutoff": 1200,               // Hz, base cutoff
    "resonance": 2,               // BiquadFilter Q (musical range ~0.7..15)
    "envAmount": 1500,            // Hz added to cutoff at filter-env peak (can be negative)
    "keytrack": 0.4               // 0..1, how much cutoff follows note pitch
  },
  "filterEnv": {                  // dedicated filter envelope, seconds
    "attack": 0.01, "decay": 0.2, "sustain": 0.4, "release": 0.2
  },
  "pitchBendRange": 2,            // semitones, ± range for the pitch-bend CC lane
  "lfos": [                       // 0..N; each is per-voice unless global:true
    { "id": "lfo-a",              // STABLE id — matrix refers to this, not "lfo0"
      "target": "pitch", "shape": "sine", "rate": 5.0, "depthCents": 6,
      "global": false,
      "fadeIn": 0 }               // reserved: delayed-vibrato fade-in (v1 = 0/off)
  ],
  "modMatrix": [                  // typed routings — NOT dotted strings
    { "source": "modWheel", "destination": { "kind": "lfoDepth", "lfoId": "lfo-a" }, "amount": 1.0 },
    { "source": "velocity", "destination": { "kind": "filterEnvAmount" }, "amount": 0.5 }
  ]
}
```

- **`destination` is a typed union, not a string** (see §6B): `{ kind:
  'lfoDepth', lfoId }`, `{ kind: 'filterCutoff' }`, `{ kind: 'filterEnvAmount' }`,
  `{ kind: 'ampGain' }`, `{ kind: 'pitch' }`, … `tsc`-checked; LFOs referenced by
  `id`. The dotted `"lfo0.depth"` form is illustrative shorthand only — do not
  ship it.
- **`pitchBendRange`** (semitones) is required for the pitch-bend lane — the lane
  carries a normalized ±1 curve; the range turns it into cents at bake time.
- **`lfo.fadeIn`** is a reserved seam for delayed vibrato (strings). v1 ships it
  as `0` (no fade) so adding real fade-in later is not a schema migration.

**Units:** cutoff/envAmount in **Hz**; resonance = **Q**; LFO pitch depth in
**cents**, filter-target depth in **Hz**, amp-target (tremolo) depth in **0..1**;
LFO `rate` in **Hz** (or a tempo-sync division in a later field). `modWheel →
{ kind: 'lfoDepth', lfoId: 'lfo-a' }` is the standard "mod wheel adds vibrato"
routing — the preset's own `depthCents` is the *floor*, the wheel adds on top
(additive matrix). This is the *same* routing the mod-wheel CC lane draws (§3),
expressed once — not a second parallel path.

### Starter bank (8 patches, real values)

| Preset | Wave | Amp A/D/S/R (s) | Cutoff Hz | Q | EnvAmt Hz | Keytrk | FiltEnv A/D/S/R (s) | LFO |
|---|---|---|---|---|---|---|---|---|
| **Sub Bass** | sine | 0.005/0.12/0.9/0.08 | 300 | 1 | 200 | 0.2 | 0.005/0.1/0.5/0.1 | — |
| **Acid Bass** | sawtooth | 0.005/0.15/0.7/0.08 | 350 | 9 | 2600 | 0.3 | 0.005/0.14/0.15/0.1 | — |
| **Pluck** | sawtooth | 0.002/0.18/0.0/0.12 | 800 | 6 | 3000 | 0.5 | 0.002/0.15/0.0/0.1 | — |
| **Warm Pad** | sawtooth | 0.8/0.5/0.85/1.2 | 1000 | 1 | 600 | 0.4 | 1.0/0.8/0.6/1.5 | pitch 4.5Hz 4c; cutoff 0.25Hz 300Hz |
| **Bright Lead** | square | 0.01/0.2/0.85/0.15 | 2500 | 3 | 1500 | 0.7 | 0.01/0.25/0.5/0.2 | pitch 5.5Hz 8c (via mod wheel) |
| **Strings** | sawtooth | 0.25/0.3/0.9/0.6 | 1600 | 1.5 | 400 | 0.5 | 0.3/0.5/0.7/0.6 | pitch 5Hz 6c |
| **Organ** | square | 0.005/0.0/1.0/0.02 | 3500 | 0.7 | 0 | 0.5 | — (flat) | — |
| **Wobble Bass** | sawtooth | 0.005/0.1/0.9/0.1 | 500 | 8 | 2500 | 0.3 | 0.005/0.1/0.5/0.1 | cutoff 2Hz (tempo-sync 1/8) 2000Hz, global |

Notes:
- **Sub Bass** — sine + gentle env, almost no filter movement: clean low end.
- **Acid Bass / Wobble** — high Q + big filter env (or LFO→cutoff) = the classic
  squelch; Wobble's LFO is **global + tempo-synced** so all notes lock to the grid.
- **Pluck** — amp sustain 0 + fast filter env decay to 0 = snappy, filter closes
  as the note plays.
- **Warm Pad / Strings** — long attacks, slow vibrato; a slow cutoff LFO on the
  pad adds shimmer. (An LFO **delay/fade-in** for strings-style delayed vibrato is
  a nice later addition — not in v1.)
- **Bright Lead** — vibrato depth sits near 0 and comes from the **mod wheel**
  (`modWheel → { kind: 'lfoDepth', lfoId }`), so it's expressive rather than
  always-on.
- **Organ** — deliberately static (no filter env, no LFO) to show the range.

These are *starting points* to tune by ear once the DSP is running; the numbers
are chosen to be musically sane, not final. The 8 patches double as **schema
test fixtures** — every field the presets use must round-trip through
save/load.

---

## 11. Testing & verification

- **Offline determinism (the parity guarantee):** render a patch through
  `renderMidiClipToBuffer` **twice** and assert byte-identical buffers, and
  assert the filter/env actually changed the output vs a filter-bypassed render.
  This is the concrete proof of the §2 offline-export-parity constraint.
- **`MidiSynth` unit tests** (extend `tests/unit/midiSynth.test.ts`): filter is
  in the graph, filter-env carrier ramps are scheduled with `linearRamp` (not
  exponential) and tolerate negative `envAmount`, LFO/carrier nodes start+stop
  within the voice window, no `setValueCurveAtTime` overlap throw on the shared
  params.
- **Voice-cap parity** (extend `tests/unit/midiClipRenderer.test.ts`): a dense
  overlapping-note clip caps to N in `planMidiClipNotes`, and the offline
  plan-time cap drops the **same** notes the live stealing policy would — one
  shared priority function, tested once.
- **Scheduler** (`src/services/audio/midiPlaybackScheduler.ts` — **currently has
  no test**): add coverage for slicing `clip.automation` to a note's window and
  passing it through the widened seam; guard the seek/loop re-anchor path against
  regressions now that more state is baked per note.
- **Serializability guard** (extend `tests/unit/midiClipSlice.test.ts` /
  history): `clip.automation` and the extended instrument survive a history
  snapshot round-trip and violate no `historyTimelineEditState` boundary
  assertion (plain JSON only).

---

## 12. Implementation status (issue #298 branch)

- **Packet 1 — data model + `IMidiSynth` seam (durable): DONE.** Extended
  `SimpleSynthInstrument` (filter/filterEnv/lfos/typed modMatrix/pitchBendRange),
  `MidiClipAutomation` + `clip.automation` on all clip variants, widened
  `scheduleNote` with the note-local automation window, slice helper, history +
  save/load round-trip, store actions.
- **Packet 2 — subtractive DSP (disposable): DONE.** `osc → BiquadFilter → amp`,
  carrier-node additive matrix, filter env (linear), keytrack, per-voice LFOs,
  live voice stealing + offline analytic cap. New Simple-Synth tracks default to a
  subtractive patch (sawtooth + lowpass + filter env); legacy saved instruments
  stay bare (back-compat). Global LFO renders per-voice for now; the JS DSP honors
  a subset of mod-matrix routings (velocity→filterEnvAmount/filterCutoff) plus the
  four canonical CC-lane destinations.
- **Packet 3 — UI (durable): DONE.** Layout-agnostic synth sections
  (`Oscillator/Filter/Envelope/Lfo/ModMatrix`) in `MidiInstrumentTab`; CC lanes as
  an SVG breakpoint editor with a lane selector (Option A — one lane visible at a
  time) in the controller area, editing `clip.automation`.
- **Packet 4 — presets: DONE.** Built-in bank of the 8 starter patches
  (`src/engine/audio/synth/simpleSynthPresets.ts`), user save/load persisted in
  `settingsStore.simpleSynthUserPresets`, and a `PresetSection` picker at the top
  of the synth panel. Presets are plain-JSON `SimpleSynthInstrument` patches that
  round-trip losslessly (schema fixtures).

**Phase 1 is functionally complete** (all four packets). Remaining items are the
§13 deferred follow-ups, not Phase-1 scope.

## 13. Deferred follow-ups (post-Phase-1)

Captured so they aren't lost; not yet built.

- **Automation ↔ instrument-UI linkage (the "automate the real instrument"
  gap).** Today the panel sliders are the *static base* and the CC lanes are a
  *separate additive curve*; editing a lane never moves the corresponding slider,
  and the sliders don't move during playback. Two improvements, in this order:
  - **(A) Motorized faders** — during playback, instrument controls animate to
    their live automated value (base + automation sampled at the playhead). Purely
    visual read-out overlay (do NOT write the animated value back to the base
    patch); keeps the additive audio model. This is the direct answer to "I want
    to see automation on the real instrument."
  - **(B) Absolute instrument-parameter automation** — for instrument *knobs*
    (cutoff first, then other panel params) the lane should BE the parameter value
    over time and the knob follows it, instead of adding an offset on top of the
    base. Needs the DSP bake path + the cutoff-lane mapping reworked from additive
    to absolute. Leave **mod / expression / pitch bend** additive — those are
    genuine performance controllers (CC1/CC11/bend sit *on top of* the patch), not
    knobs. Recommended after (A), once the movement is visible.
- **MIDI clip cut/merge automation splitting.** Cutting a MIDI clip splits its
  notes (`partitionMidiNotesAtCut`) but not `clip.automation`; the two halves
  should each get the automation segment inside their window (and merge should
  concatenate). Low-frequency edge case, deferred until it bites.
- **Global (shared, phase-coherent) LFO.** The `global` flag is stored but v1
  renders every LFO per-voice.
- **Tempo-synced LFO rate.** Schema ships free-run Hz; a tempo-sync division field
  is a later add (Wobble Bass wants 1/8-note sync).

---

## 14. Motorized-fader infrastructure (§13-A, promoted to active) — GENERAL

Deferred follow-up (A) is being built now, but **as instrument-agnostic
infrastructure**, not a Simple-Synth one-off. The goal: any instrument (Simple
Synth today, Wavetable next, a compiled-DSP instrument later) declares its
parameters once, and the UI can show the **live automated value** of any
parameter so the user *sees on the panel what is changing and to what value*.

### 14.1 Core decision — re-derive, don't read the DSP

The audio bakes schedule-ahead onto AudioParams and must render identically
offline; the live DSP value is not cleanly readable and won't be once the DSP
moves to a FAUST/WASM worklet (§3a). So the displayed value is **re-derived**
from data we already own — `base patch value + clip-automation lane sampled at
the playhead` (`sampleLaneAt` in `midiAutomationWindow.ts`, already pure). This
evaluator is the single source of truth: deterministic, offline-parity, and
**DSP-swap-proof** (same durable tier as the schema + seam). It never writes the
animated value back to the base patch — the additive audio model is untouched.

### 14.2 Scope — Tier 1 only (locked)

- **Tier 1 (this work):** clip-level automation (the four CC lanes) + base.
  Instrument-agnostic, needs nothing from the DSP.
- **Tier 2 (documented seam, NOT built):** per-voice modulation (filter env,
  LFO, velocity) is per-note and only exists while a voice sounds; a faithful
  read-out would need an optional `getMeter()` tap on `IMidiSynth`, which is
  inherently per-DSP. Left as a seam for after the WASM direction settles.

### 14.3 The four pieces

1. **Parameter descriptors, per instrument `kind` (registry).** Each instrument
   lists its animatable params: stable `id` (e.g. `'filter.cutoff'`), label,
   min/max, unit, `getBase(inst)`, the feeding automation `lane`
   (`keyof MidiClipAutomation` | none), and a `combine(base, laneNorm)` rule
   (additive for mod/expression/pitchBend; the cutoff lane's mapping normalized
   0..1 → Hz). A new instrument adds one descriptor list; everything downstream
   just works. Registry: `getInstrumentParamModel(kind)`.
2. **Pure evaluator** — `evaluateParamAt(descriptor, instrument, automation,
   time)`: `combine(getBase, sampleLaneAt(automation[lane], time))`. Returns
   `undefined` when the param has no active lane, so the UI knows not to animate.
3. **Live-value bus driven imperatively by the playhead clock.** Pushing the
   playhead into Zustand every frame would re-render the whole properties panel;
   instead a single rAF subscription (the clock the piano-roll playhead already
   follows) samples time, runs the evaluator for the *subscribed* params, and
   pushes values into a lightweight non-React channel. Controls update their own
   DOM. Zero React re-renders per frame — same ref-follow pattern as
   `PianoRoll.syncRulerScroll`.
4. **Generalized animated control** — extend `SynthSlider` into an
   `AnimatedParamControl(paramId, …)` that subscribes to the bus and paints a
   **ghost thumb + fill** at the live value in a distinct color (glow when
   moving). The user's real thumb stays at the *base* value and stays editable.
   Any instrument's UI reuses it. Fixes the earlier gap for free: editing a CC
   lane now moves the matching slider's ghost, because both read one evaluator.

### 14.4 Packets

- **Packet A (durable, pure):** descriptor types + simple-synth descriptor list +
  registry + `evaluateParamAt`, in `src/services/midi/instrumentParams/`. Light
  unit test. No UI, no clock.
- **Packet B:** live-value bus + playhead-clock driver hook (imperative).
- **Packet C:** `AnimatedParamControl` (ghost thumb) + wire descriptors into the
  synth sections. Check in on the visual/UX before finalizing.

Simple-Synth Tier-1 param ↔ lane map: **Filter cutoff ↔ `cutoff` lane**
(0..1→Hz), **Gain/amp ↔ `expression` lane** (additive scale), **LFO(pitch)
depth ↔ `mod` lane** (additive vibrato). Pitch bend has no natural panel slider
(small pitch read-out only, or skip a ghost). Wavetable registers `gain` (no
lanes yet → no animation, but the plumbing is present).

### 14.5 Implementation status — Tier 1 DONE (uncommitted)

- **Packet A (durable, pure): DONE.** `src/services/midi/instrumentParams/`
  (`instrumentParamTypes.ts`, `simpleSynthParams.ts`, `index.ts` = registry
  `getInstrumentParamModel` + `evaluateParamAt`). CC-range mapping constants
  (`CUTOFF_CC_RANGE_HZ`, `MOD_WHEEL_VIBRATO_CENTS`) moved into the shared pure
  leaf `synthVoiceMath.ts` so the DSP bake and the UI evaluator use ONE source of
  truth. Test `tests/unit/instrumentParams.test.ts`.
- **Packet B (bus + clock): DONE.** `liveParamBus.ts` (framework-free pub/sub),
  `activeMidiClip.ts` (`activeMidiClipAt`/`clipContentTimeAt` — MIDI clip under
  the playhead on a track, global→content time), driver hook
  `synthSections/useLiveInstrumentParams.ts` (rAF loop reading
  `getPlayheadPosition`, publishes per-param live values while playing). Test
  `tests/unit/liveParamBus.test.ts`.
- **Packet C (UI): DONE.** `SynthSlider` extended with optional `paramId` → an
  imperative ghost (fill + thumb + value badge, teal, `.is-automating` glow) that
  subscribes to the bus and updates DOM without re-rendering. Wired: Filter Cutoff
  (`filter.cutoff`), Oscillator Gain (`gain`), pitch-LFO Depth
  (`lfo.<id>.depth`). Driver mounted in `MidiInstrumentTab`. CSS in
  `PropertiesPanel.css`.

All green: `tsc -b`, eslint on the write-set, focused vitest (21 tests). Tier 1
committed (`b9ca25dc`). Tier 2 (`getMeter()` per-voice tap) remains a documented
seam.

### 14.6 Control-UX follow-ups (DONE, committed)

Built on top of Tier 1; all reuse the same descriptor/bus plumbing.

- **Perceptual slider tapers** (`999d99b3`). `src/components/common/sliderScale.ts`
  = pure `valueToPosition`/`positionToValue` for `'linear' | 'log' | 'power'`.
  `SynthSlider` gained a `scale` prop: a non-linear scale runs the native range on
  normalized position [0,1] and maps through the taper; the motorized ghost uses
  the SAME map so fader and ghost stay in lockstep. Assignments: **log** = cutoff,
  LFO rate (equal travel per octave); **power** (γ2, reaches 0) = gain, envelope
  A/D/R, filter-target LFO depth; linear = the rest (cents already log; env amount
  is bipolar). Test `tests/unit/sliderScale.test.ts`.
- **General `Knob` component** (`1b43179a`). `src/components/common/Knob.tsx`
  (+`Knob.css`) — a project-general rotary control (taper-aware, vertical
  drag-to-turn with Shift/Ctrl fine, right-click/double-click reset, `role=slider`
  a11y). **No MIDI dependency**: a generic `subscribeLive(cb) => unsub` prop drives
  an imperative automation overlay (teal arc/dot, no re-render), so any live source
  can animate it. `synthSections/SynthKnob.tsx` is the thin wrapper binding
  `paramId → liveParamBus` (mirrors `SynthSlider`). **FilterSection** rebuilt as a
  compact knob row (Cutoff live-automated / Res / Env Amt bipolar / Key Trk),
  saving vertical space. `sliderScale.ts` moved to `common/` (slider + knob share
  it). Reuse elsewhere: use `common/Knob` with your own `subscribeLive` (or none).
- **Piano-roll "Velocity" toggle renamed "Controllers"** (`999d99b3`) — the
  controller-area toggle now hosts velocity + the four CC lanes, so the old label
  was a misnomer.
- **Whole synth panel is knob-based + 2-up layout** (`434a4d3d`, `99bbdcc5`).
  Oscillator (Gain, Bend Rng), both ADSR envelopes, LFO (Rate/Depth), and Mod
  Matrix (Amount) all use the knob; sections pair up (Instrument|Preset,
  Oscillator|Filter, Amp|Filter envelope, LFO ⅔|Mod Matrix ⅓); LFOs lay out
  two-up. Also fixed a real load-failure bug: the history serializer flagged ANY
  key named `source` as a runtime handle, so a mod-matrix route's string `source`
  aborted project load — now it only guards object-valued keys (`99bbdcc5`).
- **Interactive ADSR envelope graph** (`EnvelopeGraph.tsx`). Each of A/D/R maps
  its REAL value into its own fixed-width slot (independent — turning Decay never
  moves the attack curve); release is anchored to the right edge and measured
  backwards; sustain is the flexible plateau level. Breakpoints are draggable with
  absolute cursor tracking and flow through the same `onChange` as the knobs, so
  graph + knobs + audio stay in sync. Level (height) is linear (matches the
  sustain knob); time uses a graph-only power taper (γ3) tuned for looks — the
  graph is self-consistent for dragging regardless of the knob taper.

Not yet verified live in the running app (knob drag + Cutoff arc during playback).
