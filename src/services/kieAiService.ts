// Kie.ai Service - Unified API for AI media generation via kie.ai
// Currently supports: Kling 3.0 + Seedance 2.0 video and Nano Banana 2 images
// Docs: https://kie.ai

import { Logger } from './logger';
import type {
  VideoProvider,
  TextToVideoParams,
  ImageToVideoParams,
  VideoTask,
  TaskStatus,
  AccountInfo,
} from './piApiService';

const log = Logger.create('KieAI');

const BASE_URL = 'https://api.kie.ai';
const UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';

const KIEAI_SEEDANCE_2_PROVIDER_ID = 'seedance-2';
const KIEAI_SEEDANCE_2_MODEL_ID = 'bytedance/seedance-2';
const KIEAI_SEEDANCE_2_DEFAULT_RESOLUTION = '720p';

// Kie.ai providers (Kling 3.0 only for now)
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
  [KIEAI_SEEDANCE_2_PROVIDER_ID]: {
    // Based on the current Kie.ai Seedance 2.0 pricing:
    // text-to-video 720p: ~$0.205/s, image-to-video 720p: ~$0.125/s
    // Kie credits currently map 1 credit = $0.005.
    'std': { normal: 41, audio: 41 },
  },
};

export function getKieAiProviders(): VideoProvider[] {
  return KIEAI_PROVIDERS;
}

export function getKieAiProvider(providerId: string): VideoProvider | undefined {
  return KIEAI_PROVIDERS.find(p => p.id === providerId);
}

// Calculate cost in credits for Kie.ai
export function calculateKieAiCost(
  provider: string,
  mode: string,
  duration: number,
  sound = false,
  options?: {
    hasStartFrame?: boolean;
  },
): number {
  if (provider === KIEAI_SEEDANCE_2_PROVIDER_ID) {
    const ratePerSecond = options?.hasStartFrame ? 25 : 41;
    return duration * ratePerSecond;
  }

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

function isSeedance2Provider(provider: string | undefined): boolean {
  return provider === KIEAI_SEEDANCE_2_PROVIDER_ID;
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

  // Upload image to Kie.ai file hosting
  private async uploadImage(dataUrl: string): Promise<string> {
    if (!this.hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    const blob = this.dataUrlToBlob(dataUrl);
    const filename = `image_${Date.now()}.jpg`;
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('uploadPath', 'images');
    formData.append('fileName', filename);

    log.debug(`Uploading image to Kie.ai, size: ${Math.round(blob.size / 1024)} KB`);

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Kie.ai upload failed: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success || !result.data?.downloadUrl) {
      throw new Error('Kie.ai upload failed: no download URL returned');
    }

    log.debug('Uploaded to Kie.ai:', result.data.downloadUrl);
    return result.data.downloadUrl;
  }

  private async prepareUploadedImageUrl(sourceUrl: string): Promise<string> {
    const compressed = await this.compressImage(sourceUrl);
    return this.uploadImage(compressed);
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

    const url = `${BASE_URL}${endpoint}`;
    const response = await fetch(url, {
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
      const errorMsg = (result as Record<string, unknown>).msg || responseText;
      throw new Error(`Kie.ai error: ${response.status} - ${errorMsg}`);
    }

    return result;
  }

  async createTextToVideo(params: TextToVideoParams): Promise<string> {
    if (isSeedance2Provider(params.provider)) {
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        aspect_ratio: params.aspectRatio || '16:9',
        resolution: KIEAI_SEEDANCE_2_DEFAULT_RESOLUTION,
        generate_audio: Boolean(params.sound),
      };

      const body = {
        model: KIEAI_SEEDANCE_2_MODEL_ID,
        input,
      };

      log.debug('Creating Seedance 2.0 text-to-video task:', JSON.stringify(body, null, 2));

      const result = await this.request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

      if (result.code !== 200 || !result.data?.taskId) {
        throw new Error(`Kie.ai error: ${result.msg || 'Failed to create task'}`);
      }

      return result.data.taskId;
    }

    const multiPrompt = params.multiShots ? normalizeMultiShotPrompt(params.multiPrompt) : undefined;
    const effectiveSound = params.multiShots ? true : (params.sound ?? false);

    // Kie.ai Kling 3.0 API: no cfg_scale, no negative_prompt
    const input: Record<string, unknown> = {
      prompt: params.prompt,
      duration: String(params.duration),
      aspect_ratio: params.aspectRatio || '16:9',
      mode: params.mode || 'std',
      sound: effectiveSound,
      multi_shots: Boolean(params.multiShots),
    };

    if (multiPrompt) {
      input.multi_prompt = multiPrompt;
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

    if (params.imageInputs?.length) {
      const uploaded = await Promise.all(
        params.imageInputs.map(async (image) => {
          const compressed = await this.compressImage(image);
          return this.uploadImage(compressed);
        })
      );
      input.image_input = uploaded;
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
    if (isSeedance2Provider(params.provider)) {
      const input: Record<string, unknown> = {
        prompt: params.prompt || '',
        duration: params.duration,
        aspect_ratio: params.aspectRatio || '16:9',
        resolution: KIEAI_SEEDANCE_2_DEFAULT_RESOLUTION,
        generate_audio: Boolean(params.sound),
      };

      if (params.startImageUrl) {
        log.debug('Compressing and uploading Seedance 2 start image...');
        input.first_frame_url = await this.prepareUploadedImageUrl(params.startImageUrl);
      }

      if (params.endImageUrl) {
        log.debug('Compressing and uploading Seedance 2 end image...');
        input.last_frame_url = await this.prepareUploadedImageUrl(params.endImageUrl);
      }

      const body = {
        model: KIEAI_SEEDANCE_2_MODEL_ID,
        input,
      };

      log.debug('Creating Seedance 2.0 image-to-video task:', {
        hasStartImage: Boolean(input.first_frame_url),
        hasEndImage: Boolean(input.last_frame_url),
      });

      const result = await this.request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

      if (result.code !== 200 || !result.data?.taskId) {
        throw new Error(`Kie.ai error: ${result.msg || 'Failed to create task'}`);
      }

      return result.data.taskId;
    }

    const imageUrls: string[] = [];
    const multiPrompt = params.multiShots ? normalizeMultiShotPrompt(params.multiPrompt) : undefined;
    const effectiveSound = params.multiShots ? true : (params.sound ?? false);

    // Upload start image
    if (params.startImageUrl) {
      log.debug('Compressing and uploading start image...');
      const url = await this.prepareUploadedImageUrl(params.startImageUrl);
      imageUrls.push(url);
    }

    // Upload end image (passed as second element in image_urls)
    if (params.endImageUrl && !params.multiShots) {
      log.debug('Compressing and uploading end image...');
      const url = await this.prepareUploadedImageUrl(params.endImageUrl);
      imageUrls.push(url);
    }

    const input: Record<string, unknown> = {
      prompt: params.prompt,
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
      input.multi_prompt = multiPrompt;
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
      creditsUsd: credits, // Kie.ai credits map 1:1 to USD
    };
  }
}

// Singleton instance
export const kieAiService = new KieAiService();
