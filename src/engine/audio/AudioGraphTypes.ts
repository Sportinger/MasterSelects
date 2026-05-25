import type {
  AudioEffectInstance,
  ClipAudioState,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../types';

export const AUDIO_GRAPH_SCHEMA_VERSION = 1;

export type AudioGraphRenderMode = 'live' | 'offline' | 'export';
export type AudioGraphScope = 'clip' | 'track' | 'master';
export type AudioGraphDiagnosticSeverity = 'info' | 'warning' | 'error';
export type AudioGraphEffectStatus = 'active' | 'disabled' | 'bypassed' | 'invalid';
export type AudioGraphJsonPrimitive = string | number | boolean | null;
export type AudioGraphJsonValue =
  | AudioGraphJsonPrimitive
  | AudioGraphJsonValue[]
  | { [key: string]: AudioGraphJsonValue };

export interface AudioGraphRenderInput {
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  masterAudioState?: MasterAudioState;
  mode?: AudioGraphRenderMode;
}

export interface AudioGraphDiagnostic {
  severity: AudioGraphDiagnosticSeverity;
  code: string;
  message: string;
  scope?: AudioGraphScope;
  refId?: string;
}

export interface AudioGraphAnalysisRefsDescriptor {
  waveformPyramidId?: string;
  processedWaveformPyramidId?: string;
  spectrogramTileSetIds?: string[];
  loudnessEnvelopeId?: string;
  beatGridId?: string;
  onsetMapId?: string;
  phaseCorrelationId?: string;
  transcriptTimingId?: string;
  frequencySummaryId?: string;
}

export interface AudioGraphClipSourceDescriptor {
  mediaFileId?: string;
  sourceMediaFileId?: string;
  sourceType?: string;
  sourceAudioRevisionId?: string;
  sourceAnalysisRefs?: AudioGraphAnalysisRefsDescriptor;
  processedAnalysisRefs?: AudioGraphAnalysisRefsDescriptor;
}

export interface AudioGraphTimeRangeDescriptor {
  startTime: number;
  duration: number;
  endTime: number;
  inPoint: number;
  outPoint: number;
  playbackRate: number;
  reversed: boolean;
  preservesPitch: boolean;
}

export interface AudioGraphEffectDescriptor {
  id: string;
  descriptorId: string;
  order: number;
  enabled: boolean;
  bypassed: boolean;
  status: AudioGraphEffectStatus;
  params: Record<string, AudioGraphJsonPrimitive>;
  automationMode?: AudioEffectInstance['automationMode'];
}

export interface AudioGraphSendDescriptor {
  id: string;
  targetBusId: string;
  gainDb: number;
  preFader: boolean;
  enabled: boolean;
  order: number;
}

export interface AudioGraphClipDescriptor {
  kind: 'clip';
  id: string;
  name: string;
  trackId: string;
  trackOrder: number;
  order: number;
  muted: boolean;
  soloSafe: boolean;
  time: AudioGraphTimeRangeDescriptor;
  source: AudioGraphClipSourceDescriptor;
  effectChain: AudioGraphEffectDescriptor[];
}

export interface AudioGraphTrackDescriptor {
  kind: 'track';
  id: string;
  name: string;
  type: TimelineTrack['type'];
  order: number;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  volumeDb: number;
  pan: number;
  recordArm: boolean;
  inputMonitor: boolean;
  inputDeviceId?: string;
  meterMode: TrackAudioState['meterMode'];
  effectChain: AudioGraphEffectDescriptor[];
  sends: AudioGraphSendDescriptor[];
}

export interface AudioGraphMasterDescriptor {
  kind: 'master';
  id: 'master';
  volumeDb: number;
  limiterEnabled: boolean;
  targetLufs?: number;
  truePeakCeilingDb: number;
  effectChain: AudioGraphEffectDescriptor[];
}

export interface AudioGraphDescriptor {
  schemaVersion: typeof AUDIO_GRAPH_SCHEMA_VERSION;
  clips: AudioGraphClipDescriptor[];
  tracks: AudioGraphTrackDescriptor[];
  master: AudioGraphMasterDescriptor;
}

export interface AudioGraphEffectPlanStep {
  nodeId: string;
  scope: AudioGraphScope;
  ownerId: string;
  effectId: string;
  descriptorId: string;
  order: number;
  params: Record<string, AudioGraphJsonPrimitive>;
  automationMode?: AudioEffectInstance['automationMode'];
}

export interface AudioGraphSkippedEffect {
  effectId: string;
  descriptorId: string;
  order: number;
  status: Exclude<AudioGraphEffectStatus, 'active'>;
}

export interface AudioGraphClipPlan {
  kind: 'clip';
  nodeId: string;
  clipId: string;
  trackId: string;
  order: number;
  active: boolean;
  muted: boolean;
  time: AudioGraphTimeRangeDescriptor;
  source: AudioGraphClipSourceDescriptor;
  effectChain: AudioGraphEffectPlanStep[];
  skippedEffects: AudioGraphSkippedEffect[];
  outputTarget: string;
}

export interface AudioGraphTrackPlan {
  kind: 'track';
  nodeId: string;
  trackId: string;
  order: number;
  active: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  volumeDb: number;
  pan: number;
  inputClipIds: string[];
  effectChain: AudioGraphEffectPlanStep[];
  skippedEffects: AudioGraphSkippedEffect[];
  sends: AudioGraphSendDescriptor[];
  outputTarget: 'master:input';
}

export interface AudioGraphMasterPlan {
  kind: 'master';
  nodeId: 'master:main';
  active: true;
  volumeDb: number;
  limiterEnabled: boolean;
  targetLufs?: number;
  truePeakCeilingDb: number;
  effectChain: AudioGraphEffectPlanStep[];
  skippedEffects: AudioGraphSkippedEffect[];
}

export interface AudioGraphRenderStep {
  nodeId: string;
  kind: AudioGraphScope;
  ownerId: string;
  order: number;
}

export interface AudioGraphRenderPlan {
  schemaVersion: typeof AUDIO_GRAPH_SCHEMA_VERSION;
  mode: AudioGraphRenderMode;
  graphKey: string;
  descriptor: AudioGraphDescriptor;
  clips: AudioGraphClipPlan[];
  tracks: AudioGraphTrackPlan[];
  master: AudioGraphMasterPlan;
  renderSequence: AudioGraphRenderStep[];
  diagnostics: AudioGraphDiagnostic[];
}

export type AudioEffectInstanceWithBypass = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

export type ClipAudioStateInput = ClipAudioState & Record<string, unknown>;
export type TrackAudioStateInput = TrackAudioState & Record<string, unknown>;
export type MasterAudioStateInput = MasterAudioState & Record<string, unknown>;
export type MediaFileAudioAnalysisRefsInput = MediaFileAudioAnalysisRefs & Record<string, unknown>;
