import { blobToArrayBuffer } from '../../artifacts';
import type { AudioArtifactStore } from './AudioArtifactStore';
import {
  decodeFrequencyBandPayload,
  decodePhaseCorrelationPayload,
  float32ToPhaseCorrelationPoints,
  type FrequencyBandSummary,
  type FrequencySummaryManifest,
  type PhaseCorrelationManifest,
  type PhaseCorrelationPoint,
} from './frequencyPhaseManifest';

export interface TimelineFrequencySummary {
  sampleRate: number;
  duration: number;
  fftSize: number;
  hopSize: number;
  bands: FrequencyBandSummary[];
  summary: FrequencySummaryManifest['summary'];
}

export interface TimelinePhaseCorrelation {
  sampleRate: number;
  duration: number;
  windowDuration: number;
  hopDuration: number;
  points: PhaseCorrelationPoint[];
  summary: PhaseCorrelationManifest['summary'];
}

const frequencySummaryCache = new Map<string, TimelineFrequencySummary>();
const phaseCorrelationCache = new Map<string, TimelinePhaseCorrelation>();

function mapFrequencyBandsFromPayload(
  manifest: FrequencySummaryManifest,
  values: Float32Array,
): FrequencyBandSummary[] {
  return manifest.bands.map((band, index) => ({
    ...band,
    minFrequency: values[index * 6] ?? band.minFrequency,
    maxFrequency: values[index * 6 + 1] ?? band.maxFrequency,
    rmsDb: values[index * 6 + 2] ?? band.rmsDb,
    peakDb: values[index * 6 + 3] ?? band.peakDb,
    energyShare: values[index * 6 + 4] ?? band.energyShare,
    centroidHz: values[index * 6 + 5] ?? band.centroidHz,
  }));
}

export function primeTimelineFrequencySummaryCache(
  keys: readonly string[],
  summary: TimelineFrequencySummary,
): void {
  keys.forEach((key) => frequencySummaryCache.set(key, summary));
}

export function primeTimelinePhaseCorrelationCache(
  keys: readonly string[],
  phase: TimelinePhaseCorrelation,
): void {
  keys.forEach((key) => phaseCorrelationCache.set(key, phase));
}

export function getCachedTimelineFrequencySummary(key: string | undefined): TimelineFrequencySummary | undefined {
  return key ? frequencySummaryCache.get(key) : undefined;
}

export function getCachedTimelinePhaseCorrelation(key: string | undefined): TimelinePhaseCorrelation | undefined {
  return key ? phaseCorrelationCache.get(key) : undefined;
}

export function clearTimelineFrequencyPhaseCache(): void {
  frequencySummaryCache.clear();
  phaseCorrelationCache.clear();
}

export async function readTimelineFrequencySummary(
  manifest: FrequencySummaryManifest,
  store: AudioArtifactStore,
): Promise<TimelineFrequencySummary> {
  const payload = await store.getPayload(manifest.bandsPayloadRef.artifactId);
  if (!payload) {
    throw new Error(`Missing frequency summary payload: ${manifest.bandsPayloadRef.artifactId}`);
  }

  const decoded = decodeFrequencyBandPayload(await blobToArrayBuffer(payload));
  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    fftSize: manifest.fftSize,
    hopSize: manifest.hopSize,
    bands: mapFrequencyBandsFromPayload(manifest, decoded.values),
    summary: manifest.summary,
  };
}

export async function readTimelinePhaseCorrelation(
  manifest: PhaseCorrelationManifest,
  store: AudioArtifactStore,
): Promise<TimelinePhaseCorrelation> {
  const payload = await store.getPayload(manifest.correlationPayloadRef.artifactId);
  if (!payload) {
    throw new Error(`Missing phase correlation payload: ${manifest.correlationPayloadRef.artifactId}`);
  }

  const decoded = decodePhaseCorrelationPayload(await blobToArrayBuffer(payload));
  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    windowDuration: manifest.windowDuration,
    hopDuration: manifest.hopDuration,
    points: float32ToPhaseCorrelationPoints(decoded.values),
    summary: manifest.summary,
  };
}

export async function cacheTimelineFrequencyPhaseFromArtifacts(
  frequencyArtifactId: string,
  phaseArtifactId: string,
  store: AudioArtifactStore,
): Promise<{
  frequency?: TimelineFrequencySummary;
  phase?: TimelinePhaseCorrelation;
}> {
  const [frequencyArtifact, phaseArtifact] = await Promise.all([
    store.getAnalysisArtifact(frequencyArtifactId),
    store.getAnalysisArtifact(phaseArtifactId),
  ]);
  const frequencyManifest = frequencyArtifact?.metadata?.frequencySummaryManifest as FrequencySummaryManifest | undefined;
  const phaseManifest = phaseArtifact?.metadata?.phaseCorrelationManifest as PhaseCorrelationManifest | undefined;

  const [frequency, phase] = await Promise.all([
    frequencyManifest ? readTimelineFrequencySummary(frequencyManifest, store) : Promise.resolve(undefined),
    phaseManifest ? readTimelinePhaseCorrelation(phaseManifest, store) : Promise.resolve(undefined),
  ]);

  if (frequency && frequencyArtifact) {
    primeTimelineFrequencySummaryCache([
      frequencyArtifact.id,
      frequencyArtifact.manifestRef.artifactId,
      frequencyArtifactId,
    ], frequency);
  }
  if (phase && phaseArtifact) {
    primeTimelinePhaseCorrelationCache([
      phaseArtifact.id,
      phaseArtifact.manifestRef.artifactId,
      phaseArtifactId,
    ], phase);
  }

  return { frequency, phase };
}
