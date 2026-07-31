import type { FlashBoardGenerationRequest } from '../../../stores/flashboardStore/types';
import { getFlashBoardPriceQuote } from '../../flashboard/FlashBoardPricing';
import { hashGenerationValue, recomputePreparedGenerationFingerprint } from './canonical';
import { resolveStoryboardGenerationCapabilities } from './capabilityResolver';
import type {
  PrepareStoryboardGenerationInput,
  PreparedStoryboardGeneration,
  StoryboardGenerationCapability,
  StoryboardGenerationPricingPort,
} from './types';
import { STORYBOARD_GENERATION_REQUEST_KEY_PREFIX } from './types';

function assertCandidateCount(candidateCount: number): void {
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 16) {
    throw new Error('Storyboard generation candidateCount must be an integer between 1 and 16.');
  }
}

function selectedCapability(
  input: PrepareStoryboardGenerationInput,
  compatible: readonly StoryboardGenerationCapability[],
): StoryboardGenerationCapability {
  const selected = compatible.find((capability) => (
    (!input.selection?.service || capability.service === input.selection.service)
    && (!input.selection?.providerId || capability.providerId === input.selection.providerId)
    && (!input.selection?.version || capability.version === input.selection.version)
    && (!input.selection?.mode || capability.mode === input.selection.mode)
    && (!input.selection?.imageSize || capability.imageSize === input.selection.imageSize)
  ));
  if (!selected) {
    throw new Error('No compatible generation capability matches the requested selection.');
  }
  if (!selected.submissionSupported) {
    throw new Error(selected.unsupportedReason ?? 'The selected provider route is not safe to submit.');
  }
  return selected;
}

function composePrompt(input: PrepareStoryboardGenerationInput): string {
  const sections = [
    input.brief.prompt.trim(),
    input.brief.visualContinuity?.trim()
      ? `Visual continuity: ${input.brief.visualContinuity.trim()}`
      : '',
    input.brief.camera?.trim() ? `Camera: ${input.brief.camera.trim()}` : '',
    input.brief.motion?.trim() ? `Motion: ${input.brief.motion.trim()}` : '',
    input.brief.lighting?.trim() ? `Lighting: ${input.brief.lighting.trim()}` : '',
    input.brief.audioIntent?.trim() ? `Audio: ${input.brief.audioIntent.trim()}` : '',
  ].filter(Boolean);
  return sections.join('\n\n');
}

export function buildPreparedFlashBoardRequest(
  input: PrepareStoryboardGenerationInput,
  capability: StoryboardGenerationCapability,
): FlashBoardGenerationRequest {
  const request: FlashBoardGenerationRequest = {
    service: capability.service,
    providerId: capability.providerId,
    version: capability.version,
    outputType: capability.outputType,
    prompt: composePrompt(input),
    duration: capability.durationSeconds,
    aspectRatio: capability.aspectRatio,
    referenceMediaFileIds: capability.references
      .filter((reference) => reference.role === 'reference')
      .map((reference) => reference.mediaFileId),
  };
  if (input.brief.negativePrompt?.trim()) {
    request.negativePrompt = input.brief.negativePrompt.trim();
  }
  if (capability.mode) request.mode = capability.mode;
  if (capability.imageSize) request.imageSize = capability.imageSize;
  if (input.brief.startFrameMediaFileId) {
    request.startMediaFileId = input.brief.startFrameMediaFileId;
  }
  if (input.brief.endFrameMediaFileId) {
    request.endMediaFileId = input.brief.endFrameMediaFileId;
  }
  if (capability.outputType === 'video') {
    request.generateAudio = input.brief.capabilityPolicy.needsNativeAudio === true;
  }
  return request;
}

export function createStoryboardGenerationPricingInput(
  request: FlashBoardGenerationRequest,
): Parameters<StoryboardGenerationPricingPort>[0] {
  return {
    duration: request.duration,
    generateAudio: request.generateAudio,
    imageSize: request.imageSize,
    mode: request.mode,
    modelId: request.version,
    multiShots: request.multiShots,
    outputType: request.outputType,
    providerId: request.providerId,
    service: request.service,
    text: request.prompt,
    hasVideoInput: false,
  };
}

export async function prepareStoryboardGeneration(
  input: PrepareStoryboardGenerationInput,
): Promise<PreparedStoryboardGeneration> {
  assertCandidateCount(input.candidateCount);
  if (!input.userId.trim()) throw new Error('Storyboard generation requires a userId.');
  if (!input.projectId.trim()) throw new Error('Storyboard generation requires a projectId.');

  const compatibleCapabilities = resolveStoryboardGenerationCapabilities({
    availability: input.availability,
    brief: input.brief,
    catalogEntries: input.catalogEntries,
    referenceMediaTypes: input.referenceMediaTypes,
  });
  const capability = selectedCapability(input, compatibleCapabilities);
  const request = buildPreparedFlashBoardRequest(input, capability);
  const pricingPort = input.pricingPort ?? getFlashBoardPriceQuote;
  const perRequest = pricingPort(createStoryboardGenerationPricingInput(request));
  if (!perRequest?.exact || !Number.isFinite(perRequest.amount) || perRequest.amount < 0) {
    throw new Error('The selected capability has no exact machine-readable price.');
  }

  const total = perRequest.amount * input.candidateCount;
  if (!Number.isFinite(total)) throw new Error('Storyboard generation price overflow.');
  const batchKey = await hashGenerationValue({
    brief: input.brief,
    candidateCount: input.candidateCount,
    capability,
    projectId: input.projectId,
    quote: {
      maximumSpend: total,
      perRequest,
      requestCount: input.candidateCount,
      total,
    },
    request,
    userId: input.userId,
  });
  const preparedAt = input.now ?? Date.now();
  const entries = Array.from({ length: input.candidateCount }, (_, index) => {
    const generationRequestKey =
      `${STORYBOARD_GENERATION_REQUEST_KEY_PREFIX}${batchKey}:${index}`;
    return {
      index,
      generationRequestKey,
      request: {
        ...request,
        idempotencyKey: generationRequestKey,
        referenceMediaFileIds: [...request.referenceMediaFileIds],
      },
      candidate: {
        schemaVersion: 1 as const,
        id: `storyboard-candidate:${batchKey}:${index}`,
        sceneId: input.brief.sceneId,
        kind: capability.outputType === 'image'
          ? 'generated-image' as const
          : capability.outputType === 'audio'
            ? 'generated-audio' as const
            : 'generated-video' as const,
        state: 'awaiting-approval' as const,
        generationBriefRevision: input.brief.revision,
        generationRequestKey,
        sourceMomentHandles: [],
        durationSeconds: input.brief.durationSeconds,
        ...(perRequest.unit === 'hosted-credit'
          ? { estimatedCredits: perRequest.amount }
          : {}),
        createdAt: preparedAt,
      },
    };
  });
  const prepared: PreparedStoryboardGeneration = {
    schemaVersion: 1,
    batchKey,
    briefId: input.brief.id,
    briefRevision: input.brief.revision,
    candidateCount: input.candidateCount,
    capability,
    compatibleCapabilities,
    entries,
    fingerprint: '',
    preparedAt,
    projectId: input.projectId,
    quote: {
      maximumSpend: total,
      perRequest,
      requestCount: input.candidateCount,
      total,
    },
    sceneId: input.brief.sceneId,
    userId: input.userId,
  };
  prepared.fingerprint = await recomputePreparedGenerationFingerprint(prepared);
  return prepared;
}
