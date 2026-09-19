import { SEEDANCE_2_5_PROVIDER_ID } from '../kieAi/config';

const SEEDANCE_2_PROVIDER_IDS = new Set([
  'bytedance/seedance-2',
  'bytedance/seedance-2-fast',
]);

export function isSeedance2ProviderId(providerId: string): boolean {
  return SEEDANCE_2_PROVIDER_IDS.has(providerId);
}

export function isSeedanceProviderId(providerId: string): boolean {
  return isSeedance2ProviderId(providerId) || providerId === SEEDANCE_2_5_PROVIDER_ID;
}

export interface SeedanceReferenceValidationInput {
  audioReferenceCount?: number;
  audioReferenceDuration?: number;
  hasExactFrames?: boolean;
  hasReferenceMedia: boolean;
  imageReferenceCount?: number;
  providerId: string;
  videoReferenceCount?: number;
  videoReferenceDuration?: number;
}

export function getSeedanceReferenceValidationError(input: SeedanceReferenceValidationInput): string | null {
  if (isSeedance2ProviderId(input.providerId)) {
    return input.hasReferenceMedia
      ? 'Seedance 2.0 multimodal references are temporarily disabled. Use the IN and OUT frame slots for exact first/last-frame mode.'
      : null;
  }

  if (input.providerId !== SEEDANCE_2_5_PROVIDER_ID) {
    return null;
  }

  if (input.hasExactFrames && input.hasReferenceMedia) {
    return 'Seedance 2.5 exact first/last frames and multimodal references are separate modes. Remove one set of inputs.';
  }

  const imageCount = input.imageReferenceCount ?? 0;
  const videoCount = input.videoReferenceCount ?? 0;
  const audioCount = input.audioReferenceCount ?? 0;
  if (imageCount + videoCount + audioCount > 50) {
    return 'Seedance 2.5 accepts at most 50 multimodal references.';
  }
  if (imageCount > 30) return 'Seedance 2.5 accepts at most 30 reference images.';
  if (videoCount > 10) return 'Seedance 2.5 accepts at most 10 reference videos.';
  if (audioCount > 10) return 'Seedance 2.5 accepts at most 10 reference audio files.';
  if ((input.videoReferenceDuration ?? 0) > 30) {
    return 'Seedance 2.5 reference videos may total at most 30 seconds.';
  }
  if ((input.audioReferenceDuration ?? 0) > 30) {
    return 'Seedance 2.5 reference audio may total at most 30 seconds.';
  }

  return null;
}
