import { Logger } from '../logger';
import type { GenerationReferenceMedia } from '../piApiService';
import type { FlashBoardGenerationRequest, FlashBoardJobRefund, FlashBoardMediaType } from '../../stores/flashboardStore/types';
import type { SubmitGenerationJobInput, SubmitGenerationJobResult } from './types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMediaStore } from '../../stores/mediaStore';
import { createThumbnail } from '../../stores/mediaStore/helpers/thumbnailHelpers';
import { resumeFlashBoardProviderJob, runFlashBoardProviderJob } from './FlashBoardProviderRunners';

const log = Logger.create('FlashBoardJob');

function shouldUsePersonalApiKey(provider: 'piapi' | 'kieai' | 'evolink' | 'elevenlabs'): boolean {
  if (import.meta.env.PROD) {
    return false;
  }

  return useSettingsStore.getState().shouldUseApiKeyByDefault(provider);
}

function resolveEffectiveRequest(request: FlashBoardGenerationRequest): FlashBoardGenerationRequest {
  if (request.service === 'kieai') {
    return {
      ...request,
      providerId: request.providerId === 'kling-3.0' ? 'cloud-kling' : request.providerId,
      service: 'cloud',
      version: 'latest',
    };
  }

  if (request.service === 'elevenlabs') {
    return {
      ...request,
      providerId: 'cloud-elevenlabs-tts',
      service: 'cloud',
    };
  }

  if (request.service === 'suno') {
    return {
      ...request,
      service: 'cloud',
    };
  }

  return request;
}

function assertPersonalApiKeyAccess(request: FlashBoardGenerationRequest): void {
  if (request.service === 'piapi' && !shouldUsePersonalApiKey('piapi')) {
    throw new Error('Enable a PiAPI key as default in Settings to generate with PiAPI.');
  }

  if (request.service === 'kieai' && !shouldUsePersonalApiKey('kieai')) {
    throw new Error('Enable a Kie.ai key as default in Settings to generate with Kie.ai.');
  }

  if (request.service === 'evolink' && !shouldUsePersonalApiKey('evolink')) {
    throw new Error('Enable an EvoLink key as default in Settings to generate with EvoLink.');
  }

  if (request.service === 'elevenlabs' && !shouldUsePersonalApiKey('elevenlabs')) {
    throw new Error('Enable an ElevenLabs key as default in Settings to generate speech with ElevenLabs.');
  }

  if (request.service === 'suno' && !shouldUsePersonalApiKey('kieai')) {
    throw new Error('Enable a Kie.ai key as default in Settings to generate with Suno.');
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read media as data URL'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read media'));
    reader.readAsDataURL(blob);
  });
}

interface QueueEntry {
  recordId: string;
  request: FlashBoardGenerationRequest;
  abortController: AbortController;
}

interface RunningJob {
  recordId: string;
  remoteTaskId?: string;
  service: FlashBoardGenerationRequest['service'];
  abortController: AbortController;
}

type JobUpdateCallback = (recordId: string, update: {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  error?: string;
  assetUrl?: string;
  assetFile?: File;
  mediaType?: FlashBoardMediaType;
  refund?: FlashBoardJobRefund;
}) => void;

class FlashBoardJobService {
  private queue: QueueEntry[] = [];
  private running: RunningJob[] = [];
  private maxConcurrent = 3;
  private maxConcurrentKieAi = 1;
  private maxConcurrentEvolink = 1;
  private maxConcurrentElevenLabs = 2;
  private onUpdate: JobUpdateCallback | null = null;

  setUpdateCallback(cb: JobUpdateCallback | null): void {
    this.onUpdate = cb;
  }

  submit(input: SubmitGenerationJobInput): SubmitGenerationJobResult | null {
    const entry: QueueEntry = {
      recordId: input.recordId,
      request: input.request,
      abortController: new AbortController(),
    };
    this.queue.push(entry);
    this.onUpdate?.(input.recordId, { status: 'queued' });
    this.processQueue();
    return null;
  }

  cancel(recordId: string): void {
    const queueIdx = this.queue.findIndex(e => e.recordId === recordId);
    if (queueIdx >= 0) {
      this.queue.splice(queueIdx, 1);
      this.onUpdate?.(recordId, { status: 'canceled' });
      return;
    }
    const running = this.running.find(r => r.recordId === recordId);
    if (running) {
      running.abortController.abort();
      this.running = this.running.filter(r => r.recordId !== recordId);
      this.onUpdate?.(recordId, { status: 'canceled' });
      this.processQueue();
    }
  }

  hasJob(recordId: string): boolean {
    return this.queue.some((job) => job.recordId === recordId)
      || this.running.some((job) => job.recordId === recordId);
  }

  retry(recordId: string, request: FlashBoardGenerationRequest): void {
    this.submit({ recordId, request });
  }

  resume(input: { recordId: string; request: FlashBoardGenerationRequest; remoteTaskId: string }): void {
    if (
      this.running.some((job) => job.recordId === input.recordId)
      || this.queue.some((job) => job.recordId === input.recordId)
    ) {
      return;
    }

    const request = resolveEffectiveRequest(input.request);
    const abortController = new AbortController();
    this.running.push({
      recordId: input.recordId,
      remoteTaskId: input.remoteTaskId,
      service: request.service,
      abortController,
    });
    this.onUpdate?.(input.recordId, { status: 'processing', remoteTaskId: input.remoteTaskId });
    void this.resumeJob({
      recordId: input.recordId,
      request,
      remoteTaskId: input.remoteTaskId,
      abortController,
    });
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
    if (service === 'evolink') {
      const evolinkRunning = this.running.filter(r => r.service === 'evolink').length;
      if (evolinkRunning >= this.maxConcurrentEvolink) return false;
    }
    if (service === 'elevenlabs') {
      const elevenLabsRunning = this.running.filter(r => r.service === 'elevenlabs').length;
      if (elevenLabsRunning >= this.maxConcurrentElevenLabs) return false;
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

  private async normalizeImageSourceForUpload(url: string): Promise<string> {
    if (url.startsWith('data:') || /^https?:\/\//i.test(url)) {
      return url;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to read reference image: ${response.status}`);
    }

    return blobToDataUrl(await response.blob());
  }

  private async normalizeMediaSourceForHostedUpload(url: string): Promise<string> {
    if (url.startsWith('data:') || /^https?:\/\//i.test(url)) {
      return url;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to read reference media: ${response.status}`);
    }

    return blobToDataUrl(await response.blob());
  }

  private async resolveReferenceImage(mediaFileId: string | undefined): Promise<string | undefined> {
    if (!mediaFileId) {
      return undefined;
    }

    const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);

    if (!mediaFile) {
      throw new Error('Reference media not found');
    }

    if (mediaFile.type === 'image') {
      if (mediaFile.file) {
        return blobToDataUrl(mediaFile.file);
      }

      return this.normalizeImageSourceForUpload(mediaFile.url);
    }

    if (mediaFile.type === 'video') {
      if (mediaFile.thumbnailUrl) {
        return this.normalizeImageSourceForUpload(mediaFile.thumbnailUrl);
      }

      if (mediaFile.file) {
        const thumbnailUrl = await createThumbnail(mediaFile.file, 'video');
        if (thumbnailUrl) {
          useMediaStore.setState((state) => ({
            files: state.files.map((file) => (
              file.id === mediaFile.id ? { ...file, thumbnailUrl } : file
            )),
          }));
          return this.normalizeImageSourceForUpload(thumbnailUrl);
        }
      }

      throw new Error('Reference video has no preview frame available');
    }

    throw new Error('Image generation can only use image references or video preview frames');
  }

  private resolveReferenceMedia(mediaFileId: string): GenerationReferenceMedia {
    const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);

    if (!mediaFile) {
      throw new Error('Reference media not found');
    }

    if (mediaFile.type !== 'image' && mediaFile.type !== 'video' && mediaFile.type !== 'audio') {
      throw new Error('Reference media must be an image, video, or audio file');
    }

    const source = mediaFile.file ?? mediaFile.url;
    if (!source) {
      throw new Error('Reference media has no readable file source');
    }

    return {
      id: mediaFile.id,
      mediaType: mediaFile.type,
      source,
      fileName: mediaFile.file?.name ?? mediaFile.name,
      label: mediaFile.name,
      mimeType: mediaFile.file?.type,
    };
  }

  private async resolveHostedReferenceMedia(mediaFileId: string): Promise<GenerationReferenceMedia> {
    const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);

    if (!mediaFile) {
      throw new Error('Reference media not found');
    }

    if (mediaFile.type !== 'image' && mediaFile.type !== 'video' && mediaFile.type !== 'audio') {
      throw new Error('Reference media must be an image, video, or audio file');
    }

    const source = mediaFile.file
      ? await blobToDataUrl(mediaFile.file)
      : mediaFile.url
        ? await this.normalizeMediaSourceForHostedUpload(mediaFile.url)
        : undefined;

    if (!source) {
      throw new Error('Reference media has no readable file source');
    }

    return {
      id: mediaFile.id,
      mediaType: mediaFile.type,
      source,
      fileName: mediaFile.file?.name ?? mediaFile.name,
      label: mediaFile.name,
      mimeType: mediaFile.file?.type,
    };
  }

  private async startJob(entry: QueueEntry): Promise<void> {
    const { recordId, abortController } = entry;
    const request = resolveEffectiveRequest(entry.request);
    this.running.push({
      recordId,
      service: request.service,
      abortController,
    });

    try {
      this.onUpdate?.(recordId, { status: 'processing' });
      assertPersonalApiKeyAccess(request);

      const result = await runFlashBoardProviderJob({
        recordId,
        request,
        abortController,
        registerRunningJob: (remoteTaskId) => {
          this.running = this.running.map((job) => (
            job.recordId === recordId ? { ...job, remoteTaskId } : job
          ));
        },
        onProcessing: (update) => {
          this.onUpdate?.(recordId, update);
        },
        resolveReferenceImage: (mediaFileId) => this.resolveReferenceImage(mediaFileId),
        resolveReferenceMedia: (mediaFileId) => this.resolveReferenceMedia(mediaFileId),
        resolveHostedReferenceMedia: (mediaFileId) => this.resolveHostedReferenceMedia(mediaFileId),
      });
      this.running = this.running.filter(r => r.recordId !== recordId);
      if (result) {
        this.onUpdate?.(recordId, result);
      }
    } catch (err: unknown) {
      this.running = this.running.filter(r => r.recordId !== recordId);
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error(`Job failed for record ${recordId}:`, message);
      this.onUpdate?.(recordId, { status: 'failed', error: message });
    }

    this.processQueue();
  }

  private async resumeJob(input: {
    recordId: string;
    request: FlashBoardGenerationRequest;
    remoteTaskId: string;
    abortController: AbortController;
  }): Promise<void> {
    const { recordId, request, remoteTaskId, abortController } = input;

    try {
      assertPersonalApiKeyAccess(request);
      const result = await resumeFlashBoardProviderJob({
        request,
        remoteTaskId,
        abortController,
        onProcessing: (update) => {
          this.onUpdate?.(recordId, update);
        },
      });
      this.running = this.running.filter(r => r.recordId !== recordId);
      if (result) {
        this.onUpdate?.(recordId, result);
      }
    } catch (err: unknown) {
      this.running = this.running.filter(r => r.recordId !== recordId);
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error(`Job resume failed for record ${recordId}:`, message);
      this.onUpdate?.(recordId, { status: 'failed', error: message, remoteTaskId });
    }

    this.processQueue();
  }
}

export const flashBoardJobService = new FlashBoardJobService();
