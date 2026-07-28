import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../functions/lib/env';
import {
  createHostedOpenAITranscription,
  type PreparedHostedOpenAITranscription,
} from '../../functions/lib/providers/openaiTranscription';
import {
  mapHostedTranscriptionWords,
  transcribeWithCloudProvider,
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

  it('uses the same diarized review request with a local BYO OpenAI key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(diarizedResponse());
    vi.stubGlobal('fetch', fetchMock);

    const words = await transcribeWithCloudProvider(
      'openai',
      'clip-1',
      new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
      'de',
      'browser-secret',
      4,
      vi.fn(),
      { openAIVariant: 'diarized-speakers' },
    );

    const request = fetchMock.mock.calls[0][1];
    const body = request?.body as FormData;
    expect(body.get('model')).toBe('gpt-4o-transcribe-diarize');
    expect(body.get('response_format')).toBe('diarized_json');
    expect(body.get('chunking_strategy')).toBe('auto');
    expect(words.map(word => word.speaker)).toEqual([
      'Speaker A',
      'Speaker A',
      'Speaker B',
    ]);
    expect(words[0].start).toBe(4);
    expect(words[1].end).toBe(5);
  });

  it('keeps Whisper word timestamps for the normal OpenAI-only mode', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      words: [{ end: 0.5, start: 0.1, word: 'Test' }],
    })));
    vi.stubGlobal('fetch', fetchMock);

    await transcribeWithCloudProvider(
      'openai',
      'clip-1',
      new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
      'de',
      'browser-secret',
      0,
      vi.fn(),
    );

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('model')).toBe('whisper-1');
    expect(body.get('response_format')).toBe('verbose_json');
    expect(body.get('timestamp_granularities[]')).toBe('word');
    expect(body.has('chunking_strategy')).toBe(false);
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
