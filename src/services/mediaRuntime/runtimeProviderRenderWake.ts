import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { getPlayheadPosition } from '../layerBuilder/PlayheadState';
import { Logger } from '../logger';
import { renderHostPort } from '../render/renderHostPort';
import type { DecodeSessionPolicy } from './types';

const log = Logger.create('RuntimePlayback');

export interface EnsureRuntimeFrameProviderOptions {
  readonly preferWorkerWebCodecs?: boolean;
  readonly onFrame?: () => void;
  readonly onError?: (error: Error) => void;
}

interface RuntimeProviderWakeSource {
  sourceId: string;
  sessionKey: string;
  mediaFileId?: string;
  policy: DecodeSessionPolicy;
}

/** Ordinary providers retain their existing immediate presentation wake. */
export const runtimeProviderRenderCallbacks = {
  onFrame: () => renderHostPort.requestNewFrameRender(),
  onError: () => renderHostPort.requestRender(),
};

/**
 * Only a known off-air multicam angle can use the normal playback cadence.
 * Check live ownership on every decode: an angle's shared provider can become
 * the program at a cut without being recreated. Everything uncertain keeps
 * the immediate wake, including nested/transition sources and paused seeks.
 */
function isOffAirMulticamFrame(source: RuntimeProviderWakeSource): boolean {
  if (source.policy !== 'interactive' || !source.sessionKey.startsWith('interactive-track:')) return false;
  const timeline = useTimelineStore.getState();
  if (!timeline.isPlaying || timeline.isDraggingPlayhead || timeline.clipDragPreview
    || timeline.playbackWarmup || timeline.isExporting || timeline.isRamPreviewing
    || timeline.playbackSpeed !== 1) return false;

  const media = useMediaStore.getState();
  const composition = media.compositions.find((comp) => comp.id === media.activeCompositionId);
  if (!composition?.multicam?.active || !source.mediaFileId) return false;
  const angle = composition.multicam.angles.find((candidate) => (
    source.sessionKey === `interactive-track:${candidate.trackId}:${source.sourceId}`
    && candidate.sources.some((entry) => entry.mediaFileId === source.mediaFileId)
  ));
  if (!angle) return false;

  const time = getPlayheadPosition(timeline.playheadPosition);
  if (!Number.isFinite(time)) return false;
  // Include both sides of a cut: the clock can cross the boundary between a
  // decoder callback and the next render callback, within one composition frame.
  const frameRate = composition.frameRate;
  const cutGuard = Number.isFinite(frameRate) && frameRate > 0 ? 1 / frameRate : 1 / 30;
  for (const clip of timeline.clips) {
    if (clip.source?.type === 'audio') continue;
    if (time < clip.startTime - cutGuard || time >= clip.startTime + clip.duration + cutGuard) continue;
    if (clip.isComposition || clip.nestedClips?.length || clip.transitionIn || clip.transitionOut
      || clip.transitionRender || clip.source?.type !== 'video') return false;
    if (clip.trackId === angle.trackId
      || clip.source.runtimeSourceId === source.sourceId
      || clip.source.runtimeSessionKey === source.sessionKey
      || (clip.source.mediaFileId ?? clip.mediaFileId) === source.mediaFileId) return false;
  }
  return true;
}

export function createCodecProviderRenderCallbacks(
  source: RuntimeProviderWakeSource,
  providerName: string,
  options: EnsureRuntimeFrameProviderOptions,
) {
  return {
    onFrame: () => {
      options.onFrame?.();
      if (isOffAirMulticamFrame(source)) {
        // Multi Preview has its own scheduler. Do not mark its off-air frame as
        // new program content and force a duplicate full-resolution composite.
        renderHostPort.requestRender();
      } else {
        renderHostPort.requestNewFrameRender();
      }
    },
    onError: (error: Error) => {
      options.onError?.(error);
      log.warn(`${providerName} provider error`, { sourceId: source.sourceId, message: error.message });
      renderHostPort.requestRender();
    },
  };
}
