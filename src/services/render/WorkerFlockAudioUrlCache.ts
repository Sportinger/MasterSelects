import { encodeLoudnessCurvePayload } from '../audio/loudnessEnvelopeManifest';
import type { TimelineLoudnessCurve } from '../audio/timelineLoudnessEnvelopeCache';
import { flockAudioCurveFingerprint } from '../../engine/flock/runtime/flockAudioCurve';
import { WORKER_FLOCK_AUDIO_MAX_BYTES, type WorkerGpuNativeAudioInput } from './workerGpuNativeAudioContract';

type Reference = NonNullable<WorkerGpuNativeAudioInput['curve']>;
interface Entry { reference: Reference; retainUntil: number }

/** Host owns URLs until every referencing frame has expired; no per-frame PCM copy. */
export class WorkerFlockAudioUrlCache {
  private readonly entries = new Map<TimelineLoudnessCurve, Entry>();
  private bytes = 0;

  prune(now = Date.now()): void {
    for (const [curve, entry] of this.entries) if (entry.retainUntil < now) {
      URL.revokeObjectURL(entry.reference.url);
      this.entries.delete(curve); this.bytes -= entry.reference.byteLength;
    }
  }

  reference(curve: TimelineLoudnessCurve, expireAfterMs: number): Reference {
    const cached = this.entries.get(curve);
    if (cached) { cached.retainUntil = Math.max(cached.retainUntil, expireAfterMs + 1000); return cached.reference; }
    if (curve.values.byteLength + 4096 > WORKER_FLOCK_AUDIO_MAX_BYTES) throw new Error('Flock audio curve exceeds Worker resource limit');
    const data = encodeLoudnessCurvePayload({ header: { schemaVersion: 1, metric: curve.metric,
      ...(curve.channelIndex === undefined ? {} : { channelIndex: curve.channelIndex }),
      windowDuration: curve.windowDuration, hopDuration: curve.hopDuration, pointCount: curve.pointCount,
      valueLayout: 'time-series', valueEncoding: 'db' }, values: curve.values });
    if (this.bytes + data.byteLength > WORKER_FLOCK_AUDIO_MAX_BYTES * 4 || this.entries.size >= 256) {
      throw new Error('Flock audio resources exceed the active Worker frame budget');
    }
    const reference = { url: URL.createObjectURL(new Blob([data])), byteLength: data.byteLength, fingerprint: flockAudioCurveFingerprint(curve) };
    this.entries.set(curve, { reference, retainUntil: expireAfterMs + 1000 }); this.bytes += data.byteLength;
    return reference;
  }
}

