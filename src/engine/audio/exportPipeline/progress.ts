import type { ClipAudioRenderProgress } from '../../../services/audio/ClipAudioRenderService';
import type { TimelineClip } from '../../../types/timeline';

type AudioExportPhase = 'extracting' | 'processing' | 'effects' | 'mixing' | 'encoding' | 'complete';

export interface AudioExportProgressUpdate {
  phase: AudioExportPhase;
  percent: number;
  currentClip?: string;
  message?: string;
}

export type AudioExportProgressSink = (progress: AudioExportProgressUpdate) => void;

export function buildClipRenderProgress(
  clip: TimelineClip,
  clipIndex: number,
  totalClips: number,
  progress: ClipAudioRenderProgress,
): AudioExportProgressUpdate {
  const phase: AudioExportPhase = progress.phase === 'effects' ? 'effects' : 'processing';
  return {
    phase,
    percent: Math.round(((clipIndex + progress.percent / 100) / Math.max(1, totalClips)) * 100),
    currentClip: clip.name,
    message: progress.message ?? `Rendering audio: ${clip.name}`,
  };
}

export function buildEncodingProgress(percent: number): AudioExportProgressUpdate {
  return {
    phase: 'encoding',
    percent,
    message: `Encoding: ${percent}%`,
  };
}
