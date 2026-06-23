import type { Env } from '../env';

const OPENAI_TRANSCRIPTION_MODEL = 'whisper-1';
const OPENAI_TRANSCRIPTION_USD_PER_MINUTE = 0.006;
const HOSTED_MASTERSELECTS_USD_PER_CREDIT = 0.001;

export interface HostedOpenAITranscriptionParams {
  audioBase64: string;
  fileName: string;
  language?: string;
  mimeType: string;
}

export interface PreparedHostedOpenAITranscription {
  bytes: Uint8Array;
  durationSeconds: number;
  fileName: string;
  language?: string;
  mimeType: string;
}

export interface HostedOpenAITranscriptionResult {
  durationSeconds: number;
  model: string;
  words: Array<{ word: string; start: number; end: number }>;
}

interface OpenAITranscriptionResponse {
  words?: Array<{ word: string; start: number; end: number }>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getOpenAIKey(env: Env): string {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  return apiKey;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function getWavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) throw new Error('Expected a WAV audio payload.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') {
    throw new Error('Expected a WAV audio payload.');
  }

  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readFourCc(view, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 20 <= view.byteLength) {
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === 'data') {
      dataBytes = size;
    }
    offset += 8 + size + (size % 2);
  }

  if (byteRate <= 0 || dataBytes <= 0) throw new Error('Could not read WAV duration.');
  return dataBytes / byteRate;
}

export function normalizeHostedOpenAITranscriptionParams(value: unknown): HostedOpenAITranscriptionParams | null {
  if (!isRecord(value)) return null;

  const audioBase64 = asString(value.audioBase64 ?? value.audio_base64);
  if (!audioBase64) return null;

  return {
    audioBase64,
    fileName: asString(value.fileName ?? value.file_name) ?? 'audio.wav',
    language: asString(value.language),
    mimeType: asString(value.mimeType ?? value.mime_type) ?? 'audio/wav',
  };
}

export function prepareHostedOpenAITranscription(
  params: HostedOpenAITranscriptionParams,
): PreparedHostedOpenAITranscription {
  const bytes = decodeBase64(params.audioBase64);
  return {
    bytes,
    durationSeconds: getWavDurationSeconds(bytes),
    fileName: params.fileName,
    language: params.language === 'auto' ? undefined : params.language,
    mimeType: params.mimeType,
  };
}

export function calculateHostedOpenAITranscriptionCredits(durationSeconds: number): number {
  const safeDuration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0);
  const usd = (safeDuration / 60) * OPENAI_TRANSCRIPTION_USD_PER_MINUTE;
  return Math.max(1, Math.ceil(usd / HOSTED_MASTERSELECTS_USD_PER_CREDIT));
}

export async function createHostedOpenAITranscription(
  env: Env,
  input: PreparedHostedOpenAITranscription,
): Promise<HostedOpenAITranscriptionResult> {
  const formData = new FormData();
  formData.append('file', new Blob([input.bytes], { type: input.mimeType }), input.fileName);
  formData.append('model', OPENAI_TRANSCRIPTION_MODEL);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  if (input.language) formData.append('language', input.language);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    body: formData,
    headers: { Authorization: `Bearer ${getOpenAIKey(env)}` },
    method: 'POST',
  });
  const payload = await response.json().catch(() => null) as OpenAITranscriptionResponse & {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `OpenAI transcription failed with status ${response.status}`);
  }

  return {
    durationSeconds: input.durationSeconds,
    model: OPENAI_TRANSCRIPTION_MODEL,
    words: payload?.words ?? [],
  };
}
