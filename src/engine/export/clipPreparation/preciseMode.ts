import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { ClipPreparationModeResult, ExportClipState } from '../ClipPreparation';
import { createPreciseExportVideoElement, getClipWarmupSourceTime } from './mediaElements';
import { createExportRuntimeSource, getExportRuntimeOwnerId } from './runtimeBinding';

const log = Logger.create('ClipPreparation');

export async function initializePreciseMode(
  videoClips: TimelineClip[],
  clipStates: Map<string, ExportClipState>,
  mediaFiles: MediaFile[],
  exportStartTime: number,
  exportRunId?: string
): Promise<ClipPreparationModeResult> {
  const registerPreciseClip = async (clip: TimelineClip, warmupTime: number) => {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const runtimeSource = createExportRuntimeSource(clip, runtimeOwnerId, null, exportRunId);
    const preparedVideo = clip.source?.type === 'video'
      ? await createPreciseExportVideoElement(clip, mediaFile, warmupTime, exportRunId)
      : null;

    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource,
      preciseVideoElement: preparedVideo?.videoElement ?? clip.source?.videoElement ?? null,
      preciseVideoObjectUrl: preparedVideo?.objectUrl ?? null,
      hasDedicatedPreciseVideoElement: !!preparedVideo,
    });

    return !!preparedVideo;
  };

  let preciseClipCount = 0;
  let preciseNestedClipCount = 0;
  let dedicatedPreciseVideoCount = 0;

  for (const clip of videoClips) {
    if (clip.isComposition && clip.nestedClips) {
      for (const nestedClip of clip.nestedClips) {
        if (nestedClip.source?.type !== 'video') continue;
        if (await registerPreciseClip(nestedClip, getClipWarmupSourceTime(nestedClip, nestedClip.startTime))) {
          dedicatedPreciseVideoCount += 1;
        }
        preciseNestedClipCount += 1;
      }
    }

    if (clip.source?.type !== 'video') continue;
    if (await registerPreciseClip(clip, getClipWarmupSourceTime(clip, exportStartTime))) {
      dedicatedPreciseVideoCount += 1;
    }
    preciseClipCount += 1;
    log.debug(`Clip ${clip.name}: PRECISE mode (HTMLVideoElement seeking)`);
  }
  log.info(`All ${preciseClipCount} clips using PRECISE HTMLVideoElement seeking`);
  if (preciseNestedClipCount > 0) {
    log.info(`Registered ${preciseNestedClipCount} nested PRECISE export clips`);
  }
  if (dedicatedPreciseVideoCount > 0) {
    log.info(`Prepared ${dedicatedPreciseVideoCount} dedicated PRECISE export video elements`);
  }

  return {
    clipStates,
    parallelDecoder: null,
    useParallelDecode: false,
    exportMode: 'precise',
  };
}
