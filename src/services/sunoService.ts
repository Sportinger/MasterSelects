import { Logger } from './logger';
import type { TaskStatus } from './piApiService';

const log = Logger.create('Suno');

const BASE_URL = 'https://api.kie.ai';
const DEFAULT_CALLBACK_URL = 'https://www.masterselects.com/api/ai/suno/callback';

export const SUNO_PROVIDER_ID = 'suno-music';
export const SUNO_MODEL_IDS = ['V5', 'V4_5PLUS', 'V4_5', 'V4'] as const;
export const DEFAULT_SUNO_MODEL_ID = 'V5';
export const DEFAULT_SUNO_CUSTOM_MODE = false;
export const DEFAULT_SUNO_INSTRUMENTAL = true;
export const DEFAULT_SUNO_STYLE_WEIGHT = 0.65;
export const DEFAULT_SUNO_WEIRDNESS_CONSTRAINT = 0.65;
export const DEFAULT_SUNO_AUDIO_WEIGHT = 0.65;

export type SunoModelId = typeof SUNO_MODEL_IDS[number];
export type SunoVocalGender = 'm' | 'f';

export interface SunoCreateMusicParams {
  audioWeight?: number;
  callBackUrl?: string;
  customMode?: boolean;
  instrumental?: boolean;
  model?: string;
  negativeTags?: string;
  prompt: string;
  style?: string;
  styleWeight?: number;
  title?: string;
  vocalGender?: SunoVocalGender;
  weirdnessConstraint?: number;
}

export interface SunoMusicResult {
  audioUrl: string;
  duration?: number;
  id?: string;
  imageUrl?: string;
  prompt?: string;
  streamAudioUrl?: string;
  tags?: string;
  title?: string;
}

export interface SunoMusicTask {
  completedAt?: Date;
  createdAt: Date;
  error?: string;
  id: string;
  progress?: number;
  results?: SunoMusicResult[];
  status: TaskStatus;
}

interface KieSunoCreateResponse {
  code?: number;
  data?: {
    taskId?: string;
  };
  msg?: string;
}

interface KieSunoRecordResponse {
  code?: number;
  data?: {
    completeTime?: number;
    createTime?: number;
    errorCode?: string;
    errorMessage?: string;
    response?: {
      sunoData?: unknown[];
    };
    status?: string;
    taskId?: string;
  };
  msg?: string;
}

function clampWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeModel(model: string | undefined): SunoModelId {
  return SUNO_MODEL_IDS.includes(model as SunoModelId)
    ? model as SunoModelId
    : DEFAULT_SUNO_MODEL_ID;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStatus(status: string | undefined): TaskStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'completed';
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      return 'failed';
    case 'PENDING':
      return 'pending';
    case 'TEXT_SUCCESS':
    case 'FIRST_SUCCESS':
    default:
      return 'processing';
  }
}

function normalizeProgress(status: string | undefined): number | undefined {
  switch ((status ?? '').toUpperCase()) {
    case 'PENDING':
      return 0.05;
    case 'TEXT_SUCCESS':
      return 0.35;
    case 'FIRST_SUCCESS':
      return 0.75;
    case 'SUCCESS':
      return 1;
    default:
      return undefined;
  }
}

function normalizeMusicResult(value: unknown): SunoMusicResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const audioUrl = asString(record.audioUrl ?? record.audio_url ?? record.sourceAudioUrl ?? record.source_audio_url);
  if (!audioUrl) {
    return null;
  }

  return {
    audioUrl,
    duration: asNumber(record.duration),
    id: asString(record.id),
    imageUrl: asString(record.imageUrl ?? record.image_url),
    prompt: asString(record.prompt),
    streamAudioUrl: asString(record.streamAudioUrl ?? record.stream_audio_url),
    tags: asString(record.tags),
    title: asString(record.title),
  };
}

class SunoService {
  private apiKey = '';

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  hasApiKey(): boolean {
    return this.apiKey.trim().length > 0;
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: object,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      method,
      signal,
    });
    const text = await response.text();
    let result: T;

    try {
      result = text ? JSON.parse(text) as T : {} as T;
    } catch {
      log.error('Failed to parse Suno response:', text);
      throw new Error(`Suno request failed: ${response.status} - invalid JSON response`);
    }

    if (!response.ok) {
      const message = (result as Record<string, unknown>).msg ?? text;
      throw new Error(`Suno request failed: ${response.status} - ${message}`);
    }

    return result;
  }

  async createMusic(params: SunoCreateMusicParams, signal?: AbortSignal): Promise<string> {
    const prompt = params.prompt.trim();
    if (!prompt) {
      throw new Error('Describe the music before generating with Suno.');
    }

    const customMode = params.customMode ?? DEFAULT_SUNO_CUSTOM_MODE;
    const instrumental = params.instrumental ?? DEFAULT_SUNO_INSTRUMENTAL;
    const body: Record<string, unknown> = {
      callBackUrl: params.callBackUrl?.trim() || DEFAULT_CALLBACK_URL,
      customMode,
      instrumental,
      model: normalizeModel(params.model),
      prompt,
    };

    if (customMode) {
      const style = params.style?.trim();
      const title = params.title?.trim();
      if (!style || !title) {
        throw new Error('Custom Suno mode needs a title and style.');
      }

      body.style = style;
      body.title = title;
    }

    if (params.negativeTags?.trim()) {
      body.negativeTags = params.negativeTags.trim();
    }
    if (params.vocalGender) {
      body.vocalGender = params.vocalGender;
    }

    body.styleWeight = clampWeight(params.styleWeight, DEFAULT_SUNO_STYLE_WEIGHT);
    body.weirdnessConstraint = clampWeight(params.weirdnessConstraint, DEFAULT_SUNO_WEIRDNESS_CONSTRAINT);
    body.audioWeight = clampWeight(params.audioWeight, DEFAULT_SUNO_AUDIO_WEIGHT);

    log.debug('Creating Suno music task:', {
      customMode,
      instrumental,
      model: body.model,
    });

    const result = await this.request<KieSunoCreateResponse>('/api/v1/generate', 'POST', body, signal);
    if (result.code !== 200 || !result.data?.taskId) {
      throw new Error(`Suno request failed: ${result.msg || 'missing task id'}`);
    }

    return result.data.taskId;
  }

  async getMusicTaskStatus(taskId: string, signal?: AbortSignal): Promise<SunoMusicTask> {
    const result = await this.request<KieSunoRecordResponse>(
      `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      'GET',
      undefined,
      signal,
    );
    const providerStatus = result.data?.status;
    const status = normalizeStatus(providerStatus);
    const results = result.data?.response?.sunoData
      ?.map(normalizeMusicResult)
      .filter((item): item is SunoMusicResult => item !== null);
    const error = result.data?.errorMessage || result.msg;

    return {
      completedAt: result.data?.completeTime ? new Date(result.data.completeTime) : status === 'completed' ? new Date() : undefined,
      createdAt: result.data?.createTime ? new Date(result.data.createTime) : new Date(),
      error: status === 'failed' ? error : undefined,
      id: taskId,
      progress: normalizeProgress(providerStatus),
      results,
      status,
    };
  }

  async pollMusicTaskUntilComplete(
    taskId: string,
    onProgress?: (task: SunoMusicTask) => void,
    pollInterval = 10000,
    timeout = 900000,
    signal?: AbortSignal,
  ): Promise<SunoMusicTask> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (signal?.aborted) {
        throw new Error('Canceled');
      }

      const task = await this.getMusicTaskStatus(taskId, signal);
      onProgress?.(task);

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Suno task timed out after 15 minutes');
  }
}

export const sunoService = new SunoService();
