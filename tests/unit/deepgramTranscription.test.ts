import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateHostedDeepgramTranscriptionCredits,
  createHostedDeepgramTranscription,
} from '../../functions/lib/providers/deepgramTranscription';
import type { Env } from '../../functions/lib/env';
import type { PreparedHostedOpenAITranscription } from '../../functions/lib/providers/openaiTranscription';
import {
  mapHostedTranscriptionWords,
} from '../../src/services/transcription/cloudProviders';

const preparedAudio: PreparedHostedOpenAITranscription = {
  bytes: new Uint8Array([82, 73, 70, 70]),
  durationSeconds: 60,
  fileName: 'clip.wav',
  language: 'de',
  mimeType: 'audio/wav',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hosted Deepgram transcription', () => {
  it('uses the server-side key and normalizes Deepgram word results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: {
        channels: [{
          alternatives: [{
            words: [{
              confidence: 0.97,
              end: 1.2,
              punctuated_word: 'Hallo!',
              speaker: 1,
              speaker_confidence: 0.91,
              start: 0.5,
              word: 'hallo',
            }],
          }],
        }],
      },
    })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHostedDeepgramTranscription(
      { DEEPGRAM_API_KEY: 'server-secret' } as Env,
      preparedAudio,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, request] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('smart_format')).toBe('true');
    expect(url.searchParams.get('diarize_model')).toBe('latest');
    expect(url.searchParams.has('diarize')).toBe(false);
    expect(url.searchParams.get('utterances')).toBe('true');
    expect(url.searchParams.get('language')).toBe('de');
    expect(request).toMatchObject({
      headers: {
        Authorization: 'Token server-secret',
        'Content-Type': 'audio/wav',
      },
      method: 'POST',
    });
    expect(result).toEqual({
      durationSeconds: 60,
      model: 'nova-3',
      words: [{
        confidence: 0.97,
        end: 1.2,
        speaker: 1,
        speakerConfidence: 0.91,
        start: 0.5,
        word: 'Hallo!',
      }],
    });
  });

  it('enables automatic language detection when no language is requested', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: {
        channels: [{ alternatives: [{ words: [] }] }],
      },
    })));
    vi.stubGlobal('fetch', fetchMock);

    await createHostedDeepgramTranscription(
      { DEEPGRAM_API_KEY: 'server-secret' } as Env,
      { ...preparedAudio, language: undefined },
    );

    const [requestUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.searchParams.get('detect_language')).toBe('true');
    expect(url.searchParams.has('language')).toBe(false);
  });

  it('keeps hosted Deepgram speaker labels and confidence in timeline words', () => {
    expect(mapHostedTranscriptionWords('deepgram', [{
      confidence: 0.96,
      end: 1.25,
      speaker: 0,
      speakerConfidence: 0.89,
      start: 0.5,
      word: 'Hallo.',
    }], 4)).toEqual([{
      confidence: 0.96,
      end: 5.25,
      id: 'word-0',
      speaker: 'Speaker 1',
      speakerConfidence: 0.89,
      start: 4.5,
      text: 'Hallo.',
    }]);
  });

  it('charges the configured Deepgram rate in whole MasterSelects credits', () => {
    expect(calculateHostedDeepgramTranscriptionCredits(0)).toBe(1);
    expect(calculateHostedDeepgramTranscriptionCredits(60)).toBe(13);
    expect(calculateHostedDeepgramTranscriptionCredits(65)).toBe(14);
  });
});
