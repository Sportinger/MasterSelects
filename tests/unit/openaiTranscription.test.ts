import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../functions/lib/env';
import {
  createHostedOpenAITranscription,
  type PreparedHostedOpenAITranscription,
} from '../../functions/lib/providers/openaiTranscription';
import {
  mapHostedTranscriptionWords,
} from '../../src/services/transcription/cloudProviders';

const diarizedAudio: PreparedHostedOpenAITranscription = {
  bytes: new Uint8Array([82, 73, 70, 70]),
  durationSeconds: 60,
  fileName: 'clip.wav',
  language: 'de',
  mimeType: 'audio/wav',
  variant: 'diarized-speakers',
};

function diarizedResponse(): Response {
  return new Response(JSON.stringify({
    segments: [
      { end: 1, speaker: 'A', start: 0, text: 'Hallo Welt' },
      { end: 1.5, speaker: 'B', start: 1, text: 'Ja.' },
    ],
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI diarized transcription review', () => {
  it('uses the diarization model and normalizes its speaker segments on the hosted path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(diarizedResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHostedOpenAITranscription(
      { OPENAI_API_KEY: 'server-secret' } as Env,
      diarizedAudio,
    );

    const [requestUrl, request] = fetchMock.mock.calls[0];
    const body = request?.body as FormData;
    expect(requestUrl).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(request).toMatchObject({
      headers: { Authorization: 'Bearer server-secret' },
      method: 'POST',
    });
    expect(body.get('model')).toBe('gpt-4o-transcribe-diarize');
    expect(body.get('response_format')).toBe('diarized_json');
    expect(body.get('chunking_strategy')).toBe('auto');
    expect(body.has('timestamp_granularities[]')).toBe(false);
    expect(result.model).toBe('gpt-4o-transcribe-diarize');
    expect(result.words).toHaveLength(3);
    expect(result.words.map(word => word.speaker)).toEqual(['A', 'A', 'B']);
    expect(result.words[0].start).toBe(0);
    expect(result.words[1].end).toBe(1);
  });

  it('maps hosted diarized labels without pretending they are provider word timings', () => {
    const words = mapHostedTranscriptionWords('openai', [{
      end: 1,
      speaker: 'A',
      start: 0.5,
      word: 'Hallo',
    }], 2);
    expect(words).toEqual([{
      confidence: 1,
      end: 3,
      id: 'word-0',
      speaker: 'Speaker A',
      start: 2.5,
      text: 'Hallo',
    }]);
  });
});
