import type { MediaFile } from '../types';
import { generateTimelineWaveformAnalysisForFile } from '../../../services/audio/timelineWaveformPyramidCache';
import { Logger } from '../../../services/logger';
import { shouldSkipWaveform } from '../../timeline/helpers/waveformHelpers';

const log = Logger.create('MediaWaveform');

const MEDIA_WAVEFORM_SAMPLES_PER_SECOND = 160;
const MEDIA_WAVEFORM_MAX_PREVIEW_SAMPLES = 32000;

type MediaWaveformUpdate = Partial<Pick<
  MediaFile,
  'audioAnalysisRefs' | 'waveform' | 'waveformChannels' | 'waveformProgress' | 'waveformStatus'
>>;

type UpdateMediaWaveform = (id: string, updates: MediaWaveformUpdate) => void;
type ResolveMediaFile = (id: string) => MediaFile | undefined;

const activeMediaWaveformJobs = new Map<string, Promise<void>>();

function canHaveSourceWaveform(mediaFile: MediaFile): boolean {
  return mediaFile.type === 'audio' || (mediaFile.type === 'video' && mediaFile.hasAudio !== false);
}

function hasReadyWaveform(mediaFile: MediaFile): boolean {
  return (mediaFile.waveform?.length ?? 0) > 0 && mediaFile.waveformStatus === 'ready';
}

function getWaveformJobKey(mediaFile: MediaFile): string {
  const file = mediaFile.file;
  return [
    mediaFile.id,
    file?.name ?? mediaFile.name,
    file?.size ?? mediaFile.fileSize ?? 0,
    file?.lastModified ?? 0,
  ].join(':');
}

export function shouldPrepareMediaWaveform(mediaFile: MediaFile): boolean {
  if (!canHaveSourceWaveform(mediaFile)) return false;
  if (!mediaFile.file) return false;
  if (hasReadyWaveform(mediaFile)) return false;
  if (mediaFile.waveformStatus === 'generating') return false;
  return true;
}

export function startMediaFileWaveformGeneration(
  mediaFile: MediaFile,
  updateMediaFile: UpdateMediaWaveform,
  resolveMediaFile?: ResolveMediaFile,
): void {
  if (!shouldPrepareMediaWaveform(mediaFile)) return;

  const file = mediaFile.file;
  if (!file) return;

  const jobKey = getWaveformJobKey(mediaFile);
  if (activeMediaWaveformJobs.has(jobKey)) return;

  const isAudioOnly = mediaFile.type === 'audio';
  if (shouldSkipWaveform(file, isAudioOnly)) {
    updateMediaFile(mediaFile.id, {
      waveformStatus: 'skipped',
      waveformProgress: 0,
    });
    return;
  }

  updateMediaFile(mediaFile.id, {
    waveformStatus: 'generating',
    waveformProgress: 0,
  });

  const job = (async () => {
    try {
      const analysis = await generateTimelineWaveformAnalysisForFile(file, {
        mediaFileId: mediaFile.id,
        includePyramid: false,
        samplesPerSecond: MEDIA_WAVEFORM_SAMPLES_PER_SECOND,
        maxPreviewSamples: MEDIA_WAVEFORM_MAX_PREVIEW_SAMPLES,
        onProgress: (progress, partialWaveform) => {
          const current = resolveMediaFile?.(mediaFile.id);
          if (current && hasReadyWaveform(current)) return;
          updateMediaFile(mediaFile.id, {
            waveform: partialWaveform,
            waveformProgress: Math.max(0, Math.min(99, progress)),
            waveformStatus: 'generating',
          });
        },
      });

      updateMediaFile(mediaFile.id, {
        waveform: analysis.waveform,
        waveformChannels: analysis.waveformChannels,
        audioAnalysisRefs: analysis.audioAnalysisRefs
          ? {
              ...(resolveMediaFile?.(mediaFile.id)?.audioAnalysisRefs ?? mediaFile.audioAnalysisRefs ?? {}),
              ...analysis.audioAnalysisRefs,
            }
          : resolveMediaFile?.(mediaFile.id)?.audioAnalysisRefs ?? mediaFile.audioAnalysisRefs,
        waveformStatus: analysis.waveform.length > 0 ? 'ready' : 'error',
        waveformProgress: analysis.waveform.length > 0 ? 100 : 0,
      });
      log.debug('Prepared source waveform', {
        id: mediaFile.id,
        name: mediaFile.name,
        samples: analysis.waveform.length,
        channels: analysis.waveformChannels?.length ?? 1,
      });
    } catch (error) {
      updateMediaFile(mediaFile.id, {
        waveformStatus: 'error',
        waveformProgress: 0,
      });
      log.warn('Failed to prepare source waveform', {
        id: mediaFile.id,
        name: mediaFile.name,
        error,
      });
    }
  })().finally(() => {
    activeMediaWaveformJobs.delete(jobKey);
  });

  activeMediaWaveformJobs.set(jobKey, job);
}
