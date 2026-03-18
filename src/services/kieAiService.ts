// Kie.ai Service - Unified API for AI video generation via kie.ai
// Currently supports: Kling 3.0 (text-to-video, image-to-video)
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
// Source: https://kie.ai/kling-3-0
// std no-audio: 20 credits/s ($0.10/s)
// std audio:    30 credits/s ($0.15/s)
// pro no-audio: 27 credits/s ($0.135/s)
// pro audio:    40 credits/s ($0.20/s)
// 1 credit = $0.005
const KIEAI_CREDITS_PER_SECOND: Record<string, Record<string, { normal: number; audio: number }>> = {
  'kling-3.0': {
    'std': { normal: 20, audio: 30 },
    'pro': { normal: 27, audio: 40 },
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
  if (!providerRates) return duration * 20; // fallback
  const modeRates = providerRates[mode];
  if (!modeRates) return duration * 20;
  const ratePerSecond = sound ? modeRates.audio : modeRates.normal;
  return duration * ratePerSecond;
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
    taskId: string;
    state: string;
    resultJson?: string;
    resultUrls?: string[];
    costTime?: string;
    failMsg?: string;
  };
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
    // Kie.ai Kling 3.0 API: no cfg_scale, no negative_prompt
    const input: Record<string, unknown> = {
      prompt: params.prompt,
      duration: String(params.duration),
      aspect_ratio: params.aspectRatio || '16:9',
      mode: params.mode || 'std',
      sound: params.sound ?? false,
      multi_shots: false,
    };

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

  async createImageToVideo(params: ImageToVideoParams): Promise<string> {
    const imageUrls: string[] = [];

    // Upload start image
    if (params.startImageUrl) {
      log.debug('Compressing and uploading start image...');
      const compressed = await this.compressImage(params.startImageUrl);
      const url = await this.uploadImage(compressed);
      imageUrls.push(url);
    }

    // Upload end image (passed as second element in image_urls)
    if (params.endImageUrl) {
      log.debug('Compressing and uploading end image...');
      const compressed = await this.compressImage(params.endImageUrl);
      const url = await this.uploadImage(compressed);
      imageUrls.push(url);
    }

    const input: Record<string, unknown> = {
      prompt: params.prompt,
      duration: String(params.duration),
      aspect_ratio: params.aspectRatio || '16:9',
      mode: params.mode || 'std',
      sound: params.sound ?? false,
      multi_shots: false,
    };

    if (imageUrls.length > 0) {
      input.image_urls = imageUrls;
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

    let status: TaskStatus = 'pending';
    const taskState = result.data?.state?.toLowerCase() || '';

    if (taskState === 'success') {
      status = 'completed';
    } else if (taskState === 'processing') {
      status = 'processing';
    } else if (taskState === 'failed') {
      status = 'failed';
    } else if (taskState === 'pending') {
      status = 'pending';
    }

    const task: VideoTask = {
      id: taskId,
      status,
      error: result.data?.failMsg,
      createdAt: new Date(),
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
      task.completedAt = new Date();
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
