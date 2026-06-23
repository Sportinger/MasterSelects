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
  type TranscriptApiWord,
} from './resultMapping';

const log = Logger.create('ClipTranscriber');

interface OpenAITranscriptionResponse {
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

const OPENAI_MAX_BYTES = 24 * 1024 * 1024;

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
  clipId: string,
  requestId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  chunkIndex?: number,
): string {
  const chunk = chunkIndex === undefined ? 'single' : `chunk-${chunkIndex}`;
  return `transcription:${requestId}:${clipId}:${Math.round(inPointOffset * 1000)}:${audioBlob.size}:${language}:${chunk}`;
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
): Promise<TranscriptWord[]> {
  switch (provider) {
    case 'openai':
      return transcribeWithOpenAI(clipId, audioBlob, language, apiKey, inPointOffset, updateClipTranscript);
    case 'assemblyai':
      return transcribeWithAssemblyAI(clipId, audioBlob, language, apiKey, inPointOffset, updateClipTranscript);
    case 'deepgram':
      return transcribeWithDeepgram(clipId, audioBlob, language, apiKey, inPointOffset, updateClipTranscript);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function openAISingleRequest(
  audioBlob: Blob,
  language: string,
  apiKey: string,
): Promise<Array<{ word: string; start: number; end: number }>> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'whisper-1');
  if (language !== 'auto') {
    formData.append('language', language);
  }
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(`OpenAI API error: ${response.status}: ${error.error?.message || response.statusText}`);
  }

  const result = await response.json() as OpenAITranscriptionResponse;
  return result.words || [];
}

async function hostedOpenAISingleRequest(
  clipId: string,
  requestId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  chunkIndex?: number,
): Promise<Array<{ word: string; start: number; end: number }>> {
  const response = await cloudApi.ai.audio.transcription({
    action: 'transcription',
    idempotencyKey: createHostedTranscriptionIdempotencyKey(
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
    },
  });

  if (typeof response.creditBalance === 'number') {
    useAccountStore.getState().applyHostedCreditBalance(response.creditBalance);
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? 'Hosted OpenAI transcription failed.');
  }

  return response.data?.words ?? [];
}

export async function transcribeWithHostedOpenAI(
  clipId: string,
  audioBlob: Blob,
  language: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
): Promise<TranscriptWord[]> {
  const requestId = createHostedTranscriptionRequestId();

  if (audioBlob.size <= OPENAI_MAX_BYTES) {
    updateClipTranscript(clipId, { progress: 20, message: 'Sending to OpenAI Cloud...' });
    const rawWords = await hostedOpenAISingleRequest(clipId, requestId, audioBlob, language, inPointOffset);
    updateClipTranscript(clipId, { progress: 80, message: 'Processing response...' });
    return mapOpenAIWords(rawWords, inPointOffset);
  }

  log.info(`Audio WAV is ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB, splitting into chunks...`);
  updateClipTranscript(clipId, { progress: 10, message: 'Audio too large, splitting...' });

  const fullBuffer = await decodeAudioBlob(audioBlob);
  const chunks = splitAudioBuffer(fullBuffer, OPENAI_MAX_BYTES);
  const allWords: TranscriptWord[] = [];
  let globalWordIndex = 0;
  let sampleOffset = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkTimeOffset = sampleOffset / fullBuffer.sampleRate;
    const progressBase = 15 + (70 * index / chunks.length);
    const progressEnd = 15 + (70 * (index + 1) / chunks.length);

    updateClipTranscript(clipId, {
      progress: Math.round(progressBase),
      message: `Transcribing chunk ${index + 1}/${chunks.length}...`,
    });

    const chunkWav = await audioBufferToWav(chunks[index]);
    const rawWords = await hostedOpenAISingleRequest(
      clipId,
      requestId,
      chunkWav,
      language,
      chunkTimeOffset + inPointOffset,
      index,
    );
    const mappedWords = mapOpenAIWords(rawWords, chunkTimeOffset + inPointOffset, globalWordIndex);
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

async function transcribeWithOpenAI(
  clipId: string,
  audioBlob: Blob,
  language: string,
  apiKey: string,
  inPointOffset: number,
  updateClipTranscript: TranscriptUpdater,
): Promise<TranscriptWord[]> {
  if (audioBlob.size <= OPENAI_MAX_BYTES) {
    updateClipTranscript(clipId, { progress: 20, message: 'Sending to OpenAI...' });

    const rawWords = await openAISingleRequest(audioBlob, language, apiKey);

    updateClipTranscript(clipId, { progress: 80, message: 'Processing response...' });

    return mapOpenAIWords(rawWords, inPointOffset);
  }

  log.info(`Audio WAV is ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB, splitting into chunks...`);
  updateClipTranscript(clipId, { progress: 10, message: 'Audio too large, splitting...' });

  const fullBuffer = await decodeAudioBlob(audioBlob);
  const chunks = splitAudioBuffer(fullBuffer, OPENAI_MAX_BYTES);
  log.info(`Split into ${chunks.length} chunks`);

  const allWords: TranscriptWord[] = [];
  let globalWordIndex = 0;
  const sampleRate = fullBuffer.sampleRate;
  let sampleOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkTimeOffset = sampleOffset / sampleRate;
    const progressBase = 15 + (70 * i / chunks.length);
    const progressEnd = 15 + (70 * (i + 1) / chunks.length);

    updateClipTranscript(clipId, {
      progress: Math.round(progressBase),
      message: `Transcribing chunk ${i + 1}/${chunks.length}...`,
    });

    const chunkWav = await audioBufferToWav(chunks[i]);
    const rawWords = await openAISingleRequest(chunkWav, language, apiKey);
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
  });

  if (!transcriptResponse.ok) {
    throw new Error(`AssemblyAI transcription request failed: ${transcriptResponse.statusText}`);
  }

  const { id: transcriptId } = await transcriptResponse.json() as { id: string };
  let result: AssemblyTranscriptResponse | null = null;
  let attempts = 0;
  const maxAttempts = 120;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;

    const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { Authorization: apiKey },
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
): Promise<TranscriptWord[]> {
  updateClipTranscript(clipId, {
    progress: 20,
    message: 'Sending to Deepgram...',
  });

  const params = new URLSearchParams({
    model: 'nova-2',
    punctuate: 'true',
    utterances: 'false',
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
