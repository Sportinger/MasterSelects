import type { TimelineClip } from '../../../types/timeline';
import { Logger } from '../../../services/logger';
import { updateClipById } from '../helpers/clipStateHelpers';
import { clipRequiresProcessedWaveformPyramid } from '../../../services/audio/ProcessedWaveformPyramidService';
import { prepareClipAudioAnalysisInput } from '../../../services/audio/ClipAudioAnalysisOrchestrator';
import type { GenerateClipAudioAnalysisOptions } from '../types';
import type { ClipActionContext } from './clipActionContext';
import {
  clearAudioAnalysisJobUpdate,
  updateAudioAnalysisJobProgress,
} from './clipAudioAnalysisShared';

const log = Logger.create('ClipPreparedAudioAnalysisCore');

type SourceAnalysisRefs = NonNullable<NonNullable<TimelineClip['audioState']>['sourceAnalysisRefs']>;
type ProcessedAnalysisRefs = NonNullable<NonNullable<TimelineClip['audioState']>['processedAnalysisRefs']>;

export function getPreparedProgress(percent: number, processed: boolean): number {
  const base = processed ? 66 : 0;
  const scale = processed ? 0.32 : 0.98;
  return Math.min(98, Math.round(base + percent * scale));
}

export async function prepareAnalysisInput(
  context: ClipActionContext,
  clipId: string,
  needsProcessed: boolean,
  signal: AbortSignal,
  emptyMessage: string,
) {
  const { get, set } = context;
  const clip = get().clips.find(c => c.id === clipId);
  const keyframes = get().clipKeyframes.get(clipId) ?? [];
  if (!clip) return null;

  const prepared = await prepareClipAudioAnalysisInput({
    clip,
    keyframes,
    needsProcessed,
    signal,
    onMixdownReady: (buffer) => {
      set({
        clips: updateClipById(get().clips, clipId, {
          mixdownBuffer: buffer,
          hasMixdownAudio: true,
        }),
      });
    },
    onRenderProgress: (progress) => {
      set({
        clips: updateAudioAnalysisJobProgress(
          get().clips,
          clipId,
          Math.min(66, Math.round(progress.percent * 0.66)),
          'rendering-processed-audio',
          progress.message,
        ),
      });
    },
  });

  if (!prepared) {
    log.warn(emptyMessage, { clipId });
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
    return null;
  }
  return prepared;
}

export function shouldSkipPreparedAnalysis(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions,
  sourceRef: (refs: SourceAnalysisRefs | undefined) => boolean,
  processedRef: (refs: ProcessedAnalysisRefs | undefined) => boolean,
): { clipName: string; needsProcessed: boolean } | null {
  const { get } = context;
  const clip = get().clips.find(c => c.id === clipId);
  if (!clip) {
    log.warn('Audio analysis skipped: the clip no longer exists', { clipId });
    return null;
  }
  if (clip.waveformGenerating) {
    // Callers retry once the waveform is ready; say so instead of returning silently.
    log.info('Audio analysis skipped: the clip waveform is still being generated', { clipId });
    return null;
  }

  const keyframes = get().clipKeyframes.get(clipId) ?? [];
  const needsProcessed = clipRequiresProcessedWaveformPyramid(clip, keyframes);
  if (!options.force && needsProcessed && processedRef(clip.audioState?.processedAnalysisRefs)) return null;
  if (!options.force && !needsProcessed && sourceRef(clip.audioState?.sourceAnalysisRefs)) return null;
  return { clipName: clip.name, needsProcessed };
}
