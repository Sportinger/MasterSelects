import type { GenerationReferenceMedia } from '../piApiService';
import type { KieAiTaskResponse } from './apiContracts';
import { isRemoteUrl } from './config';
import { log } from './log';
import type { KieAiMediaTools } from './mediaUpload';
import type { KieAiRequest } from './transport';

export interface TextToImageParams {
  provider: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  imageInputs?: string[];
  referenceMedia?: GenerationReferenceMedia[];
}

function normalizeImageResolution(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
}

export async function createTextToImageTask(
  params: TextToImageParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '1:1',
    resolution: normalizeImageResolution(params.resolution),
    output_format: params.outputFormat || 'png',
  };

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

  if (imageInputs.length > 0) {
    input.image_input = imageInputs;
  }

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
