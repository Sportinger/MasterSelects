import type { ClipAudioStemLayer, TimelineClip } from '../../types';
import { proxyFrameCache } from '../proxyFrameCache';
import { dbToLinearGain } from './audioTrackElementUtils';
import type { AudioTrackStemLayerBufferCache } from './audioTrackStemLayerBuffers';
import {
  STEM_SOURCE_LAYER_ID,
  type ClipStemSeparationState,
  type StemBufferMixerLayer,
  type StemBufferMixerSession,
} from './audioTrackStemSyncModel';

export function buildDesiredStemBufferMixerLayers(options: {
  clip: TimelineClip;
  stemSeparation: ClipStemSeparationState;
  audibleStemLayers: readonly ClipAudioStemLayer[];
  shouldUseSourceAudio: boolean;
  sourceGain: number;
  effectiveVolume: number;
  trackMuted: boolean;
  getClipSourceMediaFileId: (clip: TimelineClip) => string | undefined;
}): StemBufferMixerLayer[] {
  const sourceMediaFileId = options.getClipSourceMediaFileId(options.clip);
  const audibleStemIds = new Set(options.audibleStemLayers.map(stem => stem.id));
  const desiredLayers: StemBufferMixerLayer[] = [];
  const sourceIsAudible = options.shouldUseSourceAudio && !options.trackMuted;
  if (sourceMediaFileId && sourceIsAudible) {
    desiredLayers.push({
      id: STEM_SOURCE_LAYER_ID,
      mediaFileId: sourceMediaFileId,
      gain: options.effectiveVolume * options.sourceGain,
      required: true,
    });
  }
  for (const stem of options.stemSeparation.stems) {
    const stemIsAudible = audibleStemIds.has(stem.id) && !options.trackMuted;
    if (!stemIsAudible) continue;
    desiredLayers.push({
      id: stem.id,
      stemLayer: stem,
      gain: options.effectiveVolume * dbToLinearGain(stem.gainDb),
      required: true,
    });
  }
  return desiredLayers;
}

export function resolveReadyStemBufferMixerLayers(options: {
  clipId: string;
  desiredLayers: StemBufferMixerLayer[];
  current: StemBufferMixerSession | undefined;
  stemLayerBuffers: AudioTrackStemLayerBufferCache;
  requestStemLayerBuffer: (layer: ClipAudioStemLayer) => void;
}): {
  buffers: Map<string, AudioBuffer>;
  layers: StemBufferMixerLayer[];
  missingRequiredLayer: boolean;
} {
  const buffers = new Map<string, AudioBuffer>();
  const layers: StemBufferMixerLayer[] = [];
  let missingRequiredLayer = false;
  for (const layer of options.desiredLayers) {
    const buffer = getCachedStemMixerLayerBuffer(layer, options.stemLayerBuffers);
    if (!buffer) {
      if (layer.stemLayer) options.requestStemLayerBuffer(layer.stemLayer);
      if (layer.required) missingRequiredLayer = true;
      continue;
    }
    if (options.current && !layer.required && !options.current.gains.has(layer.id)) continue;
    buffers.set(layer.id, buffer);
    layers.push(layer);
  }
  return { buffers, layers, missingRequiredLayer };
}

function getCachedStemMixerLayerBuffer(
  layer: StemBufferMixerLayer,
  stemLayerBuffers: AudioTrackStemLayerBufferCache,
): AudioBuffer | null {
  if (layer.stemLayer) return stemLayerBuffers.getCached(layer.stemLayer);
  return layer.mediaFileId ? proxyFrameCache.getCachedAudioBuffer(layer.mediaFileId) : null;
}
