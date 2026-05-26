import { blobToArrayBuffer } from '../../artifacts';
import { AudioArtifactStore } from './AudioArtifactStore';
import {
  decodeLoudnessCurvePayload,
  type LoudnessEnvelopeManifest,
  type LoudnessEnvelopeMetric,
  type LoudnessEnvelopeSummary,
} from './loudnessEnvelopeManifest';
import { createCurrentAudioArtifactStore } from './timelineWaveformPyramidCache';

export interface TimelineLoudnessCurve {
  metric: LoudnessEnvelopeMetric;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  values: Float32Array;
}

export interface TimelineLoudnessEnvelope {
  sampleRate: number;
  duration: number;
  curves: TimelineLoudnessCurve[];
  summary?: LoudnessEnvelopeSummary;
}

const timelineLoudnessEnvelopeCache = new Map<string, TimelineLoudnessEnvelope>();

export function primeTimelineLoudnessEnvelopeCache(
  keys: Array<string | undefined>,
  envelope: TimelineLoudnessEnvelope,
): void {
  for (const key of keys) {
    if (key) {
      timelineLoudnessEnvelopeCache.set(key, envelope);
    }
  }
}

export function getCachedTimelineLoudnessEnvelope(
  key: string | undefined,
): TimelineLoudnessEnvelope | null {
  return key ? timelineLoudnessEnvelopeCache.get(key) ?? null : null;
}

export async function readTimelineLoudnessEnvelope(
  manifest: LoudnessEnvelopeManifest,
  store: AudioArtifactStore,
): Promise<TimelineLoudnessEnvelope> {
  const curves = await Promise.all(manifest.curves.map(async (curve) => {
    const payload = await store.getPayload(curve.payloadRef.artifactId);
    if (!payload) {
      throw new Error(`Missing loudness curve payload: ${curve.payloadRef.artifactId}`);
    }

    const decoded = decodeLoudnessCurvePayload(await blobToArrayBuffer(payload));
    if (
      decoded.header.metric !== curve.metric
      || decoded.header.channelIndex !== curve.channelIndex
      || decoded.header.windowDuration !== curve.windowDuration
      || decoded.header.hopDuration !== curve.hopDuration
      || decoded.header.pointCount !== curve.pointCount
    ) {
      throw new Error(`Loudness curve payload header mismatch: ${curve.payloadRef.artifactId}`);
    }

    return {
      metric: curve.metric,
      channelIndex: curve.channelIndex,
      windowDuration: curve.windowDuration,
      hopDuration: curve.hopDuration,
      pointCount: curve.pointCount,
      values: decoded.values,
    };
  }));

  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    curves: curves.toSorted((a, b) => {
      const metricOrder = a.metric.localeCompare(b.metric);
      if (metricOrder !== 0) return metricOrder;
      return (a.channelIndex ?? -1) - (b.channelIndex ?? -1);
    }),
    summary: manifest.summary,
  };
}

export async function loadTimelineLoudnessEnvelope(
  refId: string | undefined,
): Promise<TimelineLoudnessEnvelope | null> {
  const cached = getCachedTimelineLoudnessEnvelope(refId);
  if (cached || !refId) return cached;

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  if (!artifact) return null;

  const manifest = artifact.metadata?.loudnessEnvelopeManifest as LoudnessEnvelopeManifest | undefined;
  if (!manifest) return null;

  const envelope = await readTimelineLoudnessEnvelope(manifest, store);
  primeTimelineLoudnessEnvelopeCache([refId, artifact.id, artifact.manifestRef.artifactId], envelope);
  return envelope;
}
