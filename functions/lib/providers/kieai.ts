import {
  calculateHostedImageCost,
  calculateHostedKlingCost,
  createHostedImageTask,
  createHostedKlingTask,
  getHostedKlingTask,
  type HostedImageParams,
  type HostedVideoParams,
  type HostedVideoTask,
} from '../kieai';

export interface HostedKlingCapabilities {
  byoExplicit: true;
  provider: 'kling-3.0';
  pollingSupported: true;
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

export function normalizeHostedKlingParams(value: unknown): HostedVideoParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const duration = Number(value.duration);
  const multiShots = value.multiShots === true || value.multi_shots === true;

  const normalizedDuration = Math.max(3, Math.min(15, Math.floor(duration)));
  const multiPrompt = multiShots
    ? normalizeHostedMultiPrompt(value.multiPrompt ?? value.multi_prompt)
    : undefined;

  if (!prompt || !Number.isFinite(duration)) {
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

export {
  calculateHostedImageCost,
  calculateHostedKlingCost,
  createHostedImageTask,
  createHostedKlingTask,
  getHostedKlingTask,
};
export type { HostedImageParams, HostedVideoParams, HostedVideoTask };

export function buildHostedKlingCapabilities(): HostedKlingCapabilities {
  return {
    byoExplicit: true,
    provider: 'kling-3.0',
    pollingSupported: true,
  };
}
