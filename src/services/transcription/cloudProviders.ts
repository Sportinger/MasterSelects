import { Logger } from '../logger';
import { cloudApi } from '../cloudApi';
import { useAccountStore } from '../../stores/accountStore';
import type { TranscriptWord } from '../../types/clipMetadata';
import { audioBufferToWav, decodeAudioBlob, splitAudioBuffer } from './audioPrep';
import type { ClipTranscriptUpdate } from './artifactPersistence';
import {
  mapAssemblyAIWords,
  mapDeepgramWords,
  mapOpenAIWords,
  expandDiarizedSegmentsToWords,
  type TranscriptApiSegment,
  type TranscriptApiWord,
} from './resultMapping';

const log = Logger.create('ClipTranscriber');

interface OpenAITranscriptionResponse {
  segments?: TranscriptApiSegment[];
  words?: Array<{ word: string; start: number; end: number }>;
}

interface AssemblyTranscriptResponse {
  id?: string;
  status?: string;
  error?: string;
  words?: TranscriptApiWord[];
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: TranscriptApiWord[];
      }>;
    }>;
  };
}

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

export async function transcribeWithCloudProvider(
  provider: string,
  clipId: string,
  audioBlob: Blob,
  language: string,
  apiKey: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
  options?: TranscriptionRequestOptions,
): Promise<TranscriptWord[]> {
  switch (provider) {
    case 'openai':
      return transcribeWithOpenAI(
        clipId,
        audioBlob,
        language,
        apiKey,
        inPointOffset,
        updateClipTranscript,
        options?.openAIVariant,
        options?.signal,
      );
    case 'assemblyai':
      return transcribeWithAssemblyAI(
        clipId,
        audioBlob,
        language,
        apiKey,
        inPointOffset,
        updateClipTranscript,
        options?.signal,
      );
    case 'deepgram':
      return transcribeWithDeepgram(
        clipId,
        audioBlob,
        language,
        apiKey,
        inPointOffset,
        updateClipTranscript,
        options?.signal,
      );
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function openAISingleRequest(
  audioBlob: Blob,
  language: string,
  apiKey: string,
  variant: OpenAITranscriptionVariant,
  signal?: AbortSignal,
): Promise<TranscriptApiWord[]> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append(
    'model',
    variant === 'diarized-speakers' ? 'gpt-4o-transcribe-diarize' : 'whisper-1',
  );
  if (language !== 'auto') {
    formData.append('language', language);
  }
  if (variant === 'diarized-speakers') {
    formData.append('response_format', 'diarized_json');
    formData.append('chunking_strategy', 'auto');
  } else {
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(`OpenAI API error: ${response.status}: ${error.error?.message || response.statusText}`);
  }

  const result = await response.json() as OpenAITranscriptionResponse;
  return variant === 'diarized-speakers'
    ? expandDiarizedSegmentsToWords(result.segments ?? [])
    : result.words ?? [];
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
  const response = await cloudApi.ai.audio.transcription({
    action: 'transcription',
    idempotencyKey: createHostedTranscriptionIdempotencyKey(
      provider,
      openAIVariant,
      clipId,
      requestId,
      audioBlob,
      language,
      inPointOffset,
      chunkIndex,
    ),
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
    useAccountStore.getState().applyHostedCreditBalance(response.creditBalance);
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

export function transcribeWithHostedOpenAI(
  clipId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
): Promise<TranscriptWord[]> {
  return transcribeWithHostedProvider('openai', clipId, audioBlob, language, inPointOffset, updateClipTranscript);
}

async function transcribeWithOpenAI(
  clipId: string,
  audioBlob: Blob,
  language: string,
  apiKey: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
  variant: OpenAITranscriptionVariant = 'word-timestamps',
  signal?: AbortSignal,
): Promise<TranscriptWord[]> {
  if (audioBlob.size <= HOSTED_TRANSCRIPTION_MAX_BYTES) {
    updateClipTranscript(clipId, { progress: 20, message: 'Sending to OpenAI...' });

    const rawWords = await openAISingleRequest(audioBlob, language, apiKey, variant, signal);

    updateClipTranscript(clipId, { progress: 80, message: 'Processing response...' });

    return mapOpenAIWords(rawWords, inPointOffset);
  }

  log.info(`Audio WAV is ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB, splitting into chunks...`);
  updateClipTranscript(clipId, { progress: 10, message: 'Audio too large, splitting...' });

  const fullBuffer = await decodeAudioBlob(audioBlob);
  const chunks = splitAudioBuffer(fullBuffer, HOSTED_TRANSCRIPTION_MAX_BYTES);
  log.info(`Split into ${chunks.length} chunks`);

  const allWords: TranscriptWord[] = [];
  let globalWordIndex = 0;
  const sampleRate = fullBuffer.sampleRate;
  let sampleOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    signal?.throwIfAborted();
    const chunkTimeOffset = sampleOffset / sampleRate;
    const progressBase = 15 + (70 * i / chunks.length);
    const progressEnd = 15 + (70 * (i + 1) / chunks.length);

    updateClipTranscript(clipId, {
      progress: Math.round(progressBase),
      message: `Transcribing chunk ${i + 1}/${chunks.length}...`,
    });

    const chunkWav = await audioBufferToWav(chunks[i]);
    const rawWords = await openAISingleRequest(chunkWav, language, apiKey, variant, signal);
    const mappedWords = mapOpenAIWords(rawWords, chunkTimeOffset + inPointOffset, globalWordIndex);
    allWords.push(...mappedWords);
    globalWordIndex += mappedWords.length;

    updateClipTranscript(clipId, {
      progress: Math.round(progressEnd),
      words: allWords,
      message: `Chunk ${i + 1}/${chunks.length} done (${allWords.length} words)`,
    });

    sampleOffset += chunks[i].length;
  }

  return allWords;
}

async function transcribeWithAssemblyAI(
  clipId: string,
  audioBlob: Blob,
  language: string,
  apiKey: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
  signal?: AbortSignal,
): Promise<TranscriptWord[]> {
  updateClipTranscript(clipId, {
    progress: 15,
    message: 'Uploading to AssemblyAI...',
  });

  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBlob,
    signal,
  });

  if (!uploadResponse.ok) {
    throw new Error(`AssemblyAI upload failed: ${uploadResponse.statusText}`);
  }

  const { upload_url } = await uploadResponse.json();

  updateClipTranscript(clipId, {
    progress: 30,
    message: 'Starting transcription...',
  });

  const languageMap: Record<string, string> = {
    de: 'de',
    en: 'en',
    es: 'es',
    fr: 'fr',
    it: 'it',
    pt: 'pt',
    nl: 'nl',
    pl: 'pl',
    ru: 'ru',
    ja: 'ja',
    zh: 'zh',
    ko: 'ko',
  };

  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      ...(language === 'auto'
        ? { language_detection: true }
        : { language_code: languageMap[language] || language }),
    }),
    signal,
  });

  if (!transcriptResponse.ok) {
    throw new Error(`AssemblyAI transcription request failed: ${transcriptResponse.statusText}`);
  }

  const { id: transcriptId } = await transcriptResponse.json() as { id: string };
  let result: AssemblyTranscriptResponse | null = null;
  let attempts = 0;
  const maxAttempts = 120;

  while (attempts < maxAttempts) {
    signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    signal?.throwIfAborted();
    attempts++;

    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { Authorization: apiKey },
      signal,
    });

    result = await pollResponse.json() as AssemblyTranscriptResponse;

    if (result.status === 'completed') {
      break;
    } else if (result.status === 'error') {
      throw new Error(`AssemblyAI error: ${result.error}`);
    }

    const progress = 30 + Math.min(50, attempts * 0.5);
    updateClipTranscript(clipId, {
      progress,
      message: `Transcribing... (${result.status})`,
    });
  }

  if (!result || result.status !== 'completed') {
    throw new Error('AssemblyAI transcription timed out');
  }

  updateClipTranscript(clipId, {
    progress: 90,
    message: 'Processing response...',
  });

  return mapAssemblyAIWords(result.words || [], inPointOffset);
}

async function transcribeWithDeepgram(
  clipId: string,
  audioBlob: Blob,
  language: string,
  apiKey: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
  signal?: AbortSignal,
): Promise<TranscriptWord[]> {
  updateClipTranscript(clipId, {
    progress: 20,
    message: 'Sending to Deepgram...',
  });

  const params = new URLSearchParams({
    diarize_model: 'latest',
    model: 'nova-3',
    smart_format: 'true',
    utterances: 'true',
  });
  if (language === 'auto') {
    params.set('detect_language', 'true');
  } else {
    params.set('language', language);
  }

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: audioBlob,
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Deepgram API error: ${error.error || error.err_msg || response.statusText}`);
  }

  updateClipTranscript(clipId, {
    progress: 80,
    message: 'Processing response...',
  });

  const result = await response.json() as DeepgramResponse;
  const channel = result.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];

  if (!alternative) {
    throw new Error('No transcription results from Deepgram');
  }

  return mapDeepgramWords(alternative.words || [], inPointOffset);
}
