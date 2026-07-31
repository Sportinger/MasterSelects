import type {
  AnalysisStatus,
  ClipAnalysis,
  ClipSegment,
  TranscriptStatus,
  TranscriptWord,
} from '../../types';
import type { ClipAudioState } from '../../types/audio';
import type { MidiClipData } from '../../types/midiClip';
import type { StoryboardClipProperties } from '../../types/storyboard';
import type { VectorAnimationClipSettings } from '../../types/vectorAnimation';

export interface TimelinePaintFadeCurveKeyframe {
  id?: string;
  time: number;
  value: number;
  easing: string;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export interface TimelinePaintFadeVisuals {
  keyframes: readonly TimelinePaintFadeCurveKeyframe[];
  clipDuration: number;
  isAudioClip: boolean;
}

export interface TimelinePaintSourceClip {
  id: string;
  trackId: string;
  trackType?: 'video' | 'audio' | 'midi';
  startTime: number;
  duration: number;
  name: string;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  linkedClipId?: string;
  linkedGroupId?: string;
  isPendingDownload?: boolean;
  downloadProgress?: number;
  downloadError?: string;
  transcript?: TranscriptWord[];
  transcriptStatus?: TranscriptStatus;
  transcriptProgress?: number;
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  analysisProgress?: number;
  mediaFileId?: string;
  thumbnails?: string[];
  isComposition?: boolean;
  compositionId?: string;
  nestedClipBoundaries?: number[];
  clipSegments?: ClipSegment[];
  mixdownWaveform?: number[];
  mixdownGenerating?: boolean;
  hasMixdownAudio?: boolean;
  waveform?: number[];
  waveformChannels?: number[][];
  waveformGenerating?: boolean;
  waveformProgress?: number;
  audioState?: ClipAudioState;
  midiData?: MidiClipData;
  fade?: TimelinePaintFadeVisuals;
  storyboardProperties?: StoryboardClipProperties;
  captionProperties?: unknown;
  captionLayerBinding?: {
    role?: 'input' | 'text' | 'background';
  };
  source?: {
    type?: string | null;
    mediaFileId?: string;
    naturalDuration?: number;
    vectorAnimationSettings?: VectorAnimationClipSettings;
  } | null;
}
