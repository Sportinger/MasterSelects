import { cloudApi, type CloudAiChatRequest, type CloudAiGatewayEnvelope, type CloudAiVideoRequest } from './cloudApi';
import { resolveAiAccess, type AiAccessDecision, type AiAccessInput } from './aiAccess';
import type {
  AccountInfo,
  GenerationReferenceMedia,
  HostedAiRefundInfo,
  ImageToVideoParams,
  TaskStatus,
  TextToImageParams,
  TextToVideoParams,
  VideoTask,
} from './aiGenerationContracts';
import type { SunoCreateMusicParams, SunoCreateSoundsParams, SunoMusicTask } from './sunoContracts';
import { SUNO_PROVIDER_ID, SUNO_SOUNDS_PROVIDER_ID } from './sunoContracts';
import {
  applyConfirmedCreditUpdate,
  beginCreditActivity,
  endCreditActivity,
  reconcileCreditBalance,
} from './credits/creditBalanceCoordinator';
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

interface HostedCreditEnvelopeLike {
  creditBalance?: number | null;
  creditMutationId?: string | null;
  creditsCharged?: number | null;
}

function syncHostedCreditBalance(
  response: HostedCreditEnvelopeLike,
  input?: { activityId?: string; source?: string },
): void {
  if (typeof response.creditBalance !== 'number' || !Number.isFinite(response.creditBalance)) {
    return;
  }
  const credits = typeof response.creditsCharged === 'number' && Number.isFinite(response.creditsCharged)
    ? Math.max(0, Math.floor(response.creditsCharged))
    : 0;
  const creditMutationId = response.creditMutationId?.trim();
  if (credits > 0 && creditMutationId) {
    const source = input?.source ?? 'hosted:ai_gateway';
    applyConfirmedCreditUpdate({
      activityId: input?.activityId,
      balance: response.creditBalance,
      credits,
      kind: 'debit',
      mutationId: `debit:${source}:${creditMutationId}`,
      source,
    });
    return;
  }
  reconcileCreditBalance(response.creditBalance);
}

function syncHostedCreditBalanceFromHeaders(
  headers: Headers,
  input?: { activityId?: string; source?: string },
): void {
  const creditBalance = Number(headers.get('X-MasterSelects-Credit-Balance'));
  if (!Number.isFinite(creditBalance)) {
    return;
  }
  const credits = Number(headers.get('X-MasterSelects-Credits-Charged'));
  const creditMutationId = headers.get('X-MasterSelects-Credit-Mutation-Id')?.trim();
  if (Number.isFinite(credits) && credits > 0 && creditMutationId) {
    const source = input?.source ?? 'hosted:binary';
    applyConfirmedCreditUpdate({
      activityId: input?.activityId,
      balance: creditBalance,
      credits,
      kind: 'debit',
      mutationId: `debit:${source}:${creditMutationId}`,
      source,
    });
    return;
  }
  reconcileCreditBalance(creditBalance);
}

function applyHostedRefund(refund: HostedAiRefundInfo | undefined, activityId?: string): void {
  if (!refund) return;
  if (refund.refunded && refund.ledgerEntryId) {
    applyConfirmedCreditUpdate({
      activityId,
      balance: refund.creditBalance,
      credits: refund.credits,
      kind: 'refund',
      mutationId: `refund:hosted:failed_task:${refund.ledgerEntryId}`,
      source: 'refund:hosted:failed_task',
    });
    return;
  }
  reconcileCreditBalance(refund.creditBalance);
}

function normalizeHostedRefund(value: unknown): HostedAiRefundInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const refund = value as Partial<HostedAiRefundInfo>;
  return typeof refund.credits === 'number' && refund.credits > 0 && typeof refund.jobId === 'string'
    ? {
        creditBalance: typeof refund.creditBalance === 'number' ? refund.creditBalance : 0,
        credits: refund.credits,
        idempotencyKey: refund.idempotencyKey ?? null,
        jobId: refund.jobId,
        ledgerEntryId: refund.ledgerEntryId ?? null,
        refunded: refund.refunded === true,
      }
    : undefined;
}

function isTransientFetchError(error: unknown): boolean {
  return error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message);
}

function getPollingRetryDelay(pollInterval: number, attempt: number): number {
  return Math.max(0, Math.min(pollInterval, attempt * 2000));
}

function getHostedTaskDownloadUrl(taskId: string, sourceUrl: string | undefined): string | undefined {
  if (!sourceUrl) {
    return undefined;
  }

  const params = new URLSearchParams({
    taskId,
    download: '1',
  });
  return `/api/ai/video?${params.toString()}`;
}

function createHostedAudioIdempotencyKey(): string {
  return `hosted-audio:${Date.now()}:${crypto.randomUUID()}`;
}

function createHostedSunoIdempotencyKey(): string {
  return `hosted-suno:${Date.now()}:${crypto.randomUUID()}`;
}

function createHostedGenerationIdempotencyKey(): string {
  return `hosted-generation:${Date.now()}:${crypto.randomUUID()}`;
}

const hostedTaskActivities = new Map<string, string>();

function registerHostedTask(taskId: string, activityId: string): void {
  hostedTaskActivities.set(taskId, activityId);
}

function finishHostedTask(taskId: string, status: 'completed' | 'failed'): void {
  const activityId = hostedTaskActivities.get(taskId);
  if (!activityId) return;
  hostedTaskActivities.delete(taskId);
  endCreditActivity({ id: activityId, status });
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
  async createChatCompletion(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : `hosted-chat:${Date.now()}:${crypto.randomUUID()}`;
    const activityId = `chat:${idempotencyKey}`;
    beginCreditActivity({ feature: 'AI chat', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
      const response = await cloudApi.ai.chat.create({
        ...body,
        idempotencyKey,
      } as unknown as CloudAiChatRequest, signal);
      syncHostedCreditBalance(response, { activityId, source: 'hosted:ai_chat' });
      endCreditActivity({ id: activityId, status: response.ok ? 'completed' : 'failed' });
      return response.data ?? response;
    } catch (error) {
      endCreditActivity({ id: activityId, status: signal?.aborted ? 'canceled' : 'failed' });
      throw error;
    }
  },
  async createImageToVideo(params: ImageToVideoParams, idempotencyKey?: string): Promise<string> {
    const requestKey = idempotencyKey ?? createHostedGenerationIdempotencyKey();
    const activityId = `video:${requestKey}`;
    beginCreditActivity({ feature: 'AI video', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
      const response = await cloudApi.ai.video.create({
        action: 'generate',
        idempotencyKey: requestKey,
        params: {
          aspectRatio: params.aspectRatio,
          duration: params.duration,
          endImageUrl: params.endImageUrl,
          mode: params.mode,
          multiPrompt: params.multiPrompt,
          multiShots: params.multiShots,
          prompt: params.prompt ?? '',
          provider: params.provider,
          referenceMedia: serializeHostedReferenceMedia(params.referenceMedia),
          sound: params.sound,
          startImageUrl: params.startImageUrl,
        },
      });
      syncHostedCreditBalance(response, { activityId, source: 'hosted:video' });
      const taskId = getHostedTaskId(response, 'Hosted video generation did not return a task id');
      registerHostedTask(taskId, activityId);
      return taskId;
    } catch (error) {
      endCreditActivity({ id: activityId, status: 'failed' });
      throw error;
    }
  },
  async createTextToVideo(params: TextToVideoParams, idempotencyKey?: string): Promise<string> {
    const requestKey = idempotencyKey ?? createHostedGenerationIdempotencyKey();
    const activityId = `video:${requestKey}`;
    beginCreditActivity({ feature: 'AI video', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
      const response = await cloudApi.ai.video.create({
      action: 'generate',
      idempotencyKey: requestKey,
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
      syncHostedCreditBalance(response, { activityId, source: 'hosted:video' });
      const taskId = getHostedTaskId(response, 'Hosted video generation did not return a task id');
      registerHostedTask(taskId, activityId);
      return taskId;
    } catch (error) {
      endCreditActivity({ id: activityId, status: 'failed' });
      throw error;
    }
  },
  async createTextToImage(params: TextToImageParams, idempotencyKey?: string): Promise<string> {
    const requestKey = idempotencyKey ?? createHostedGenerationIdempotencyKey();
    const activityId = `image:${requestKey}`;
    beginCreditActivity({ feature: 'AI image', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
      const response = await cloudApi.ai.video.create({
      action: 'generate',
      idempotencyKey: requestKey,
      params: {
        aspectRatio: params.aspectRatio,
        imageInputs: params.imageInputs,
        negativePrompt: params.negativePrompt,
        outputFormat: params.outputFormat,
        outputType: 'image',
        prompt: params.prompt,
        provider: params.provider,
        resolution: params.resolution,
      },
      });
      syncHostedCreditBalance(response, { activityId, source: 'hosted:image' });
      const taskId = getHostedTaskId(response, 'Hosted image generation did not return a task id');
      registerHostedTask(taskId, activityId);
      return taskId;
    } catch (error) {
      endCreditActivity({ id: activityId, status: 'failed' });
      throw error;
    }
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
    const activityId = `speech:${idempotencyKey}`;
    beginCreditActivity({ feature: 'AI speech', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
      const { blob, response } = await cloudApi.ai.audio.speech({
        idempotencyKey,
        params,
      }, signal);
      syncHostedCreditBalanceFromHeaders(response.headers, { activityId, source: 'hosted:speech' });

      const outputFormatHeader = response.headers.get('X-MasterSelects-Output-Format') ?? '';
      const outputFormat = isElevenLabsMp3OutputFormat(outputFormatHeader)
        ? outputFormatHeader
        : params.outputFormat ?? DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT;

      endCreditActivity({ id: activityId, status: 'completed' });
      return {
        audio: blob,
        mimeType: ELEVENLABS_MP3_MIME_TYPE,
        extension: ELEVENLABS_MP3_EXTENSION,
        outputFormat,
        size: blob.size,
      };
    } catch (error) {
      endCreditActivity({ id: activityId, status: signal?.aborted ? 'canceled' : 'failed' });
      throw error;
    }
  },
  async createSunoMusic(
    params: SunoCreateMusicParams,
    idempotencyKey = createHostedSunoIdempotencyKey(),
    signal?: AbortSignal,
  ): Promise<string> {
    const activityId = `music:${idempotencyKey}`;
    beginCreditActivity({ feature: 'AI music', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
      const response = await cloudApi.ai.audio.music({
        action: 'music',
        idempotencyKey,
        params: {
          audioWeight: params.audioWeight,
          customMode: params.customMode,
          duration: params.duration,
          instrumental: params.instrumental,
          model: params.model,
          negativeTags: params.negativeTags,
          outputType: 'audio',
          prompt: params.prompt ?? '',
          provider: SUNO_PROVIDER_ID,
          style: params.style,
          styleWeight: params.styleWeight,
          title: params.title,
          vocalGender: params.vocalGender,
          weirdnessConstraint: params.weirdnessConstraint,
        },
      }, signal);
      syncHostedCreditBalance(response, { activityId, source: 'hosted:music' });
      const taskId = getHostedTaskId(response, 'Hosted Suno generation did not return a task id');
      registerHostedTask(taskId, activityId);
      return taskId;
    } catch (error) {
      endCreditActivity({ id: activityId, status: signal?.aborted ? 'canceled' : 'failed' });
      throw error;
    }
  },
  async createSunoSounds(
    params: SunoCreateSoundsParams,
    idempotencyKey = createHostedSunoIdempotencyKey(),
    signal?: AbortSignal,
  ): Promise<string> {
    const activityId = `sound:${idempotencyKey}`;
    beginCreditActivity({ feature: 'AI sound', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
    try {
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
      syncHostedCreditBalance(response, { activityId, source: 'hosted:sound' });
      const taskId = getHostedTaskId(response, 'Hosted Suno Sounds generation did not return a task id');
      registerHostedTask(taskId, activityId);
      return taskId;
    } catch (error) {
      endCreditActivity({ id: activityId, status: signal?.aborted ? 'canceled' : 'failed' });
      throw error;
    }
  },
  async getSunoMusicTaskStatus(taskId: string): Promise<SunoMusicTask> {
    const response = await cloudApi.ai.audio.musicStatus(taskId);
    syncHostedCreditBalance(response);
    const task = response.data as {
      completedAt?: string;
      createdAt?: string;
      error?: string;
      id?: string;
      progress?: number;
      refund?: unknown;
      results?: SunoMusicTask['results'];
      status?: SunoMusicTask['status'];
    } | null;

    const refund = normalizeHostedRefund(task?.refund);
    applyHostedRefund(refund, hostedTaskActivities.get(taskId));
    const status = task?.status ?? 'pending';
    if (status === 'completed' || status === 'failed') {
      finishHostedTask(taskId, status);
    }
    return {
      completedAt: task?.completedAt ? new Date(task.completedAt) : undefined,
      createdAt: task?.createdAt ? new Date(task.createdAt) : new Date(),
      error: task?.error,
      id: task?.id ?? taskId,
      progress: task?.progress,
      refund,
      results: task?.results,
      status,
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
        const activityId = hostedTaskActivities.get(taskId);
        if (activityId) {
          hostedTaskActivities.delete(taskId);
          endCreditActivity({ id: activityId, status: 'canceled' });
        }
        throw new Error('Canceled');
      }

      const task = await cloudAiService.getSunoMusicTaskStatus(taskId);
      onProgress?.(task);

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    finishHostedTask(taskId, 'failed');
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

      const idempotencyKey = body.idempotencyKey?.trim()
        || `hosted-chat:${Date.now()}:${crypto.randomUUID()}`;
      const activityId = `chat:${idempotencyKey}`;
      beginCreditActivity({ feature: 'AI chat', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
      try {
        const response = await cloudApi.ai.chat.create({ ...body, idempotencyKey });
        syncHostedCreditBalance(response, { activityId, source: 'hosted:ai_chat' });
        endCreditActivity({ id: activityId, status: response.ok ? 'completed' : 'failed' });
        return {
          decision,
          response,
        };
      } catch (error) {
        endCreditActivity({ id: activityId, status: 'failed' });
        throw error;
      }
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

      const idempotencyKey = body.idempotencyKey?.trim()
        || createHostedGenerationIdempotencyKey();
      const activityId = `generation:${idempotencyKey}`;
      beginCreditActivity({ feature: 'AI generation', id: activityId, targetId: 'flashboard-credit-activity-anchor' });
      try {
        const response = await cloudApi.ai.video.create({ ...body, idempotencyKey });
        syncHostedCreditBalance(response, { activityId, source: 'hosted:generation' });
        const task = response.data as { taskId?: string } | null;
        if (response.ok && task?.taskId) {
          registerHostedTask(task.taskId, activityId);
        } else {
          endCreditActivity({ id: activityId, status: 'failed' });
        }
        return {
          decision,
          response,
        };
      } catch (error) {
        endCreditActivity({ id: activityId, status: 'failed' });
        throw error;
      }
    },
    async status(taskId: string, access: AiAccessInput = { feature: 'video' }): Promise<CloudAiDispatchResult<CloudAiGatewayEnvelope>> {
      const decision = planAiAccess('video', access);

      if (decision.mode !== 'hosted') {
        return {
          decision,
          response: null,
        };
      }

      const response = await cloudApi.ai.video.status(taskId);
      syncHostedCreditBalance(response);
      const task = response.data as { refund?: unknown; status?: TaskStatus } | null;
      const refund = normalizeHostedRefund(task?.refund);
      applyHostedRefund(refund, hostedTaskActivities.get(taskId));
      if (task?.status === 'completed' || task?.status === 'failed') {
        finishHostedTask(taskId, task.status);
      }
      return {
        decision,
        response,
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
    syncHostedCreditBalance(response);
    const task = response.data as {
      completedAt?: string;
      createdAt?: string;
      error?: string;
      id?: string;
      imageUrl?: string;
      progress?: number;
      refund?: unknown;
      status?: TaskStatus;
      taskId?: string;
      videoUrl?: string;
    } | null;
    const progress = typeof task?.progress === 'number' && Number.isFinite(task.progress)
      ? Math.max(0, Math.min(1, task.progress))
      : undefined;
    const id = task?.id ?? task?.taskId ?? taskId;
    const status = task?.status ?? 'pending';
    const rawImageUrl = task?.imageUrl ?? task?.videoUrl;
    const rawVideoUrl = task?.videoUrl ?? task?.imageUrl;
    const imageUrl = status === 'completed' ? getHostedTaskDownloadUrl(id, rawImageUrl) : rawImageUrl;
    const videoUrl = status === 'completed' ? getHostedTaskDownloadUrl(id, rawVideoUrl) : rawVideoUrl;

    const refund = normalizeHostedRefund(task?.refund);
    applyHostedRefund(refund, hostedTaskActivities.get(taskId));
    if (status === 'completed' || status === 'failed') {
      finishHostedTask(taskId, status);
    }
    return {
      completedAt: task?.completedAt ? new Date(task.completedAt) : undefined,
      createdAt: task?.createdAt ? new Date(task.createdAt) : new Date(),
      error: task?.error,
      id,
      imageUrl,
      progress,
      refund,
      status,
      videoUrl,
    };
  },
  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 15000,
    timeout = 600000,
  ): Promise<VideoTask> {
    const startTime = Date.now();
    let transientFailures = 0;

    while (Date.now() - startTime < timeout) {
      let task: VideoTask;

      try {
        task = await cloudAiService.getTaskStatus(taskId);
        transientFailures = 0;
      } catch (error) {
        if (isTransientFetchError(error) && transientFailures < 4) {
          transientFailures += 1;
          await new Promise((resolve) => setTimeout(resolve, getPollingRetryDelay(pollInterval, transientFailures)));
          continue;
        }
        throw error;
      }

      if (onProgress) {
        onProgress(task);
      }

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    finishHostedTask(taskId, 'failed');
    throw new Error('Task timed out after 10 minutes');
  },
  plan: planAiAccess,
};
