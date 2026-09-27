import { decodeLoudnessCurvePayload } from '../audio/loudnessEnvelopeManifest';
import { flockAudioCurveFingerprint, sampleFlockAudioCurve, type FlockAudioCurve } from '../../engine/flock/runtime/flockAudioCurve';
import type { FlockAudioSampler } from '../flock/compiler/flockParamEvaluation';
import type { WorkerGpuNativeSceneLayer } from './workerGpuNativeSceneContract';
import { WORKER_FLOCK_AUDIO_MAX_BYTES, type WorkerGpuNativeAudioInput } from './workerGpuNativeAudioContract';

interface CurveEntry { curve: FlockAudioCurve; fingerprint: string; byteLength: number }

/** Occurrence-local audio placements; immutable analysis content can be reused. */
export class WorkerGpuNativeSceneAudio {
  private readonly curves = new Map<string, CurveEntry>();
  private inputs = new Map<string, ReadonlyMap<string, WorkerGpuNativeAudioInput>>();

  async prepare(layers: readonly WorkerGpuNativeSceneLayer[], guard: () => void): Promise<void> {
    const next = new Map<string, ReadonlyMap<string, WorkerGpuNativeAudioInput>>();
    const retained = new Set(layers.flatMap(layer => layer.kind === 'flock'
      ? (layer.audioInputs ?? []).flatMap(input => input.curve ? [input.curve.url] : []) : []));
    for (const url of this.curves.keys()) if (!retained.has(url)) this.curves.delete(url);
    for (const layer of layers) {
      if (layer.kind !== 'flock') continue;
      const inputs = new Map((layer.audioInputs ?? []).map(input => [input.clipId, input]));
      next.set(layer.clipId, inputs);
      for (const input of inputs.values()) {
        guard();
        const ref = input.curve;
        if (!ref) continue;
        const cached = this.curves.get(ref.url);
        if (cached) {
          if (cached.fingerprint !== ref.fingerprint || cached.byteLength !== ref.byteLength) throw new Error('Conflicting Worker audio resource identity');
          continue;
        }
        const totalBytes = [...this.curves.values()].reduce((sum, curve) => sum + curve.byteLength, ref.byteLength);
        if (totalBytes > WORKER_FLOCK_AUDIO_MAX_BYTES * 4) throw new Error('Worker audio resource budget exceeded');
        const response = await fetch(ref.url);
        if (!response.ok) throw new Error(`Worker audio resource failed (${response.status})`);
        const data = await response.arrayBuffer();
        guard();
        if (data.byteLength !== ref.byteLength) throw new Error('Worker audio resource length mismatch');
        const decoded = decodeLoudnessCurvePayload(data);
        const curve = { hopDuration: decoded.header.hopDuration, pointCount: decoded.header.pointCount, values: decoded.values };
        if (flockAudioCurveFingerprint(curve) !== ref.fingerprint) throw new Error('Worker audio resource fingerprint mismatch');
        this.curves.set(ref.url, { curve, fingerprint: ref.fingerprint, byteLength: ref.byteLength });
      }
    }
    guard();
    this.inputs = next;
    for (const url of this.curves.keys()) if (!retained.has(url)) this.curves.delete(url);
  }

  require(clipId: string, audioClipIds: readonly string[]): void {
    for (const id of audioClipIds) if (!this.inputs.get(clipId)?.has(id)) {
      throw new Error(`Worker audio input '${id}' was not projected for '${clipId}'`);
    }
  }

  fingerprint(clipId: string, audioClipIds: readonly string[]): string {
    return JSON.stringify([...new Set(audioClipIds)].toSorted().map(id => {
      const input = this.inputs.get(clipId)?.get(id);
      return [id, input?.sourceOffset ?? 0, input?.curve?.fingerprint ?? null];
    }));
  }

  sampler(clipId: string): FlockAudioSampler {
    return (audioClipId, sourceTime, smoothingSeconds) => {
      const input = this.inputs.get(clipId)?.get(audioClipId);
      const curve = input?.curve ? this.curves.get(input.curve.url)?.curve ?? null : null;
      return sampleFlockAudioCurve(curve, sourceTime + (input?.sourceOffset ?? 0), smoothingSeconds);
    };
  }

  dispose(): void { this.curves.clear(); this.inputs.clear(); }
}
