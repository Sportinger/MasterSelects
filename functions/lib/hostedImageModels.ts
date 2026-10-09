import { GPT_IMAGE_25_MODELS, getGptImage25ValidationError, isGptImage25Provider, type GptImage25Background } from '../../src/services/kieAi/gptImage25';

export interface HostedImageParams {
  aspectRatio?: string;
  background?: GptImage25Background;
  imageInputs?: string[];
  negativePrompt?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  prompt: string;
  provider: string;
  resolution?: string;
}

type HostedImageInputKey = 'image_input' | 'image_urls' | 'input_urls';

interface HostedImageModelSpec {
  defaultAspectRatio: string;
  imageInputKey?: HostedImageInputKey;
  maxImages?: number;
  quality?: string;
  requiresImageInput?: boolean;
  supportsGoogleSearch?: boolean;
  supportsNegativePrompt?: boolean;
  supportsNsfwChecker?: boolean;
  supportsOutputFormat?: boolean;
  supportsResolution?: boolean;
}

export function normalizeImageResolution(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
}

const DEFAULT_HOSTED_IMAGE_MODEL_SPEC: HostedImageModelSpec = {
  defaultAspectRatio: '1:1',
  imageInputKey: 'image_input',
  supportsOutputFormat: true,
  supportsResolution: true,
};

const HOSTED_IMAGE_MODEL_SPECS: Record<string, HostedImageModelSpec> = {
  ...Object.fromEntries(GPT_IMAGE_25_MODELS.map(model => [model.id, {
    defaultAspectRatio: 'auto', supportsResolution: true,
    ...(model.edit ? { imageInputKey: 'input_urls' as const, maxImages: 16, requiresImageInput: true } : {}),
  }])),
  'nano-banana-2': {
    ...DEFAULT_HOSTED_IMAGE_MODEL_SPEC,
    defaultAspectRatio: 'auto',
    maxImages: 14,
    supportsGoogleSearch: true,
  },
  'nano-banana-pro': {
    ...DEFAULT_HOSTED_IMAGE_MODEL_SPEC,
    maxImages: 14,
  },
  'gpt-image-2-text-to-image': {
    defaultAspectRatio: 'auto',
  },
  'gpt-image-2-image-to-image': {
    defaultAspectRatio: 'auto',
    imageInputKey: 'input_urls',
    maxImages: 16,
    requiresImageInput: true,
  },
  'flux-2/pro-text-to-image': {
    defaultAspectRatio: '1:1',
    supportsNsfwChecker: true,
    supportsResolution: true,
  },
  'flux-2/pro-image-to-image': {
    defaultAspectRatio: '1:1',
    imageInputKey: 'input_urls',
    maxImages: 8,
    requiresImageInput: true,
    supportsNsfwChecker: true,
    supportsResolution: true,
  },
  'seedream/5-lite-text-to-image': {
    defaultAspectRatio: '1:1',
    quality: 'basic',
    supportsNsfwChecker: true,
  },
  'seedream/5-lite-image-to-image': {
    defaultAspectRatio: '1:1',
    imageInputKey: 'image_urls',
    maxImages: 14,
    quality: 'basic',
    requiresImageInput: true,
    supportsNsfwChecker: true,
  },
};

export function buildHostedMarketImageInput(params: HostedImageParams, imageInputs: string[]): Record<string, unknown> {
  const error = getGptImage25ValidationError({ ...params, imageInputs });
  if (error) throw new Error(error);
  const spec = HOSTED_IMAGE_MODEL_SPECS[params.provider];
  if (!spec) {
    throw new Error(`Unsupported hosted image provider: ${params.provider}`);
  }
  const effectiveImageInputs = typeof spec.maxImages === 'number'
    ? imageInputs.slice(0, spec.maxImages)
    : imageInputs;

  if (spec.requiresImageInput && effectiveImageInputs.length === 0) {
    throw new Error('Add at least one reference image for this hosted image model.');
  }

  const input: Record<string, unknown> = {
    aspect_ratio: params.aspectRatio ?? spec.defaultAspectRatio,
    prompt: params.prompt,
  };

  if (spec.imageInputKey && effectiveImageInputs.length > 0) {
    input[spec.imageInputKey] = effectiveImageInputs;
  }

  if (spec.supportsOutputFormat) {
    input.output_format = params.outputFormat ?? 'png';
  }

  if (spec.supportsNegativePrompt) {
    input.negative_prompt = params.negativePrompt?.trim() ?? '';
  }

  if (spec.supportsResolution) {
    input.resolution = normalizeImageResolution(params.resolution);
  }

  if (spec.quality) {
    input.quality = spec.quality;
  }

  if (spec.supportsNsfwChecker) {
    input.nsfw_checker = false;
  }

  if (spec.supportsGoogleSearch) {
    input.google_search = false;
  }

  if (isGptImage25Provider(params.provider)) input.background = params.background ?? 'auto';
  return input;
}
