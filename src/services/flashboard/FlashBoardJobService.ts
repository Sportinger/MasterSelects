import { Logger } from '../logger';
import { piApiService } from '../piApiService';
import { kieAiService } from '../kieAiService';
import { cloudAiService } from '../cloudAiService';
import type { TextToVideoParams, ImageToVideoParams } from '../piApiService';
import type { FlashBoardGenerationRequest } from '../../stores/flashboardStore/types';
import type { SubmitNodeJobInput, SubmitNodeJobResult } from './types';
import { useSettingsStore } from '../../stores/settingsStore';

const log = Logger.create('FlashBoardJob');

interface QueueEntry {
  nodeId: string;
  request: FlashBoardGenerationRequest;
  abortController: AbortController;
}

interface RunningJob {
  nodeId: string;
  remoteTaskId: string;
  service: FlashBoardGenerationRequest['service'];
  abortController: AbortController;
}

type JobUpdateCallback = (nodeId: string, update: {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  error?: string;
  assetUrl?: string;
  mediaType?: 'video' | 'image';
}) => void;

class FlashBoardJobService {
  private queue: QueueEntry[] = [];
  private running: RunningJob[] = [];
  private maxConcurrent = 3;
  private maxConcurrentKieAi = 1;
  private onUpdate: JobUpdateCallback | null = null;

  setUpdateCallback(cb: JobUpdateCallback | null): void {
    this.onUpdate = cb;
  }

  submit(input: SubmitNodeJobInput): SubmitNodeJobResult | null {
    const entry: QueueEntry = {
      nodeId: input.nodeId,
      request: input.request,
      abortController: new AbortController(),
    };
    this.queue.push(entry);
    this.onUpdate?.(input.nodeId, { status: 'queued' });
    this.processQueue();
    return null;
  }

  cancel(nodeId: string): void {
    const queueIdx = this.queue.findIndex(e => e.nodeId === nodeId);
    if (queueIdx >= 0) {
      this.queue.splice(queueIdx, 1);
      this.onUpdate?.(nodeId, { status: 'canceled' });
      return;
    }
    const running = this.running.find(r => r.nodeId === nodeId);
    if (running) {
      running.abortController.abort();
      this.running = this.running.filter(r => r.nodeId !== nodeId);
      this.onUpdate?.(nodeId, { status: 'canceled' });
      this.processQueue();
    }
  }

  retry(nodeId: string, request: FlashBoardGenerationRequest): void {
    this.submit({ nodeId, request });
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getRunningCount(): number {
    return this.running.length;
  }

  private canStartJob(service: FlashBoardGenerationRequest['service']): boolean {
    if (this.running.length >= this.maxConcurrent) return false;
    if (service === 'kieai') {
      const kieaiRunning = this.running.filter(r => r.service === 'kieai').length;
      if (kieaiRunning >= this.maxConcurrentKieAi) return false;
    }
    return true;
  }

  private processQueue(): void {
    while (this.queue.length > 0) {
      const next = this.queue.find(e => this.canStartJob(e.request.service));
      if (!next) break;
      this.queue = this.queue.filter(e => e !== next);
      this.startJob(next);
    }
  }

  private async startJob(entry: QueueEntry): Promise<void> {
    const { nodeId, request, abortController } = entry;

    try {
      this.onUpdate?.(nodeId, { status: 'processing' });

      const { piapi, kieai } = useSettingsStore.getState().apiKeys;
      if (request.service === 'piapi') {
        piApiService.setApiKey(piapi);
      }
      if (request.service === 'kieai') {
        kieAiService.setApiKey(kieai);
      }

      if (request.outputType === 'image' || request.providerId === 'nano-banana-2') {
        if (request.service !== 'kieai') {
          throw new Error(`${request.providerId} is currently only supported via Kie.ai`);
        }

        const remoteTaskId = await kieAiService.createTextToImage({
          provider: request.providerId,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          resolution: request.imageSize,
          outputFormat: 'png',
        });

        this.running.push({
          nodeId,
          remoteTaskId,
          service: request.service,
          abortController,
        });
        this.onUpdate?.(nodeId, { status: 'processing', remoteTaskId });

        const result = await kieAiService.pollImageTaskUntilComplete(
          remoteTaskId,
          (task) => {
            if (abortController.signal.aborted) throw new Error('Canceled');
            this.onUpdate?.(nodeId, { status: 'processing', progress: task.progress, remoteTaskId });
          },
          5000,
        );

        this.running = this.running.filter(r => r.nodeId !== nodeId);
        if (result.status === 'completed' && result.imageUrl) {
          this.onUpdate?.(nodeId, {
            status: 'completed',
            assetUrl: result.imageUrl,
            mediaType: 'image',
            remoteTaskId,
          });
        } else {
          this.onUpdate?.(nodeId, {
            status: 'failed',
            error: result.error || 'Image generation failed',
            remoteTaskId,
          });
        }
        this.processQueue();
        return;
      }

      const hasStartImage = !!request.startMediaFileId;
      const isTextToVideo = !hasStartImage;

      let remoteTaskId: string;

      if (isTextToVideo) {
        const params: TextToVideoParams = {
          provider: request.providerId,
          version: request.version,
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
          duration: request.duration || 5,
          aspectRatio: request.aspectRatio || '16:9',
          mode: request.mode || 'std',
          sound: request.generateAudio,
        };

        if (request.service === 'piapi') {
          remoteTaskId = await piApiService.createTextToVideo(params);
        } else if (request.service === 'kieai') {
          remoteTaskId = await kieAiService.createTextToVideo(params);
        } else {
          remoteTaskId = await cloudAiService.createTextToVideo(params);
        }
      } else {
        const params: ImageToVideoParams = {
          provider: request.providerId,
          version: request.version,
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
          duration: request.duration || 5,
          aspectRatio: request.aspectRatio || '16:9',
          mode: request.mode || 'std',
          sound: request.generateAudio,
        };

        if (request.service === 'piapi') {
          remoteTaskId = await piApiService.createImageToVideo(params);
        } else if (request.service === 'kieai') {
          remoteTaskId = await kieAiService.createImageToVideo(params);
        } else {
          remoteTaskId = await cloudAiService.createImageToVideo(params);
        }
      }

      const runningJob: RunningJob = {
        nodeId,
        remoteTaskId,
        service: request.service,
        abortController,
      };
      this.running.push(runningJob);
      this.onUpdate?.(nodeId, { status: 'processing', remoteTaskId });

      const pollInterval = request.service === 'piapi' ? 5000 : 15000;
      const service = request.service === 'piapi'
        ? piApiService
        : request.service === 'kieai'
          ? kieAiService
          : cloudAiService;

      const task = await service.pollTaskUntilComplete(
        remoteTaskId,
        (t) => {
          if (abortController.signal.aborted) throw new Error('Canceled');
          this.onUpdate?.(nodeId, { status: 'processing', progress: t.progress });
        },
        pollInterval,
      );

      this.running = this.running.filter(r => r.nodeId !== nodeId);

      if (task.status === 'completed' && task.videoUrl) {
        this.onUpdate?.(nodeId, { status: 'completed', assetUrl: task.videoUrl, mediaType: 'video' });
      } else if (task.status === 'failed') {
        this.onUpdate?.(nodeId, { status: 'failed', error: task.error || 'Generation failed' });
      }
    } catch (err: unknown) {
      this.running = this.running.filter(r => r.nodeId !== nodeId);
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error(`Job failed for node ${nodeId}:`, message);
      this.onUpdate?.(nodeId, { status: 'failed', error: message });
    }

    this.processQueue();
  }
}

export const flashBoardJobService = new FlashBoardJobService();
