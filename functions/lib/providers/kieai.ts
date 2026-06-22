import {
  calculateHostedImageCost,
  calculateHostedKlingCost,
  calculateHostedSeedanceCost,
  calculateHostedSunoCost,
  createHostedImageTask,
  createHostedKlingTask,
  createHostedSeedanceTask,
  createHostedSunoMusicTask,
  getHostedKlingTask,
  getHostedSunoMusicTask,
  type HostedImageParams,
  type HostedReferenceMedia,
  type HostedSunoParams,
  type HostedSunoTask,
  type HostedVideoParams,
  type HostedVideoTask,
} from '../kieai';

export interface HostedKlingCapabilities {
  byoExplicit: true;
  musicProvider: 'suno-music';
  providers: string[];
  pollingSupported: true;
  sunoModels: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeHostedMultiPrompt(
  value: unknown,
): Array<{ index: number; prompt: string; duration: number }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry, index) => {
      if (!isRecord(entry)) {
        return null;
      }

      const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
      const duration = Number(entry.duration);

      if (!prompt || !Number.isFinite(duration) || duration <= 0) {
        return null;
      }

      return {
        index: index + 1,
        prompt,
        duration: Math.floor(duration),
      };
    })
    .filter((entry): entry is { index: number; prompt: string; duration: number } => Boolean(entry))
    .slice(0, 5);

  return normalized.length > 0 ? normalized : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function clampOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, numberValue));
}

function normalizeHostedReferenceMedia(value: unknown): HostedReferenceMedia[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const references = value
    .map((candidate): HostedReferenceMedia | null => {
      if (!isRecord(candidate)) {
        return null;
      }

      const mediaType = asString(candidate.mediaType ?? candidate.media_type);
      const source = asString(candidate.source ?? candidate.url);
      if (
        (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio')
        || !source
        || (!source.startsWith('data:') && !/^https?:\/\//i.test(source))
      ) {
        return null;
      }

      return {
        fileName: asString(candidate.fileName ?? candidate.file_name),
        label: asString(candidate.label),
        mediaType,
        mimeType: asString(candidate.mimeType ?? candidate.mime_type),
        source,
      };
    })
    .filter((reference): reference is HostedReferenceMedia => Boolean(reference));

  return references.length > 0 ? references : undefined;
}

export function normalizeHostedKlingParams(value: unknown): HostedVideoParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const duration = Number(value.duration);
  const multiShots = value.multiShots === true || value.multi_shots === true;
  const requestedProvider = asString(value.provider ?? value.providerId ?? value.provider_id);
  const referenceMedia = normalizeHostedReferenceMedia(value.referenceMedia ?? value.reference_media);

  const normalizedDuration = Math.max(3, Math.min(15, Math.floor(duration)));
  const multiPrompt = multiShots
    ? normalizeHostedMultiPrompt(value.multiPrompt ?? value.multi_prompt)
    : undefined;

  if (!prompt || !Number.isFinite(duration)) {
    return null;
  }

  if (requestedProvider && requestedProvider !== 'kling-3.0' && requestedProvider !== 'cloud-kling') {
    return null;
  }

  if (multiShots) {
    const shotCount = multiPrompt?.length ?? 0;
    const totalShotDuration = (multiPrompt ?? []).reduce((sum, shot) => sum + shot.duration, 0);

    if (shotCount < 2 || shotCount > Math.min(5, normalizedDuration) || totalShotDuration !== normalizedDuration) {
      return null;
    }
  }

  return {
    aspectRatio: typeof value.aspectRatio === 'string' && value.aspectRatio.trim() ? value.aspectRatio.trim() : '16:9',
    duration: normalizedDuration,
    endImageUrl: !multiShots && typeof value.endImageUrl === 'string' && value.endImageUrl.trim() ? value.endImageUrl.trim() : undefined,
    mode: value.mode === 'pro' ? 'pro' : 'std',
    multiPrompt,
    multiShots,
    prompt,
    provider: 'kling-3.0',
    referenceMedia,
    sound: multiShots ? true : value.sound === true,
    startImageUrl: typeof value.startImageUrl === 'string' && value.startImageUrl.trim() ? value.startImageUrl.trim() : undefined,
  };
}

export function normalizeHostedImageParams(value: unknown): HostedImageParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const requestedOutputType = typeof value.outputType === 'string' ? value.outputType.trim() : '';
  const requestedProvider = typeof value.provider === 'string' ? value.provider.trim() : '';

  if (requestedOutputType !== 'image' && requestedProvider !== 'nano-banana-2') {
    return null;
  }

  const provider = requestedProvider || 'nano-banana-2';
  const imageInputs = Array.isArray(value.imageInputs)
    ? value.imageInputs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : undefined;

  if (!prompt) {
    return null;
  }

  return {
    aspectRatio: typeof value.aspectRatio === 'string' && value.aspectRatio.trim() ? value.aspectRatio.trim() : '1:1',
    imageInputs: imageInputs?.length ? imageInputs : undefined,
    outputFormat: value.outputFormat === 'jpeg' || value.outputFormat === 'webp' ? value.outputFormat : 'png',
    prompt,
    provider,
    resolution: typeof value.resolution === 'string' && value.resolution.trim() ? value.resolution.trim() : '1K',
  };
}

export function normalizeHostedSunoParams(value: unknown): HostedSunoParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const requestedProvider = asString(value.provider ?? value.providerId ?? value.provider_id);
  const requestedOutputType = asString(value.outputType ?? value.output_type);
  const prompt = asString(value.prompt);

  if (requestedProvider !== 'suno-music' && requestedOutputType !== 'audio') {
    return null;
  }

  if (!prompt) {
    return null;
  }

  const customMode = value.customMode === true || value.custom_mode === true;
  const instrumental = value.instrumental === false ? false : true;
  const style = asString(value.style ?? value.sunoStyle);
  const title = asString(value.title ?? value.sunoTitle);

  if (customMode && (!style || !title)) {
    return null;
  }

  return {
    audioWeight: clampOptionalNumber(value.audioWeight ?? value.audio_weight ?? value.sunoAudioWeight, 0, 1),
    customMode,
    instrumental,
    model: asString(value.model ?? value.version) ?? 'V5',
    negativeTags: asString(value.negativeTags ?? value.negative_tags ?? value.sunoNegativeTags),
    prompt,
    style,
    styleWeight: clampOptionalNumber(value.styleWeight ?? value.style_weight ?? value.sunoStyleWeight, 0, 1),
    title,
    vocalGender: value.vocalGender === 'm' || value.vocalGender === 'f'
      ? value.vocalGender
      : value.sunoVocalGender === 'm' || value.sunoVocalGender === 'f'
        ? value.sunoVocalGender
        : undefined,
    weirdnessConstraint: clampOptionalNumber(
      value.weirdnessConstraint ?? value.weirdness_constraint ?? value.sunoWeirdnessConstraint,
      0,
      1,
    ),
  };
}

export function normalizeHostedSeedanceParams(value: unknown): HostedVideoParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const duration = Number(value.duration);
  const requestedProvider = asString(value.provider ?? value.providerId ?? value.provider_id);
  const referenceMedia = normalizeHostedReferenceMedia(value.referenceMedia ?? value.reference_media);

  if (requestedProvider !== 'bytedance/seedance-2' && requestedProvider !== 'bytedance/seedance-2-fast') {
    return null;
  }

  if (!prompt || !Number.isFinite(duration)) {
    return null;
  }

  const provider = requestedProvider;
  const requestedMode = asString(value.mode);
  const mode = requestedMode === '480p'
    ? '480p'
    : requestedMode === '1080p' && provider === 'bytedance/seedance-2'
      ? '1080p'
      : '720p';

  return {
    aspectRatio: typeof value.aspectRatio === 'string' && value.aspectRatio.trim() ? value.aspectRatio.trim() : '16:9',
    duration: Math.max(4, Math.min(15, Math.floor(duration))),
    endImageUrl: typeof value.endImageUrl === 'string' && value.endImageUrl.trim() ? value.endImageUrl.trim() : undefined,
    mode,
    multiShots: false,
    prompt,
    provider,
    referenceMedia,
    sound: value.sound === true,
    startImageUrl: typeof value.startImageUrl === 'string' && value.startImageUrl.trim() ? value.startImageUrl.trim() : undefined,
  };
}

export {
  calculateHostedImageCost,
  calculateHostedKlingCost,
  calculateHostedSeedanceCost,
  calculateHostedSunoCost,
  createHostedImageTask,
  createHostedKlingTask,
  createHostedSeedanceTask,
  createHostedSunoMusicTask,
  getHostedKlingTask,
  getHostedSunoMusicTask,
};
export type {
  HostedImageParams,
  HostedReferenceMedia,
  HostedSunoParams,
  HostedSunoTask,
  HostedVideoParams,
  HostedVideoTask,
};

export function buildHostedKlingCapabilities(): HostedKlingCapabilities {
  return {
    byoExplicit: true,
    musicProvider: 'suno-music',
    providers: ['kling-3.0', 'bytedance/seedance-2', 'bytedance/seedance-2-fast'],
    pollingSupported: true,
    sunoModels: ['V5', 'V4_5PLUS', 'V4_5', 'V4'],
  };
}
