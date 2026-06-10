import type { TaskStatus, VideoTask } from '../piApiService';
import type { KieAiStatusResponse } from './apiContracts';
import { log } from './log';
import type { KieAiRequest } from './transport';

function normalizeKieTaskStatus(state: string | undefined): TaskStatus {
  switch ((state ?? '').trim().toLowerCase()) {
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

function createBaseTask(taskId: string, result: KieAiStatusResponse): VideoTask {
  return {
    id: taskId,
    status: normalizeKieTaskStatus(result.data?.state),
    progress: normalizeKieProgress(result.data?.progress),
    error: result.data?.failMsg,
    createdAt: result.data?.createTime ? new Date(result.data.createTime) : new Date(),
  };
}

function readFirstResultUrl(result: KieAiStatusResponse, warning: string): string | undefined {
  if (result.data?.resultUrls?.length) {
    return result.data.resultUrls[0];
  }

  if (result.data?.resultJson) {
    try {
      const parsed = JSON.parse(result.data.resultJson);
      if (parsed.resultUrls?.length) {
        return parsed.resultUrls[0];
      }
    } catch {
      log.warn(warning, result.data.resultJson);
    }
  }

  return undefined;
}

export interface KieAiTaskMonitor {
  getTaskStatus: (taskId: string) => Promise<VideoTask>;
  getImageTaskStatus: (taskId: string) => Promise<VideoTask>;
  pollTaskUntilComplete: (
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval?: number,
    timeout?: number,
  ) => Promise<VideoTask>;
  pollImageTaskUntilComplete: (
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval?: number,
    timeout?: number,
  ) => Promise<VideoTask>;
}

export function createKieAiTaskMonitor(request: KieAiRequest): KieAiTaskMonitor {
  const getTaskStatus = async (taskId: string): Promise<VideoTask> => {
    const result = await request<KieAiStatusResponse>(
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      'GET'
    );

    const task = createBaseTask(taskId, result);

    if (task.status === 'completed') {
      task.videoUrl = readFirstResultUrl(result, 'Failed to parse resultJson:');
      task.completedAt = result.data?.completeTime ? new Date(result.data.completeTime) : new Date();
    }

    return task;
  };

  const getImageTaskStatus = async (taskId: string): Promise<VideoTask> => {
    const result = await request<KieAiStatusResponse>(
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      'GET'
    );

    const task = createBaseTask(taskId, result);

    if (task.status === 'completed') {
      task.imageUrl = readFirstResultUrl(result, 'Failed to parse image resultJson:');
      task.completedAt = result.data?.completeTime ? new Date(result.data.completeTime) : new Date();
    }

    return task;
  };

  return {
    getTaskStatus,
    getImageTaskStatus,
    pollTaskUntilComplete: async (
      taskId,
      onProgress,
      pollInterval = 15000,
      timeout = 600000,
    ) => {
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const task = await getTaskStatus(taskId);

        if (onProgress) {
          onProgress(task);
        }

        if (task.status === 'completed' || task.status === 'failed') {
          return task;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      throw new Error('Task timed out after 10 minutes');
    },
    pollImageTaskUntilComplete: async (
      taskId,
      onProgress,
      pollInterval = 5000,
      timeout = 180000,
    ) => {
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const task = await getImageTaskStatus(taskId);

        if (onProgress) {
          onProgress(task);
        }

        if (task.status === 'completed' || task.status === 'failed') {
          return task;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      throw new Error('Image task timed out after 3 minutes');
    },
  };
}
