import type { MediaFileAudioAnalysisRefs } from '../../../types/audio';
import { Logger } from '../../../services/logger';
import { generateWaveformFromBuffer } from '../helpers/waveformHelpers';
import { updateClipById } from '../helpers/clipStateHelpers';
import {
  generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress,
  mapSourceWaveformPyramidProgress,
} from '../../../services/audio/timelineWaveformPyramidCache';
import { clipAudioAnalysisJobService } from '../../../services/audio/ClipAudioAnalysisJobService';
import { hasTimelineWaveformData } from '../../../utils/audioWaveformPresence';
import type { GenerateClipAudioAnalysisOptions } from '../types';
import { updateDerivedTimelineClips } from '../revisionMiddleware';
import type { ClipActionContext } from './clipActionContext';
import { reportDerivedWaveformProgress, discardDerivedWaveformProgress } from './derivedWaveformProgress';
import {
  clearAudioAnalysisJobUpdate,
  createAudioAnalysisJobUpdate,
  isAudioAnalysisCancellation,
  isUnreadableClipSourceError,
  resolveClipSourceFile,
  updateAudioAnalysisJobProgress,
} from './clipAudioAnalysisShared';

const log = Logger.create('ClipWaveformAnalysis');

export function cancelAudioAnalysisForClipAction(context: ClipActionContext, clipId: string): void {
  const { get, set } = context;
  const cancelled = clipAudioAnalysisJobService.cancelClip(clipId);
  if (cancelled === 0) return;
  set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
}

export async function generateWaveformForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  let activeJobId: string | undefined;
  const updateClips = (updater: Parameters<typeof updateDerivedTimelineClips>[0]): void => {
    const currentUpdater: typeof updater = clips => {
      if (activeJobId && clips.find(current => current.id === clipId)?.audioAnalysisJob?.jobId !== activeJobId) return clips;
      return updater(clips);
    };
    if (options.derivedOnly) {
      updateDerivedTimelineClips(currentUpdater);
      return;
    }
    const current = get().clips;
    const next = currentUpdater(current);
    if (next !== current) set({ clips: next });
  };
  const clip = get().clips.find(c => c.id === clipId);
  if (!clip || clip.waveformGenerating) return;
  if (!options.force && hasTimelineWaveformData(clip)) return;
  if (options.derivedOnly && clip.isComposition) return;
  const includePyramid = options.previewOnly !== true;

  const jobUpdate = createAudioAnalysisJobUpdate({
      kind: 'waveform-pyramid',
      label: includePyramid ? 'Waveform' : 'Waveform Preview',
      artifactKinds: includePyramid ? ['waveform-pyramid'] : [],
      processed: false,
    });
  const jobId = jobUpdate.audioAnalysisJob!.jobId;
  updateClips(clips => updateClipById(clips, clipId, jobUpdate));
  activeJobId = jobId;
  log.debug('Starting waveform generation', { clip: clip.name, includePyramid });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'waveform-pyramid' }, async ({ signal }) => {
      if (options.derivedOnly && get().clips.find(current => current.id === clipId)?.audioAnalysisJob?.jobId !== jobId) {
        throw new DOMException('Waveform clip is no longer active', 'AbortError');
      }
      updateClips(clips => updateAudioAnalysisJobProgress(clips, clipId, 1, 'preparing', 'Preparing waveform'));
      let waveform: number[];
      let waveformChannels: number[][] | undefined;
      let audioAnalysisRefs: MediaFileAudioAnalysisRefs | undefined;

      if (clip.isComposition && clip.compositionId) {
        const { requestCompositionAudioMixdown } = await import('../../../services/timeline/compositionAudioMixdownCache');
        const mixdownResult = await requestCompositionAudioMixdown(clip);
        if (signal.aborted) throw signal.reason;

        if (mixdownResult?.hasAudio) {
          waveform = mixdownResult.waveform;
          updateClips(clips => updateClipById(clips, clipId, {
              mixdownBuffer: mixdownResult.buffer,
              mixdownWaveform: mixdownResult.waveform,
              hasMixdownAudio: true,
              mixdownGenerating: false,
            }));
        } else if (clip.mixdownBuffer) {
          waveform = await generateWaveformFromBuffer(clip.mixdownBuffer, 50);
        } else {
          waveform = new Array(Math.max(1, Math.floor(clip.duration * 50))).fill(0);
        }
      } else {
        const sourceFile = await resolveClipSourceFile(clip);
        if (!sourceFile) {
          log.warn('No file found for clip', { clipId });
          updateClips(clips => updateClipById(clips, clipId, {
            ...(!options.derivedOnly ? { file: undefined, needsReload: true } : {}),
            ...clearAudioAnalysisJobUpdate(),
          }));
          return;
        }

        if (!options.derivedOnly) {
          updateClips(clips => updateClipById(clips, clipId, { file: sourceFile }));
        }
        const analysis = await generateTimelineWaveformAnalysisForFile(sourceFile, {
          mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
          includePyramid,
          reuseCompleted: options.derivedOnly === true && options.force !== true,
          reusePersisted: options.force !== true,
          includePartialPreview: options.derivedOnly !== true,
          background: options.derivedOnly === true,
          isCurrent: () => get().clips.find(current => current.id === clipId)?.audioAnalysisJob?.jobId === jobId,
          signal,
          onProgress: (progress, partialWaveform) => {
            if (options.derivedOnly) {
              reportDerivedWaveformProgress(clipId, { jobId,
                progress: includePyramid ? mapSourceWaveformPreviewProgress(progress) : progress, phase: 'analyzing' });
              return;
            }
            updateClips(clips => updateAudioAnalysisJobProgress(
                updateClipById(clips, clipId, { waveform: partialWaveform }),
                clipId,
                includePyramid ? mapSourceWaveformPreviewProgress(progress) : progress,
                'analyzing',
              ));
          },
          onPyramidProgress: (progress) => {
            if (options.derivedOnly) {
              reportDerivedWaveformProgress(clipId, { jobId, progress: mapSourceWaveformPyramidProgress(progress),
                phase: progress.phase.startsWith('storing') ? 'storing' : 'analyzing', message: progress.message });
              return;
            }
            updateClips(clips => updateAudioAnalysisJobProgress(
                clips,
                clipId,
                mapSourceWaveformPyramidProgress(progress),
                progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
                progress.message,
              ));
          },
        });
        waveform = analysis.waveform;
        waveformChannels = analysis.waveformChannels;
        audioAnalysisRefs = analysis.audioAnalysisRefs;
      }

      discardDerivedWaveformProgress(clipId, jobId);
      if (signal.aborted) throw signal.reason;
      const currentClip = get().clips.find(c => c.id === clipId);
      updateClips(clips => updateClipById(clips, clipId, {
        waveform,
        waveformChannels,
        ...(audioAnalysisRefs
          ? {
              audioState: {
                ...(currentClip?.audioState ?? {}),
                sourceAnalysisRefs: {
                  ...(currentClip?.audioState?.sourceAnalysisRefs ?? {}),
                  ...audioAnalysisRefs,
                },
              },
            }
          : {}),
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }));
    });
  } catch (e) {
    if (isAudioAnalysisCancellation(e)) {
      log.debug('Waveform generation cancelled', { clipId });
    } else if (isUnreadableClipSourceError(e)) {
      log.warn('Waveform source became unavailable', { clipId });
    } else {
      log.error('Waveform generation failed', e);
    }
    updateClips(clips => updateClipById(clips, clipId, {
      ...(isUnreadableClipSourceError(e) && !options.derivedOnly
        ? { file: undefined, needsReload: true } : {}),
      ...clearAudioAnalysisJobUpdate(),
    }));
    // Background callers must distinguish a failed analysis from completion.
    if (options.derivedOnly && !isAudioAnalysisCancellation(e)) throw e;
  } finally {
    discardDerivedWaveformProgress(clipId, jobId);
  }
}
