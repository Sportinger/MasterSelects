import { useMediaStore } from '../../mediaStore';
import { flags } from '../../../engine/featureFlags';
import { selectRuntimeFrameProviderPlan } from '../../../services/mediaRuntime/providerSelection';
import { createTurboResFrameProvider } from '../../../services/mediaRuntime/prores/TurboResFrameProvider';
import { createHapFrameProvider } from '../../../services/mediaRuntime/hap/HapFrameProvider';

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
    if (providerPlan.backend === 'turbores') {
      void createTurboResFrameProvider({
        sourceId: `timeline-thumbnails:${mediaFileId}`,
        file,
        fourCC: providerPlan.fourCC,
        policy: 'background',
        // Canvas2D can accept high-bit-depth VideoFrames but render them black
        // on some Chromium/Windows combinations. Timeline JPEGs only need SDR.
        allowedOutputFormats: ['I420'],
      }).then(async (provider) => {
        if (!provider) {
          thumbnailCacheService.reportUnsupported(
            mediaFileId,
            'TurboRes could not initialize timeline thumbnail decoding.',
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
    if (providerPlan.backend === 'hap') {
      void createHapFrameProvider({
        sourceId: `timeline-thumbnails:${mediaFileId}`,
        file,
        fourCC: providerPlan.fourCC,
        policy: 'background',
      }).then(async (provider) => {
        if (!provider) {
          thumbnailCacheService.reportUnsupported(
            mediaFileId,
            'HAP could not initialize timeline thumbnail decoding.',
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
