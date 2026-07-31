import { piApiService } from '../piApiService';
import { kieAiService } from '../kieAiService';
import { cloudAiService } from '../cloudAiService';
import type { TextToVideoParams, ImageToVideoParams, GenerationReferenceMedia } from '../piApiService';
import type {
  FlashBoardGenerationOutput,
  FlashBoardGenerationRequest,
  FlashBoardJobRefund,
  FlashBoardMediaType,
} from '../../stores/flashboardStore/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMediaStore } from '../../stores/mediaStore';
import { getCatalogEntry } from './FlashBoardModelCatalog';
import { getFlashBoardImageProvider } from './FlashBoardImageProviders';
import { getSeedanceReferenceValidationError } from './seedanceReferenceRules';
import { getProviderTaskStartedAt } from './FlashBoardJobTiming';
import {
  DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT,
  ELEVENLABS_MP3_MIME_TYPE,
  elevenLabsService,
  isElevenLabsMp3OutputFormat,
} from '../elevenLabsService';
import { SUNO_PROVIDER_ID, SUNO_SOUNDS_PROVIDER_ID, sunoService } from '../sunoService';

type FlashBoardProviderProcessingUpdate = {
  status: 'processing';
  remoteTaskId?: string;
  progress?: number;
  startedAt?: number;
  outputs?: FlashBoardGenerationOutput[];
};

export interface FlashBoardProviderAsset {
  file?: File;
  mediaType: FlashBoardMediaType;
  outputId?: string;
  title?: string;
  url?: string;
}

export type FlashBoardProviderRunnerResult = {
  status: 'completed' | 'failed';
  remoteTaskId?: string;
  progress?: number;
  error?: string;
  assetUrl?: string;
  assetFile?: File;
  mediaType?: FlashBoardMediaType;
  assets?: FlashBoardProviderAsset[];
  outputs?: FlashBoardGenerationOutput[];
  refund?: FlashBoardJobRefund;
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

interface FlashBoardProviderResumeContext {
  request: FlashBoardGenerationRequest;
  remoteTaskId: string;
  abortController: AbortController;
  onProcessing: (update: FlashBoardProviderProcessingUpdate) => void;
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

interface SunoTaskResult {
  audioUrl?: string;
  duration?: number;
  id?: string;
  imageUrl?: string;
  streamAudioUrl?: string;
  title?: string;
}

function buildSunoOutputs(
  results: SunoTaskResult[] | undefined,
  completed: boolean,
): FlashBoardGenerationOutput[] {
  return (results ?? [])
    .filter((result) => Boolean(result.audioUrl || result.streamAudioUrl))
    .map((result, index) => ({
      id: result.id ?? `track-${index + 1}`,
      mediaType: 'audio' as const,
      availability: completed ? 'completed' as const : 'preview' as const,
      artworkUrl: result.imageUrl,
      downloadUrl: result.audioUrl,
      duration: result.duration,
      previewUrl: result.streamAudioUrl ?? result.audioUrl,
      title: result.title ?? `Track ${index + 1}`,
    }));
}

function buildSunoAssets(results: SunoTaskResult[] | undefined): FlashBoardProviderAsset[] {
  return (results ?? [])
    .filter((result): result is SunoTaskResult & { audioUrl: string } => Boolean(result.audioUrl))
    .map((result, index) => ({
      mediaType: 'audio',
      outputId: result.id ?? `track-${index + 1}`,
      title: result.title,
      url: result.audioUrl,
    }));
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

  const isSunoMusicRequest = context.request.providerId === SUNO_PROVIDER_ID;
  if (isSunoMusicRequest) {
    return runSunoMusicJob(context);
  }

  if (context.request.providerId === SUNO_SOUNDS_PROVIDER_ID) {
    return runSunoSoundsJob(context);
  }

  if (context.request.outputType === 'audio' || context.request.service === 'elevenlabs') {
    return runSpeechJob(context);
  }

  if (context.request.outputType === 'image' || context.request.providerId === 'nano-banana-2') {
    return runImageJob(context);
  }

  return runVideoJob(context);
}

export async function resumeFlashBoardProviderJob({
  request,
  remoteTaskId,
  abortController,
  onProcessing,
}: FlashBoardProviderResumeContext): Promise<FlashBoardProviderRunnerResult> {
  applyFlashBoardProviderApiKeys(request);
  onProcessing({ status: 'processing', remoteTaskId });

  if (request.providerId === SUNO_PROVIDER_ID || request.providerId === SUNO_SOUNDS_PROVIDER_ID) {
    const pollInterval = request.providerId === SUNO_SOUNDS_PROVIDER_ID ? 30000 : 10000;
    const task = request.service === 'cloud'
      ? await cloudAiService.pollSunoMusicTaskUntilComplete(
        remoteTaskId,
        (currentTask) => {
          if (abortController.signal.aborted) throw new Error('Canceled');
          onProcessing({
            status: 'processing',
            progress: currentTask.progress,
            remoteTaskId,
            outputs: buildSunoOutputs(currentTask.results, false),
          });
        },
        pollInterval,
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
            outputs: buildSunoOutputs(currentTask.results, false),
          });
        },
        pollInterval,
        900000,
        abortController.signal,
      );
    const assets = buildSunoAssets(task.results);
    if (task.status === 'completed' && assets.length > 0) {
      return {
        status: 'completed',
        progress: 1,
        remoteTaskId,
        assetUrl: assets[0].url,
        assets,
        mediaType: 'audio',
        outputs: buildSunoOutputs(task.results, true),
      };
    }
    return {
      status: 'failed',
      error: task.error || 'Suno generation finished without an audio URL.',
      refund: task.refund,
      remoteTaskId,
    };
  }

  if (request.outputType === 'audio' || request.service === 'elevenlabs') {
    return { status: 'failed', error: 'Speech generation cannot be resumed after reload.', remoteTaskId };
  }

  if (request.outputType === 'image' || request.providerId === 'nano-banana-2') {
    const imageProvider = getFlashBoardImageProvider(request.service);
    if (!imageProvider) {
      return { status: 'failed', error: `${request.providerId} is not available through ${request.service}`, remoteTaskId };
    }
    const result = await imageProvider.pollImageTaskUntilComplete(
      remoteTaskId,
      (task) => {
        if (abortController.signal.aborted) throw new Error('Canceled');
        onProcessing({ status: 'processing', progress: task.progress, remoteTaskId });
      },
      5000,
    );
    if (result.status === 'completed' && (result.imageUrl || result.videoUrl)) {
      return { status: 'completed', assetUrl: result.imageUrl ?? result.videoUrl, mediaType: 'image', remoteTaskId };
    }
    return { status: 'failed', error: result.error || 'Image generation failed', refund: result.refund, remoteTaskId };
  }

  const pollInterval = request.service === 'piapi' ? 5000 : 15000;
  const service = request.service === 'piapi'
    ? piApiService
    : request.service === 'kieai'
      ? kieAiService
      : cloudAiService;
  const task = await service.pollTaskUntilComplete(
    remoteTaskId,
    (currentTask) => {
      if (abortController.signal.aborted) throw new Error('Canceled');
      onProcessing({
        status: 'processing',
        progress: currentTask.progress,
        remoteTaskId,
        startedAt: getProviderTaskStartedAt(currentTask),
      });
    },
    pollInterval,
  );

  if (task.status === 'completed' && task.videoUrl) {
    return { status: 'completed', assetUrl: task.videoUrl, mediaType: 'video', remoteTaskId };
  }
  if (task.status === 'failed') {
    return { status: 'failed', error: task.error || 'Generation failed', refund: task.refund, remoteTaskId };
  }

  return null;
}

async function runSunoMusicJob({
  recordId,
  request,
  abortController,
  registerRunningJob,
  onProcessing,
}: FlashBoardProviderRunnerContext): Promise<FlashBoardProviderRunnerResult> {
  if (!request.prompt.trim() && !(request.sunoCustomMode && request.sunoInstrumental)) {
    throw new Error('Describe the music before generating with Suno.');
  }

  const remoteTaskId = request.service === 'cloud'
    ? await cloudAiService.createSunoMusic({
        audioWeight: request.sunoAudioWeight,
        customMode: request.sunoCustomMode,
        duration: request.duration,
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
        duration: request.duration,
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
          outputs: buildSunoOutputs(currentTask.results, false),
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
            outputs: buildSunoOutputs(currentTask.results, false),
          });
        },
        10000,
        900000,
        abortController.signal,
      );

  const assets = buildSunoAssets(task.results);
  if (task.status === 'completed' && assets.length > 0) {
    return {
      status: 'completed',
      progress: 1,
      remoteTaskId,
      assetUrl: assets[0].url,
      assets,
      mediaType: 'audio',
      outputs: buildSunoOutputs(task.results, true),
    };
  }

  return {
    status: 'failed',
    error: task.error || 'Suno generation finished without an audio URL.',
    refund: task.refund,
    remoteTaskId,
  };
}

async function runSunoSoundsJob({
  recordId,
  request,
  abortController,
  registerRunningJob,
  onProcessing,
}: FlashBoardProviderRunnerContext): Promise<FlashBoardProviderRunnerResult> {
  if (!request.prompt.trim()) {
    throw new Error('Describe the sound before generating with Suno Sounds.');
  }

  const soundParams = {
    model: request.version,
    prompt: request.prompt,
    soundLoop: request.mode === 'loop',
  };
  const remoteTaskId = request.service === 'cloud'
    ? await cloudAiService.createSunoSounds(
      soundParams,
      `flashboard-suno-sounds:${recordId}:${Date.now()}`,
      abortController.signal,
    )
    : await sunoService.createSounds(soundParams, abortController.signal);

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
      30000,
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
      30000,
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
    error: task.error || 'Suno Sounds generation finished without an audio URL.',
    refund: task.refund,
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
  const acceptedReferenceMediaTypes = catalogEntry?.requiredReferenceMediaType === 'image'
    ? new Set<FlashBoardMediaType>(['image'])
    : new Set<FlashBoardMediaType>(['image', 'video']);
  const visualReferenceMediaFileIds = effectiveReferenceMediaFileIds.filter((mediaFileId) => {
    const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
    if (mediaFile?.type !== 'image' && mediaFile?.type !== 'video') {
      return false;
    }

    return acceptedReferenceMediaTypes.has(mediaFile.type);
  });
  const referenceImageInputs = (await Promise.all(
    visualReferenceMediaFileIds.map((mediaFileId) => resolveReferenceImage(mediaFileId))
  )).filter((imageUrl): imageUrl is string => Boolean(imageUrl));

  const imageParams = {
    provider: request.providerId,
    prompt: request.prompt,
    negativePrompt: request.negativePrompt,
    aspectRatio: request.aspectRatio,
    resolution: request.imageSize,
    outputFormat: 'png' as const,
    imageInputs: referenceImageInputs.length > 0 ? referenceImageInputs : undefined,
  };
  const remoteTaskId = request.service === 'cloud'
    ? await cloudAiService.createTextToImage(imageParams, request.idempotencyKey)
    : await imageProvider.createTextToImage(imageParams);

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
    refund: result.refund,
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
  const isHostedKlingRequest = request.service === 'cloud' && request.providerId === 'cloud-kling';
  const isHostedSpecialKieVideoRequest = request.service === 'cloud'
    && (
      request.providerId === 'veo-3.1'
      || request.providerId === 'runway-video'
      || request.providerId === 'topaz/video-upscale'
    );
  const referenceMedia = request.service === 'kieai'
    ? effectiveVideoReferenceMediaFileIds.map((mediaFileId) => resolveReferenceMedia(mediaFileId))
    : isHostedSeedanceRequest || isHostedKlingRequest || isHostedSpecialKieVideoRequest
      ? await Promise.all(
          effectiveVideoReferenceMediaFileIds.map((mediaFileId) => resolveHostedReferenceMedia(mediaFileId)),
        )
      : undefined;
  const seedanceReferenceValidationError = getSeedanceReferenceValidationError({
    hasReferenceMedia: (referenceMedia?.length ?? 0) > 0,
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
      remoteTaskId = await cloudAiService.createTextToVideo(params, request.idempotencyKey);
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
      remoteTaskId = await cloudAiService.createImageToVideo(params, request.idempotencyKey);
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
      onProcessing({
        status: 'processing',
        progress: t.progress,
        remoteTaskId,
        startedAt: getProviderTaskStartedAt(t),
      });
    },
    pollInterval,
  );

  if (task.status === 'completed' && task.videoUrl) {
    return { status: 'completed', assetUrl: task.videoUrl, mediaType: 'video', remoteTaskId };
  }
  if (task.status === 'failed') {
    return { status: 'failed', error: task.error || 'Generation failed', refund: task.refund, remoteTaskId };
  }

  return null;
}
