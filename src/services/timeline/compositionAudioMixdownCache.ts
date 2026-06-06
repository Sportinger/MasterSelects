import type { TimelineClip } from '../../types';
import { compositionAudioMixer, type CompositionMixdownResult } from '../compositionAudioMixer';
import { Logger } from '../logger';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';
import type { RenderResourceDescriptor } from './runtimeCoordinatorTypes';
import {
  getCompositionAudioMixdownKey,
  getCompositionMixdownAudioElementResourceId,
  getCompositionMixdownBufferResourceId,
  hashCompositionAudioMixdownKey,
  releaseCompletedCompositionAudioMixdownResource,
} from './compositionAudioMixdownRuntimeResources';

export {
  getCompositionAudioMixdownKey,
  getCompositionMixdownAudioElementResourceId,
  getCompositionMixdownBufferResourceId,
  releaseCompositionMixdownAudioElementResource,
  releaseCompositionMixdownClipRuntime,
} from './compositionAudioMixdownRuntimeResources';

export interface CompositionAudioMixdownRequestResult extends CompositionMixdownResult {
  key: string;
}

interface PendingMixdownEntry {
  promise: Promise<CompositionAudioMixdownRequestResult | null>;
}

export const MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS = 12;

const log = Logger.create('CompositionAudioMixdownCache');

const pendingMixdowns = new Map<string, PendingMixdownEntry>();
const completedMixdowns = new Map<string, CompositionAudioMixdownRequestResult | null>();

function estimateAudioBufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

function createCompositionMixdownBufferResource(
  key: string,
  value: CompositionAudioMixdownRequestResult,
): RenderResourceDescriptor {
  const [compositionId] = key.split(':', 1);
  const resourceId = getCompositionMixdownBufferResourceId(key);
  return {
    id: resourceId,
    kind: 'runtime-binding',
    policyId: 'interactive',
    owner: {
      ownerId: 'composition-audio-mixdown-cache',
      ownerType: 'timeline',
      compositionId,
    },
    source: {
      sourceId: key,
      compositionId,
    },
    runtime: {
      runtimeSourceId: `composition-audio-mixdown:${hashCompositionAudioMixdownKey(key)}`,
      runtimeSessionKey: key,
    },
    dimensions: {
      durationSeconds: value.duration,
      sampleRate: value.buffer.sampleRate,
      channelCount: value.buffer.numberOfChannels,
    },
    memoryCost: {
      heapBytes: estimateAudioBufferBytes(value.buffer),
    },
    diagnostics: {
      status: 'ok',
      session: {
        sourceId: key,
        sessionKey: key,
        policyId: 'interactive',
        status: 'ok',
      },
    },
    label: 'Composition mixdown AudioBuffer cache entry',
    tags: ['composition-audio-mixdown', 'audio-buffer-cache'],
  };
}

function createCompositionMixdownAudioElementResource(params: {
  clipId: string;
  compositionId?: string;
  buffer: AudioBuffer;
}): RenderResourceDescriptor {
  const resourceId = getCompositionMixdownAudioElementResourceId(params.clipId);
  return {
    id: resourceId,
    kind: 'html-media',
    policyId: 'interactive',
    owner: {
      ownerId: `composition-audio-mixdown:${params.clipId}`,
      ownerType: 'clip',
      clipId: params.clipId,
      compositionId: params.compositionId,
    },
    source: {
      clipId: params.clipId,
      compositionId: params.compositionId,
    },
    mediaElementKind: 'audio',
    elementId: resourceId,
    srcKind: 'blob-url',
    dimensions: {
      durationSeconds: params.buffer.duration,
      sampleRate: params.buffer.sampleRate,
      channelCount: params.buffer.numberOfChannels,
    },
    memoryCost: {
      heapBytes: estimateAudioBufferBytes(params.buffer),
    },
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: resourceId,
        providerKind: 'html-audio',
        status: 'ok',
      },
    },
    label: 'Composition mixdown playback audio element',
    tags: ['composition-audio-mixdown', 'playback-audio-element'],
  };
}

function releaseCompletedMixdownBufferResource(key: string): void {
  releaseCompletedCompositionAudioMixdownResource(key);
}

function retainCompletedMixdownBufferResource(
  key: string,
  value: CompositionAudioMixdownRequestResult,
): boolean {
  const resource = createCompositionMixdownBufferResource(key, value);
  const admission = timelineRuntimeCoordinator.canRetainResource(resource);
  if (!admission.admitted) {
    log.debug('Skipped composition mixdown buffer cache retention due to runtime budget', {
      key,
      policyId: admission.policyId,
      reason: admission.reason,
      rejectedUnits: admission.rejectedUnits,
    });
    return false;
  }
  timelineRuntimeCoordinator.retainResource(resource);
  return true;
}

function rememberCompletedMixdown(key: string, value: CompositionAudioMixdownRequestResult | null): void {
  releaseCompletedMixdownBufferResource(key);
  completedMixdowns.delete(key);

  if (value && !retainCompletedMixdownBufferResource(key, value)) {
    return;
  }

  completedMixdowns.set(key, value);

  while (completedMixdowns.size > MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS) {
    const oldestKey = completedMixdowns.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    completedMixdowns.delete(oldestKey);
    releaseCompletedMixdownBufferResource(oldestKey);
  }
}

function getCompletedMixdown(key: string): CompositionAudioMixdownRequestResult | null | undefined {
  if (!completedMixdowns.has(key)) {
    return undefined;
  }
  const value = completedMixdowns.get(key) ?? null;
  completedMixdowns.delete(key);
  completedMixdowns.set(key, value);
  return value;
}

function resultFromExistingBuffer(
  clip: Pick<TimelineClip, 'compositionId' | 'nestedContentHash' | 'mixdownBuffer' | 'mixdownWaveform' | 'waveform' | 'duration' | 'source'>,
  key: string,
): CompositionAudioMixdownRequestResult | null {
  if (!clip.mixdownBuffer) return null;
  return {
    key,
    buffer: clip.mixdownBuffer,
    waveform: clip.mixdownWaveform ?? clip.waveform ?? [],
    duration: clip.source?.naturalDuration ?? clip.mixdownBuffer.duration ?? clip.duration,
    hasAudio: true,
  };
}

export async function requestCompositionAudioMixdown(
  clip: Pick<TimelineClip, 'compositionId' | 'nestedContentHash' | 'mixdownBuffer' | 'mixdownWaveform' | 'waveform' | 'duration' | 'source'>,
): Promise<CompositionAudioMixdownRequestResult | null> {
  const key = getCompositionAudioMixdownKey(clip);
  if (!key || !clip.compositionId) return null;

  const existing = resultFromExistingBuffer(clip, key);
  if (existing) return existing;

  const completed = getCompletedMixdown(key);
  if (completed !== undefined) {
    return completed;
  }

  const pending = pendingMixdowns.get(key);
  if (pending) return pending.promise;

  const promise = compositionAudioMixer
    .mixdownComposition(clip.compositionId)
    .then((result): CompositionAudioMixdownRequestResult | null => {
      const value = result ? { ...result, key } : null;
      rememberCompletedMixdown(key, value);
      return value;
    })
    .finally(() => {
      pendingMixdowns.delete(key);
    });

  pendingMixdowns.set(key, { promise });
  return promise;
}

export function createCompositionMixdownAudioElement(
  clipId: string,
  buffer: AudioBuffer,
  options: { compositionId?: string } = {},
): HTMLAudioElement | null {
  const resource = createCompositionMixdownAudioElementResource({
    clipId,
    compositionId: options.compositionId,
    buffer,
  });
  const admission = timelineRuntimeCoordinator.canRetainResource(resource);
  if (!admission.admitted) {
    log.debug('Skipped composition mixdown playback audio element due to runtime budget', {
      clipId,
      compositionId: options.compositionId,
      policyId: admission.policyId,
      reason: admission.reason,
      rejectedUnits: admission.rejectedUnits,
    });
    return null;
  }

  let element: HTMLAudioElement;
  try {
    element = compositionAudioMixer.createAudioElement(buffer, { ownerClipId: clipId });
  } catch (error) {
    timelineRuntimeCoordinator.releaseResource(resource.id);
    throw error;
  }
  timelineRuntimeCoordinator.retainResource(resource);
  return element;
}

export function forgetCompletedCompositionAudioMixdown(key: string): void {
  completedMixdowns.delete(key);
  releaseCompletedMixdownBufferResource(key);
}

export function clearCompositionAudioMixdownCache(): void {
  for (const key of completedMixdowns.keys()) {
    releaseCompletedMixdownBufferResource(key);
  }
  pendingMixdowns.clear();
  completedMixdowns.clear();
}

export function getCompositionAudioMixdownCacheStats(): {
  pendingCount: number;
  completedCount: number;
  maxCompletedCount: number;
} {
  return {
    pendingCount: pendingMixdowns.size,
    completedCount: completedMixdowns.size,
    maxCompletedCount: MAX_COMPLETED_COMPOSITION_AUDIO_MIXDOWNS,
  };
}
