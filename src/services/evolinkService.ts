// EvoLink Service - Nano Banana 2 image generation through EvoLink's async API.
// Docs: https://docs.evolink.ai/en/api-manual/image-series/nanobanana/nanobanana-2-image-generate

import { Logger } from './logger';
import type { TextToImageParams } from './aiGenerationContracts';
import type {
  AccountInfo,
  GenerationReferenceMedia,
  TaskStatus,
  VideoTask,
} from './piApiService';

const log = Logger.create('EvoLink');

const BASE_URL = 'https://api.evolink.ai';
const UPLOAD_URL = 'https://files-api.evolink.ai/api/v1/files/upload/stream';
const BYO_PROXY_REQUEST_URL = '/api/evolink/byo/request';
const BYO_PROXY_UPLOAD_URL = '/api/evolink/byo/upload';

export const EVOLINK_NANO_BANANA_2_PROVIDER_ID = 'evolink-nano-banana-2';
export const EVOLINK_NANO_BANANA_2_MODEL = 'gemini-3.1-flash-image-preview';

interface EvolinkCreateImageResponse {
  created?: number;
  error?: EvolinkTaskError;
  id?: string;
  model?: string;
  progress?: number;
  status?: string;
}

interface EvolinkTaskError {
  code?: string;
  message?: string;
  type?: string;
}

interface EvolinkTaskResponse {
  created?: number;
  error?: EvolinkTaskError;
  id?: string;
  output?: {
    image_url?: string;
    image_urls?: string[];
  };
  progress?: number;
  results?: string[];
  status?: string;
}

interface EvolinkUploadResponse {
  code?: number;
  data?: {
    download_url?: string;
    file_name?: string;
    file_url?: string;
  };
  msg?: string;
  success?: boolean;
}

interface EvolinkCreditsResponse {
  data?: {
    token?: {
      remaining_credits?: number;
      used_credits?: number;
    };
    user?: {
      remaining_credits?: number;
      used_credits?: number;
    };
  };
  message?: string;
  success?: boolean;
}

interface EvolinkProxyErrorResponse {
  error?: string;
  message?: string;
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function canUseSameOriginProxy(): boolean {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

function normalizeImageQuality(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
}

function normalizeAspectRatio(aspectRatio?: string): string {
  return aspectRatio?.trim() || 'auto';
}

function normalizeTaskStatus(status: string | undefined): TaskStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'success':
    case 'succeeded':
      return 'completed';
    case 'processing':
    case 'running':
      return 'processing';
    case 'failed':
    case 'error':
      return 'failed';
    case 'pending':
    default:
      return 'pending';
  }
}

function normalizeProgress(progress: number | undefined): number | undefined {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
}

function getTaskErrorMessage(error: EvolinkTaskError | undefined): string | undefined {
  if (!error) {
    return undefined;
  }

  return error.message || error.code || error.type;
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
    default:
      return fallback;
  }
}

function hasFileExtension(value: string | undefined): boolean {
  return Boolean(value && /\.[a-z0-9]{1,8}$/i.test(value));
}

function createDateFromSeconds(seconds: number | undefined): Date {
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000);
  }

  return new Date();
}

function getFirstImageUrl(response: EvolinkTaskResponse): string | undefined {
  return response.results?.[0]
    ?? response.output?.image_url
    ?? response.output?.image_urls?.[0];
}

class EvolinkService {
  private apiKey = '';

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey.trim();
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  private dataUrlToBlob(dataUrl: string): Blob {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URL');
    }

    const mimeType = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
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
      throw new Error(`Failed to read reference image: ${response.status}`);
    }

    return response.blob();
  }

  private async compressImage(dataUrl: string, maxWidth = 1280, quality = 0.85): Promise<string> {
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
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  }

  private createUploadFileName(reference: GenerationReferenceMedia, blob: Blob): string {
    const extension = hasFileExtension(reference.fileName)
      ? reference.fileName!.split('.').pop()!.toLowerCase()
      : getExtensionFromMimeType(reference.mimeType || blob.type, 'jpg');
    const baseName = sanitizeUploadBaseName(reference.fileName || reference.label, 'image');
    return `${baseName}_${Date.now()}.${extension}`;
  }

  private async uploadImageSource(source: Blob | string, fileName?: string): Promise<string> {
    if (typeof source === 'string' && isRemoteUrl(source)) {
      return source;
    }

    const uploadSource = typeof source === 'string' && source.startsWith('data:')
      ? await this.compressImage(source)
      : source;
    const blob = await this.sourceToBlob(uploadSource);
    const reference: GenerationReferenceMedia = {
      mediaType: 'image',
      source: blob,
      fileName,
    };
    const filename = this.createUploadFileName(reference, blob);
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('upload_path', 'images');
    formData.append('file_name', filename);

    log.debug('Uploading reference image to EvoLink', {
      filename,
      sizeKB: Math.round(blob.size / 1024),
    });

    const response = canUseSameOriginProxy()
      ? await fetch(BYO_PROXY_UPLOAD_URL, {
          body: formData,
          headers: {
            'x-evolink-api-key': this.apiKey,
          },
          method: 'POST',
        })
      : await fetch(UPLOAD_URL, {
          body: formData,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          method: 'POST',
        });

    const result = (await response.json().catch(() => null)) as EvolinkUploadResponse | null;
    const fileUrl = result?.data?.file_url ?? result?.data?.download_url;

    if (!response.ok || !result?.success || !fileUrl) {
      throw new Error(result?.msg || `EvoLink upload failed: ${response.status}`);
    }

    return fileUrl;
  }

  private async uploadReferenceImages(
    references: GenerationReferenceMedia[] | undefined,
  ): Promise<string[]> {
    const imageReferences = (references ?? []).filter((reference) => reference.mediaType === 'image');
    if (imageReferences.length === 0) {
      return [];
    }

    const urls = await Promise.all(
      imageReferences.map((reference) => this.uploadImageSource(reference.source, reference.fileName)),
    );

    return urls.slice(0, 14);
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object,
  ): Promise<T> {
    if (!this.hasApiKey()) {
      throw new Error('EvoLink API key not set');
    }

    const response = canUseSameOriginProxy()
      ? await fetch(BYO_PROXY_REQUEST_URL, {
          body: JSON.stringify({ endpoint, method, body }),
          headers: {
            'Content-Type': 'application/json',
            'x-evolink-api-key': this.apiKey,
          },
          method: 'POST',
        })
      : await fetch(`${BASE_URL}${endpoint}`, {
          body: body ? JSON.stringify(body) : undefined,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          method,
        });

    const responseText = await response.text();
    let result: T;

    try {
      result = JSON.parse(responseText) as T;
    } catch {
      throw new Error(`EvoLink error: ${response.status} - Invalid JSON response`);
    }

    if (!response.ok) {
      const errorResult = result as EvolinkProxyErrorResponse & Record<string, unknown>;
      const errorMsg = errorResult.message || errorResult.error || responseText;
      throw new Error(`EvoLink error: ${response.status} - ${errorMsg}`);
    }

    return result;
  }

  async createTextToImage(params: TextToImageParams): Promise<string> {
    const uploadedInputs = params.imageInputs?.length
      ? await Promise.all(params.imageInputs.map((source) => this.uploadImageSource(source)))
      : [];
    const referenceInputs = await this.uploadReferenceImages(params.referenceMedia);
    const imageUrls = [...uploadedInputs, ...referenceInputs].slice(0, 14);
    const model = params.provider === EVOLINK_NANO_BANANA_2_MODEL
      ? params.provider
      : EVOLINK_NANO_BANANA_2_MODEL;

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      quality: normalizeImageQuality(params.resolution),
      size: normalizeAspectRatio(params.aspectRatio),
    };

    if (imageUrls.length > 0) {
      body.image_urls = imageUrls;
    }

    log.debug('Creating EvoLink image task:', {
      model,
      referenceCount: imageUrls.length,
      quality: body.quality,
      size: body.size,
    });

    const result = await this.request<EvolinkCreateImageResponse>('/v1/images/generations', 'POST', body);
    if (!result.id) {
      throw new Error(getTaskErrorMessage(result.error) || 'EvoLink did not return a task id');
    }

    return result.id;
  }

  async getImageTaskStatus(taskId: string): Promise<VideoTask> {
    const result = await this.request<EvolinkTaskResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      'GET',
    );
    const status = normalizeTaskStatus(result.status);
    const task: VideoTask = {
      createdAt: createDateFromSeconds(result.created),
      error: getTaskErrorMessage(result.error),
      id: result.id ?? taskId,
      progress: normalizeProgress(result.progress),
      status,
    };

    if (status === 'completed') {
      task.imageUrl = getFirstImageUrl(result);
      task.completedAt = new Date();
    }

    return task;
  }

  async pollImageTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 5000,
    timeout = 600000,
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

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('EvoLink image task timed out after 10 minutes');
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const result = await this.request<EvolinkCreditsResponse>('/v1/credits', 'GET');
    const tokenCredits = result.data?.token?.remaining_credits;
    const userCredits = result.data?.user?.remaining_credits;
    const credits = typeof tokenCredits === 'number'
      ? tokenCredits
      : typeof userCredits === 'number'
        ? userCredits
        : 0;

    return {
      accountId: '',
      accountName: 'EvoLink',
      credits,
      creditsUsd: credits,
    };
  }
}

export const evolinkService = new EvolinkService();
