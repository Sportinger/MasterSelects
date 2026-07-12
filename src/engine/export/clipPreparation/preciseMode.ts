import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { ClipPreparationModeResult, ExportClipState } from '../ClipPreparation';
import { createPreciseExportVideoElement, getClipWarmupSourceTime } from './mediaElements';
import { createExportRuntimeSource, getExportRuntimeOwnerId } from './runtimeBinding';
import { collectNestedVideoClips } from './nestedVideoClips';

const log = Logger.create('ClipPreparation');

export async function initializePreciseMode(
  videoClips: TimelineClip[],
  clipStates: Map<string, ExportClipState>,
  mediaFiles: MediaFile[],
  exportStartTime: number,
  exportRunId?: string
): Promise<ClipPreparationModeResult> {
  const preparedVideoClipIds = new Set<string>();
  const registerPreciseClip = async (clip: TimelineClip, warmupTime: number): Promise<boolean | null> => {
    if (preparedVideoClipIds.has(clip.id)) return null;
    preparedVideoClipIds.add(clip.id);

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
    if (clip.isComposition) {
      for (const { clip: nestedClip } of collectNestedVideoClips(clip)) {
        const dedicated = await registerPreciseClip(
          nestedClip,
          getClipWarmupSourceTime(nestedClip, nestedClip.startTime),
        );
        if (dedicated === null) continue;
        if (dedicated) {
          dedicatedPreciseVideoCount += 1;
        }
        preciseNestedClipCount += 1;
      }
    }

    if (clip.source?.type !== 'video') continue;
    const dedicated = await registerPreciseClip(clip, getClipWarmupSourceTime(clip, exportStartTime));
    if (dedicated === null) continue;
    if (dedicated) {
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
