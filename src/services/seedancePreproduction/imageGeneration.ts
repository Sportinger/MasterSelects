import {
  getAgentMediaGenerationStatus,
  inspectAgentMediaGenerationModel,
  startAgentMediaGeneration,
} from '../flashboard/FlashBoardAgentGeneration';
import { MAX_SEEDANCE_GENERATION_REFERENCES } from './referenceSelection';

const GENERATION_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

interface GenerationStatus {
  job?: { error?: string; status?: string };
  recordId?: string;
  results?: Array<{ mediaFileId?: string }>;
}

function generationPollDelay(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason ?? new Error('Generation canceled.'));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 750);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForGeneratedMedia(
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<{ mediaFileId: string; recordId?: string }> {
  const startedAt = Date.now();
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new Error('Generation canceled.');
    const status = getAgentMediaGenerationStatus({ idempotencyKey }) as GenerationStatus;
    const mediaFileId = status.results?.find((result) => result.mediaFileId)?.mediaFileId;
    if (mediaFileId) return { mediaFileId, recordId: status.recordId };
    if (status.job?.status === 'failed' || status.job?.status === 'canceled') {
      throw new Error(status.job.error || 'Image generation failed.');
    }
    if (Date.now() - startedAt > GENERATION_TIMEOUT_MS) {
      throw new Error('Image generation timed out.');
    }
    await generationPollDelay(signal);
  }
}

export async function generateSeedanceImage(input: {
  idempotencyKey: string;
  negativePrompt: string;
  prompt: string;
  providerId: string;
  referenceMediaFileIds: string[];
  signal: AbortSignal;
}): Promise<{ mediaFileId: string; recordId?: string }> {
  const inspection = await inspectAgentMediaGenerationModel({
    outputType: 'image',
    providerId: input.providerId,
  });
  const settingsToken = typeof inspection.settingsToken === 'string'
    ? inspection.settingsToken
    : '';
  if (!settingsToken) throw new Error('Image generation settings are unavailable.');
  await startAgentMediaGeneration({
    outputType: 'image',
    providerId: input.providerId,
    settingsToken,
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceMediaFileIds: input.referenceMediaFileIds.slice(0, MAX_SEEDANCE_GENERATION_REFERENCES),
  });
  return waitForGeneratedMedia(input.idempotencyKey, input.signal);
}
