import type { Env } from '../env';
import type { PreparedHostedOpenAITranscription } from './openaiTranscription';
import type { HostedTranscriptionWord } from './hostedTranscriptionRoute';

const DEEPGRAM_TRANSCRIPTION_MODEL = 'nova-3';
const DEEPGRAM_TRANSCRIPTION_USD_PER_MINUTE = 0.0125;
const HOSTED_MASTERSELECTS_USD_PER_CREDIT = 0.001;

export interface HostedDeepgramTranscriptionResult {
  durationSeconds: number;
  model: string;
  words: HostedTranscriptionWord[];
}

interface DeepgramResponse {
  error?: string;
  err_msg?: string;
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        words?: Array<{
          confidence?: number;
          end?: number;
          punctuated_word?: string;
          speaker?: number | string;
          speaker_confidence?: number;
          start?: number;
          word?: string;
        }>;
      }>;
    }>;
  };
}

function getDeepgramKey(env: Env): string {
  const apiKey = env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not configured');
  return apiKey;
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function calculateHostedDeepgramTranscriptionCredits(durationSeconds: number): number {
  const safeDuration = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0);
  const usd = (safeDuration / 60) * DEEPGRAM_TRANSCRIPTION_USD_PER_MINUTE;
  return Math.max(1, Math.ceil(usd / HOSTED_MASTERSELECTS_USD_PER_CREDIT));
}

export async function createHostedDeepgramTranscription(
  env: Env,
  input: PreparedHostedOpenAITranscription,
): Promise<HostedDeepgramTranscriptionResult> {
  const params = new URLSearchParams({
    diarize_model: 'latest',
    model: DEEPGRAM_TRANSCRIPTION_MODEL,
    smart_format: 'true',
    utterances: 'true',
  });
  if (input.language) {
    params.set('language', input.language);
  } else {
    params.set('detect_language', 'true');
  }

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    body: new Blob([copyBytesToArrayBuffer(input.bytes)], { type: input.mimeType }),
    headers: {
      Authorization: `Token ${getDeepgramKey(env)}`,
      'Content-Type': input.mimeType,
    },
    method: 'POST',
  });
  const payload = await response.json().catch(() => null) as DeepgramResponse | null;

  if (!response.ok) {
    throw new Error(
      payload?.error
      ?? payload?.err_msg
      ?? `Deepgram transcription failed with status ${response.status}`,
    );
  }

  const rawWords = payload?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return {
    durationSeconds: input.durationSeconds,
    model: DEEPGRAM_TRANSCRIPTION_MODEL,
    words: rawWords.map((word) => ({
      confidence: word.confidence,
      end: word.end ?? word.start ?? 0,
      speaker: word.speaker,
      speakerConfidence: word.speaker_confidence,
      start: word.start ?? 0,
      word: word.punctuated_word ?? word.word ?? '',
    })),
  };
}
