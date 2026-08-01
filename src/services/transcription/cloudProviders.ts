import { Logger } from '../logger';
import { cloudApi } from '../cloudApi';
import {
  applyConfirmedCreditUpdate,
  beginCreditActivity,
  endCreditActivity,
  reconcileCreditBalance,
} from '../credits/creditBalanceCoordinator';
import type { TranscriptWord } from '../../types/clipMetadata';
import { audioBufferToWav, decodeAudioBlob, splitAudioBuffer } from './audioPrep';
import type { ClipTranscriptUpdate } from './artifactPersistence';
import {
  mapDeepgramWords,
  mapOpenAIWords,
  type TranscriptApiWord,
} from './resultMapping';

const log = Logger.create('ClipTranscriber');

type TranscriptUpdater = (clipId: string, data: ClipTranscriptUpdate) => void;

export const HOSTED_TRANSCRIPTION_MAX_BYTES = 24 * 1024 * 1024;
type HostedTranscriptionProvider = 'deepgram' | 'openai';
export type OpenAITranscriptionVariant = 'word-timestamps' | 'diarized-speakers';
export interface TranscriptionRequestOptions {
  openAIVariant?: OpenAITranscriptionVariant;
  signal?: AbortSignal;
}
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
function createHostedTranscriptionIdempotencyKey(
  provider: HostedTranscriptionProvider,
  openAIVariant: OpenAITranscriptionVariant,
  clipId: string,
  requestId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  chunkIndex?: number,
): string {
  const chunk = chunkIndex === undefined ? 'single' : `chunk-${chunkIndex}`;
  const variant = provider === 'openai' ? `:${openAIVariant}` : '';
  return `transcription:${provider}${variant}:${requestId}:${clipId}:${Math.round(inPointOffset * 1000)}:${audioBlob.size}:${language}:${chunk}`;
}

function createHostedTranscriptionRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function hostedTranscriptionSingleRequest(
  provider: HostedTranscriptionProvider,
  openAIVariant: OpenAITranscriptionVariant,
  clipId: string,
  requestId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  signal?: AbortSignal,
  chunkIndex?: number,
): Promise<TranscriptApiWord[]> {
  const idempotencyKey = createHostedTranscriptionIdempotencyKey(
    provider,
    openAIVariant,
    clipId,
    requestId,
    audioBlob,
    language,
    inPointOffset,
    chunkIndex,
  );
  const activityId = `transcription:${requestId}`;
  const response = await cloudApi.ai.audio.transcription({
    action: 'transcription',
    idempotencyKey,
    params: {
      audioBase64: arrayBufferToBase64(await audioBlob.arrayBuffer()),
      fileName: 'audio.wav',
      language,
      mimeType: audioBlob.type || 'audio/wav',
      provider,
      ...(provider === 'openai' ? { variant: openAIVariant } : {}),
    },
  }, signal);

  if (typeof response.creditBalance === 'number') {
    if (
      typeof response.creditsCharged === 'number'
      && response.creditsCharged > 0
      && response.creditMutationId
    ) {
      applyConfirmedCreditUpdate({
        activityId,
        balance: response.creditBalance,
        credits: response.creditsCharged,
        kind: 'debit',
        mutationId: `debit:hosted:transcription:${response.creditMutationId}`,
        source: 'hosted:transcription',
      });
    } else {
      reconcileCreditBalance(response.creditBalance);
    }
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? `Hosted ${provider === 'deepgram' ? 'Deepgram' : 'OpenAI'} transcription failed.`);
  }

  return response.data?.words ?? [];
}

export function mapHostedTranscriptionWords(
  provider: HostedTranscriptionProvider,
  rawWords: TranscriptApiWord[],
  inPointOffset: number,
  startIndex: number = 0,
): TranscriptWord[] {
  return provider === 'deepgram'
    ? mapDeepgramWords(rawWords, inPointOffset, startIndex)
    : mapOpenAIWords(rawWords, inPointOffset, startIndex);
}

async function runHostedProviderTranscription(
  provider: HostedTranscriptionProvider,
  clipId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
  requestId: string,
  options?: TranscriptionRequestOptions,
): Promise<TranscriptWord[]> {
  const providerName = provider === 'deepgram' ? 'Deepgram' : 'OpenAI Cloud';
  const openAIVariant = options?.openAIVariant ?? 'word-timestamps';

  if (audioBlob.size <= HOSTED_TRANSCRIPTION_MAX_BYTES) {
    updateClipTranscript(clipId, { progress: 20, message: `Sending to ${providerName}...` });
    const rawWords = await hostedTranscriptionSingleRequest(
      provider,
      openAIVariant,
      clipId,
      requestId,
      audioBlob,
      language,
      inPointOffset,
      options?.signal,
    );
    updateClipTranscript(clipId, { progress: 80, message: 'Processing response...' });
    return mapHostedTranscriptionWords(provider, rawWords, inPointOffset);
  }

  log.info(`Audio WAV is ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB, splitting into chunks...`);
  updateClipTranscript(clipId, { progress: 10, message: 'Audio too large, splitting...' });

  const fullBuffer = await decodeAudioBlob(audioBlob);
  const chunks = splitAudioBuffer(fullBuffer, HOSTED_TRANSCRIPTION_MAX_BYTES);
  const allWords: TranscriptWord[] = [];
  let globalWordIndex = 0;
  let sampleOffset = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    options?.signal?.throwIfAborted();
    const chunkTimeOffset = sampleOffset / fullBuffer.sampleRate;
    const progressBase = 15 + (70 * index / chunks.length);
    const progressEnd = 15 + (70 * (index + 1) / chunks.length);

    updateClipTranscript(clipId, {
      progress: Math.round(progressBase),
      message: `Transcribing chunk ${index + 1}/${chunks.length}...`,
    });

    const chunkWav = await audioBufferToWav(chunks[index]);
    const rawWords = await hostedTranscriptionSingleRequest(
      provider,
      openAIVariant,
      clipId,
      requestId,
      chunkWav,
      language,
      chunkTimeOffset + inPointOffset,
      options?.signal,
      index,
    );
    const mappedWords = mapHostedTranscriptionWords(
      provider,
      rawWords,
      chunkTimeOffset + inPointOffset,
      globalWordIndex,
    );
    allWords.push(...mappedWords);
    globalWordIndex += mappedWords.length;
    sampleOffset += chunks[index].length;

    updateClipTranscript(clipId, {
      progress: Math.round(progressEnd),
      words: allWords,
      message: `Chunk ${index + 1}/${chunks.length} done (${allWords.length} words)`,
    });
  }

  return allWords;
}

export async function transcribeWithHostedProvider(
  provider: HostedTranscriptionProvider,
  clipId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
  options?: TranscriptionRequestOptions,
): Promise<TranscriptWord[]> {
  const requestId = createHostedTranscriptionRequestId();
  const activityId = `transcription:${requestId}`;
  beginCreditActivity({
    feature: 'AI transcription',
    id: activityId,
    targetId: 'flashboard-credit-activity-anchor',
  });
  try {
    const words = await runHostedProviderTranscription(
      provider,
      clipId,
      audioBlob,
      language,
      inPointOffset,
      updateClipTranscript,
      requestId,
      options,
    );
    endCreditActivity({ id: activityId, status: 'completed' });
    return words;
  } catch (error) {
    endCreditActivity({ id: activityId, status: options?.signal?.aborted ? 'canceled' : 'failed' });
    throw error;
  }
}

export function transcribeWithHostedOpenAI(
  clipId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
): Promise<TranscriptWord[]> {
  return transcribeWithHostedProvider('openai', clipId, audioBlob, language, inPointOffset, updateClipTranscript);
}
