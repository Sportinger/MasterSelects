import type { FlashBoardMediaType } from '../../../stores/flashboardStore/types';
import { getCatalogEntries } from '../../flashboard/FlashBoardModelCatalog';
import type { CatalogEntry, CatalogReferenceInputKind } from '../../flashboard/types';
import type {
  ResolveStoryboardGenerationCapabilitiesInput,
  StoryboardGenerationCapability,
  StoryboardGenerationReference,
} from './types';

function isAvailable(
  _entry: CatalogEntry,
  input: ResolveStoryboardGenerationCapabilitiesInput,
): boolean {
  return input.availability.hostedAvailable;
}

function outputTypeFor(entry: CatalogEntry): 'audio' | 'image' | 'video' {
  return entry.outputType ?? 'video';
}

function referenceKindFor(mediaType: FlashBoardMediaType): CatalogReferenceInputKind {
  switch (mediaType) {
    case 'audio':
      return 'audio-reference';
    case 'image':
      return 'image-reference';
    case 'video':
      return 'video-reference';
  }
}

function collectReferences(
  input: ResolveStoryboardGenerationCapabilitiesInput,
): StoryboardGenerationReference[] | null {
  const references: StoryboardGenerationReference[] = [];
  if (input.brief.startFrameMediaFileId) {
    references.push({
      mediaFileId: input.brief.startFrameMediaFileId,
      mediaType: 'image',
      role: 'start-frame',
    });
  }
  if (input.brief.endFrameMediaFileId) {
    references.push({
      mediaFileId: input.brief.endFrameMediaFileId,
      mediaType: 'image',
      role: 'end-frame',
    });
  }
  for (const mediaFileId of input.brief.referenceMediaFileIds) {
    const mediaType = input.referenceMediaTypes?.[mediaFileId];
    if (!mediaType) return null;
    references.push({ mediaFileId, mediaType, role: 'reference' });
  }
  return references;
}

function supportsReference(
  entry: CatalogEntry,
  reference: StoryboardGenerationReference,
): boolean {
  const kinds = entry.referenceInputKinds ?? [];
  if (reference.role === 'start-frame') return kinds.includes('start-frame');
  if (reference.role === 'end-frame') return kinds.includes('end-frame');
  if (kinds.includes(referenceKindFor(reference.mediaType))) return true;
  return reference.mediaType === 'image' && (entry.maxReferenceImages ?? 0) > 0;
}

function supportsReferenceLimits(
  entry: CatalogEntry,
  references: readonly StoryboardGenerationReference[],
): boolean {
  const uniqueReferences = new Map(
    references.map((reference) => [reference.mediaFileId, reference]),
  );
  const imageCount = [...uniqueReferences.values()]
    .filter((reference) => reference.mediaType === 'image').length;
  if (
    entry.maxReferenceMedia !== undefined
    && uniqueReferences.size > entry.maxReferenceMedia
  ) {
    return false;
  }
  if (
    entry.maxReferenceImages !== undefined
    && imageCount > entry.maxReferenceImages
  ) {
    return false;
  }
  return true;
}

function supportsRequiredReferenceType(
  entry: CatalogEntry,
  references: readonly StoryboardGenerationReference[],
): boolean {
  if (!entry.requiredReferenceMediaType) return true;
  if (entry.requiredReferenceMediaType === 'visual') {
    return references.some(
      (reference) => reference.mediaType === 'image' || reference.mediaType === 'video',
    );
  }
  return references.some(
    (reference) => reference.mediaType === entry.requiredReferenceMediaType,
  );
}

function isCompatibleEntry(
  entry: CatalogEntry,
  input: ResolveStoryboardGenerationCapabilitiesInput,
  references: readonly StoryboardGenerationReference[],
): boolean {
  const { brief, selection } = input;
  if (!isAvailable(entry, input)) return false;
  if (selection?.service && selection.service !== entry.service) return false;
  if (selection?.providerId && selection.providerId !== entry.providerId) return false;
  if (outputTypeFor(entry) !== brief.capabilityPolicy.mediaType) return false;
  if (
    selection?.version
    && !entry.versions.includes(selection.version)
  ) {
    return false;
  }
  if (selection?.mode && !entry.modes.includes(selection.mode)) return false;
  if (selection?.imageSize && !entry.imageSizes?.includes(selection.imageSize)) {
    return false;
  }
  if (
    entry.durations.length > 0
    && !entry.durations.includes(brief.durationSeconds)
  ) {
    return false;
  }
  if (
    entry.aspectRatios.length > 0
    && !entry.aspectRatios.includes(brief.aspectRatio)
  ) {
    return false;
  }
  if (entry.requiresPrompt !== false && !brief.prompt.trim()) return false;
  if (entry.requiresReferenceMedia && references.length === 0) return false;

  if (brief.capabilityPolicy.mediaType === 'video') {
    const needsImageInput = brief.capabilityPolicy.needsImageToVideo
      || Boolean(brief.startFrameMediaFileId)
      || Boolean(brief.endFrameMediaFileId);
    if (needsImageInput ? !entry.supportsImageToVideo : !entry.supportsTextToVideo) {
      return false;
    }
    if (
      brief.capabilityPolicy.needsNativeAudio
      && entry.supportsGenerateAudio !== true
    ) {
      return false;
    }
  } else if (
    brief.capabilityPolicy.mediaType === 'image'
    && entry.supportsTextToImage !== true
  ) {
    return false;
  } else if (
    brief.capabilityPolicy.mediaType === 'audio'
    && entry.supportsTextToAudio !== true
  ) {
    return false;
  }

  if (
    brief.capabilityPolicy.needsStartEndFrames
    && (
      !entry.referenceInputKinds?.includes('start-frame')
      || !entry.referenceInputKinds.includes('end-frame')
    )
  ) {
    return false;
  }
  if (!references.every((reference) => supportsReference(entry, reference))) return false;
  if (!supportsReferenceLimits(entry, references)) return false;
  return supportsRequiredReferenceType(entry, references);
}

function submissionSupport(entry: CatalogEntry): {
  durableProviderIdempotency: boolean;
  submissionSupported: boolean;
  unsupportedReason?: string;
} {
  const outputType = outputTypeFor(entry);
  const exactHostedVideo = outputType === 'video'
    && (
      entry.providerId === 'cloud-kling'
      || entry.providerId === 'bytedance/seedance-2'
      || entry.providerId === 'bytedance/seedance-2-fast'
    );
  const exactHostedImage = outputType === 'image' && entry.providerId === 'nano-banana-2';
  if (entry.service === 'cloud' && (exactHostedVideo || exactHostedImage)) {
    return {
      durableProviderIdempotency: true,
      submissionSupported: true,
    };
  }
  return {
    durableProviderIdempotency: false,
    submissionSupported: false,
    unsupportedReason: outputType === 'audio'
      ? 'Audio task/response replay is not yet durable across reload.'
      : 'This hosted model has no matching exact versioned client/server price quote.',
  };
}

function capabilityFor(
  entry: CatalogEntry,
  input: ResolveStoryboardGenerationCapabilitiesInput,
  references: StoryboardGenerationReference[],
): StoryboardGenerationCapability {
  const support = submissionSupport(entry);
  const capability: StoryboardGenerationCapability = {
    aspectRatio: input.brief.aspectRatio,
    description: entry.description,
    durationSeconds: input.brief.durationSeconds,
    ...support,
    name: entry.name,
    outputType: outputTypeFor(entry),
    providerId: entry.providerId,
    references: references.map((reference) => ({ ...reference })),
    route: 'hosted',
    service: entry.service,
    version: input.selection?.version ?? entry.versions[0] ?? 'latest',
  };
  const mode = input.selection?.mode ?? entry.modes[0];
  const imageSize = input.selection?.imageSize ?? entry.imageSizes?.[0];
  if (mode) capability.mode = mode;
  if (imageSize) capability.imageSize = imageSize;
  return capability;
}

export function resolveStoryboardGenerationCapabilities(
  input: ResolveStoryboardGenerationCapabilitiesInput,
): StoryboardGenerationCapability[] {
  const references = collectReferences(input);
  if (!references) return [];
  const catalog = input.catalogEntries ?? getCatalogEntries();
  return catalog
    .filter((entry) => isCompatibleEntry(entry, input, references))
    .map((entry) => capabilityFor(entry, input, references))
    .toSorted((left, right) => (
      Number(right.submissionSupported) - Number(left.submissionSupported)
      || left.route.localeCompare(right.route)
      || left.providerId.localeCompare(right.providerId)
      || left.version.localeCompare(right.version)
    ));
}
