import type { ClipAudioStemLayer, TimelineClip } from '../../types';
import { STEM_SOURCE_LAYER_ID } from '../audio/stemSeparation';
import type { LiveAudioRouteSettings } from '../audio/audioGraphRouteSettings';
import type { ClipTimeInfo } from './types';

export { STEM_SOURCE_LAYER_ID };

export interface StemAudioElementEntry {
  key: string;
  element: HTMLAudioElement | null;
  loading: boolean;
  error?: string;
  url?: string;
  resourceId?: string;
}

export interface StemAudioElementSet {
  key: string;
  entries: Map<string, StemAudioElementEntry>;
}

export interface StemBufferMixerLayer {
  id: string;
  mediaFileId?: string;
  stemLayer?: ClipAudioStemLayer;
  gain: number;
  required: boolean;
}

export interface StemBufferMixerSession {
  key: string;
  clipId: string;
  context: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
  stereoSplitter: ChannelSplitterNode;
  leftAnalyser: AnalyserNode;
  rightAnalyser: AnalyserNode;
  meterSamples: Float32Array<ArrayBuffer>;
  leftMeterSamples: Float32Array<ArrayBuffer>;
  rightMeterSamples: Float32Array<ArrayBuffer>;
  meterTrackId: string;
  getSourceTime: () => number | null;
  sources: AudioBufferSourceNode[];
  gains: Map<string, GainNode>;
  startedAtContextTime: number;
  startedClipTime: number;
  sourceCount: number;
  lastGainSignature: string;
  lastMeterPublishAt: number;
}

export type ClipStemSeparationState = NonNullable<NonNullable<TimelineClip['audioState']>['stemSeparation']>;

export interface StemBufferMixerSyncOptions {
  clip: TimelineClip;
  stemSeparation: ClipStemSeparationState;
  audibleStemLayers: ClipAudioStemLayer[];
  shouldUseSourceAudio: boolean;
  sourceGain: number;
  routeSettings: LiveAudioRouteSettings;
  timeInfo: ClipTimeInfo;
  effectiveVolume: number;
  trackMuted: boolean;
  meterTrackId: string;
  canBeMaster: boolean;
}

export const STEM_MIXER_START_DELAY_SECONDS = 0.035;
export const STEM_MIXER_RESTART_DRIFT_SECONDS = 0.2;
export const STEM_MIXER_METER_INTERVAL_MS = 50;
export const STEM_MIXER_BUFFER_SET_MAX_BYTES = 512 * 1024 * 1024;
export const STEM_LAYER_BUFFER_CACHE_MAX_BYTES = 768 * 1024 * 1024;
export const STEM_LAYER_BUFFER_CACHE_MAX_ENTRIES = 12;

export function estimateAudioBufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

export function estimateStemLayerBytes(stemSeparation: ClipStemSeparationState, layerCount: number): number {
  const duration = Math.max(0, stemSeparation.range.end - stemSeparation.range.start);
  const sampleRate = Math.max(1, stemSeparation.sampleRate);
  const channelCount = Math.max(1, stemSeparation.channelCount);
  return Math.ceil(duration * sampleRate) * channelCount * Float32Array.BYTES_PER_ELEMENT * layerCount;
}

export function createStemBufferCacheKey(layer: ClipAudioStemLayer): string {
  return [
    layer.manifestArtifactId,
    layer.payloadRef.artifactId,
    layer.payloadRef.hash,
    layer.sourceFingerprint,
  ].filter(Boolean).join(':');
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createStemLayerSetKey(clip: TimelineClip): string | null {
  const stemSeparation = clip.audioState?.stemSeparation;
  if (!stemSeparation || stemSeparation.stems.length === 0) return null;

  return JSON.stringify({
    clipId: clip.id,
    activeSetId: stemSeparation.activeSetId,
    modelId: stemSeparation.modelId,
    modelVersion: stemSeparation.modelVersion,
    sourceFingerprint: stemSeparation.sourceFingerprint,
    stems: stemSeparation.stems.map(stem => ({
      id: stem.id,
      payloadArtifactId: stem.payloadRef.artifactId,
      manifestArtifactId: stem.manifestArtifactId,
      mediaFileId: stem.mediaFileId,
    })),
  });
}

export function getAudibleStemLayers(
  stemSeparation: NonNullable<TimelineClip['audioState']>['stemSeparation'],
): ClipAudioStemLayer[] {
  if (!stemSeparation || stemSeparation.mixMode === 'original' || stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID) {
    return [];
  }
  if (stemSeparation.soloStemId) {
    return stemSeparation.stems.filter(stem => stem.id === stemSeparation.soloStemId);
  }
  return [];
}

export function usesSourceAudioLayer(
  stemSeparation: NonNullable<TimelineClip['audioState']>['stemSeparation'],
): boolean {
  const hasSelectedStem = Boolean(
    stemSeparation?.soloStemId &&
    stemSeparation.soloStemId !== STEM_SOURCE_LAYER_ID &&
    stemSeparation.stems.some(stem => stem.id === stemSeparation.soloStemId),
  );

  return !stemSeparation ||
    stemSeparation.mixMode === 'original' ||
    stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID ||
    !hasSelectedStem;
}

export function clipUsesSourceAudioLayer(clip: TimelineClip): boolean {
  return usesSourceAudioLayer(clip.audioState?.stemSeparation);
}

export function canUseStemBufferMixer(
  routeSettings: LiveAudioRouteSettings,
  absSpeed: number,
): boolean {
  const routeHasEq = (eqGains: readonly number[] | undefined): boolean => {
    return eqGains?.some(gain => Math.abs(gain) > 0.01) ?? false;
  };

  return Math.abs(absSpeed - 1) <= 0.001 &&
    Math.abs(routeSettings.pan) <= 0.001 &&
    !routeHasEq(routeSettings.eqGains) &&
    !routeHasEq(routeSettings.master.eqGains) &&
    routeSettings.processors.length === 0 &&
    routeSettings.master.processors.length === 0;
}
