import type { ComposerReferenceBadge } from './FlashBoardReferenceStrip';

type ReferenceBadgeMediaType = 'image' | 'video' | 'audio';

interface FlashBoardReferenceBadgeMediaFile {
  name?: string;
  thumbnailUrl?: string;
  type?: string;
  url?: string;
}

interface BuildFlashBoardReferenceBadgesInput {
  endMediaFileId?: string;
  isReferenceableMediaType: (type: string | undefined) => type is ReferenceBadgeMediaType;
  mediaFilesById: ReadonlyMap<string, FlashBoardReferenceBadgeMediaFile>;
  referenceMediaFileIds: string[];
  startMediaFileId?: string;
}

function getFlashBoardReferenceBadgeMedia(
  mediaFileId: string,
  mediaFilesById: ReadonlyMap<string, FlashBoardReferenceBadgeMediaFile>,
  isReferenceableMediaType: (type: string | undefined) => type is ReferenceBadgeMediaType,
) {
  const mediaFile = mediaFilesById.get(mediaFileId);

  return {
    displayName: mediaFile?.name,
    mediaType: isReferenceableMediaType(mediaFile?.type) ? mediaFile.type : 'image',
    previewUrl: mediaFile?.url,
    thumbnailUrl: mediaFile?.thumbnailUrl || (mediaFile?.type === 'image' ? mediaFile.url : undefined),
  };
}

export function buildFlashBoardReferenceBadges({
  endMediaFileId,
  isReferenceableMediaType,
  mediaFilesById,
  referenceMediaFileIds,
  startMediaFileId,
}: BuildFlashBoardReferenceBadgesInput): ComposerReferenceBadge[] {
  const badges: ComposerReferenceBadge[] = [];

  if (startMediaFileId) {
    const media = getFlashBoardReferenceBadgeMedia(startMediaFileId, mediaFilesById, isReferenceableMediaType);
    badges.push({
      key: `start-${startMediaFileId}`,
      role: 'start',
      mediaFileId: startMediaFileId,
      mediaType: media.mediaType,
      previewUrl: media.previewUrl,
      roleLabel: 'IN',
      thumbnailUrl: media.thumbnailUrl,
      displayName: media.displayName ?? 'Start frame',
    });
  }

  if (endMediaFileId) {
    const media = getFlashBoardReferenceBadgeMedia(endMediaFileId, mediaFilesById, isReferenceableMediaType);
    badges.push({
      key: `end-${endMediaFileId}`,
      role: 'end',
      mediaFileId: endMediaFileId,
      mediaType: media.mediaType,
      previewUrl: media.previewUrl,
      roleLabel: 'OUT',
      thumbnailUrl: media.thumbnailUrl,
      displayName: media.displayName ?? 'End frame',
    });
  }

  referenceMediaFileIds.forEach((mediaFileId, index) => {
    const media = getFlashBoardReferenceBadgeMedia(mediaFileId, mediaFilesById, isReferenceableMediaType);
    badges.push({
      key: `reference-${mediaFileId}`,
      role: 'reference',
      mediaFileId,
      mediaType: media.mediaType,
      previewUrl: media.previewUrl,
      roleLabel: `REF ${index + 1}`,
      thumbnailUrl: media.thumbnailUrl,
      displayName: media.displayName ?? 'Reference media',
    });
  });

  return badges;
}
