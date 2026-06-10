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
    if (isSeedance2Provider(params.provider)) {
      return createSeedanceVideoTask(params, this.transport.request, this.mediaTools);
    }

    return createKlingTextToVideo(params, this.transport.request, this.mediaTools);
  }

  async createTextToImage(params: TextToImageParams): Promise<string> {
    return createTextToImageTask(params, this.transport.request, this.mediaTools);
  }

  async createImageToVideo(params: ImageToVideoParams): Promise<string> {
    if (isSeedance2Provider(params.provider)) {
      return createSeedanceVideoTask(params, this.transport.request, this.mediaTools);
    }

    return createKlingImageToVideo(params, this.transport.request, this.mediaTools);
  }

  async getTaskStatus(taskId: string): Promise<VideoTask> {
    return this.taskMonitor.getTaskStatus(taskId);
  }

  async getImageTaskStatus(taskId: string): Promise<VideoTask> {
    return this.taskMonitor.getImageTaskStatus(taskId);
  }

  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 15000,
    timeout = 600000,
  ): Promise<VideoTask> {
    return this.taskMonitor.pollTaskUntilComplete(taskId, onProgress, pollInterval, timeout);
  }

  async pollImageTaskUntilComplete(
    taskId: string,
    onProgress?: (task: VideoTask) => void,
    pollInterval = 5000,
    timeout = 180000,
  ): Promise<VideoTask> {
    return this.taskMonitor.pollImageTaskUntilComplete(taskId, onProgress, pollInterval, timeout);
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return this.transport.getAccountInfo();
  }
}

// Singleton instance
export const kieAiService = new KieAiService();
