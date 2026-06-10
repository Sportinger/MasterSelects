import type { WaveformStatistic } from '../waveformPyramidManifest';

export type WaveformPyramidAnalysisPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface WaveformPyramidAnalysisProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: WaveformPyramidAnalysisPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  levelIndex?: number;
  channelIndex?: number;
  samplesPerBucket?: number;
  statistic?: WaveformStatistic;
  message?: string;
}

export interface WaveformPyramidAnalysisContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  cacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: WaveformPyramidAnalysisProgress) => void;
}

export interface WaveformChannelStats {
  channelIndex: number;
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
  peak: Float32Array;
}

export interface WaveformLevelStats {
  samplesPerBucket: number;
  bucketDuration: number;
  bucketCount: number;
  channels: WaveformChannelStats[];
}
