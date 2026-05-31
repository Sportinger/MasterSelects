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

import type { GmInstrumentAsset, GmZone } from '../../types/gmAsset';
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
 * Select the zone covering `pitch` (loKey..hiKey inclusive). Falls back to the
 * nearest zone by rootKey if none covers the pitch, then to the first zone — so a
 * single-zone v1 asset (loKey 0..hiKey 127) always resolves and out-of-range notes
 * never go silent.
 */
export function selectZone(zones: GmZone[], pitch: number): GmZone | null {
  if (zones.length === 0) return null;
  const covering = zones.find((z) => pitch >= z.loKey && pitch <= z.hiKey);
  if (covering) return covering;
  let nearest = zones[0];
  let bestDist = Math.abs(pitch - nearest.rootKey);
  for (const z of zones) {
    const d = Math.abs(pitch - z.rootKey);
    if (d < bestDist) { bestDist = d; nearest = z; }
  }
  return nearest;
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

function gmAssetUrl(program: number): string {
  // Relative to the deployed base path (works under a subpath); BASE_URL ends in '/'.
  const base = import.meta.env.BASE_URL ?? '/';
  const name = String(program).padStart(4, '0');
  return `${base}instruments/gm/${name}.json`;
}

// ── Bank singleton ──────────────────────────────────────────────────────────────

class GmSampleBank {
  private assets = new Map<number, GmInstrumentAsset>();   // program → parsed asset
  private inflight = new Map<number, Promise<void>>();      // dedup concurrent fetches
  private missing = new Set<number>();                      // known-404, don't refetch
  private decoded = new Map<string, Float32Array>();        // `${program}:${zoneIdx}` → PCM
  private buffers = new Map<string, AudioBuffer>();         // `${program}:${zoneIdx}` → buffer

  /** Fetch + parse the JSON for any not-yet-loaded program. Deduped + cached. */
  async ensureLoaded(programs: number[]): Promise<void> {
    await Promise.all([...new Set(programs)].map((p) => this.loadProgram(p)));
  }

  isLoaded(program: number): boolean {
    return this.assets.has(program);
  }

  private loadProgram(program: number): Promise<void> {
    if (this.assets.has(program) || this.missing.has(program)) return Promise.resolve();
    const existing = this.inflight.get(program);
    if (existing) return existing;
    const p = this.fetchProgram(program).finally(() => this.inflight.delete(program));
    this.inflight.set(program, p);
    return p;
  }

  private async fetchProgram(program: number): Promise<void> {
    const url = gmAssetUrl(program);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Missing program degrades gracefully: silent track, no crash.
        this.missing.add(program);
        log.warn('GM program asset missing', { program, url, status: res.status });
        return;
      }
      const asset = (await res.json()) as GmInstrumentAsset;
      if (!asset?.zones?.length) {
        this.missing.add(program);
        log.warn('GM program asset has no zones', { program, url });
        return;
      }
      this.assets.set(program, asset);
      log.debug('Loaded GM program', { program, name: asset.name, zones: asset.zones.length });
    } catch (error) {
      this.missing.add(program);
      log.warn('Failed to load GM program asset', { program, url, error });
    }
  }

  private getDecoded(program: number, zoneIdx: number, zone: GmZone): Float32Array {
    const key = `${program}:${zoneIdx}`;
    let pcm = this.decoded.get(key);
    if (!pcm) {
      pcm = decodeBase64ToFloat32(zone.pcm);
      this.decoded.set(key, pcm);
    }
    return pcm;
  }

  private getBuffer(program: number, zoneIdx: number, zone: GmZone, sampleRate: number): AudioBuffer {
    const key = `${program}:${zoneIdx}`;
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const pcm = this.getDecoded(program, zoneIdx, zone);
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
   * pitch + loop applied. Returns null if the program isn't loaded yet — callers
   * preload, but must tolerate a miss (the note is simply skipped).
   */
  buildSource(program: number, pitch: number, isDrum: boolean, ctx: BaseAudioContext): GmBuiltSource | null {
    const asset = this.assets.get(program);
    if (!asset) return null;
    const zoneIdx = asset.zones.findIndex((z) => pitch >= z.loKey && pitch <= z.hiKey);
    const idx = zoneIdx >= 0 ? zoneIdx : 0;
    const zone = selectZone(asset.zones, pitch);
    if (!zone) return null;

    const buffer = this.getBuffer(program, idx, zone, asset.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = computePlaybackRate(pitch, zone.rootKey, isDrum);

    if (!isDrum && zone.loopStart >= 0 && zone.loopEnd > zone.loopStart) {
      source.loop = true;
      source.loopStart = zone.loopStart / asset.sampleRate;
      source.loopEnd = zone.loopEnd / asset.sampleRate;
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
