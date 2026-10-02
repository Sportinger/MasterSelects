import type { TimelineClip } from '../../../types';
import { Logger } from '../../../services/logger';
import { useMediaStore } from '../../mediaStore';
import { shouldSkipWaveform } from '../helpers/waveformHelpers';
import { updateClipById } from '../helpers/clipStateHelpers';
import { updateDerivedTimelineClips } from '../revisionMiddleware';
import {
  SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES,
  SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND,
  generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress,
  mapSourceWaveformPyramidProgress,
} from '../../../services/audio/timelineWaveformPyramidCache';

const log = Logger.create('VideoLinkedAudioLoader');

function getCachedMediaWaveform(mediaFileId: string | undefined): Pick<TimelineClip, 'audioState' | 'waveform' | 'waveformChannels' | 'waveformGenerating' | 'waveformProgress'> | null {
  if (!mediaFileId) return null;
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (mediaFile?.waveformStatus === 'generating') return null;
  if (!mediaFile?.waveform?.length && !mediaFile?.audioAnalysisRefs?.waveformPyramidId) return null;

  return {
    ...(mediaFile.waveform?.length ? { waveform: mediaFile.waveform } : {}),
    ...(mediaFile.waveformChannels ? { waveformChannels: mediaFile.waveformChannels } : {}),
    ...(mediaFile.audioAnalysisRefs
      ? { audioState: { sourceAnalysisRefs: mediaFile.audioAnalysisRefs } }
      : {}),
    waveformGenerating: false,
    waveformProgress: 100,
  };
}

/**
 * Hands a source waveform that finished after its clips were placed (for
 * example one built from a camera's audio proxy) to the timeline audio clips
 * of that media which still have none.
 */
export function applyMediaWaveformToAudioClips(mediaFileId: string): void {
  const cached = getCachedMediaWaveform(mediaFileId);
  if (!cached) return;
  updateDerivedTimelineClips(clips => clips.map((clip) => {
    if (clip.source?.type !== 'audio' || (clip.source.mediaFileId ?? clip.mediaFileId) !== mediaFileId) return clip;
    if (clip.waveform?.length || clip.audioState?.sourceAnalysisRefs?.waveformPyramidId) return clip;
    return {
      ...clip,
      ...cached,
      audioState: {
        ...(clip.audioState ?? {}),
        sourceAnalysisRefs: {
          ...(clip.audioState?.sourceAnalysisRefs ?? {}),
          ...(cached.audioState?.sourceAnalysisRefs ?? {}),
        },
      },
    };
  }));
}

export async function loadLinkedAudio(
  file: File,
  audioClipId: string,
  naturalDuration: number,
  mediaFileId: string | undefined,
  waveformsEnabled: boolean,
  updateClip: (id: string, updates: Partial<TimelineClip>) => void,
): Promise<void> {
  const cachedWaveform = getCachedMediaWaveform(mediaFileId);
  updateClip(audioClipId, {
    source: { type: 'audio', naturalDuration, mediaFileId },
    isLoading: false,
    ...(cachedWaveform ?? {}),
  });

  const isLargeFile = shouldSkipWaveform(file);
  if (waveformsEnabled && !isLargeFile && !cachedWaveform) {
    updateDerivedTimelineClips(clips => updateClipById(clips, audioClipId, {
      waveformGenerating: true,
      waveformProgress: 0,
    }));

    try {
      const analysis = await generateTimelineWaveformAnalysisForFile(file, {
        mediaFileId,
        includePyramid: true,
        samplesPerSecond: SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND,
        maxPreviewSamples: SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES,
        onProgress: (progress, partialWaveform) => {
          updateDerivedTimelineClips(clips => updateClipById(clips, audioClipId, {
            waveformProgress: mapSourceWaveformPreviewProgress(progress),
            waveform: partialWaveform,
          }));
        },
        onPyramidProgress: (progress) => {
          updateDerivedTimelineClips(clips => updateClipById(clips, audioClipId, {
            waveformProgress: mapSourceWaveformPyramidProgress(progress),
          }));
        },
      });
      updateDerivedTimelineClips(clips => {
        const currentClip = clips.find(c => c.id === audioClipId);
        return updateClipById(clips, audioClipId, {
          waveform: analysis.waveform,
          waveformChannels: analysis.waveformChannels,
          ...(analysis.audioAnalysisRefs
            ? {
                audioState: {
                  ...(currentClip?.audioState ?? {}),
                  sourceAnalysisRefs: {
                    ...(currentClip?.audioState?.sourceAnalysisRefs ?? {}),
                    ...analysis.audioAnalysisRefs,
                  },
                },
              }
            : {}),
          waveformGenerating: false,
          waveformProgress: 100,
        });
      });
    } catch (e) {
      log.warn('Waveform generation failed', e);
      updateDerivedTimelineClips(clips => updateClipById(clips, audioClipId, {
        waveformGenerating: false,
      }));
    }
  }
}
