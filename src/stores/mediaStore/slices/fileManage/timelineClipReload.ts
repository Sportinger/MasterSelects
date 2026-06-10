import { thumbnailCacheService } from '../../../../services/thumbnailCacheService';
import { readLottieMetadata } from '../../../../services/vectorAnimation/lottieMetadata';
import { readRiveMetadata } from '../../../../services/vectorAnimation/riveMetadata';
import { isVectorAnimationSourceType } from '../../../../types/vectorAnimation';
import { createPrimaryMediaObjectUrl } from '../../../../services/project/mediaObjectUrlManager';
import {
  getModelSequenceFrameUrl,
  resolveModelSequenceData,
} from '../../../../utils/modelSequence';
import { resolveGaussianSplatSequenceData } from '../../../../utils/gaussianSplatSequence';
import { useTimelineStore } from '../../../timeline';
import { blobUrlManager } from '../../../timeline/helpers/blobUrlManager';
import { useMediaStore } from '../..';
import { fileManageLog as log } from './log';
import {
  createSourceReplacementClipAudioPatch,
  invalidateMediaSourceReplacementCaches,
} from './sourceReplacementCache';

/**
 * Update timeline clips with reloaded file.
 * Writes data-only clip sources for video/audio; runtime hydration happens lazily.
 * Exported for use by projectSync auto-relink.
 */
export type UpdateTimelineClipsOptions = {
  generateThumbnails?: boolean;
  invalidateCaches?: boolean;
  fileHash?: string;
};

export async function updateTimelineClips(
  mediaFileId: string,
  file: File,
  options: UpdateTimelineClipsOptions = {},
): Promise<void> {
  const generateThumbnails = options.generateThumbnails !== false;
  const shouldInvalidateCaches = options.invalidateCaches !== false;
  const timelineStore = useTimelineStore.getState();
  const mediaFile = useMediaStore.getState().files.find((entry) => entry.id === mediaFileId);
  const fileHash = options.fileHash ?? mediaFile?.fileHash;
  const clips = timelineStore.clips.filter(
    c => c.source?.mediaFileId === mediaFileId && c.needsReload
  );

  if (clips.length === 0) {
    // Debug: check if there are clips that need reload but with different mediaFileId
    const allNeedReload = timelineStore.clips.filter(c => c.needsReload);
    if (allNeedReload.length > 0) {
      log.debug(`No clips matched for mediaFileId ${mediaFileId}, but ${allNeedReload.length} clips need reload`, {
        mediaFileId,
        clipMediaIds: allNeedReload.map(c => c.source?.mediaFileId).slice(0, 5),
      });
    }
    return;
  }

  if (shouldInvalidateCaches) {
    await invalidateMediaSourceReplacementCaches(mediaFileId, mediaFile, clips);
  }

  let sharedFileUrl: string | undefined;
  const getSharedFileUrl = () => {
    sharedFileUrl ??= mediaFile?.url || createPrimaryMediaObjectUrl(mediaFileId, file);
    return sharedFileUrl;
  };

  for (const clip of clips) {
    const sourceType = clip.source?.type;

    if (sourceType === 'video') {
      const naturalDuration = clip.source?.naturalDuration || mediaFile?.duration || clip.duration;
      const sourceUrl = getSharedFileUrl();
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          type: 'video',
          naturalDuration,
          mediaFileId,
        },
      });
      if (generateThumbnails) {
        void thumbnailCacheService.generateForSourceUrl(mediaFileId, sourceUrl, naturalDuration, fileHash);
      }
    } else if (sourceType === 'audio') {
      const naturalDuration = clip.source?.naturalDuration || mediaFile?.duration || clip.duration;
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          type: 'audio',
          naturalDuration,
          mediaFileId,
        },
      });
    } else if (sourceType === 'image') {
      const imageUrl = getSharedFileUrl();
      const naturalDuration = clip.source?.naturalDuration || mediaFile?.duration || clip.duration;
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          type: 'image',
          imageUrl,
          naturalDuration,
          mediaFileId,
        },
      });
    } else if (isVectorAnimationSourceType(sourceType)) {
      try {
        const metadata = sourceType === 'lottie'
          ? await readLottieMetadata(file)
          : await readRiveMetadata(file);

        timelineStore.updateClip(clip.id, {
          ...createSourceReplacementClipAudioPatch(clip),
          file,
          needsReload: false,
          isLoading: false,
          source: {
            ...clip.source!,
            type: sourceType,
            naturalDuration: metadata.duration ?? clip.duration,
            mediaFileId,
          },
        });
      } catch (error) {
        log.warn('Failed to reload vector animation for clip', { clipName: clip.name, sourceType, error });
        timelineStore.updateClip(clip.id, {
          needsReload: false,
          isLoading: false,
        });
      }
    } else if (sourceType === 'model') {
      // 3D Model - create blob URL for the shared scene loader
      const modelSequence = resolveModelSequenceData(
        clip.source?.modelSequence,
        mediaFile?.modelSequence,
      );
      const sequenceModelUrl = getModelSequenceFrameUrl(modelSequence, 0);
      const modelUrl = sequenceModelUrl ?? (mediaFile?.url || blobUrlManager.create(clip.id, file, 'model'));
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          modelUrl,
          ...(modelSequence ? { modelSequence } : {}),
        },
      });
    } else if (sourceType === 'gaussian-avatar') {
      // Gaussian avatar - create blob URL for the renderer
      const gaussianAvatarUrl = mediaFile?.url || blobUrlManager.create(clip.id, file, 'model');
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          gaussianAvatarUrl,
          gaussianBlendshapes: clip.source?.gaussianBlendshapes || {},
        },
      });
    } else if (sourceType === 'gaussian-splat') {
      // Gaussian splat - create blob URL for the renderer
      const gaussianSplatSequence = resolveGaussianSplatSequenceData(
        clip.source?.gaussianSplatSequence,
        mediaFile?.gaussianSplatSequence,
      );
      const firstFrame = gaussianSplatSequence?.frames[0];
      const gaussianSplatUrl = firstFrame?.splatUrl ?? (mediaFile?.url || blobUrlManager.create(clip.id, file, 'file'));
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          gaussianSplatUrl,
          gaussianSplatFileName: firstFrame?.name ?? file.name,
          gaussianSplatFileHash: firstFrame ? undefined : fileHash,
          gaussianSplatRuntimeKey:
            firstFrame?.projectPath ??
            firstFrame?.absolutePath ??
            firstFrame?.sourcePath ??
            firstFrame?.name,
          gaussianSplatSequence,
          gaussianSplatSettings: clip.source?.gaussianSplatSettings,
        },
      });
    } else {
      // Unknown type - just update the file reference
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
      });
    }
  }

  log.debug(`Updated ${clips.length} timeline clips`);
}
