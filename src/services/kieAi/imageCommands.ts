import type { GenerationReferenceMedia } from '../piApiService';
import type { KieAiTaskResponse } from './apiContracts';
import {
  RECRAFT_CRISP_UPSCALE_PROVIDER_ID,
  RECRAFT_REMOVE_BACKGROUND_PROVIDER_ID,
  TOPAZ_IMAGE_UPSCALE_PROVIDER_ID,
  isRemoteUrl,
} from './config';
import { log } from './log';
import type { KieAiMediaTools } from './mediaUpload';
import type { KieAiRequest } from './transport';

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

type KieAiImageInputKey = 'image_input' | 'input_urls' | 'image_urls';
type KieAiSingleImageInputKey = 'image' | 'image_url';

interface KieAiImageModelSpec {
  defaultAspectRatio: string;
  imageInputKey?: KieAiImageInputKey;
  singleImageInputKey?: KieAiSingleImageInputKey;
  maxImages?: number;
  omitAspectRatio?: boolean;
  omitPrompt?: boolean;
  quality?: string;
  requiresImageInput?: boolean;
  supportsGoogleSearch?: boolean;
  supportsNegativePrompt?: boolean;
  supportsNsfwChecker?: boolean;
  supportsOutputFormat?: boolean;
  supportsResolution?: boolean;
  supportsUpscaleFactor?: boolean;
}

const DEFAULT_IMAGE_MODEL_SPEC: KieAiImageModelSpec = {
  defaultAspectRatio: '1:1',
  imageInputKey: 'image_input',
  supportsOutputFormat: true,
  supportsResolution: true,
};

const KIEAI_IMAGE_MODEL_SPECS: Record<string, KieAiImageModelSpec> = {
  'nano-banana-2': {
    ...DEFAULT_IMAGE_MODEL_SPEC,
    defaultAspectRatio: 'auto',
    maxImages: 14,
    supportsGoogleSearch: true,
  },
  'nano-banana-pro': {
    ...DEFAULT_IMAGE_MODEL_SPEC,
    maxImages: 14,
  },
  'google/nano-banana': {
    defaultAspectRatio: '1:1',
    supportsOutputFormat: true,
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
  [RECRAFT_REMOVE_BACKGROUND_PROVIDER_ID]: {
    defaultAspectRatio: '1:1',
    maxImages: 1,
    omitAspectRatio: true,
    omitPrompt: true,
    requiresImageInput: true,
    singleImageInputKey: 'image',
  },
  [RECRAFT_CRISP_UPSCALE_PROVIDER_ID]: {
    defaultAspectRatio: '1:1',
    maxImages: 1,
    omitAspectRatio: true,
    omitPrompt: true,
    requiresImageInput: true,
    singleImageInputKey: 'image',
  },
  [TOPAZ_IMAGE_UPSCALE_PROVIDER_ID]: {
    defaultAspectRatio: '1:1',
    maxImages: 1,
    omitAspectRatio: true,
    omitPrompt: true,
    requiresImageInput: true,
    singleImageInputKey: 'image_url',
    supportsUpscaleFactor: true,
  },
};

function normalizeImageResolution(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
}

function normalizeOutputFormat(format: TextToImageParams['outputFormat']): 'png' | 'jpeg' | 'webp' {
  return format === 'jpeg' || format === 'webp' ? format : 'png';
}

function normalizeUpscaleFactor(value: string | undefined): '2' | '4' {
  return value === '4' || value === '4x' || value === '4X' ? '4' : '2';
}

function getImageModelSpec(provider: string): KieAiImageModelSpec {
  const spec = KIEAI_IMAGE_MODEL_SPECS[provider];
  if (!spec) {
    throw new Error(`Unsupported Kie.ai image provider: ${provider}`);
  }
  return spec;
}

export function buildKieAiImageTaskInput(
  params: TextToImageParams,
  imageInputs: string[] = [],
): Record<string, unknown> {
  const spec = getImageModelSpec(params.provider);
  const input: Record<string, unknown> = {};
  const effectiveImageInputs = typeof spec.maxImages === 'number'
    ? imageInputs.slice(0, spec.maxImages)
    : imageInputs;

  if (spec.requiresImageInput && effectiveImageInputs.length === 0) {
    throw new Error('Add at least one reference image for this Kie.ai image model.');
  }

  if (!spec.omitPrompt) {
    input.prompt = params.prompt;
  }
  if (!spec.omitAspectRatio) {
    input.aspect_ratio = params.aspectRatio || spec.defaultAspectRatio;
  }
  if (spec.singleImageInputKey && effectiveImageInputs.length > 0) {
    input[spec.singleImageInputKey] = effectiveImageInputs[0];
  } else if (spec.imageInputKey && effectiveImageInputs.length > 0) {
    input[spec.imageInputKey] = effectiveImageInputs;
  }
  if (spec.supportsResolution) {
    input.resolution = normalizeImageResolution(params.resolution);
  }
  if (spec.supportsOutputFormat) {
    input.output_format = normalizeOutputFormat(params.outputFormat);
  }
  if (spec.supportsNegativePrompt && params.negativePrompt?.trim()) {
    input.negative_prompt = params.negativePrompt.trim();
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
  if (spec.supportsUpscaleFactor) {
    input.upscale_factor = normalizeUpscaleFactor(params.resolution);
  }

  return input;
}

export async function createTextToImageTask(
  params: TextToImageParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const imageInputs: string[] = [];
  if (params.imageInputs?.length) {
    const uploaded = await Promise.all(
      params.imageInputs.map(async (image) => {
        if (isRemoteUrl(image)) {
          return image;
        }
        const compressed = await mediaTools.compressImage(image);
        return mediaTools.uploadImage(compressed);
      })
    );
    imageInputs.push(...uploaded);
  }

  const referenceImages = await mediaTools.uploadReferenceMedia(params.referenceMedia, ['image']);
  imageInputs.push(...referenceImages.map((reference) => reference.url));
  const input = buildKieAiImageTaskInput(params, imageInputs);

  const body = {
    model: params.provider,
    input,
  };

  log.debug('Creating text-to-image task:', JSON.stringify(body, null, 2));

  const result = await request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

  if (result.code !== 200 || !result.data?.taskId) {
    throw new Error(`Kie.ai error: ${result.msg || 'Failed to create image task'}`);
  }

  return result.data.taskId;
}
