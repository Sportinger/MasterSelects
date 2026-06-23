import type { ImageToVideoParams, TextToVideoParams, VideoTask } from '../piApiService';
import type { KieAiTaskResponse } from './apiContracts';
import {
  FLUX_KONTEXT_MAX_PROVIDER_ID,
  FLUX_KONTEXT_PRO_PROVIDER_ID,
  RUNWAY_VIDEO_PROVIDER_ID,
  TOPAZ_VIDEO_UPSCALE_PROVIDER_ID,
  VEO_3_1_PROVIDER_ID,
  isRemoteUrl,
} from './config';
import { log } from './log';
import type { KieAiMediaTools } from './mediaUpload';
import type { KieAiRequest } from './transport';
import type { TextToImageParams } from './imageCommands';

export type KieAiSpecialVideoTaskKind = 'runway' | 'veo';

interface KieAiFluxKontextStatusResponse {
  code?: number;
  data?: {
    completeTime?: number | string;
    createTime?: number | string;
    errorMessage?: string;
    failMsg?: string;
    response?: {
      resultImageUrl?: string;
    };
    successFlag?: number;
  };
  msg?: string;
}

interface KieAiVeoStatusResponse {
  code?: number;
  data?: {
    completeTime?: number | string;
    createTime?: number | string;
    errorMessage?: string;
    failMsg?: string;
    response?: {
      resultUrl?: string;
      resultUrls?: string[];
      videoUrl?: string;
    };
    successFlag?: number;
  };
  msg?: string;
}

interface KieAiRunwayStatusResponse {
  code?: number;
  data?: {
    completeTime?: number | string;
    createTime?: number | string;
    errorMessage?: string;
    failMsg?: string;
    state?: string;
    videoInfo?: {
      videoUrl?: string;
    };
  };
  msg?: string;
}

export function isFluxKontextProvider(provider: string): boolean {
  return provider === FLUX_KONTEXT_PRO_PROVIDER_ID || provider === FLUX_KONTEXT_MAX_PROVIDER_ID;
}

export function getKieAiSpecialVideoTaskKind(provider: string): KieAiSpecialVideoTaskKind | null {
  if (provider === RUNWAY_VIDEO_PROVIDER_ID) {
    return 'runway';
  }

  if (provider === VEO_3_1_PROVIDER_ID) {
    return 'veo';
  }

  return null;
}

export function isKieAiSpecialVideoProvider(provider: string): boolean {
  return getKieAiSpecialVideoTaskKind(provider) !== null || provider === TOPAZ_VIDEO_UPSCALE_PROVIDER_ID;
}

function normalizeUpscaleFactor(value: string | undefined): '2' | '4' {
  return value === '4' || value === '4x' || value === '4X' ? '4' : '2';
}

function normalizeRunwayDuration(value: number | undefined): '5' | '10' {
  return value === 10 ? '10' : '5';
}

function normalizeRunwayQuality(mode: string | undefined, duration: '5' | '10'): '720p' | '1080p' {
  return mode === '1080p' && duration !== '10' ? '1080p' : '720p';
}

function normalizeVeoModel(mode: string | undefined): 'veo3' | 'veo3_fast' | 'veo3_lite' {
  if (mode === 'veo3' || mode === 'veo3_lite') {
    return mode;
  }

  return 'veo3_fast';
}

function dateFromProvider(value: number | string | undefined): Date | undefined {
  if (typeof value === 'number') {
    return new Date(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value);
  }

  return undefined;
}

async function uploadImageInputs(
  params: TextToImageParams,
  mediaTools: KieAiMediaTools,
): Promise<string[]> {
  const imageInputs: string[] = [];

  if (params.imageInputs?.length) {
    imageInputs.push(...await Promise.all(
      params.imageInputs.map(async (image) => {
        if (isRemoteUrl(image)) {
          return image;
        }

        return mediaTools.uploadImage(await mediaTools.compressImage(image));
      }),
    ));
  }

  const references = await mediaTools.uploadReferenceMedia(params.referenceMedia, ['image']);
  imageInputs.push(...references.map((reference) => reference.url));

  return imageInputs;
}

async function createKieTask(
  request: KieAiRequest,
  endpoint: string,
  body: object,
  failureMessage: string,
): Promise<string> {
  const result = await request<KieAiTaskResponse>(endpoint, 'POST', body);

  if (!result.data?.taskId) {
    throw new Error(`Kie.ai error: ${result.msg || failureMessage}`);
  }

  return result.data.taskId;
}

export async function createFluxKontextImageTask(
  params: TextToImageParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const imageInputs = await uploadImageInputs(params, mediaTools);
  const body: Record<string, unknown> = {
    prompt: params.prompt.trim(),
    enableTranslation: true,
    aspectRatio: params.aspectRatio || '16:9',
    outputFormat: params.outputFormat || 'png',
    promptUpsampling: false,
    model: params.provider,
    safetyTolerance: 2,
  };

  if (imageInputs[0]) {
    body.inputImage = imageInputs[0];
  }

  log.debug('Creating Flux Kontext image task:', {
    hasInputImage: Boolean(body.inputImage),
    model: params.provider,
  });

  return createKieTask(
    request,
    '/api/v1/flux/kontext/generate',
    body,
    'Failed to create Flux Kontext task',
  );
}

export async function getFluxKontextImageTaskStatus(
  taskId: string,
  request: KieAiRequest,
): Promise<VideoTask> {
  const result = await request<KieAiFluxKontextStatusResponse>(
    `/api/v1/flux/kontext/record-info?taskId=${encodeURIComponent(taskId)}`,
    'GET',
  );
  const successFlag = result.data?.successFlag;
  const status = successFlag === 1 ? 'completed' : successFlag === 2 || successFlag === 3 ? 'failed' : 'processing';
  const task: VideoTask = {
    id: taskId,
    status,
    progress: status === 'completed' ? 1 : status === 'failed' ? undefined : 0.5,
    createdAt: dateFromProvider(result.data?.createTime) ?? new Date(),
    error: status === 'failed' ? result.data?.errorMessage || result.data?.failMsg || result.msg : undefined,
  };

  if (status === 'completed') {
    task.imageUrl = result.data?.response?.resultImageUrl;
    task.completedAt = dateFromProvider(result.data?.completeTime) ?? new Date();
  }

  return task;
}

async function createTopazVideoUpscaleTask(
  params: TextToVideoParams | ImageToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const videos = await mediaTools.uploadReferenceMedia(params.referenceMedia, ['video']);
  const videoUrl = videos[0]?.url;
  if (!videoUrl) {
    throw new Error('Add a reference video for Topaz Video Upscale.');
  }

  return createKieTask(
    request,
    '/api/v1/jobs/createTask',
    {
      model: TOPAZ_VIDEO_UPSCALE_PROVIDER_ID,
      input: {
        video_url: videoUrl,
        upscale_factor: normalizeUpscaleFactor(params.mode),
      },
    },
    'Failed to create Topaz Video Upscale task',
  );
}

async function createRunwayVideoTask(
  params: TextToVideoParams | ImageToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const startImageUrl = 'startImageUrl' in params
    ? await mediaTools.uploadOptionalImageSource(params.startImageUrl)
    : undefined;
  const referenceImage = startImageUrl
    ? undefined
    : (await mediaTools.uploadReferenceMedia(params.referenceMedia, ['image']))[0]?.url;
  const duration = normalizeRunwayDuration(params.duration);
  const body: Record<string, unknown> = {
    prompt: params.prompt.trim(),
    duration,
    quality: normalizeRunwayQuality(params.mode, duration),
    aspectRatio: params.aspectRatio || '16:9',
    waterMark: '',
  };

  if (startImageUrl || referenceImage) {
    body.imageUrl = startImageUrl ?? referenceImage;
  }

  log.debug('Creating Runway video task:', {
    duration,
    hasImage: Boolean(body.imageUrl),
    quality: body.quality,
  });

  return createKieTask(request, '/api/v1/runway/generate', body, 'Failed to create Runway task');
}

async function createVeoVideoTask(
  params: TextToVideoParams | ImageToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const startImageUrl = 'startImageUrl' in params
    ? await mediaTools.uploadOptionalImageSource(params.startImageUrl)
    : undefined;
  const endImageUrl = 'endImageUrl' in params
    ? await mediaTools.uploadOptionalImageSource(params.endImageUrl)
    : undefined;
  const referenceImages = await mediaTools.uploadReferenceMedia(params.referenceMedia, ['image']);
  const imageUrls = [startImageUrl, endImageUrl, ...referenceImages.map((reference) => reference.url)]
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);
  const generationType = startImageUrl && endImageUrl
    ? 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    : imageUrls.length > 0
      ? 'REFERENCE_2_VIDEO'
      : 'TEXT_2_VIDEO';
  const body: Record<string, unknown> = {
    prompt: params.prompt.trim(),
    imageUrls,
    model: normalizeVeoModel(params.mode),
    watermark: '',
    aspect_ratio: params.aspectRatio || '16:9',
    enableFallback: false,
    enableTranslation: true,
    generationType,
  };

  log.debug('Creating Veo video task:', {
    generationType,
    imageCount: imageUrls.length,
    model: body.model,
  });

  return createKieTask(request, '/api/v1/veo/generate', body, 'Failed to create Veo task');
}

export async function createKieAiSpecialVideoTask(
  params: TextToVideoParams | ImageToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  if (params.provider === TOPAZ_VIDEO_UPSCALE_PROVIDER_ID) {
    return createTopazVideoUpscaleTask(params, request, mediaTools);
  }

  if (params.provider === RUNWAY_VIDEO_PROVIDER_ID) {
    return createRunwayVideoTask(params, request, mediaTools);
  }

  if (params.provider === VEO_3_1_PROVIDER_ID) {
    return createVeoVideoTask(params, request, mediaTools);
  }

  throw new Error(`${params.provider} is not a Kie.ai special video provider.`);
}

export async function getKieAiSpecialVideoTaskStatus(
  taskId: string,
  kind: KieAiSpecialVideoTaskKind,
  request: KieAiRequest,
): Promise<VideoTask> {
  if (kind === 'runway') {
    const result = await request<KieAiRunwayStatusResponse>(
      `/api/v1/runway/record-detail?taskId=${encodeURIComponent(taskId)}`,
      'GET',
    );
    const state = (result.data?.state ?? '').trim().toLowerCase();
    const status = state === 'success' ? 'completed' : state === 'fail' ? 'failed' : 'processing';

    return {
      id: taskId,
      status,
      progress: status === 'completed' ? 1 : status === 'failed' ? undefined : 0.5,
      videoUrl: status === 'completed' ? result.data?.videoInfo?.videoUrl : undefined,
      createdAt: dateFromProvider(result.data?.createTime) ?? new Date(),
      completedAt: status === 'completed' ? dateFromProvider(result.data?.completeTime) ?? new Date() : undefined,
      error: status === 'failed' ? result.data?.errorMessage || result.data?.failMsg || result.msg : undefined,
    };
  }

  const result = await request<KieAiVeoStatusResponse>(
    `/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
    'GET',
  );
  const successFlag = result.data?.successFlag;
  const status = successFlag === 1 ? 'completed' : successFlag === 2 || successFlag === 3 ? 'failed' : 'processing';
  const videoUrl = result.data?.response?.resultUrls?.[0]
    ?? result.data?.response?.resultUrl
    ?? result.data?.response?.videoUrl;

  return {
    id: taskId,
    status,
    progress: status === 'completed' ? 1 : status === 'failed' ? undefined : 0.5,
    videoUrl: status === 'completed' ? videoUrl : undefined,
    createdAt: dateFromProvider(result.data?.createTime) ?? new Date(),
    completedAt: status === 'completed' ? dateFromProvider(result.data?.completeTime) ?? new Date() : undefined,
    error: status === 'failed' ? result.data?.errorMessage || result.data?.failMsg || result.msg : undefined,
  };
}
