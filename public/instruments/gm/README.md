# GM instrument assets (issue #193)

Lazy-loaded wavetable assets for the General MIDI synth — one JSON per GM program
(`NNNN.json`, e.g. `0000.json` = program 0). Data only (never bundled into JS),
fetched at runtime relative to the app base URL.

## Status
- `0000.json` is a **hand-built placeholder** (a pure sine tone) used to prove the
  runtime pipeline in Phase 3. It is NOT a real instrument sound.
- `drums/0000.json` is a **hand-built placeholder** drum kit (synthesized
  kick/snare/hi-hats/crash on GM notes 36/38/42/46/49) proving the percussion path
  in Phase 5. Drum kits live in their own `drums/` namespace because a melodic
  program and a drum kit can share the same program number.

## Real assets (Phase 2b, pending)
Generated offline from the **FluidR3 GM** SoundFont (MIT licensed — free for
personal and commercial use) by `scripts/build-gm-instruments.*`. Only the
generated JSON is committed; the source `.sf2` stays out of the repo.

Format: see `src/types/gmAsset.ts`. PCM is raw decoded Float32 mono (base64) so a
buffer can be built synchronously for any AudioContext sample rate.
