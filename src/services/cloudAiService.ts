import { cloudApi, type CloudAiChatRequest, type CloudAiGatewayEnvelope, type CloudAiVideoRequest } from './cloudApi';
import { resolveAiAccess, type AiAccessDecision, type AiAccessInput } from './aiAccess';
import type { TextToImageParams } from './kieAiService';
import type { SunoCreateMusicParams, SunoCreateSoundsParams, SunoMusicTask } from './sunoService';
import { SUNO_PROVIDER_ID, SUNO_SOUNDS_PROVIDER_ID } from './sunoService';
import { useAccountStore } from '../stores/accountStore';
import {
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT,
  ELEVENLABS_MP3_EXTENSION,
  ELEVENLABS_MP3_MIME_TYPE,
  isElevenLabsMp3OutputFormat,
  type ElevenLabsCreateSpeechParams,
  type ElevenLabsModel,
  type ElevenLabsSpeechResult,
  type ElevenLabsVoiceSearchParams,
  type ElevenLabsVoiceSearchResult,
} from './elevenLabsService';
import type {
  AccountInfo,
  GenerationReferenceMedia,
  ImageToVideoParams,
  TaskStatus,
  TextToVideoParams,
  VideoTask,
} from './piApiService';

export interface CloudAiStreamEvent {
  data: unknown;
  event: 'delta' | 'done' | 'error' | 'meta' | 'ready';
}

export interface CloudAiDispatchResult<TResponse> {
  decision: AiAccessDecision;
  response: TResponse | null;
}

function normalizeSseData(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function* readSseEvents(response: Response): AsyncGenerator<CloudAiStreamEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex < 0) {
          break;
        }

        const rawEvent = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);

        if (!rawEvent) {
          continue;
        }

        let eventName: CloudAiStreamEvent['event'] = 'meta';
        const dataLines: string[] = [];

        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() as CloudAiStreamEvent['event'];
            continue;
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        const payload = dataLines.join('\n');
        yield {
          data: normalizeSseData(payload),
          event: eventName,
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function planAiAccess(feature: 'chat' | 'video', input: AiAccessInput): AiAccessDecision {
  return resolveAiAccess({
    ...input,
    feature,
  });
}

function getHostedTaskId(response: CloudAiGatewayEnvelope, errorMessage: string): string {
  const task = response.data as { taskId?: string } | null;

  if (!task?.taskId) {
    throw new Error(errorMessage);
  }

  return task.taskId;
}

function syncHostedCreditBalance(response: { creditBalance?: number | null }): void {
  if (typeof response.creditBalance !== 'number' || !Number.isFinite(response.creditBalance)) {
    return;
  }

  useAccountStore.getState().applyHostedCreditBalance(response.creditBalance);
}

function syncHostedCreditBalanceFromHeaders(headers: Headers): void {
  const creditBalance = Number(headers.get('X-MasterSelects-Credit-Balance'));
  if (!Number.isFinite(creditBalance)) {
    return;
  }

  useAccountStore.getState().applyHostedCreditBalance(creditBalance);
}

function createHostedAudioIdempotencyKey(): string {
  return `hosted-audio:${Date.now()}:${crypto.randomUUID()}`;
}

function createHostedSunoIdempotencyKey(): string {
  return `hosted-suno:${Date.now()}:${crypto.randomUUID()}`;
}

type CloudHostedReferenceMedia = NonNullable<NonNullable<CloudAiVideoRequest['params']>['referenceMedia']>;

function serializeHostedReferenceMedia(
  referenceMedia: GenerationReferenceMedia[] | undefined,
): CloudHostedReferenceMedia | undefined {
  const serialized = (referenceMedia ?? [])
    .map((reference): CloudHostedReferenceMedia[number] | null => {
      if (typeof reference.source !== 'string') {
        return null;
      }

      return {
        fileName: reference.fileName,
        label: reference.label,
        mediaType: reference.mediaType,
        mimeType: reference.mimeType,
        source: reference.source,
      };
    })
    .filter((reference): reference is CloudHostedReferenceMedia[number] => Boolean(reference));

  return serialized.length > 0 ? serialized : undefined;
}

export const cloudAiService = {
  async createChatCompletion(body: Record<string, unknown>): Promise<unknown> {
    const response = await cloudApi.ai.chat.create(body as unknown as CloudAiChatRequest);
    syncHostedCreditBalance(response);
    return response.data ?? response;
  },
  async createImageToVideo(params: ImageToVideoParams): Promise<string> {
    const response = await cloudApi.ai.video.create({
      action: 'generate',
      params: {
        aspectRatio: params.aspectRatio,
        duration: params.duration,
        endImageUrl: params.endImageUrl,
        mode: params.mode,
        multiPrompt: params.multiPrompt,
        multiShots: params.multiShots,
        prompt: params.prompt,
        provider: params.provider,
        referenceMedia: serializeHostedReferenceMedia(params.referenceMedia),
        sound: params.sound,
        startImageUrl: params.startImageUrl,
      },
    });
    syncHostedCreditBalance(response);
    return getHostedTaskId(response, 'Hosted video generation did not return a task id');
  },
  async createTextToVideo(params: TextToVideoParams): Promise<string> {
    const response = await cloudApi.ai.video.create({
      action: 'generate',
      params: {
        aspectRatio: params.aspectRatio,
        duration: params.duration,
        mode: params.mode,
        multiPrompt: params.multiPrompt,
        multiShots: params.multiShots,
        prompt: params.prompt,
        provider: params.provider,
        referenceMedia: serializeHostedReferenceMedia(params.referenceMedia),
        sound: params.sound,
      },
    });
    syncHostedCreditBalance(response);
    return getHostedTaskId(response, 'Hosted video generation did not return a task id');
  },
  async createTextToImage(params: TextToImageParams): Promise<string> {
    const response = await cloudApi.ai.video.create({
      action: 'generate',
      params: {
        aspectRatio: params.aspectRatio,
        imageInputs: params.imageInputs,
        outputFormat: params.outputFormat,
        outputType: 'image',
        prompt: params.prompt,
        provider: params.provider,
        resolution: params.resolution,
      },
    });
    syncHostedCreditBalance(response);
    return getHostedTaskId(response, 'Hosted image generation did not return a task id');
  },
  async listElevenLabsModels(): Promise<ElevenLabsModel[]> {
    const response = await cloudApi.ai.audio.models();
    syncHostedCreditBalance(response);
    return response.data?.models ?? [];
  },
  async listElevenLabsVoices(params: ElevenLabsVoiceSearchParams = {}): Promise<ElevenLabsVoiceSearchResult> {
    const response = await cloudApi.ai.audio.voices(params);
    syncHostedCreditBalance(response);
    return response.data ?? {
      voices: [],
      hasMore: false,
      nextPageToken: null,
    };
  },
  async createElevenLabsSpeech(
    params: ElevenLabsCreateSpeechParams,
    idempotencyKey = createHostedAudioIdempotencyKey(),
    signal?: AbortSignal,
  ): Promise<ElevenLabsSpeechResult> {
    const { blob, response } = await cloudApi.ai.audio.speech({
      idempotencyKey,
      params,
    }, signal);
    syncHostedCreditBalanceFromHeaders(response.headers);

    const outputFormatHeader = response.headers.get('X-MasterSelects-Output-Format') ?? '';
    const outputFormat = isElevenLabsMp3OutputFormat(outputFormatHeader)
      ? outputFormatHeader
      : params.outputFormat ?? DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT;

    return {
      audio: blob,
      mimeType: ELEVENLABS_MP3_MIME_TYPE,
      extension: ELEVENLABS_MP3_EXTENSION,
      outputFormat,
      size: blob.size,
    };
  },
  async createSunoMusic(
    params: SunoCreateMusicParams,
    idempotencyKey = createHostedSunoIdempotencyKey(),
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await cloudApi.ai.audio.music({
      action: 'music',
      idempotencyKey,
      params: {
        audioWeight: params.audioWeight,
        customMode: params.customMode,
        instrumental: params.instrumental,
        model: params.model,
        negativeTags: params.negativeTags,
        outputType: 'audio',
        prompt: params.prompt,
        provider: SUNO_PROVIDER_ID,
        style: params.style,
        styleWeight: params.styleWeight,
        title: params.title,
        vocalGender: params.vocalGender,
        weirdnessConstraint: params.weirdnessConstraint,
      },
    }, signal);
    syncHostedCreditBalance(response);
    return getHostedTaskId(response, 'Hosted Suno generation did not return a task id');
  },
  async createSunoSounds(
    params: SunoCreateSoundsParams,
    idempotencyKey = createHostedSunoIdempotencyKey(),
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await cloudApi.ai.audio.music({
      action: 'sound',
      idempotencyKey,
      params: {
        model: params.model,
        outputType: 'audio',
        prompt: params.prompt,
        provider: SUNO_SOUNDS_PROVIDER_ID,
        soundLoop: params.soundLoop,
      },
    }, signal);
    syncHostedCreditBalance(response);
    return getHostedTaskId(response, 'Hosted Suno Sounds generation did not return a task id');
  },
  async getSunoMusicTaskStatus(taskId: string): Promise<SunoMusicTask> {
    const response = await cloudApi.ai.audio.musicStatus(taskId);
    const task = response.data as {
      completedAt?: string;
      createdAt?: string;
      error?: string;
      id?: string;
      progress?: number;
      results?: SunoMusicTask['results'];
      status?: SunoMusicTask['status'];
    } | null;

    return {
      completedAt: task?.completedAt ? new Date(task.completedAt) : undefined,
      createdAt: task?.createdAt ? new Date(task.createdAt) : new Date(),
      error: task?.error,
      id: task?.id ?? taskId,
      progress: task?.progress,
      results: task?.results,
      status: task?.status ?? 'pending',
    };
  },
  async pollSunoMusicTaskUntilComplete(
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

      const task = await cloudAiService.getSunoMusicTaskStatus(taskId);
      onProgress?.(task);

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Suno task timed out after 15 minutes');
  },
  access: {
    resolve: resolveAiAccess,
  },
  chat: {
    async dispatch(
      body: CloudAiChatRequest,
      access: AiAccessInput = { feature: 'chat' },
    ): Promise<CloudAiDispatchResult<CloudAiGatewayEnvelope>> {
      const decision = planAiAccess('chat', access);

      if (decision.mode !== 'hosted') {
        return {
          decision,
          response: null,
        };
      }

      const response = await cloudApi.ai.chat.create(body);
      syncHostedCreditBalance(response);
      return {
        decision,
        response,
      };
    },
    stream(body: CloudAiChatRequest, access: AiAccessInput = { feature: 'chat' }): Promise<Response> | null {
      const decision = planAiAccess('chat', access);

      if (decision.mode !== 'hosted') {
        return null;
      }

      return cloudApi.ai.chat.stream(body);
    },
    async *streamEvents(
      body: CloudAiChatRequest,
      access: AiAccessInput = { feature: 'chat' },
    ): AsyncGenerator<CloudAiStreamEvent> {
      const response = await cloudAiService.chat.stream(body, access);

      if (!response) {
        return;
      }

      yield* readSseEvents(response);
    },
  },
  video: {
    async dispatch(
      body: CloudAiVideoRequest,
      access: AiAccessInput = { feature: 'video' },
    ): Promise<CloudAiDispatchResult<CloudAiGatewayEnvelope>> {
      const decision = planAiAccess('video', access);

      if (decision.mode !== 'hosted') {
        return {
          decision,
          response: null,
        };
      }

      const response = await cloudApi.ai.video.create(body);
      syncHostedCreditBalance(response);
      return {
        decision,
        response,
      };
    },
    async status(taskId: string, access: AiAccessInput = { feature: 'video' }): Promise<CloudAiDispatchResult<CloudAiGatewayEnvelope>> {
      const decision = planAiAccess('video', access);

      if (decision.mode !== 'hosted') {
        return {
          decision,
          response: null,
        };
      }

      return {
        decision,
        response: await cloudApi.ai.video.status(taskId),
      };
    },
  },
  async getAccountInfo(): Promise<AccountInfo> {
    const info = await cloudApi.ai.video.capabilities();
    syncHostedCreditBalance(info);
    const creditBalance = typeof info.creditBalance === 'number' ? info.creditBalance : 0;

    return {
      accountId: info.requestId ?? 'hosted',
      accountName: 'MasterSelects Cloud',
      credits: creditBalance,
      creditsUsd: creditBalance * 0.005,
    };
  },
  async getTaskStatus(taskId: string): Promise<VideoTask> {
    const response = await cloudApi.ai.video.status(taskId);
    const task = response.data as {
      completedAt?: string;
      createdAt?: string;
      error?: string;
      id?: string;
      imageUrl?: string;
      progress?: number;
      status?: TaskStatus;
      taskId?: string;
      videoUrl?: string;
    } | null;
    const progress = typeof task?.progress === 'number' && Number.isFinite(task.progress)
      ? Math.max(0, Math.min(1, task.progress))
      : undefined;

    return {
      completedAt: task?.completedAt ? new Date(task.completedAt) : undefined,
      createdAt: task?.createdAt ? new Date(task.createdAt) : new Date(),
      error: task?.error,
      id: task?.id ?? task?.taskId ?? taskId,
      imageUrl: task?.imageUrl ?? task?.videoUrl,
      progress,
      status: task?.status ?? 'pending',
      videoUrl: task?.videoUrl ?? task?.imageUrl,
    };
  },
  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 15000,
    timeout = 600000,
  ): Promise<VideoTask> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = await cloudAiService.getTaskStatus(taskId);

      if (onProgress) {
        onProgress(task);
      }

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Task timed out after 10 minutes');
  },
  setApiKey(): void {
    return;
  },
  plan: planAiAccess,
};
