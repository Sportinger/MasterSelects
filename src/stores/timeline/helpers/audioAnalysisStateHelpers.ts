import type { AudioEffectInstance, ClipAudioState, TimelineClip } from '../../../types';
import { audioEffectInstanceRequiresProcessedAnalysis } from '../../../services/audio/processedWaveformEligibility';

const AUDIO_RELEVANT_UPDATE_KEYS = new Set<keyof TimelineClip>([
  'audioState',
  'speed',
  'reversed',
  'inPoint',
  'outPoint',
  'duration',
]);

const CACHE_NEUTRAL_AUDIO_STATE_KEYS = new Set<keyof ClipAudioState>([
  'sourceAnalysisRefs',
  'processedAnalysisRefs',
  'bakeHistory',
  'soloSafe',
]);

function effectStackRequiresProcessedAnalysis(effectStack: readonly AudioEffectInstance[] | undefined): boolean {
  return (effectStack ?? []).some(effect => audioEffectInstanceRequiresProcessedAnalysis(effect));
}

function audioStatePatchInvalidatesProcessedAudioAnalysis(
  current: ClipAudioState | undefined,
  patch: Partial<ClipAudioState> | undefined,
): boolean {
  if (!patch) return current !== undefined;

  for (const key of Object.keys(patch) as Array<keyof ClipAudioState>) {
    if (CACHE_NEUTRAL_AUDIO_STATE_KEYS.has(key)) continue;

    if (key === 'effectStack') {
      const currentRequiresProcessedAnalysis = effectStackRequiresProcessedAnalysis(current?.effectStack);
      const nextRequiresProcessedAnalysis = effectStackRequiresProcessedAnalysis(patch.effectStack);
      if (currentRequiresProcessedAnalysis || nextRequiresProcessedAnalysis) return true;
      continue;
    }

    if (key === 'muted') {
      if ((current?.muted ?? false) !== (patch.muted ?? false)) return true;
      continue;
    }

    if (key === 'sourceAudioRevisionId') {
      if (current?.sourceAudioRevisionId !== patch.sourceAudioRevisionId) return true;
      continue;
    }

    return true;
  }

  return false;
}

export function clipUpdatesInvalidateProcessedAudioAnalysis(
  updates: Partial<TimelineClip>,
  currentClip?: Pick<TimelineClip, 'audioState'>,
): boolean {
  return (Object.keys(updates) as Array<keyof TimelineClip>).some(key => {
    if (!AUDIO_RELEVANT_UPDATE_KEYS.has(key)) return false;
    if (key === 'audioState') {
      return audioStatePatchInvalidatesProcessedAudioAnalysis(currentClip?.audioState, updates.audioState);
    }
    return true;
  });
}

export function clearProcessedAudioAnalysisRefs(clip: TimelineClip): TimelineClip {
  if (!clip.audioState?.processedAnalysisRefs) {
    return clip;
  }

  const audioState = { ...clip.audioState };
  delete audioState.processedAnalysisRefs;
  return {
    ...clip,
    audioState,
  };
}

export function applyClipUpdatesWithAudioAnalysisInvalidation(
  clip: TimelineClip,
  updates: Partial<TimelineClip>,
): TimelineClip {
  const hasAudioStateUpdate = Object.prototype.hasOwnProperty.call(updates, 'audioState');
  const invalidateProcessedAnalysis = (Object.keys(updates) as Array<keyof TimelineClip>).some(key => {
    if (!AUDIO_RELEVANT_UPDATE_KEYS.has(key)) return false;
    if (key === 'audioState') {
      return audioStatePatchInvalidatesProcessedAudioAnalysis(clip.audioState, updates.audioState);
    }
    return true;
  });
  const nextClip: TimelineClip = {
    ...clip,
    ...updates,
    ...(hasAudioStateUpdate && updates.audioState
      ? { audioState: { ...clip.audioState, ...updates.audioState } }
      : hasAudioStateUpdate
        ? { audioState: updates.audioState }
      : {}),
  };

  return invalidateProcessedAnalysis ? clearProcessedAudioAnalysisRefs(nextClip) : nextClip;
}
