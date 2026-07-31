import type { FlashBoardMediaType } from '../../../stores/flashboardStore/types';
import type { CatalogEntry } from '../../flashboard/types';
import type {
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../contracts';
import {
  prepareStoryboardGeneration,
  selectLatestStoryboardGenerationBrief,
  type PreparedStoryboardGeneration,
  type StoryboardGenerationAvailability,
  type StoryboardGenerationPricingPort,
} from '../generation';

export interface PrepareStoryboardConceptImageInput {
  availability: StoryboardGenerationAvailability;
  candidateCount: number;
  catalogEntries?: readonly CatalogEntry[];
  imageSize?: string;
  now?: number;
  pricingPort?: StoryboardGenerationPricingPort;
  projectId: string;
  referenceMediaTypes?: Readonly<Record<string, FlashBoardMediaType>>;
  sceneId: string;
  state: StoryboardProjectState;
  userId: string;
}

function conceptBrief(
  brief: StoryboardGenerationBrief,
): StoryboardGenerationBrief {
  const referenceMediaFileIds = [
    ...brief.referenceMediaFileIds,
    ...(brief.startFrameMediaFileId ? [brief.startFrameMediaFileId] : []),
    ...(brief.endFrameMediaFileId ? [brief.endFrameMediaFileId] : []),
  ].filter((mediaFileId, index, values) => values.indexOf(mediaFileId) === index);
  return {
    schemaVersion: 1,
    id: brief.id,
    sceneId: brief.sceneId,
    revision: brief.revision,
    prompt: brief.prompt,
    durationSeconds: brief.durationSeconds,
    aspectRatio: brief.aspectRatio,
    referenceMediaFileIds,
    capabilityPolicy: {
      mediaType: 'image',
      preferredQuality: 'draft',
    },
    createdAt: brief.createdAt,
    ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
    ...(brief.visualContinuity ? { visualContinuity: brief.visualContinuity } : {}),
    ...(brief.camera ? { camera: brief.camera } : {}),
    ...(brief.lighting ? { lighting: brief.lighting } : {}),
  };
}

export async function prepareStoryboardConceptImage(
  input: PrepareStoryboardConceptImageInput,
): Promise<PreparedStoryboardGeneration> {
  const scene = input.state.scenes[input.sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${input.sceneId}`);
  const sourceBrief = selectLatestStoryboardGenerationBrief(
    input.state,
    input.sceneId,
  );
  if (!sourceBrief) {
    throw new Error(`Scene ${input.sceneId} has no generation brief.`);
  }
  const referenceMediaTypes = {
    ...input.referenceMediaTypes,
    ...(sourceBrief.startFrameMediaFileId
      ? { [sourceBrief.startFrameMediaFileId]: 'image' as const }
      : {}),
    ...(sourceBrief.endFrameMediaFileId
      ? { [sourceBrief.endFrameMediaFileId]: 'image' as const }
      : {}),
  };
  return prepareStoryboardGeneration({
    availability: input.availability,
    brief: conceptBrief(sourceBrief),
    candidateCount: input.candidateCount,
    catalogEntries: input.catalogEntries,
    now: input.now,
    pricingPort: input.pricingPort,
    projectId: input.projectId,
    referenceMediaTypes,
    selection: {
      service: 'cloud',
      providerId: 'nano-banana-2',
      version: 'latest',
      ...(input.imageSize ? { imageSize: input.imageSize } : {}),
    },
    userId: input.userId,
  });
}
