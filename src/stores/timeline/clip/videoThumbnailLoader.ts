import { useMediaStore } from '../../mediaStore';
import { flags } from '../../../engine/featureFlags';
import { isCodecProviderPlan, selectRuntimeFrameProviderPlan } from '../../../services/mediaRuntime/providerSelection';
import { getCodecProviderDescriptor } from '../../../services/mediaRuntime/codec/codecProviderDescriptors';

export function startVideoThumbnailGeneration(file: File, mediaFileId: string, naturalDuration: number): void {
  import('../../../services/thumbnailCacheService').then(({ thumbnailCacheService }) => {
    const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
    const providerPlan = selectRuntimeFrameProviderPlan({
      videoCodecId: mediaFile?.videoCodecId,
      turboResEnabled: flags.turboResProRes,
    });
    if (providerPlan.backend === 'unsupported') {
      thumbnailCacheService.reportUnsupported(
        mediaFileId,
        'Timeline thumbnails are unavailable because ProRes RAW is not supported.',
      );
      return;
    }
    if (isCodecProviderPlan(providerPlan)) {
      const descriptor = getCodecProviderDescriptor(providerPlan.backend);
      void descriptor.create({
        sourceId: `timeline-thumbnails:${mediaFileId}`,
        file,
        plan: providerPlan,
        policy: 'background',
        outputProfile: 'sdr',
      }).then(async (provider) => {
        if (!provider) {
          thumbnailCacheService.reportUnsupported(
            mediaFileId,
            `${descriptor.logName} could not initialize timeline thumbnail decoding.`,
          );
          return;
        }
        try {
          await thumbnailCacheService.generateForFrameProvider(
            mediaFileId,
            provider,
            naturalDuration,
            mediaFile?.fileHash,
          );
        } finally {
          await provider.destroyAsync();
        }
      });
      return;
    }
    const sourceUrl = mediaFile?.url || URL.createObjectURL(file);
    const shouldRevokeSourceUrl = !mediaFile?.url;
    const fileHash = mediaFile?.fileHash;
    thumbnailCacheService
      .generateForSourceUrl(mediaFileId, sourceUrl, naturalDuration, fileHash, 'anonymous')
      .finally(() => {
        if (shouldRevokeSourceUrl) {
          URL.revokeObjectURL(sourceUrl);
        }
      });
  });
}
