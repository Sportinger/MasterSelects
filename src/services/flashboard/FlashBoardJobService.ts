import { Logger } from '../logger';
import type { GenerationReferenceMedia } from '../aiGenerationContracts';
import type {
  FlashBoardGenerationOutput,
  FlashBoardGenerationRequest,
  FlashBoardJobRefund,
  FlashBoardMediaType,
} from '../../stores/flashboardStore/types';
import type { SubmitGenerationJobInput, SubmitGenerationJobResult } from './types';
import { useMediaStore } from '../../stores/mediaStore';
import { createThumbnail } from '../../stores/mediaStore/helpers/thumbnailHelpers';
import {
  resumeFlashBoardProviderJob,
  runFlashBoardProviderJob,
  type FlashBoardProviderAsset,
} from './FlashBoardProviderRunners';

const log = Logger.create('FlashBoardJob');
export const FLASHBOARD_CANCEL_REQUESTED_ERROR =
  'Cancellation requested. Provider processing and billing may continue.';

export type FlashBoardCancelDisposition =
  | 'canceled-before-submission'
  | 'cancel-requested'
  | 'not-found';

export interface FlashBoardCancelResult {
  billingMayContinue: boolean;
  disposition: FlashBoardCancelDisposition;
  recordId: string;
  remoteTaskId?: string;
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
  startedAt?: number;
  error?: string;
  assetUrl?: string;
  assetFile?: File;
  mediaType?: FlashBoardMediaType;
  assets?: FlashBoardProviderAsset[];
  outputs?: FlashBoardGenerationOutput[];
  refund?: FlashBoardJobRefund;
}) => void;

class FlashBoardJobService {
  private queue: QueueEntry[] = [];
  private running: RunningJob[] = [];
  private maxConcurrent = 100;
  private onUpdate: JobUpdateCallback | null = null;

  setUpdateCallback(cb: JobUpdateCallback | null): void {
    this.onUpdate = cb;
  }

  submit(input: SubmitGenerationJobInput): SubmitGenerationJobResult | null {
    const queued = this.queue.find((entry) => entry.recordId === input.recordId);
    if (queued) return { recordId: queued.recordId };
    const running = this.running.find((entry) => entry.recordId === input.recordId);
    if (running) {
      return {
        recordId: running.recordId,
        ...(running.remoteTaskId ? { remoteTaskId: running.remoteTaskId } : {}),
      };
    }

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

  cancel(recordId: string): FlashBoardCancelResult {
    const queueIdx = this.queue.findIndex(e => e.recordId === recordId);
    if (queueIdx >= 0) {
      this.queue.splice(queueIdx, 1);
      this.onUpdate?.(recordId, { status: 'canceled' });
      return {
        billingMayContinue: false,
        disposition: 'canceled-before-submission',
        recordId,
      };
    }
    const running = this.running.find(r => r.recordId === recordId);
    if (running) {
      running.abortController.abort();
      this.running = this.running.filter(r => r.recordId !== recordId);
      this.onUpdate?.(recordId, {
        status: 'processing',
        error: FLASHBOARD_CANCEL_REQUESTED_ERROR,
        ...(running.remoteTaskId ? { remoteTaskId: running.remoteTaskId } : {}),
      });
      this.processQueue();
      return {
        billingMayContinue: true,
        disposition: 'cancel-requested',
        recordId,
        ...(running.remoteTaskId ? { remoteTaskId: running.remoteTaskId } : {}),
      };
    }
    return {
      billingMayContinue: true,
      disposition: 'not-found',
      recordId,
    };
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

    const request = input.request;
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
    if (service !== 'cloud') return true;
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
    const request = entry.request;
    this.running.push({
      recordId,
      service: request.service,
      abortController,
    });

    try {
      const result = await runFlashBoardProviderJob({
        recordId,
        request,
        abortController,
        registerRunningJob: (remoteTaskId) => {
          this.running = this.running.map((job) => (
            job.recordId === recordId ? { ...job, remoteTaskId } : job
          ));
          this.onUpdate?.(recordId, {
            status: 'processing',
            remoteTaskId,
          });
        },
        onProcessing: (update) => {
          this.onUpdate?.(recordId, update);
        },
        resolveReferenceImage: (mediaFileId) => this.resolveReferenceImage(mediaFileId),
        resolveHostedReferenceMedia: (mediaFileId) => this.resolveHostedReferenceMedia(mediaFileId),
      });
      this.running = this.running.filter(r => r.recordId !== recordId);
      if (result) {
        this.onUpdate?.(recordId, result);
      }
    } catch (err: unknown) {
      this.running = this.running.filter(r => r.recordId !== recordId);
      if (!abortController.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`Job failed for record ${recordId}:`, message);
        this.onUpdate?.(recordId, { status: 'failed', error: message });
      }
    }

    this.processQueue();
  }

  private async resumeJob(input: {
    recordId: string;
    request: FlashBoardGenerationRequest;
    remoteTaskId: string;
    abortController: AbortController;
  }): Promise<void> {
    const { recordId, remoteTaskId, abortController } = input;
    const request = input.request;

    try {
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
