// Kie.ai Service - Unified API for AI media generation via kie.ai
// Currently supports: Kling 3.0/Seedance 2.0 video and Nano Banana 2 images
// Docs: https://kie.ai

import type {
  AccountInfo,
  ImageToVideoParams,
  TextToVideoParams,
  VideoTask,
} from './piApiService';
import {
  calculateKieAiCost,
  getKieAiProvider,
  getKieAiProviders,
  type KieAiCostOptions,
} from './kieAi/catalog';
import { createTextToImageTask, type TextToImageParams } from './kieAi/imageCommands';
import { createKlingImageToVideo, createKlingTextToVideo } from './kieAi/klingCommands';
import { createKieAiMediaTools, type KieAiMediaTools } from './kieAi/mediaUpload';
import { createSeedanceVideoTask, isSeedance2Provider } from './kieAi/seedanceCommands';
import {
  createFluxKontextImageTask,
  createKieAiSpecialVideoTask,
  getFluxKontextImageTaskStatus,
  getKieAiSpecialVideoTaskKind,
  getKieAiSpecialVideoTaskStatus,
  isFluxKontextProvider,
  isKieAiSpecialVideoProvider,
  type KieAiSpecialVideoTaskKind,
} from './kieAi/specialCommands';
import { createKieAiTaskMonitor, type KieAiTaskMonitor } from './kieAi/statusPolling';
import { createKieAiTransport, type KieAiTransport } from './kieAi/transport';

export {
  calculateKieAiCost,
  getKieAiProvider,
  getKieAiProviders,
  type KieAiCostOptions,
  type TextToImageParams,
};

class KieAiService {
  private apiKey: string = '';
  private mediaTools: KieAiMediaTools;
  private transport: KieAiTransport;
  private taskMonitor: KieAiTaskMonitor;
  private imageTaskKinds = new Map<string, 'flux-kontext'>();
  private videoTaskKinds = new Map<string, KieAiSpecialVideoTaskKind>();

  constructor() {
    this.mediaTools = createKieAiMediaTools(
      () => this.apiKey,
      () => this.hasApiKey(),
    );
    this.transport = createKieAiTransport(
      () => this.apiKey,
      () => this.hasApiKey(),
    );
    this.taskMonitor = createKieAiTaskMonitor(this.transport.request);
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  async createTextToVideo(params: TextToVideoParams): Promise<string> {
    if (isKieAiSpecialVideoProvider(params.provider)) {
      const taskId = await createKieAiSpecialVideoTask(params, this.transport.request, this.mediaTools);
      const taskKind = getKieAiSpecialVideoTaskKind(params.provider);
      if (taskKind) {
        this.videoTaskKinds.set(taskId, taskKind);
      }
      return taskId;
    }

    if (isSeedance2Provider(params.provider)) {
      return createSeedanceVideoTask(params, this.transport.request, this.mediaTools);
    }

    return createKlingTextToVideo(params, this.transport.request, this.mediaTools);
  }

  async createTextToImage(params: TextToImageParams): Promise<string> {
    if (isFluxKontextProvider(params.provider)) {
      const taskId = await createFluxKontextImageTask(params, this.transport.request, this.mediaTools);
      this.imageTaskKinds.set(taskId, 'flux-kontext');
      return taskId;
    }

    return createTextToImageTask(params, this.transport.request, this.mediaTools);
  }

  async createImageToVideo(params: ImageToVideoParams): Promise<string> {
    if (isKieAiSpecialVideoProvider(params.provider)) {
      const taskId = await createKieAiSpecialVideoTask(params, this.transport.request, this.mediaTools);
      const taskKind = getKieAiSpecialVideoTaskKind(params.provider);
      if (taskKind) {
        this.videoTaskKinds.set(taskId, taskKind);
      }
      return taskId;
    }

    if (isSeedance2Provider(params.provider)) {
      return createSeedanceVideoTask(params, this.transport.request, this.mediaTools);
    }

    return createKlingImageToVideo(params, this.transport.request, this.mediaTools);
  }

  async getTaskStatus(taskId: string): Promise<VideoTask> {
    const specialTaskKind = this.videoTaskKinds.get(taskId);
    if (specialTaskKind) {
      const task = await getKieAiSpecialVideoTaskStatus(taskId, specialTaskKind, this.transport.request);
      if (task.status === 'completed' || task.status === 'failed') {
        this.videoTaskKinds.delete(taskId);
      }
      return task;
    }

    return this.taskMonitor.getTaskStatus(taskId);
  }

  async getImageTaskStatus(taskId: string): Promise<VideoTask> {
    if (this.imageTaskKinds.get(taskId) === 'flux-kontext') {
      const task = await getFluxKontextImageTaskStatus(taskId, this.transport.request);
      if (task.status === 'completed' || task.status === 'failed') {
        this.imageTaskKinds.delete(taskId);
      }
      return task;
    }

    return this.taskMonitor.getImageTaskStatus(taskId);
  }

  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 15000,
    timeout = 600000,
  ): Promise<VideoTask> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = await this.getTaskStatus(taskId);
      onProgress?.(task);

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
    timeout = 180000,
  ): Promise<VideoTask> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = await this.getImageTaskStatus(taskId);
      onProgress?.(task);

      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Image task timed out after 3 minutes');
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return this.transport.getAccountInfo();
  }
}

// Singleton instance
export const kieAiService = new KieAiService();
