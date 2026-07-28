import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { ClipPreparationModeResult, ExportClipState } from '../ClipPreparation';
import { createPreciseExportVideoElement, getClipWarmupSourceTime } from './mediaElements';
import { createExportRuntimeSource, getExportRuntimeOwnerId } from './runtimeBinding';
import { collectNestedVideoClips } from './nestedVideoClips';
import {
  collectShareableRegularVideoSourceKeys,
  getExportSourceKey,
} from './sourceSharing';

const log = Logger.create('ClipPreparation');

export async function initializePreciseMode(
  videoClips: TimelineClip[],
  clipStates: Map<string, ExportClipState>,
  mediaFiles: MediaFile[],
  exportStartTime: number,
  exportRunId?: string
): Promise<ClipPreparationModeResult> {
  const preparedVideoClipIds = new Set<string>();
  const shareablePreciseSourceKeys = collectShareableRegularVideoSourceKeys(videoClips);
  const preparedRuntimeBindings = new Map<
    string,
    {
      runtimeOwnerId: string;
      runtimeSource: TimelineClip['source'];
    }
  >();
  const preparedPreciseVideos = new Map<
    string,
    {
      videoElement: HTMLVideoElement;
      objectUrl?: string;
    }
  >();
  const registerPreciseClip = async (clip: TimelineClip, warmupTime: number): Promise<boolean | null> => {
    if (preparedVideoClipIds.has(clip.id)) return null;
    preparedVideoClipIds.add(clip.id);

    const runtimeBindingKey = getExportSourceKey(clip);
    const shareSourceResources = shareablePreciseSourceKeys.has(runtimeBindingKey);
    let runtimeBinding = shareSourceResources
      ? preparedRuntimeBindings.get(runtimeBindingKey)
      : undefined;
    let runtimeOwnerId: string | undefined;
    if (!runtimeBinding) {
      runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
      runtimeBinding = {
        runtimeOwnerId,
        runtimeSource: createExportRuntimeSource(
          clip,
          runtimeOwnerId,
          null,
          exportRunId,
        ),
      };
      if (shareSourceResources) {
        preparedRuntimeBindings.set(runtimeBindingKey, runtimeBinding);
      }
    }
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    let preparedVideo = shareSourceResources
      ? preparedPreciseVideos.get(runtimeBindingKey) ?? null
      : null;
    const ownsPreparedVideo = clip.source?.type === 'video' && !preparedVideo;
    if (ownsPreparedVideo) {
      preparedVideo = await createPreciseExportVideoElement(
        clip,
        mediaFile,
        warmupTime,
        exportRunId,
      );
      if (preparedVideo && shareSourceResources) {
        preparedPreciseVideos.set(runtimeBindingKey, preparedVideo);
      }
    }

    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      ...(runtimeOwnerId ? { runtimeOwnerId } : {}),
      runtimeSource: runtimeBinding.runtimeSource,
      preciseVideoElement: preparedVideo?.videoElement ?? clip.source?.videoElement ?? null,
      preciseVideoObjectUrl: ownsPreparedVideo
        ? preparedVideo?.objectUrl ?? null
        : null,
      hasDedicatedPreciseVideoElement: ownsPreparedVideo && !!preparedVideo,
    });

    return ownsPreparedVideo && !!preparedVideo;
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
