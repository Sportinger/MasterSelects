// Kie.ai Service - Unified API for AI media generation via kie.ai
// Currently supports: Kling 3.0/Seedance 2.0 video and Nano Banana 2 images
// Docs: https://kie.ai

import { Logger } from './logger';
import type {
  VideoProvider,
  TextToVideoParams,
  ImageToVideoParams,
  GenerationReferenceMedia,
  VideoTask,
  TaskStatus,
  AccountInfo,
} from './piApiService';

const log = Logger.create('KieAI');

const BASE_URL = 'https://api.kie.ai';
const UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
const BYO_PROXY_REQUEST_URL = '/api/kieai/byo/request';
const BYO_PROXY_UPLOAD_URL = '/api/kieai/byo/upload';

// Kie.ai providers
const KIEAI_PROVIDERS: VideoProvider[] = [
  {
    id: 'kling-3.0',
    name: 'Kling 3.0',
    description: 'Latest Kling model via Kie.ai',
    versions: ['3.0'],
    supportedModes: ['std', 'pro'],
    supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
  {
    id: 'bytedance/seedance-2',
    name: 'Seedance 2.0',
    description: 'Multimodal reference-to-video via Kie.ai',
    versions: ['2.0'],
    supportedModes: ['720p', '1080p'],
    supportedDurations: [5, 10, 15],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
];

// Kie.ai Kling 3.0 pricing in CREDITS per second
// Source: current Kie.ai pricing shared by the user
// std no-audio (720p): 14 credits/s ($0.07/s)
// std audio (720p):    20 credits/s ($0.10/s)
// pro no-audio (1080p): 18 credits/s ($0.09/s)
// pro audio (1080p):    27 credits/s ($0.135/s)
// 1 credit = $0.005
const KIEAI_CREDITS_PER_SECOND: Record<string, Record<string, { normal: number; audio: number }>> = {
  'kling-3.0': {
    'std': { normal: 14, audio: 20 },
    'pro': { normal: 18, audio: 27 },
  },
};

export function getKieAiProviders(): VideoProvider[] {
  return KIEAI_PROVIDERS;
}

export function getKieAiProvider(providerId: string): VideoProvider | undefined {
  return KIEAI_PROVIDERS.find(p => p.id === providerId);
}

// Calculate cost in credits for Kie.ai
export function calculateKieAiCost(provider: string, mode: string, duration: number, sound = false): number {
  const providerRates = KIEAI_CREDITS_PER_SECOND[provider];
  if (!providerRates) return duration * 14; // fallback
  const modeRates = providerRates[mode];
  if (!modeRates) return duration * 14;
  const ratePerSecond = sound ? modeRates.audio : modeRates.normal;
  return duration * ratePerSecond;
}

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

function normalizeMultiShotPrompt(
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>
): Array<{ index: number; prompt: string; duration: string }> | undefined {
  const normalized = (multiPrompt ?? [])
    .map((shot, index) => ({
      index: index + 1,
      prompt: typeof shot.prompt === 'string' ? shot.prompt.trim() : '',
      duration: String(Math.max(1, Math.floor(Number(shot.duration) || 0))),
    }))
    .filter((shot) => shot.prompt.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

interface KieAiTaskResponse {
  code: number;
  msg: string;
  data: {
    taskId: string;
  };
}

interface KieAiStatusResponse {
  code: number;
  msg?: string;
  data: {
    completeTime?: number;
    taskId: string;
    createTime?: number;
    progress?: number;
    state: string;
    resultJson?: string;
    resultUrls?: string[];
    costTime?: string;
    failMsg?: string;
  };
}

interface KieAiUploadResponse {
  data?: {
    downloadUrl?: string;
  };
  msg?: string;
  success?: boolean;
}

interface KieAiProxyErrorResponse {
  error?: string;
  message?: string;
}

interface UploadedReferenceMedia {
  label?: string;
  mediaType: GenerationReferenceMedia['mediaType'];
  url: string;
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function canUseSameOriginProxy(): boolean {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

function sanitizeUploadBaseName(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  const withoutExtension = trimmed.replace(/\.[a-z0-9]{1,8}$/i, '');
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

  return sanitized || fallback;
}

function getExtensionFromMimeType(mimeType: string | undefined, fallback: string): string {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/aac':
      return 'aac';
    case 'audio/flac':
      return 'flac';
    default:
      return fallback;
  }
}

function getReferenceUploadPath(mediaType: GenerationReferenceMedia['mediaType']): string {
  switch (mediaType) {
    case 'audio':
      return 'audios';
    case 'video':
      return 'videos';
    case 'image':
    default:
      return 'images';
  }
}

function getReferenceFallbackExtension(mediaType: GenerationReferenceMedia['mediaType']): string {
  switch (mediaType) {
    case 'audio':
      return 'mp3';
    case 'video':
      return 'mp4';
    case 'image':
    default:
      return 'jpg';
  }
}

function hasFileExtension(value: string | undefined): boolean {
  return Boolean(value && /\.[a-z0-9]{1,8}$/i.test(value));
}

function getReferenceToken(index: number): string {
  return `ref_${index + 1}`;
}

function applyKlingReferenceTokens(prompt: string, references: UploadedReferenceMedia[]): string {
  if (references.length === 0) {
    return prompt;
  }

  let nextPrompt = prompt;
  const tokens = references.map((_, index) => getReferenceToken(index));

  tokens.forEach((token, index) => {
    const pattern = new RegExp(`\\bREF\\s*${index + 1}\\b`, 'gi');
    nextPrompt = nextPrompt.replace(pattern, `@${token}`);
  });

  const mentionsReference = tokens.some((token) => new RegExp(`@${token}\\b`, 'i').test(nextPrompt));
  if (mentionsReference) {
    return nextPrompt;
  }

  return `${nextPrompt.trim()} ${tokens.map((token) => `@${token}`).join(' ')}`.trim();
}

function withSeedanceReferenceGuidance(prompt: string, guidance: string[]): string {
  const basePrompt = prompt.trim();
  const suffix = guidance.filter(Boolean).join(' ').trim();
  return suffix ? `${basePrompt} ${suffix}`.trim() : basePrompt;
}

function normalizeKieTaskStatus(state: string | undefined): TaskStatus {
  switch ((state ?? '').toLowerCase()) {
    case 'success':
      return 'completed';
    case 'processing':
    case 'generating':
    case 'queuing':
    case 'waiting':
      return 'processing';
    case 'failed':
    case 'fail':
      return 'failed';
    case 'pending':
    default:
      return 'pending';
  }
}

function normalizeKieProgress(progress: number | undefined): number | undefined {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return undefined;
  }

  if (progress > 1) {
    return Math.max(0, Math.min(1, progress / 100));
  }

  return Math.max(0, Math.min(1, progress));
}

class KieAiService {
  private apiKey: string = '';

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  // Convert data URL to Blob
  private dataUrlToBlob(dataUrl: string): Blob {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URL');
    }
    const mimeType = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mimeType });
  }

  private async sourceToBlob(source: Blob | string): Promise<Blob> {
    if (source instanceof Blob) {
      return source;
    }

    if (source.startsWith('data:')) {
      return this.dataUrlToBlob(source);
    }

    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to read reference media: ${response.status}`);
    }

    return response.blob();
  }

  private createUploadFileName(reference: GenerationReferenceMedia, blob: Blob): string {
    const fallbackExtension = getReferenceFallbackExtension(reference.mediaType);
    const extension = hasFileExtension(reference.fileName)
      ? reference.fileName!.split('.').pop()!.toLowerCase()
      : getExtensionFromMimeType(reference.mimeType || blob.type, fallbackExtension);
    const baseName = sanitizeUploadBaseName(reference.fileName || reference.label, reference.mediaType);
    return `${baseName}_${Date.now()}.${extension}`;
  }

  private async uploadMedia(reference: GenerationReferenceMedia): Promise<string> {
    if (!this.hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    if (typeof reference.source === 'string' && isRemoteUrl(reference.source)) {
      return reference.source;
    }

    const blob = await this.sourceToBlob(reference.source);
    const filename = this.createUploadFileName(reference, blob);
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('uploadPath', getReferenceUploadPath(reference.mediaType));
    formData.append('fileName', filename);

    log.debug('Uploading reference media to Kie.ai', {
      filename,
      mediaType: reference.mediaType,
      sizeKB: Math.round(blob.size / 1024),
    });

    const response = canUseSameOriginProxy()
      ? await fetch(BYO_PROXY_UPLOAD_URL, {
          method: 'POST',
          headers: {
            'x-kieai-api-key': this.apiKey,
          },
          body: formData,
        })
      : await fetch(UPLOAD_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: formData,
        });

    if (!response.ok) {
      throw new Error(`Kie.ai upload failed: ${response.status}`);
    }

    const result = await response.json() as KieAiUploadResponse;
    if (!result.success || !result.data?.downloadUrl) {
      throw new Error('Kie.ai upload failed: no download URL returned');
    }

    log.debug('Uploaded to Kie.ai:', result.data.downloadUrl);
    return result.data.downloadUrl;
  }

  // Upload image to Kie.ai file hosting
  private async uploadImage(imageSource: string): Promise<string> {
    return this.uploadMedia({
      mediaType: 'image',
      source: imageSource,
      fileName: `image_${Date.now()}.jpg`,
    });
  }

  private async uploadReferenceMedia(
    references: GenerationReferenceMedia[] | undefined,
    allowedTypes?: GenerationReferenceMedia['mediaType'][],
  ): Promise<UploadedReferenceMedia[]> {
    const filteredReferences = (references ?? []).filter((reference) => (
      !allowedTypes || allowedTypes.includes(reference.mediaType)
    ));

    if (filteredReferences.length === 0) {
      return [];
    }

    return Promise.all(filteredReferences.map(async (reference) => ({
      label: reference.label || reference.fileName,
      mediaType: reference.mediaType,
      url: await this.uploadMedia(reference),
    })));
  }

  // Compress image before upload
  private async compressImage(dataUrl: string, maxWidth = 1280, quality = 0.8): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        const sizeKB = Math.round((compressed.length * 0.75) / 1024);
        log.debug(`Compressed image: ${img.width}x${img.height} -> ${width}x${height}, ~${sizeKB}KB`);
        resolve(compressed);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object
  ): Promise<T> {
    if (!this.hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    const response = canUseSameOriginProxy()
      ? await fetch(BYO_PROXY_REQUEST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-kieai-api-key': this.apiKey,
          },
          body: JSON.stringify({ endpoint, method, body }),
        })
      : await fetch(`${BASE_URL}${endpoint}`, {
          method,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });

    const responseText = await response.text();
    let result: T;

    try {
      result = JSON.parse(responseText) as T;
    } catch {
      log.error('Failed to parse response:', responseText);
      throw new Error(`Kie.ai error: ${response.status} - Invalid JSON response`);
    }

    if (!response.ok) {
      log.error('API error:', result);
      const errorResult = result as KieAiProxyErrorResponse & Record<string, unknown>;
      const errorMsg = errorResult.msg || errorResult.message || errorResult.error || responseText;
      throw new Error(`Kie.ai error: ${response.status} - ${errorMsg}`);
    }

    return result;
  }

  async createTextToVideo(params: TextToVideoParams): Promise<string> {
    if (params.provider === 'bytedance/seedance-2') {
      return this.createSeedanceVideo(params);
    }

    const multiPrompt = params.multiShots ? normalizeMultiShotPrompt(params.multiPrompt) : undefined;
    const effectiveSound = params.multiShots ? true : (params.sound ?? false);
    const elementReferences = (await this.uploadReferenceMedia(params.referenceMedia, ['image', 'video'])).slice(0, 3);
    const prompt = applyKlingReferenceTokens(params.prompt, elementReferences);

    // Kie.ai Kling 3.0 API: no cfg_scale, no negative_prompt
    const input: Record<string, unknown> = {
      prompt,
      duration: String(params.duration),
      aspect_ratio: params.aspectRatio || '16:9',
      mode: params.mode || 'std',
      sound: effectiveSound,
      multi_shots: Boolean(params.multiShots),
    };

    if (multiPrompt) {
      input.multi_prompt = multiPrompt.map((shot) => ({
        ...shot,
        prompt: applyKlingReferenceTokens(shot.prompt, elementReferences),
      }));
    }

    if (elementReferences.length > 0) {
      input.kling_elements = elementReferences.map((reference, index) => ({
        name: getReferenceToken(index),
        description: reference.label || `Reference ${index + 1}`,
        element_input_urls: [reference.url],
      }));
    }

    const body = {
      model: 'kling-3.0/video',
      input,
    };

    log.debug('Creating text-to-video task:', JSON.stringify(body, null, 2));

    const result = await this.request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

    if (result.code !== 200 || !result.data?.taskId) {
      throw new Error(`Kie.ai error: ${result.msg || 'Failed to create task'}`);
    }

    return result.data.taskId;
  }

  async createTextToImage(params: TextToImageParams): Promise<string> {
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
          const compressed = await this.compressImage(image);
          return this.uploadImage(compressed);
        })
      );
      imageInputs.push(...uploaded);
    }

    const referenceImages = await this.uploadReferenceMedia(params.referenceMedia, ['image']);
    imageInputs.push(...referenceImages.map((reference) => reference.url));

    if (imageInputs.length > 0) {
      input.image_input = imageInputs;
    }

    const body = {
      model: params.provider,
      input,
    };

    log.debug('Creating text-to-image task:', JSON.stringify(body, null, 2));

    const result = await this.request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

    if (result.code !== 200 || !result.data?.taskId) {
      throw new Error(`Kie.ai error: ${result.msg || 'Failed to create image task'}`);
    }

    return result.data.taskId;
  }

  async createImageToVideo(params: ImageToVideoParams): Promise<string> {
    if (params.provider === 'bytedance/seedance-2') {
      return this.createSeedanceVideo(params);
    }

    const imageUrls: string[] = [];
    const multiPrompt = params.multiShots ? normalizeMultiShotPrompt(params.multiPrompt) : undefined;
    const effectiveSound = params.multiShots ? true : (params.sound ?? false);
    const elementReferences = (await this.uploadReferenceMedia(params.referenceMedia, ['image', 'video'])).slice(0, 3);
    const prompt = applyKlingReferenceTokens(params.prompt, elementReferences);

    // Upload start image
    if (params.startImageUrl) {
      log.debug('Compressing and uploading start image...');
      const url = isRemoteUrl(params.startImageUrl)
        ? params.startImageUrl
        : await this.uploadImage(await this.compressImage(params.startImageUrl));
      imageUrls.push(url);
    }

    // Upload end image (passed as second element in image_urls)
    if (params.endImageUrl && !params.multiShots) {
      log.debug('Compressing and uploading end image...');
      const url = isRemoteUrl(params.endImageUrl)
        ? params.endImageUrl
        : await this.uploadImage(await this.compressImage(params.endImageUrl));
      imageUrls.push(url);
    }

    const input: Record<string, unknown> = {
      prompt,
      duration: String(params.duration),
      aspect_ratio: params.aspectRatio || '16:9',
      mode: params.mode || 'std',
      sound: effectiveSound,
      multi_shots: Boolean(params.multiShots),
    };

    if (imageUrls.length > 0) {
      input.image_urls = imageUrls;
    }

    if (multiPrompt) {
      input.multi_prompt = multiPrompt.map((shot) => ({
        ...shot,
        prompt: applyKlingReferenceTokens(shot.prompt, elementReferences),
      }));
    }

    if (elementReferences.length > 0) {
      input.kling_elements = elementReferences.map((reference, index) => ({
        name: getReferenceToken(index),
        description: reference.label || `Reference ${index + 1}`,
        element_input_urls: [reference.url],
      }));
    }

    // Kie.ai Kling 3.0: no cfg_scale, no negative_prompt

    const body = {
      model: 'kling-3.0/video',
      input,
    };

    log.debug('Creating image-to-video task:', {
      hasStartImage: imageUrls.length >= 1,
      hasEndImage: imageUrls.length >= 2,
    });

    const result = await this.request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

    if (result.code !== 200 || !result.data?.taskId) {
      throw new Error(`Kie.ai error: ${result.msg || 'Failed to create task'}`);
    }

    return result.data.taskId;
  }

  private async uploadOptionalImageSource(imageSource: string | undefined): Promise<string | undefined> {
    if (!imageSource) {
      return undefined;
    }

    if (isRemoteUrl(imageSource)) {
      return imageSource;
    }

    return this.uploadImage(await this.compressImage(imageSource));
  }

  private async createSeedanceVideo(params: TextToVideoParams | ImageToVideoParams): Promise<string> {
    const startImageUrl = 'startImageUrl' in params ? params.startImageUrl : undefined;
    const endImageUrl = 'endImageUrl' in params ? params.endImageUrl : undefined;
    const hasReferenceMedia = (params.referenceMedia ?? []).length > 0;
    const useMultimodalReferenceMode = hasReferenceMedia;
    const firstFrameUrl = useMultimodalReferenceMode
      ? undefined
      : await this.uploadOptionalImageSource(startImageUrl);
    const lastFrameUrl = useMultimodalReferenceMode || params.multiShots
      ? undefined
      : await this.uploadOptionalImageSource(endImageUrl);
    const referenceMedia = useMultimodalReferenceMode
      ? await this.uploadReferenceMedia(params.referenceMedia)
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
      const startReferenceImageUrl = await this.uploadOptionalImageSource(startImageUrl);
      const endReferenceImageUrl = params.multiShots
        ? undefined
        : await this.uploadOptionalImageSource(endImageUrl);
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
      duration: Math.max(1, Math.floor(params.duration || 5)),
      resolution: params.mode === '1080p' ? '1080p' : '720p',
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
      model: 'bytedance/seedance-2',
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

    const result = await this.request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

    if (result.code !== 200 || !result.data?.taskId) {
      throw new Error(`Kie.ai error: ${result.msg || 'Failed to create Seedance task'}`);
    }

    return result.data.taskId;
  }

  async getTaskStatus(taskId: string): Promise<VideoTask> {
    const result = await this.request<KieAiStatusResponse>(
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      'GET'
    );

    const status = normalizeKieTaskStatus(result.data?.state);

    const task: VideoTask = {
      id: taskId,
      status,
      progress: normalizeKieProgress(result.data?.progress),
      error: result.data?.failMsg,
      createdAt: result.data?.createTime ? new Date(result.data.createTime) : new Date(),
    };

    // Extract video URL from response
    if (status === 'completed') {
      // Try resultUrls directly
      if (result.data?.resultUrls?.length) {
        task.videoUrl = result.data.resultUrls[0];
      }
      // Try parsing resultJson
      else if (result.data?.resultJson) {
        try {
          const parsed = JSON.parse(result.data.resultJson);
          if (parsed.resultUrls?.length) {
            task.videoUrl = parsed.resultUrls[0];
          }
        } catch {
          log.warn('Failed to parse resultJson:', result.data.resultJson);
        }
      }
      task.completedAt = result.data?.completeTime ? new Date(result.data.completeTime) : new Date();
    }

    return task;
  }

  async getImageTaskStatus(taskId: string): Promise<VideoTask> {
    const result = await this.request<KieAiStatusResponse>(
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      'GET'
    );

    const status = normalizeKieTaskStatus(result.data?.state);

    const task: VideoTask = {
      id: taskId,
      status,
      progress: normalizeKieProgress(result.data?.progress),
      error: result.data?.failMsg,
      createdAt: result.data?.createTime ? new Date(result.data.createTime) : new Date(),
    };

    if (status === 'completed') {
      if (result.data?.resultUrls?.length) {
        task.imageUrl = result.data.resultUrls[0];
      } else if (result.data?.resultJson) {
        try {
          const parsed = JSON.parse(result.data.resultJson);
          if (parsed.resultUrls?.length) {
            task.imageUrl = parsed.resultUrls[0];
          }
        } catch {
          log.warn('Failed to parse image resultJson:', result.data.resultJson);
        }
      }
      task.completedAt = result.data?.completeTime ? new Date(result.data.completeTime) : new Date();
    }

    return task;
  }

  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 15000, // Kie.ai recommends 15s intervals
    timeout = 600000 // 10 minutes
  ): Promise<VideoTask> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = await this.getTaskStatus(taskId);

      if (onProgress) {
        onProgress(task);
      }

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Task timed out after 10 minutes');
  }

  async pollImageTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 5000,
    timeout = 180000
  ): Promise<VideoTask> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = await this.getImageTaskStatus(taskId);

      if (onProgress) {
        onProgress(task);
      }

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Image task timed out after 3 minutes');
  }

  // Get remaining credits from Kie.ai
  // Endpoint: GET /api/v1/chat/credit
  // Response: { code: 200, msg: "success", data: <credits as integer> }
  async getAccountInfo(): Promise<AccountInfo> {
    if (!this.hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    const response = await fetch(`${BASE_URL}/api/v1/chat/credit`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get account info: ${response.status}`);
    }

    const result = await response.json();
    log.debug('Kie.ai credit info:', result);

    const credits = result.data ?? 0;
    return {
      accountName: 'Kie.ai',
      accountId: '',
      credits,
      creditsUsd: credits * 0.005,
    };
  }
}

// Singleton instance
export const kieAiService = new KieAiService();
