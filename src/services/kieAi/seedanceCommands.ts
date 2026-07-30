import type { ImageToVideoParams, TextToVideoParams } from '../piApiService';
import type { KieAiTaskResponse } from './apiContracts';
import {
  SEEDANCE_2_FAST_PROVIDER_ID,
  SEEDANCE_2_PROVIDER_ID,
} from './config';
import { log } from './log';
import type { KieAiMediaTools } from './mediaUpload';
import type { KieAiRequest } from './transport';

export function isSeedance2Provider(provider: string): boolean {
  return provider === SEEDANCE_2_PROVIDER_ID || provider === SEEDANCE_2_FAST_PROVIDER_ID;
}

function normalizeSeedanceResolution(provider: string, mode: string | undefined): '480p' | '720p' | '1080p' {
  if (mode === '480p') {
    return '480p';
  }

  if (mode === '1080p' && provider !== SEEDANCE_2_FAST_PROVIDER_ID) {
    return '1080p';
  }

  return '720p';
}

function normalizeSeedanceDuration(duration: number | undefined): number {
  return Math.max(4, Math.min(15, Math.floor(duration || 5)));
}

export async function createSeedanceVideoTask(
  params: TextToVideoParams | ImageToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const startImageUrl = 'startImageUrl' in params ? params.startImageUrl : undefined;
  const endImageUrl = 'endImageUrl' in params ? params.endImageUrl : undefined;
  if ((params.referenceMedia ?? []).length > 0) {
    throw new Error(
      'Seedance multimodal references are temporarily disabled. Use start and end frames instead.',
    );
  }
  const firstFrameUrl = await mediaTools.uploadOptionalImageSource(startImageUrl);
  const lastFrameUrl = await mediaTools.uploadOptionalImageSource(endImageUrl);

  const input: Record<string, unknown> = {
    prompt: params.prompt.trim(),
    duration: normalizeSeedanceDuration(params.duration),
    resolution: normalizeSeedanceResolution(params.provider, params.mode),
    aspect_ratio: params.aspectRatio || '16:9',
    generate_audio: Boolean(params.sound),
    return_last_frame: false,
    web_search: false,
  };

  if (firstFrameUrl) {
    input.first_frame_url = firstFrameUrl;
  }

  if (lastFrameUrl) {
    input.last_frame_url = lastFrameUrl;
  }

  const body = {
    model: params.provider,
    input,
  };

  log.debug('Creating Seedance 2.0 task:', {
    hasFirstFrame: Boolean(firstFrameUrl),
    hasLastFrame: Boolean(lastFrameUrl),
    frameMode: firstFrameUrl && lastFrameUrl ? 'first-last' : firstFrameUrl ? 'first' : 'text',
  });

  const result = await request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

  if (result.code !== 200 || !result.data?.taskId) {
    throw new Error(`Kie.ai error: ${result.msg || 'Failed to create Seedance task'}`);
  }

  return result.data.taskId;
}
