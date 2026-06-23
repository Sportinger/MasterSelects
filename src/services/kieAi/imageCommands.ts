import type { GenerationReferenceMedia } from '../piApiService';
import type { KieAiTaskResponse } from './apiContracts';
import { isRemoteUrl } from './config';
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

interface KieAiImageModelSpec {
  defaultAspectRatio: string;
  imageInputKey?: KieAiImageInputKey;
  maxImages?: number;
  quality?: string;
  requiresImageInput?: boolean;
  supportsGoogleSearch?: boolean;
  supportsNegativePrompt?: boolean;
  supportsNsfwChecker?: boolean;
  supportsOutputFormat?: boolean;
  supportsResolution?: boolean;
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
  'google/imagen4-fast': {
    defaultAspectRatio: '16:9',
    supportsNegativePrompt: true,
  },
  'google/imagen4-ultra': {
    defaultAspectRatio: '1:1',
    supportsNegativePrompt: true,
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

function normalizeImageResolution(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
}

function normalizeOutputFormat(format: TextToImageParams['outputFormat']): 'png' | 'jpeg' | 'webp' {
  return format === 'jpeg' || format === 'webp' ? format : 'png';
}

function getImageModelSpec(provider: string): KieAiImageModelSpec {
  return KIEAI_IMAGE_MODEL_SPECS[provider] ?? DEFAULT_IMAGE_MODEL_SPEC;
}

export function buildKieAiImageTaskInput(
  params: TextToImageParams,
  imageInputs: string[] = [],
): Record<string, unknown> {
  const spec = getImageModelSpec(params.provider);
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || spec.defaultAspectRatio,
  };
  const effectiveImageInputs = typeof spec.maxImages === 'number'
    ? imageInputs.slice(0, spec.maxImages)
    : imageInputs;

  if (spec.requiresImageInput && effectiveImageInputs.length === 0) {
    throw new Error('Add at least one reference image for this Kie.ai image model.');
  }

  if (spec.imageInputKey && effectiveImageInputs.length > 0) {
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
