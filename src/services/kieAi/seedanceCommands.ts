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

function withSeedanceReferenceGuidance(prompt: string, guidance: string[]): string {
  const basePrompt = prompt.trim();
  const suffix = guidance.filter(Boolean).join(' ').trim();
  return suffix ? `${basePrompt} ${suffix}`.trim() : basePrompt;
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
  const hasReferenceMedia = (params.referenceMedia ?? []).length > 0;
  const useMultimodalReferenceMode = hasReferenceMedia;
  const firstFrameUrl = useMultimodalReferenceMode
    ? undefined
    : await mediaTools.uploadOptionalImageSource(startImageUrl);
  const lastFrameUrl = useMultimodalReferenceMode || params.multiShots
    ? undefined
    : await mediaTools.uploadOptionalImageSource(endImageUrl);
  const referenceMedia = useMultimodalReferenceMode
    ? await mediaTools.uploadReferenceMedia(params.referenceMedia)
    : [];

  const referenceImageUrls = referenceMedia
    .filter((reference) => reference.mediaType === 'image')
    .map((reference) => reference.url)
    .slice(0, 9);
  const referenceVideoUrls = referenceMedia
    .filter((reference) => reference.mediaType === 'video')
    .map((reference) => reference.url)
    .slice(0, 3);
  const referenceAudioUrls = referenceMedia
    .filter((reference) => reference.mediaType === 'audio')
    .map((reference) => reference.url)
    .slice(0, 3);
  const seedancePromptGuidance: string[] = [];

  if (useMultimodalReferenceMode) {
    const startReferenceImageUrl = await mediaTools.uploadOptionalImageSource(startImageUrl);
    const endReferenceImageUrl = params.multiShots
      ? undefined
      : await mediaTools.uploadOptionalImageSource(endImageUrl);
    const anchorImageUrls = [startReferenceImageUrl, endReferenceImageUrl].filter((url): url is string => Boolean(url));

    if (anchorImageUrls.length > 0) {
      referenceImageUrls.unshift(...anchorImageUrls);
      referenceImageUrls.length = Math.min(referenceImageUrls.length, 9);
    }

    if (startReferenceImageUrl) {
      seedancePromptGuidance.push('Use the first reference image as the opening image.');
    }

    if (endReferenceImageUrl) {
      seedancePromptGuidance.push(
        startReferenceImageUrl
          ? 'Use the second reference image as the final image.'
          : 'Use the first reference image as the final image.',
      );
    }
  }

  if (referenceAudioUrls.length > 0) {
    seedancePromptGuidance.push('Synchronize visible speech, mouth shapes, and performance timing to the reference audio.');
  }

  const input: Record<string, unknown> = {
    prompt: withSeedanceReferenceGuidance(params.prompt, seedancePromptGuidance),
    duration: normalizeSeedanceDuration(params.duration),
    resolution: normalizeSeedanceResolution(params.provider, params.mode),
    aspect_ratio: params.aspectRatio || '16:9',
    generate_audio: useMultimodalReferenceMode ? false : Boolean(params.sound),
    return_last_frame: false,
    web_search: false,
  };

  if (firstFrameUrl) {
    input.first_frame_url = firstFrameUrl;
  }

  if (lastFrameUrl) {
    input.last_frame_url = lastFrameUrl;
  }

  if (referenceImageUrls.length > 0) {
    input.reference_image_urls = referenceImageUrls;
  }

  if (referenceVideoUrls.length > 0) {
    input.reference_video_urls = referenceVideoUrls;
  }

  if (referenceAudioUrls.length > 0) {
    input.reference_audio_urls = referenceAudioUrls;
  }

  const body = {
    model: params.provider,
    input,
  };

  log.debug('Creating Seedance 2.0 task:', {
    hasFirstFrame: Boolean(firstFrameUrl),
    hasLastFrame: Boolean(lastFrameUrl),
    multimodalReferenceMode: useMultimodalReferenceMode,
    referenceAudioCount: referenceAudioUrls.length,
    referenceImageCount: referenceImageUrls.length,
    referenceVideoCount: referenceVideoUrls.length,
  });

  const result = await request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

  if (result.code !== 200 || !result.data?.taskId) {
    throw new Error(`Kie.ai error: ${result.msg || 'Failed to create Seedance task'}`);
  }

  return result.data.taskId;
}
