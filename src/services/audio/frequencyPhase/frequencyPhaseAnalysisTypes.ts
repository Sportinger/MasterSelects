import type {
  FrequencyBandSummary,
  FrequencySummaryManifest,
  PhaseCorrelationManifest,
  PhaseCorrelationPoint,
} from '../frequencyPhaseManifest';

export type FrequencyPhaseAnalysisPhase =
  | 'queued'
  | 'analyzing-frequency'
  | 'analyzing-phase'
  | 'storing-payloads'
  | 'storing-manifests'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface FrequencyPhaseAnalysisProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: FrequencyPhaseAnalysisPhase;
  percent: number;
  timestamp: string;
  frequencyCacheKey: string;
  phaseCacheKey: string;
  frameIndex?: number;
  frameCount?: number;
  message?: string;
}

export interface FrequencyBandDefinition {
  bandId: string;
  label: string;
  minFrequency: number;
  maxFrequency: number;
  group: 'low' | 'mid' | 'high';
}

export interface NormalizedFrequencyBand extends FrequencyBandDefinition {
  binStart: number;
  binEnd: number;
  binCount: number;
}

export interface FrequencyAccumulator extends NormalizedFrequencyBand {
  energy: number;
  peakPower: number;
  weightedFrequency: number;
}

export interface FrequencyAnalysis {
  bands: FrequencyBandSummary[];
  summary: FrequencySummaryManifest['summary'];
}

export interface PhaseAnalysis {
  points: PhaseCorrelationPoint[];
  summary: PhaseCorrelationManifest['summary'];
}

export interface NormalizedFrequencyPhaseParameters {
  fftSize: 1024 | 2048 | 4096;
  hopSize: number;
  frameCount: number;
  phaseWindowDuration: number;
  phaseHopDuration: number;
  phaseWindowSamples: number;
  phaseHopSamples: number;
  phasePointCount: number;
}

export interface FrequencyPhaseAnalysisContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  frequencyCacheKey: string;
  phaseCacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: FrequencyPhaseAnalysisProgress) => void;
}
