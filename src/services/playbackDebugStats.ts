import type { EngineStats } from '../types';
import type { PipelineEvent } from './wcPipelineMonitor';
import type { VFPipelineEvent } from './vfPipelineMonitor';

export type PlaybackDebugStats = NonNullable<EngineStats['playback']>;
export type PlaybackPipeline = PlaybackDebugStats['pipeline'];

export interface PlaybackRunStartupStats {
  firstDecodeOutputMs?: number;
  firstPreviewFrameMs?: number;
  firstPreviewUpdateMs?: number;
  startupCatchUpMs?: number;
  initialTargetMovedStaleFrames: number;
  initialTargetMovedStaleMs: number;
}

export interface PlaybackRunDiagnostics {
  windowMs: number;
  playback: PlaybackDebugStats;
  startup: PlaybackRunStartupStats;
  wcEventCount: number;
  vfEventCount: number;
}

export interface PlaybackHealthVideoState {
  clipId: string;
  src: string;
  currentTime: number;
  readyState: number;
  seeking: boolean;
  paused: boolean;
  played: number;
  warmingUp: boolean;
  gpuReady: boolean;
}

export interface PlaybackHealthAnomaly {
  type: string;
  timestamp: number;
  clipId?: string;
  detail?: string;
  recovered: boolean;
}

export interface PlaybackDebugBuildParams {
  decoder: EngineStats['decoder'];
  now?: number;
  windowMs?: number;
  wcTimeline?: PipelineEvent[];
  vfTimeline?: VFPipelineEvent[];
  healthVideos?: PlaybackHealthVideoState[];
  healthAnomalies?: PlaybackHealthAnomaly[];
}

export interface PlaybackRunDiagnosticsParams {
  decoder: EngineStats['decoder'];
  startMs: number;
  endMs: number;
  wcEvents?: PipelineEvent[];
  vfEvents?: VFPipelineEvent[];
  healthVideos?: PlaybackHealthVideoState[];
  healthAnomalies?: PlaybackHealthAnomaly[];
}

export {
  buildPlaybackDebugStats,
  mapDecoderToPlaybackPipeline,
} from './playbackDebug/assembly';
export { buildPlaybackRunDiagnostics } from './playbackDebug/runDiagnostics';
export { summarizeFrameCadence } from './playbackDebug/collectors';
