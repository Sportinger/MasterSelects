// GM sample bank (issue #193, Phase 3).
//
// One shared singleton across every WavetableSynth (live per-track buses, piano-roll
// preview, AND offline export), so each GM program is fetched + parsed exactly once
// no matter how many synths exist (the export renderer builds a new synth per clip;
// the scheduler one per track). HMR-persisted per CLAUDE.md §9.
//
// It stores RAW decoded Float32 PCM, not AudioBuffers and not compressed audio, so a
// buffer can be built synchronously for any AudioContext sample rate (live 44.1/48k
// vs the export OfflineAudioContext rate) — avoiding decodeAudioData, which resamples
// to one context's rate and is async. AudioBuffers are not context-bound, so a built
// buffer is cached once (keyed by program+zone) and reused across live + offline.

import type { GmInstrumentAsset, GmPcmFormat, GmZone } from '../../types/gmAsset';
import { Logger } from '../../services/logger';

const log = Logger.create('GmSampleBank');

// ── Pure helpers (no WebAudio — unit-testable) ──────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Decode a base64 string of little-endian Float32 samples into a Float32Array. */
export function decodeBase64ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const usableBytes = bytes.byteLength - (bytes.byteLength % 4);
  // Copy into a fresh, 4-byte-aligned buffer (the base64 bytes may not be aligned).
  const aligned = bytes.byteOffset === 0 && bytes.byteLength === usableBytes
    ? bytes
    : bytes.slice(0, usableBytes);
  return new Float32Array(aligned.buffer, aligned.byteOffset, usableBytes / 4);
}

/**
 * Decode a base64 string of little-endian Int16 samples into a normalized
 * Float32Array (value / 32768, so full-scale ±32768 maps to ±1). Int16 is the
 * default on-disk encoding — it halves asset size losslessly since the SF2 source
 * is already 16-bit PCM.
 */
export function decodeBase64ToInt16(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const usableBytes = bytes.byteLength - (bytes.byteLength % 2);
  // base64ToBytes returns a fresh, offset-0 buffer, so Int16Array alignment holds.
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, usableBytes / 2);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

/** Decode a zone's base64 PCM into Float32 samples per the asset's encoding. */
export function decodeZonePcm(b64: string, format: GmPcmFormat = 'f32'): Float32Array {
  return format === 'i16' ? decodeBase64ToInt16(b64) : decodeBase64ToFloat32(b64);
}

/**
 * Index of the zone to play for `pitch`, or -1 for none.
 *
 * - A zone whose key range (loKey..hiKey inclusive) covers `pitch` always wins.
 * - Melodic (`isDrum` false): if none covers, fall back to the nearest zone by
 *   rootKey, so a single-zone v1 asset (0..127) always resolves and out-of-range
 *   notes still sound (pitch-shifted).
 * - Drums (`isDrum` true): NO fallback — an unmapped percussion note returns -1
 *   (silent) rather than substituting some other drum's sample.
 */
export function selectZoneIndex(zones: GmZone[], pitch: number, isDrum = false): number {
  if (zones.length === 0) return -1;
  const covering = zones.findIndex((z) => pitch >= z.loKey && pitch <= z.hiKey);
  if (covering >= 0) return covering;
  if (isDrum) return -1;
  let best = 0;
  let bestDist = Math.abs(pitch - zones[0].rootKey);
  for (let i = 1; i < zones.length; i++) {
    const d = Math.abs(pitch - zones[i].rootKey);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/** Convenience over selectZoneIndex returning the zone (or null). */
export function selectZone(zones: GmZone[], pitch: number, isDrum = false): GmZone | null {
  const i = selectZoneIndex(zones, pitch, isDrum);
  return i >= 0 ? zones[i] : null;
}

/**
 * Playback rate to shift `rootKey`'s sample to `pitch` (equal temperament). Drums
 * play at native rate (per-note samples are pre-pitched), so always 1.
 */
export function computePlaybackRate(pitch: number, rootKey: number, isDrum: boolean): number {
  if (isDrum) return 1;
  return Math.pow(2, (pitch - rootKey) / 12);
}

/** Built source + the zone it came from (envelope lives on the zone). */
export interface GmBuiltSource {
  source: AudioBufferSourceNode;
  zone: GmZone;
}

/**
 * Identifies one loadable GM sound. A melodic program and a drum kit can share the
 * same `program` number but are entirely different assets, so the cache + fetch are
 * keyed by both.
 */
export interface GmSoundRef {
  program: number;
  isDrum: boolean;
}

/** Cache/identity key for a sound (melodic vs drum kit at the same program). */
function refId(program: number, isDrum: boolean): string {
  return `${isDrum ? 'd' : 'm'}${program}`;
}

function gmAssetUrl(program: number, isDrum: boolean): string {
  // Relative to the deployed base path (works under a subpath); BASE_URL ends in '/'.
  const base = import.meta.env.BASE_URL ?? '/';
  const name = String(program).padStart(4, '0');
  // Drum kits live in their own namespace so they never collide with melodic programs.
  return isDrum ? `${base}instruments/gm/drums/${name}.json` : `${base}instruments/gm/${name}.json`;
}

// ── Bank singleton ──────────────────────────────────────────────────────────────

class GmSampleBank {
  // All keyed by refId (melodic vs drum kit, see refId), not raw program number.
  private assets = new Map<string, GmInstrumentAsset>();    // refId → parsed asset
  private inflight = new Map<string, Promise<void>>();       // dedup concurrent fetches
  private missing = new Set<string>();                       // known-404, don't refetch
  private decoded = new Map<string, Float32Array>();         // `${refId}:${zoneIdx}` → PCM
  private buffers = new Map<string, AudioBuffer>();          // `${refId}:${zoneIdx}` → buffer

  /** Fetch + parse the JSON for any not-yet-loaded sound. Deduped + cached. */
  async ensureLoaded(refs: GmSoundRef[]): Promise<void> {
    const unique = new Map<string, GmSoundRef>();
    for (const ref of refs) unique.set(refId(ref.program, ref.isDrum), ref);
    await Promise.all([...unique.values()].map((ref) => this.loadRef(ref.program, ref.isDrum)));
  }

  isLoaded(program: number, isDrum: boolean): boolean {
    return this.assets.has(refId(program, isDrum));
  }

  private loadRef(program: number, isDrum: boolean): Promise<void> {
    const id = refId(program, isDrum);
    if (this.assets.has(id) || this.missing.has(id)) return Promise.resolve();
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const p = this.fetchAsset(program, isDrum, id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async fetchAsset(program: number, isDrum: boolean, id: string): Promise<void> {
    const url = gmAssetUrl(program, isDrum);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Missing asset degrades gracefully: silent track, no crash.
        this.missing.add(id);
        log.warn('GM asset missing', { program, isDrum, url, status: res.status });
        return;
      }
      const asset = (await res.json()) as GmInstrumentAsset;
      if (!asset?.zones?.length) {
        this.missing.add(id);
        log.warn('GM asset has no zones', { program, isDrum, url });
        return;
      }
      this.assets.set(id, asset);
      log.debug('Loaded GM asset', { program, isDrum, name: asset.name, zones: asset.zones.length });
    } catch (error) {
      this.missing.add(id);
      log.warn('Failed to load GM asset', { program, isDrum, url, error });
    }
  }

  private getBuffer(id: string, zoneIdx: number, zone: GmZone, sampleRate: number, format: GmPcmFormat): AudioBuffer {
    const key = `${id}:${zoneIdx}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      let pcm = this.decoded.get(key);
      if (!pcm) {
        pcm = decodeZonePcm(zone.pcm, format);
        this.decoded.set(key, pcm);
      }
      // Build at the asset's own sample rate; WebAudio resamples to the playing
      // context automatically, so one buffer serves live AND offline export.
      buffer = new AudioBuffer({ numberOfChannels: 1, length: pcm.length, sampleRate });
      // Copy into an ArrayBuffer-backed array (the decoded view may be ArrayBufferLike).
      buffer.copyToChannel(new Float32Array(pcm), 0);
      this.buffers.set(key, buffer);
    }
    return buffer;
  }

  /**
   * Build a (one-use) AudioBufferSourceNode for a note in the given context, with
   * pitch + loop applied. Returns null if the asset isn't loaded yet OR (for drums)
   * the note number has no mapped sample — callers preload but must tolerate a miss.
   * Drums play at native rate with no loop; melodic notes are pitch-shifted and loop.
   */
  buildSource(program: number, pitch: number, isDrum: boolean, ctx: BaseAudioContext): GmBuiltSource | null {
    const id = refId(program, isDrum);
    const asset = this.assets.get(id);
    if (!asset) return null;
    const zoneIdx = selectZoneIndex(asset.zones, pitch, isDrum);
    if (zoneIdx < 0) return null;
    const zone = asset.zones[zoneIdx];

    const sampleRate = zone.sampleRate ?? asset.sampleRate;
    const buffer = this.getBuffer(id, zoneIdx, zone, sampleRate, asset.pcmFormat ?? 'f32');
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = computePlaybackRate(pitch, zone.rootKey, isDrum);

    if (!isDrum && zone.loopStart >= 0 && zone.loopEnd > zone.loopStart) {
      source.loop = true;
      source.loopStart = zone.loopStart / sampleRate;
      source.loopEnd = zone.loopEnd / sampleRate;
    }
    return { source, zone };
  }
}

let instance: GmSampleBank | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.gmSampleBank) {
    instance = import.meta.hot.data.gmSampleBank;
  }
  import.meta.hot.dispose((data) => {
    data.gmSampleBank = instance;
  });
}

/** Shared GM sample bank (singleton, HMR-persisted). */
export function getGmSampleBank(): GmSampleBank {
  if (!instance) instance = new GmSampleBank();
  return instance;
}

export type { GmSampleBank };
