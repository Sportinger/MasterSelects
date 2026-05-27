import { Logger } from '../logger';
import { piApiService } from '../piApiService';
import { kieAiService } from '../kieAiService';
import { cloudAiService } from '../cloudAiService';
import type { TextToVideoParams, ImageToVideoParams, GenerationReferenceMedia } from '../piApiService';
import type { FlashBoardGenerationRequest, FlashBoardMediaType } from '../../stores/flashboardStore/types';
import type { SubmitNodeJobInput, SubmitNodeJobResult } from './types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMediaStore } from '../../stores/mediaStore';
import { createThumbnail } from '../../stores/mediaStore/helpers/thumbnailHelpers';
import { getCatalogEntry } from './FlashBoardModelCatalog';
import { getFlashBoardImageProvider } from './FlashBoardImageProviders';
import {
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT,
  ELEVENLABS_MP3_MIME_TYPE,
  elevenLabsService,
  isElevenLabsMp3OutputFormat,
} from '../elevenLabsService';
import { SUNO_PROVIDER_ID, sunoService } from '../sunoService';

const log = Logger.create('FlashBoardJob');

function shouldUsePersonalApiKey(provider: 'piapi' | 'kieai' | 'evolink' | 'elevenlabs'): boolean {
  return useSettingsStore.getState().shouldUseApiKeyByDefault(provider);
}

function resolveEffectiveRequest(request: FlashBoardGenerationRequest): FlashBoardGenerationRequest {
  if (request.service === 'kieai' && !shouldUsePersonalApiKey('kieai')) {
    if (request.providerId === 'kling-3.0') {
      return {
        ...request,
        providerId: 'cloud-kling',
        service: 'cloud',
        version: 'latest',
      };
    }

    if (request.providerId === 'nano-banana-2') {
      return {
        ...request,
        service: 'cloud',
        version: 'latest',
      };
    }
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
    throw new Error('Enable a Kie.ai key as default in Settings to generate music with Suno.');
  }
}

function sanitizeForFilename(value: string, maxLen = 32): string {
  return value
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen)
    .replace(/_$/, '')
    .toLowerCase() || 'untitled';
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
  nodeId: string;
  request: FlashBoardGenerationRequest;
  abortController: AbortController;
}

interface RunningJob {
  nodeId: string;
  remoteTaskId?: string;
  service: FlashBoardGenerationRequest['service'];
  abortController: AbortController;
}

type JobUpdateCallback = (nodeId: string, update: {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
  remoteTaskId?: string;
  progress?: number;
  error?: string;
  assetUrl?: string;
  assetFile?: File;
  mediaType?: FlashBoardMediaType;
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

  private async startJob(entry: QueueEntry): Promise<void> {
    const { nodeId, abortController } = entry;
    const request = resolveEffectiveRequest(entry.request);

    try {
      this.onUpdate?.(nodeId, { status: 'processing' });
      assertPersonalApiKeyAccess(request);

      const { piapi, kieai, evolink, elevenlabs } = useSettingsStore.getState().apiKeys;
      if (request.service === 'piapi') {
        piApiService.setApiKey(piapi);
      }
      if (request.service === 'kieai') {
        kieAiService.setApiKey(kieai);
      }
      if (request.service === 'evolink') {
        getFlashBoardImageProvider('evolink')?.setApiKey?.(evolink);
      }
      if (request.service === 'suno') {
        sunoService.setApiKey(kieai);
      }
      if (request.service === 'elevenlabs') {
        elevenLabsService.setApiKey(elevenlabs);
      }

      const isSunoMusicRequest = request.service === 'suno' || request.providerId === SUNO_PROVIDER_ID;
      if (isSunoMusicRequest) {
        if (!request.prompt.trim()) {
          throw new Error('Describe the music before generating with Suno.');
        }

        const remoteTaskId = await sunoService.createMusic({
          audioWeight: request.sunoAudioWeight,
          customMode: request.sunoCustomMode,
          instrumental: request.sunoInstrumental,
          model: request.version,
          negativeTags: request.sunoNegativeTags,
          prompt: request.prompt,
          style: request.sunoStyle,
          styleWeight: request.sunoStyleWeight,
          title: request.sunoTitle,
          vocalGender: request.sunoVocalGender,
          weirdnessConstraint: request.sunoWeirdnessConstraint,
        }, abortController.signal);

        this.running.push({
          nodeId,
          remoteTaskId,
          service: request.service,
          abortController,
        });
        this.onUpdate?.(nodeId, { status: 'processing', progress: 0.05, remoteTaskId });

        const task = await sunoService.pollMusicTaskUntilComplete(
          remoteTaskId,
          (currentTask) => {
            if (abortController.signal.aborted) throw new Error('Canceled');
            this.onUpdate?.(nodeId, {
              status: 'processing',
              progress: currentTask.progress,
              remoteTaskId,
            });
          },
          10000,
          900000,
          abortController.signal,
        );

        this.running = this.running.filter(r => r.nodeId !== nodeId);
        const audioUrl = task.results?.[0]?.audioUrl;
        if (task.status === 'completed' && audioUrl) {
          this.onUpdate?.(nodeId, {
            status: 'completed',
            progress: 1,
            remoteTaskId,
            assetUrl: audioUrl,
            mediaType: 'audio',
          });
        } else {
          this.onUpdate?.(nodeId, {
            status: 'failed',
            error: task.error || 'Suno generation finished without an audio URL.',
            remoteTaskId,
          });
        }
        this.processQueue();
        return;
      }

      if (request.outputType === 'audio' || request.service === 'elevenlabs') {
        if (request.service !== 'elevenlabs' && request.service !== 'cloud') {
          throw new Error('Audio generation is currently only supported through ElevenLabs and Suno');
        }
        if (!request.voiceId?.trim()) {
          throw new Error('Choose an ElevenLabs voice before generating speech.');
        }
        if (!request.prompt.trim()) {
          throw new Error('Enter text to generate speech.');
        }

        const remoteTaskId = `elevenlabs-${nodeId}`;
        this.running.push({
          nodeId,
          remoteTaskId,
          service: request.service,
          abortController,
        });
        this.onUpdate?.(nodeId, { status: 'processing', progress: 0.1, remoteTaskId });

        const outputFormat = request.outputFormat && isElevenLabsMp3OutputFormat(request.outputFormat)
          ? request.outputFormat
          : DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT;
        const speechParams = {
          voiceId: request.voiceId,
          text: request.prompt,
          modelId: request.version,
          languageCode: request.languageOverride ? request.languageCode : undefined,
          outputFormat,
          voiceSettings: request.voiceSettings,
        };
        const speech = request.service === 'cloud'
          ? await cloudAiService.createElevenLabsSpeech(
              speechParams,
              `flashboard-audio:${nodeId}:${Date.now()}`,
              abortController.signal,
            )
          : await elevenLabsService.createSpeech(speechParams, abortController.signal);
        const voiceSlug = sanitizeForFilename(request.voiceName || request.voiceId, 24);
        const promptSlug = sanitizeForFilename(request.prompt, 32);
        const timestamp = Date.now();
        const file = new File(
          [speech.audio],
          `ai_voice_${voiceSlug}_${promptSlug}_${timestamp}.${speech.extension}`,
          { type: speech.mimeType || ELEVENLABS_MP3_MIME_TYPE },
        );

        this.running = this.running.filter(r => r.nodeId !== nodeId);
        this.onUpdate?.(nodeId, {
          status: 'completed',
          progress: 1,
          remoteTaskId,
          assetFile: file,
          mediaType: 'audio',
        });
        this.processQueue();
        return;
      }

      if (request.outputType === 'image' || request.providerId === 'nano-banana-2') {
        const imageProvider = getFlashBoardImageProvider(request.service);
        if (!imageProvider) {
          throw new Error(`${request.providerId} is not available through ${request.service}`);
        }

        const catalogEntry = getCatalogEntry(request.service, request.providerId);
        const effectiveReferenceMediaFileIds = typeof catalogEntry?.maxReferenceImages === 'number'
          ? (request.referenceMediaFileIds ?? []).slice(0, catalogEntry.maxReferenceImages)
          : (request.referenceMediaFileIds ?? []);
        const visualReferenceMediaFileIds = effectiveReferenceMediaFileIds.filter((mediaFileId) => {
          const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
          return mediaFile?.type === 'image' || mediaFile?.type === 'video';
        });
        const referenceImageInputs = (await Promise.all(
          visualReferenceMediaFileIds.map((mediaFileId) => this.resolveReferenceImage(mediaFileId))
        )).filter((imageUrl): imageUrl is string => Boolean(imageUrl));

        const remoteTaskId = await imageProvider.createTextToImage({
          provider: request.providerId,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          resolution: request.imageSize,
          outputFormat: 'png',
          imageInputs: referenceImageInputs.length > 0 ? referenceImageInputs : undefined,
        });

        this.running.push({
          nodeId,
          remoteTaskId,
          service: request.service,
          abortController,
        });
        this.onUpdate?.(nodeId, { status: 'processing', remoteTaskId });

        const result = await imageProvider.pollImageTaskUntilComplete(
          remoteTaskId,
          (task) => {
            if (abortController.signal.aborted) throw new Error('Canceled');
            this.onUpdate?.(nodeId, { status: 'processing', progress: task.progress, remoteTaskId });
          },
          5000,
        );

        this.running = this.running.filter(r => r.nodeId !== nodeId);
        if (result.status === 'completed' && (result.imageUrl || result.videoUrl)) {
          this.onUpdate?.(nodeId, {
            status: 'completed',
            assetUrl: result.imageUrl ?? result.videoUrl,
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
      const videoCatalogEntry = getCatalogEntry(request.service, request.providerId);
      const effectiveVideoReferenceMediaFileIds = typeof videoCatalogEntry?.maxReferenceMedia === 'number'
        ? (request.referenceMediaFileIds ?? []).slice(0, videoCatalogEntry.maxReferenceMedia)
        : (request.referenceMediaFileIds ?? []);
      const referenceMedia = request.service === 'kieai'
        ? effectiveVideoReferenceMediaFileIds.map((mediaFileId) => this.resolveReferenceMedia(mediaFileId))
        : undefined;

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
          sound: request.multiShots ? true : request.generateAudio,
          multiShots: request.multiShots,
          multiPrompt: request.multiPrompt,
          referenceMedia,
        };

        if (request.service === 'piapi') {
          remoteTaskId = await piApiService.createTextToVideo(params);
        } else if (request.service === 'kieai') {
          remoteTaskId = await kieAiService.createTextToVideo(params);
        } else {
          remoteTaskId = await cloudAiService.createTextToVideo(params);
        }
      } else {
        const startImageUrl = await this.resolveReferenceImage(request.startMediaFileId);
        const endImageUrl = await this.resolveReferenceImage(request.endMediaFileId);
        const params: ImageToVideoParams = {
          provider: request.providerId,
          version: request.version,
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
          duration: request.duration || 5,
          aspectRatio: request.aspectRatio || '16:9',
          mode: request.mode || 'std',
          sound: request.multiShots ? true : request.generateAudio,
          multiShots: request.multiShots,
          multiPrompt: request.multiPrompt,
          startImageUrl,
          endImageUrl: request.multiShots ? undefined : endImageUrl,
          referenceMedia,
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
