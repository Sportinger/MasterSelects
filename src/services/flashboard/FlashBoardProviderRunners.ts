import { piApiService } from '../piApiService';
import { kieAiService } from '../kieAiService';
import { cloudAiService } from '../cloudAiService';
import type { TextToVideoParams, ImageToVideoParams, GenerationReferenceMedia } from '../piApiService';
import type { FlashBoardGenerationRequest, FlashBoardMediaType } from '../../stores/flashboardStore/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMediaStore } from '../../stores/mediaStore';
import { getCatalogEntry } from './FlashBoardModelCatalog';
import { getFlashBoardImageProvider } from './FlashBoardImageProviders';
import { getSeedanceReferenceValidationError } from './seedanceReferenceRules';
import {
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT,
  ELEVENLABS_MP3_MIME_TYPE,
  elevenLabsService,
  isElevenLabsMp3OutputFormat,
} from '../elevenLabsService';
import { SUNO_PROVIDER_ID, sunoService } from '../sunoService';

type FlashBoardProviderProcessingUpdate = {
  status: 'processing';
  remoteTaskId?: string;
  progress?: number;
};

export type FlashBoardProviderRunnerResult = {
  status: 'completed' | 'failed';
  remoteTaskId?: string;
  progress?: number;
  error?: string;
  assetUrl?: string;
  assetFile?: File;
  mediaType?: FlashBoardMediaType;
} | null;

interface FlashBoardProviderRunnerContext {
  recordId: string;
  request: FlashBoardGenerationRequest;
  abortController: AbortController;
  registerRunningJob: (remoteTaskId: string) => void;
  onProcessing: (update: FlashBoardProviderProcessingUpdate) => void;
  resolveReferenceImage: (mediaFileId: string | undefined) => Promise<string | undefined>;
  resolveReferenceMedia: (mediaFileId: string) => GenerationReferenceMedia;
  resolveHostedReferenceMedia: (mediaFileId: string) => Promise<GenerationReferenceMedia>;
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

function applyFlashBoardProviderApiKeys(request: FlashBoardGenerationRequest): void {
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
}

export async function runFlashBoardProviderJob(
  context: FlashBoardProviderRunnerContext,
): Promise<FlashBoardProviderRunnerResult> {
  applyFlashBoardProviderApiKeys(context.request);

  const isSunoMusicRequest = context.request.service === 'suno'
    || context.request.providerId === SUNO_PROVIDER_ID;
  if (isSunoMusicRequest) {
    return runSunoMusicJob(context);
  }

  if (context.request.outputType === 'audio' || context.request.service === 'elevenlabs') {
    return runSpeechJob(context);
  }

  if (context.request.outputType === 'image' || context.request.providerId === 'nano-banana-2') {
    return runImageJob(context);
  }

  return runVideoJob(context);
}

async function runSunoMusicJob({
  recordId,
  request,
  abortController,
  registerRunningJob,
  onProcessing,
}: FlashBoardProviderRunnerContext): Promise<FlashBoardProviderRunnerResult> {
  if (!request.prompt.trim()) {
    throw new Error('Describe the music before generating with Suno.');
  }

  const remoteTaskId = request.service === 'cloud'
    ? await cloudAiService.createSunoMusic({
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
      }, `flashboard-suno:${recordId}:${Date.now()}`, abortController.signal)
    : await sunoService.createMusic({
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

  registerRunningJob(remoteTaskId);
  onProcessing({ status: 'processing', progress: 0.05, remoteTaskId });

  const task = request.service === 'cloud'
    ? await cloudAiService.pollSunoMusicTaskUntilComplete(
      remoteTaskId,
      (currentTask) => {
        if (abortController.signal.aborted) throw new Error('Canceled');
        onProcessing({
          status: 'processing',
          progress: currentTask.progress,
          remoteTaskId,
        });
      },
      10000,
      900000,
      abortController.signal,
    )
    : await sunoService.pollMusicTaskUntilComplete(
        remoteTaskId,
        (currentTask) => {
          if (abortController.signal.aborted) throw new Error('Canceled');
          onProcessing({
            status: 'processing',
            progress: currentTask.progress,
            remoteTaskId,
          });
        },
        10000,
        900000,
        abortController.signal,
      );

  const audioUrl = task.results?.[0]?.audioUrl;
  if (task.status === 'completed' && audioUrl) {
    return {
      status: 'completed',
      progress: 1,
      remoteTaskId,
      assetUrl: audioUrl,
      mediaType: 'audio',
    };
  }

  return {
    status: 'failed',
    error: task.error || 'Suno generation finished without an audio URL.',
    remoteTaskId,
  };
}

async function runSpeechJob({
  recordId,
  request,
  abortController,
  registerRunningJob,
  onProcessing,
}: FlashBoardProviderRunnerContext): Promise<FlashBoardProviderRunnerResult> {
  if (request.service !== 'elevenlabs' && request.service !== 'cloud') {
    throw new Error('Audio generation is currently only supported through ElevenLabs and Suno');
  }
  if (!request.voiceId?.trim()) {
    throw new Error('Choose an ElevenLabs voice before generating speech.');
  }
  if (!request.prompt.trim()) {
    throw new Error('Enter text to generate speech.');
  }

  const remoteTaskId = `elevenlabs-${recordId}`;
  registerRunningJob(remoteTaskId);
  onProcessing({ status: 'processing', progress: 0.1, remoteTaskId });

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
        `flashboard-audio:${recordId}:${Date.now()}`,
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

  return {
    status: 'completed',
    progress: 1,
    remoteTaskId,
    assetFile: file,
    mediaType: 'audio',
  };
}

async function runImageJob({
  request,
  abortController,
  registerRunningJob,
  onProcessing,
  resolveReferenceImage,
}: FlashBoardProviderRunnerContext): Promise<FlashBoardProviderRunnerResult> {
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
    visualReferenceMediaFileIds.map((mediaFileId) => resolveReferenceImage(mediaFileId))
  )).filter((imageUrl): imageUrl is string => Boolean(imageUrl));

  const remoteTaskId = await imageProvider.createTextToImage({
    provider: request.providerId,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    resolution: request.imageSize,
    outputFormat: 'png',
    imageInputs: referenceImageInputs.length > 0 ? referenceImageInputs : undefined,
  });

  registerRunningJob(remoteTaskId);
  onProcessing({ status: 'processing', remoteTaskId });

  const result = await imageProvider.pollImageTaskUntilComplete(
    remoteTaskId,
    (task) => {
      if (abortController.signal.aborted) throw new Error('Canceled');
      onProcessing({ status: 'processing', progress: task.progress, remoteTaskId });
    },
    5000,
  );

  if (result.status === 'completed' && (result.imageUrl || result.videoUrl)) {
    return {
      status: 'completed',
      assetUrl: result.imageUrl ?? result.videoUrl,
      mediaType: 'image',
      remoteTaskId,
    };
  }

  return {
    status: 'failed',
    error: result.error || 'Image generation failed',
    remoteTaskId,
  };
}

async function runVideoJob({
  request,
  abortController,
  registerRunningJob,
  onProcessing,
  resolveReferenceImage,
  resolveReferenceMedia,
  resolveHostedReferenceMedia,
}: FlashBoardProviderRunnerContext): Promise<FlashBoardProviderRunnerResult> {
  const hasStartImage = !!request.startMediaFileId;
  const isTextToVideo = !hasStartImage;
  const videoCatalogEntry = getCatalogEntry(request.service, request.providerId);
  const effectiveVideoReferenceMediaFileIds = typeof videoCatalogEntry?.maxReferenceMedia === 'number'
    ? (request.referenceMediaFileIds ?? []).slice(0, videoCatalogEntry.maxReferenceMedia)
    : (request.referenceMediaFileIds ?? []);
  const isHostedSeedanceRequest = request.service === 'cloud'
    && (request.providerId === 'bytedance/seedance-2' || request.providerId === 'bytedance/seedance-2-fast');
  const referenceMedia = request.service === 'kieai'
    ? effectiveVideoReferenceMediaFileIds.map((mediaFileId) => resolveReferenceMedia(mediaFileId))
    : isHostedSeedanceRequest
      ? await Promise.all(
          effectiveVideoReferenceMediaFileIds.map((mediaFileId) => resolveHostedReferenceMedia(mediaFileId)),
        )
      : undefined;
  const seedanceReferenceValidationError = getSeedanceReferenceValidationError({
    hasAudioReference: referenceMedia?.some((reference) => reference.mediaType === 'audio') === true,
    hasVisualReference: Boolean(request.startMediaFileId || request.endMediaFileId)
      || referenceMedia?.some((reference) => reference.mediaType === 'image' || reference.mediaType === 'video') === true,
    providerId: request.providerId,
  });

  if (seedanceReferenceValidationError) {
    throw new Error(seedanceReferenceValidationError);
  }

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
    const startImageUrl = await resolveReferenceImage(request.startMediaFileId);
    const endImageUrl = await resolveReferenceImage(request.endMediaFileId);
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

  registerRunningJob(remoteTaskId);
  onProcessing({ status: 'processing', remoteTaskId });

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
      onProcessing({ status: 'processing', progress: t.progress });
    },
    pollInterval,
  );

  if (task.status === 'completed' && task.videoUrl) {
    return { status: 'completed', assetUrl: task.videoUrl, mediaType: 'video' };
  }
  if (task.status === 'failed') {
    return { status: 'failed', error: task.error || 'Generation failed' };
  }

  return null;
}
