// GM wavetable asset schema (issue #193).
//
// On-disk format for one General MIDI program's sampled wavetable, lazy-fetched
// from `public/instruments/gm/<NNNN>.json` at runtime (data, never bundled). PCM
// is stored as RAW decoded Float32 mono so `GmSampleBank` can build an AudioBuffer
// for ANY context sample rate synchronously (live ≠ export rate) without
// `decodeAudioData` resampling — see docs/Features/GM-Sampler-Plan.md §5.
//
// The schema carries zones + loop + envelope from v1 (even though v1 ships a single
// zone) so the ~15 MB of generated assets never has to be regenerated for a format
// change.

export interface GmEnvelope {
  attack: number;   // seconds
  decay: number;    // seconds
  sustain: number;  // 0–1 sustain level
  release: number;  // seconds
}

export interface GmZone {
  loKey: number;    // lowest MIDI note this zone covers (0–127)
  hiKey: number;    // highest MIDI note this zone covers (0–127)
  rootKey: number;  // MIDI note the sample was recorded at (pitch reference)
  loopStart: number; // loop start in sample frames; -1 = no loop (one-shot)
  loopEnd: number;   // loop end in sample frames
  envelope: GmEnvelope;
  pcm: string;       // base64 of a Float32 mono PCM buffer at the asset sampleRate
}

export interface GmInstrumentAsset {
  program: number;    // 0–127 GM program (or drum kit id)
  name: string;
  isDrum: boolean;    // true = percussion kit (per-note sample, native rate)
  sampleRate: number; // rate the PCM was decoded at
  zones: GmZone[];
}
