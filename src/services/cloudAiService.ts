import { cloudApi, type CloudAiChatRequest, type CloudAiGatewayEnvelope, type CloudAiVideoRequest } from './cloudApi';
import { resolveAiAccess, type AiAccessDecision, type AiAccessInput } from './aiAccess';
import type {
  AccountInfo,
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

export const cloudAiService = {
  async createChatCompletion(body: Record<string, unknown>): Promise<unknown> {
    const response = await cloudApi.ai.chat.create(body as unknown as CloudAiChatRequest);
    return response.data ?? response;
  },
  async createImageToVideo(params: ImageToVideoParams): Promise<string> {
    const response = await cloudApi.ai.video.create({
      action: 'generate',
      params: {
        aspectRatio: params.aspectRatio,
        duration: params.duration,
        endImageUrl: params.endImageUrl,
        mode: params.mode as 'pro' | 'std' | undefined,
        multiPrompt: params.multiPrompt,
        multiShots: params.multiShots,
        prompt: params.prompt,
        sound: params.sound,
        startImageUrl: params.startImageUrl,
      },
    });
    const task = response.data as { taskId?: string } | null;

    if (!task?.taskId) {
      throw new Error('Hosted Kling generation did not return a task id');
    }

    return task.taskId;
  },
  async createTextToVideo(params: TextToVideoParams): Promise<string> {
    const response = await cloudApi.ai.video.create({
      action: 'generate',
      params: {
        aspectRatio: params.aspectRatio,
        duration: params.duration,
        mode: params.mode as 'pro' | 'std' | undefined,
        multiPrompt: params.multiPrompt,
        multiShots: params.multiShots,
        prompt: params.prompt,
        sound: params.sound,
      },
    });
    const task = response.data as { taskId?: string } | null;

    if (!task?.taskId) {
      throw new Error('Hosted Kling generation did not return a task id');
    }

    return task.taskId;
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
      status?: TaskStatus;
      taskId?: string;
      videoUrl?: string;
    } | null;

    return {
      completedAt: task?.completedAt ? new Date(task.completedAt) : undefined,
      createdAt: task?.createdAt ? new Date(task.createdAt) : new Date(),
      error: task?.error,
      id: task?.id ?? task?.taskId ?? taskId,
      status: task?.status ?? 'pending',
      videoUrl: task?.videoUrl,
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
