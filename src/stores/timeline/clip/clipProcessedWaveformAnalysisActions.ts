import { Logger } from '../../../services/logger';
import { updateClipById } from '../helpers/clipStateHelpers';
import { loadTimelineWaveformPyramidArtifact } from '../../../services/audio/timelineWaveformPyramidCache';
import { audioExtractor } from '../../../engine/audio/AudioExtractor';
import {
  ProcessedWaveformPyramidService,
  clipRequiresProcessedWaveformPyramid,
  createFileAudioSourceFingerprint,
  createProcessedClipAudioStateHash,
} from '../../../services/audio/ProcessedWaveformPyramidService';
import {
  DerivedProcessedWaveformPyramidService,
  canDeriveProcessedWaveformPyramid,
} from '../../../services/audio/DerivedWaveformPyramidService';
import { clipAudioAnalysisJobService } from '../../../services/audio/ClipAudioAnalysisJobService';
import type { GenerateClipAudioAnalysisOptions } from '../types';
import { updateDerivedTimelineClips } from '../revisionMiddleware';
import type { ClipActionContext } from './clipActionContext';
import {
  clearAudioAnalysisJobUpdate,
  createAudioAnalysisJobUpdate,
  isAudioAnalysisCancellation,
  resolveClipSourceFile,
  updateAudioAnalysisJobProgress,
} from './clipAudioAnalysisShared';

const log = Logger.create('ClipProcessedWaveformAnalysis');

export async function generateProcessedWaveformForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const updateClips = (updater: Parameters<typeof updateDerivedTimelineClips>[0]): void => {
    if (options.derivedOnly) {
      updateDerivedTimelineClips(updater);
      return;
    }
    set({ clips: updater(get().clips) });
  };
  const { clips, clipKeyframes } = get();
  const clip = clips.find(c => c.id === clipId);
  if (!clip || clip.waveformGenerating) return;

  const keyframes = clipKeyframes.get(clipId) ?? [];
  if (!clipRequiresProcessedWaveformPyramid(clip, keyframes)) return;
  if (!options.force && clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId) return;
  const canDeriveProcessedWaveform = canDeriveProcessedWaveformPyramid(clip, keyframes);
  const sourceWaveformPyramidId = clip.audioState?.sourceAnalysisRefs?.waveformPyramidId;
  if (options.derivedOnly && (!canDeriveProcessedWaveform || !sourceWaveformPyramidId)) return;

  updateClips(clips => updateClipById(clips, clipId, createAudioAnalysisJobUpdate({
      kind: 'processed-waveform-pyramid',
      label: 'Processed Waveform',
      artifactKinds: ['processed-waveform-pyramid'],
      processed: true,
    })));
  log.debug('Starting processed waveform generation', { clip: clip.name });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'processed-waveform-pyramid' }, async ({ signal }) => {
      updateClips(clips => updateAudioAnalysisJobProgress(clips, clipId, 1, 'preparing', 'Preparing processed waveform'));

      if (sourceWaveformPyramidId && canDeriveProcessedWaveform) {
        updateClips(clips => updateAudioAnalysisJobProgress(clips, clipId, 5, 'preparing', 'Loading source waveform pyramid'));
        const loadedSource = await loadTimelineWaveformPyramidArtifact(sourceWaveformPyramidId);
        if (signal.aborted) throw signal.reason;

        if (loadedSource) {
          const derivedService = new DerivedProcessedWaveformPyramidService();
          const result = await derivedService.generate({
            clip,
            sourcePyramid: loadedSource.pyramid,
            sourceFingerprint: loadedSource.artifact.sourceFingerprint,
            mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId ?? loadedSource.artifact.mediaFileId,
            keyframes,
            signal,
            onProgress: (progress) => {
              const phase = progress.phase === 'deriving' ? 'analyzing' : progress.phase;
              updateClips(clips => updateAudioAnalysisJobProgress(clips, clipId, progress.percent, phase, progress.message));
            },
          });

          const currentClip = get().clips.find(c => c.id === clipId);
          if (!currentClip) return;
          if (createProcessedClipAudioStateHash(currentClip, { keyframes }) !== result.clipAudioStateHash) {
            log.debug('Discarding stale derived processed waveform result', { clipId });
            updateClips(clips => updateClipById(clips, clipId, clearAudioAnalysisJobUpdate()));
            return;
          }

          updateClips(clips => updateClipById(clips, clipId, {
              ...(currentClip.waveform?.length ? {} : { waveform: result.waveform }),
              audioState: {
                ...(currentClip.audioState ?? {}),
                processedAnalysisRefs: {
                  ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
                  ...result.audioAnalysisRefs,
                },
              },
              ...clearAudioAnalysisJobUpdate(),
              waveformProgress: 100,
            }));
          log.debug('Derived processed waveform complete', { clip: clip.name, artifactId: result.artifact.id });
          return;
        }
      }

      if (options.derivedOnly) {
        updateClips(clips => updateClipById(clips, clipId, clearAudioAnalysisJobUpdate()));
        return;
      }

      let sourceBuffer: AudioBuffer | null = null;
      let sourceFingerprint = '';
      let mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
      if (clip.isComposition && clip.compositionId) {
        sourceBuffer = clip.mixdownBuffer ?? null;
        if (!sourceBuffer) {
          const { requestCompositionAudioMixdown } = await import('../../../services/timeline/compositionAudioMixdownCache');
          const mixdownResult = await requestCompositionAudioMixdown(clip);
          if (signal.aborted) throw signal.reason;
          if (mixdownResult?.hasAudio) sourceBuffer = mixdownResult.buffer;
        }
        if (sourceBuffer) {
          sourceFingerprint = [
            'composition-mixdown',
            clip.compositionId,
            clip.nestedContentHash ?? 'unknown-content',
            sourceBuffer.sampleRate,
            sourceBuffer.length,
            Number(sourceBuffer.duration.toFixed(6)),
          ].join(':');
          mediaFileId = mediaFileId ?? clip.compositionId;
        }
      } else {
        const sourceFile = await resolveClipSourceFile(clip);
        if (sourceFile) {
          mediaFileId = mediaFileId ?? `file:${sourceFile.name}:${sourceFile.size}:${sourceFile.lastModified}`;
          updateClips(clips => updateClipById(clips, clipId, { file: sourceFile }));
          sourceFingerprint = await createFileAudioSourceFingerprint(sourceFile);
          if (signal.aborted) throw signal.reason;
          sourceBuffer = await audioExtractor.extractAudio(sourceFile, mediaFileId);
        }
      }

      if (!sourceBuffer) {
        updateClips(clips => updateClipById(clips, clipId, clearAudioAnalysisJobUpdate()));
        return;
      }

      const service = new ProcessedWaveformPyramidService();
      const result = await service.generate({
        clip,
        sourceBuffer,
        sourceFingerprint,
        mediaFileId,
        keyframes,
        signal,
        onProgress: (progress) => {
          updateClips(clips => updateAudioAnalysisJobProgress(clips, clipId, progress.percent, progress.phase === 'waveform' ? 'analyzing' : 'rendering-processed-audio', progress.message));
        },
      });

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip) return;
      if (createProcessedClipAudioStateHash(currentClip, { keyframes }) !== result.clipAudioStateHash) {
        updateClips(clips => updateClipById(clips, clipId, clearAudioAnalysisJobUpdate()));
        return;
      }

      updateClips(clips => updateClipById(clips, clipId, {
          ...(currentClip.waveform?.length ? {} : { waveform: result.waveform }),
          audioState: {
            ...(currentClip.audioState ?? {}),
            processedAnalysisRefs: {
              ...(currentClip.audioState?.processedAnalysisRefs ?? {}),
              ...result.audioAnalysisRefs,
            },
          },
          ...clearAudioAnalysisJobUpdate(),
          waveformProgress: 100,
        }));
    });
  } catch (e) {
    if (isAudioAnalysisCancellation(e)) {
      log.debug('Processed waveform generation cancelled', { clipId });
    } else {
      log.error('Processed waveform generation failed', e);
    }
    updateClips(clips => updateClipById(clips, clipId, clearAudioAnalysisJobUpdate()));
  }
}
