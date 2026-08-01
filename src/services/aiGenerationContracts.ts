import type { GenerationReferenceMedia } from './piApiService';

export interface TextToImageParams {
  provider: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  imageInputs?: string[];
  referenceMedia?: GenerationReferenceMedia[];
}
