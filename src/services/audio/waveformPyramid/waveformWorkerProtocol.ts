import type { WaveformLevelStats } from './waveformPyramidAnalysisTypes';
import type { ClipAudioEditOperation } from '../../../types/audio';
import type { WaveformStatistic } from '../waveformPyramidManifest';
import type { DerivedWaveformClipRange } from './derivedPyramidMath';

export interface WaveformPreviewResult { waveform: number[]; waveformChannels?: number[][] }
export interface WaveformWorkerResult {
  preview?: WaveformPreviewResult; levels: WaveformLevelStats[]; packedPayload?: ArrayBuffer;
  sampleRate?: number; duration?: number;
}
export interface PyramidChunkLocation { levelIndex: number; channelIndex: number; statistic: WaveformStatistic; offset: number }
export type WaveformWorkerRequest = {
  type: 'start'; sampleRate: number; duration: number; length: number; channelCount: number;
  previewSamples?: number; bucketSizes: number[]; reportPreviewProgress: boolean;
  includePartialPreview: boolean;
} | { type: 'chunk'; channelIndex: number; offset: number; samples: Float32Array }
  | { type: 'decode-payload'; bytes: ArrayBuffer }
  | { type: 'derive-pyramid'; sampleRate: number; duration: number;
      levels: Array<Omit<WaveformLevelStats, 'channels'> & { channelIndexes: number[] }>;
      clip: DerivedWaveformClipRange; operations: ClipAudioEditOperation[] }
  | ({ type: 'pyramid-chunk'; samples: Float32Array } & PyramidChunkLocation);
export type WaveformWorkerResponse =
  | { type: 'read'; channelIndex: number; offset: number; length: number }
  | ({ type: 'read-pyramid'; length: number } & PyramidChunkLocation)
  | { type: 'preview-progress'; percent: number; waveform: number[] }
  | { type: 'analysis-progress'; percent: number; levelIndex: number; channelIndex: number; samplesPerBucket: number }
  | { type: 'complete'; result: WaveformWorkerResult }
  | { type: 'error'; message: string };
