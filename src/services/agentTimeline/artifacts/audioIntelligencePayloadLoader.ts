import { Logger } from '../../logger';
import type { AudioArtifactStore } from '../../audio/AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioAnalysisArtifactKind } from '../../audio/audioArtifactTypes';
import {
  decodeAudioEventListPayload,
  float32ToEvents,
  type AudioEvent,
  type OnsetMapManifest,
} from '../../audio/beatOnsetManifest';
import {
  decodeLoudnessCurvePayload,
  type LoudnessEnvelopeManifest,
  type LoudnessEnvelopeMetric,
} from '../../audio/loudnessEnvelopeManifest';
import {
  decodeAudioSpanListPayload,
  decodeSpeechMarkersPayload,
  float32ToSpans,
  type AudioSpan,
  type SpeechMarker,
  type SpeechMarkersManifest,
  type VoiceActivityManifest,
} from '../../audio/intelligence/audioIntelligencePayloadTypes';
import { DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES } from '../storage/storageJson';

const log = Logger.create('AgentTimeline');
const CACHE_LIMIT = 16;

export interface AudioIntelligenceArtifactSource {
  kind: AudioAnalysisArtifactKind;
  artifactRef: string;
  analyzerId: string;
  analyzerVersion: string;
  modelId?: string;
  modelVersion?: string;
}

export interface DecodedLoudnessWindow {
  start: number;
  end: number;
  valueDb: number;
}

export interface DecodedLoudnessCurve {
  metric: LoudnessEnvelopeMetric;
  windows: readonly DecodedLoudnessWindow[];
}

export interface AudioIntelligencePayloads {
  loudness?: {
    manifest: LoudnessEnvelopeManifest;
    curves: readonly DecodedLoudnessCurve[];
    source: AudioIntelligenceArtifactSource;
  };
  onsets?: {
    manifest: OnsetMapManifest;
    events: readonly AudioEvent[];
    source: AudioIntelligenceArtifactSource;
  };
  voiceActivity?: {
    manifest: VoiceActivityManifest;
    segments: readonly AudioSpan[];
    source: AudioIntelligenceArtifactSource;
  };
  speechMarkers?: {
    manifest: SpeechMarkersManifest;
    markers: readonly SpeechMarker[];
    source: AudioIntelligenceArtifactSource;
  };
}

const decodedCache = new Map<string, Promise<unknown>>();
const warnedFailures = new Set<string>();

function warnOnce(key: string, message: string, error?: unknown): void {
  if (warnedFailures.has(key)) return;
  warnedFailures.add(key);
  log.warn(message, error);
}

function cached<T>(key: string, load: () => Promise<T | undefined>): Promise<T | undefined> {
  const existing = decodedCache.get(key) as Promise<T | undefined> | undefined;
  if (existing) {
    decodedCache.delete(key);
    decodedCache.set(key, existing);
    return existing;
  }
  const pending = load();
  decodedCache.set(key, pending);
  while (decodedCache.size > CACHE_LIMIT) {
    const oldest = decodedCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    decodedCache.delete(oldest);
  }
  return pending;
}

function freshest(
  artifacts: readonly AudioAnalysisArtifact[],
  kind: AudioAnalysisArtifactKind,
): AudioAnalysisArtifact | undefined {
  return artifacts
    .filter((artifact) => artifact.kind === kind && !artifact.stale
      && artifact.clipAudioStateHash === undefined)
    .toSorted((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))[0];
}

function sourceFor(artifact: AudioAnalysisArtifact): AudioIntelligenceArtifactSource {
  return {
    kind: artifact.kind,
    artifactRef: artifact.manifestRef.artifactId,
    analyzerId: `${artifact.decoderId}:${artifact.kind}`,
    analyzerVersion: artifact.analyzerVersion,
    modelId: artifact.decoderId,
    modelVersion: artifact.decoderVersion,
  };
}

// jsdom Blobs may lack arrayBuffer(); fall back to FileReader there.
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Blob read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

async function readPayload(store: AudioArtifactStore, artifactId: string, hash: string): Promise<ArrayBuffer> {
  const blob = await store.getPayload(artifactId);
  if (!blob) throw new Error(`Audio intelligence payload is missing: ${artifactId}`);
  if (!Number.isSafeInteger(blob.size) || blob.size > DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES) {
    throw new RangeError(
      `Audio intelligence payload exceeds ${DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES} bytes: ${artifactId}`,
    );
  }
  const bytes = await blobToArrayBuffer(blob);
  if (bytes.byteLength > DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES) {
    throw new RangeError(
      `Audio intelligence payload exceeds ${DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES} bytes: ${artifactId}`,
    );
  }
  if (!hash) throw new TypeError(`Audio intelligence payload has no content hash: ${artifactId}`);
  return bytes;
}

function metadataManifest<T>(artifact: AudioAnalysisArtifact, key: string): T {
  const manifest = artifact.metadata?.[key];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError(`${artifact.kind} artifact is missing ${key}`);
  }
  return manifest as T;
}

function preferredCurve(
  manifest: LoudnessEnvelopeManifest,
  metrics: readonly LoudnessEnvelopeMetric[],
) {
  return metrics.flatMap((metric) => {
    const matching = manifest.curves
      .filter((curve) => curve.metric === metric)
      .toSorted((left, right) => (left.channelIndex ?? -1) - (right.channelIndex ?? -1));
    return matching.length > 0 ? [matching[0]] : [];
  })[0];
}

async function loadLoudness(
  artifact: AudioAnalysisArtifact,
  store: AudioArtifactStore,
): Promise<AudioIntelligencePayloads['loudness']> {
  return cached(`loudness:${artifact.manifestRef.hash}`, async () => {
    try {
      const manifest = metadataManifest<LoudnessEnvelopeManifest>(artifact, 'loudnessEnvelopeManifest');
      const selected = [
        preferredCurve(manifest, ['rms-dbfs', 'short-term-lufs', 'momentary-lufs']),
        preferredCurve(manifest, ['sample-peak-dbfs', 'true-peak-dbtp']),
      ].filter((curve): curve is NonNullable<typeof curve> => curve !== undefined);
      const curves = await Promise.all(selected.map(async (curve): Promise<DecodedLoudnessCurve> => {
        const decoded = await cached(
          `curve:${curve.payloadRef.hash}`,
          async () => decodeLoudnessCurvePayload(await readPayload(
            store,
            curve.payloadRef.artifactId,
            curve.payloadRef.hash,
          )),
        );
        if (!decoded) throw new Error(`Unable to decode loudness curve ${curve.payloadRef.artifactId}`);
        return {
          metric: decoded.header.metric,
          windows: Array.from(decoded.values, (valueDb, index) => ({
            start: index * decoded.header.hopDuration,
            end: Math.min(
              manifest.duration,
              index * decoded.header.hopDuration + decoded.header.windowDuration,
            ),
            valueDb,
          })).filter((window) => Number.isFinite(window.valueDb) && window.end > window.start),
        };
      }));
      return { manifest, curves, source: sourceFor(artifact) };
    } catch (error) {
      warnOnce(`loudness:${artifact.manifestRef.hash}`, `Failed to load persisted loudness envelope ${artifact.id}`, error);
      return undefined;
    }
  });
}

async function loadOnsets(
  artifact: AudioAnalysisArtifact,
  store: AudioArtifactStore,
): Promise<AudioIntelligencePayloads['onsets']> {
  return cached(`onsets:${artifact.manifestRef.hash}`, async () => {
    try {
      const manifest = metadataManifest<OnsetMapManifest>(artifact, 'onsetMapManifest');
      const decoded = decodeAudioEventListPayload(await readPayload(
        store,
        manifest.eventsPayloadRef.artifactId,
        manifest.eventsPayloadRef.hash,
      ));
      return { manifest, events: float32ToEvents(decoded.values), source: sourceFor(artifact) };
    } catch (error) {
      warnOnce(`onsets:${artifact.manifestRef.hash}`, `Failed to load persisted onset map ${artifact.id}`, error);
      return undefined;
    }
  });
}

async function loadVoiceActivity(
  artifact: AudioAnalysisArtifact,
  store: AudioArtifactStore,
): Promise<AudioIntelligencePayloads['voiceActivity']> {
  return cached(`voice-activity:${artifact.manifestRef.hash}`, async () => {
    try {
      const manifest = metadataManifest<VoiceActivityManifest>(artifact, 'voiceActivityManifest');
      const decoded = decodeAudioSpanListPayload(await readPayload(
        store,
        manifest.segmentsPayloadRef.artifactId,
        manifest.segmentsPayloadRef.hash,
      ));
      return { manifest, segments: float32ToSpans(decoded.values), source: sourceFor(artifact) };
    } catch (error) {
      warnOnce(`voice-activity:${artifact.manifestRef.hash}`, `Failed to load persisted voice activity ${artifact.id}`, error);
      return undefined;
    }
  });
}

async function loadSpeechMarkers(
  artifact: AudioAnalysisArtifact,
  store: AudioArtifactStore,
): Promise<AudioIntelligencePayloads['speechMarkers']> {
  return cached(`speech-markers:${artifact.manifestRef.hash}`, async () => {
    try {
      const manifest = metadataManifest<SpeechMarkersManifest>(artifact, 'speechMarkersManifest');
      const decoded = decodeSpeechMarkersPayload(await readPayload(
        store,
        manifest.payloadRef.artifactId,
        manifest.payloadRef.hash,
      ));
      return { manifest, markers: decoded.markers, source: sourceFor(artifact) };
    } catch (error) {
      warnOnce(`speech-markers:${artifact.manifestRef.hash}`, `Failed to load persisted speech markers ${artifact.id}`, error);
      return undefined;
    }
  });
}

export async function loadAudioIntelligencePayloads(
  artifacts: readonly AudioAnalysisArtifact[],
  store: AudioArtifactStore,
): Promise<AudioIntelligencePayloads> {
  const loudness = freshest(artifacts, 'loudness-envelope');
  const onsets = freshest(artifacts, 'onset-map');
  const voiceActivity = freshest(artifacts, 'voice-activity');
  const speechMarkers = freshest(artifacts, 'speech-markers');
  const [decodedLoudness, decodedOnsets, decodedVoiceActivity, decodedSpeechMarkers] = await Promise.all([
    loudness ? loadLoudness(loudness, store) : undefined,
    onsets ? loadOnsets(onsets, store) : undefined,
    voiceActivity ? loadVoiceActivity(voiceActivity, store) : undefined,
    speechMarkers ? loadSpeechMarkers(speechMarkers, store) : undefined,
  ]);
  return {
    ...(decodedLoudness ? { loudness: decodedLoudness } : {}),
    ...(decodedOnsets ? { onsets: decodedOnsets } : {}),
    ...(decodedVoiceActivity ? { voiceActivity: decodedVoiceActivity } : {}),
    ...(decodedSpeechMarkers ? { speechMarkers: decodedSpeechMarkers } : {}),
  };
}
