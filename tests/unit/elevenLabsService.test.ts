import { afterEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => logger),
  },
}));

import {
  calculateHostedElevenLabsCredits,
  ELEVENLABS_MP3_MIME_TYPE,
  ElevenLabsService,
  ElevenLabsServiceError,
  estimateHostedElevenLabsSpeechCredits,
  getElevenLabsModelCharacterCostMultiplier,
  type ElevenLabsMp3OutputFormat,
} from '../../src/services/elevenLabsService';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function audioResponse(data = new Uint8Array([1, 2, 3, 4])): Response {
  return new Response(data, {
    status: 200,
    headers: { 'Content-Type': ELEVENLABS_MP3_MIME_TYPE },
  });
}

describe('ElevenLabsService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('lists text-to-speech models with xi-api-key authentication', async () => {
    const service = new ElevenLabsService();
    service.setApiKey(' el-test-key ');
    const fetchMock = vi.fn(async () => jsonResponse([
      {
        model_id: 'eleven_multilingual_v2',
        name: 'Eleven Multilingual v2',
        can_do_text_to_speech: true,
        can_do_voice_conversion: true,
        can_use_style: true,
        can_use_speaker_boost: true,
        maximum_text_length_per_request: 10000,
        languages: [{ language_id: 'en', name: 'English' }],
        model_rates: {
          character_cost_multiplier: 1,
          cost_discount_multiplier: 0.8,
        },
      },
      {
        model_id: 'voice_conversion_only',
        name: 'Voice Conversion',
        can_do_text_to_speech: false,
      },
    ]));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const models = await service.listModels();

    expect(fetchMock).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': 'el-test-key',
      },
      signal: undefined,
    });
    expect(models).toEqual([
      {
        modelId: 'eleven_multilingual_v2',
        name: 'Eleven Multilingual v2',
        description: undefined,
        canDoTextToSpeech: true,
        canDoVoiceConversion: true,
        canUseStyle: true,
        canUseSpeakerBoost: true,
        maxCharactersRequestFreeUser: undefined,
        maxCharactersRequestSubscribedUser: undefined,
        maximumTextLengthPerRequest: 10000,
        languages: [{ languageId: 'en', name: 'English' }],
        modelRates: {
          characterCostMultiplier: 1,
          costDiscountMultiplier: 0.8,
        },
        concurrencyGroup: undefined,
      },
    ]);
  });

  it('searches voices with pagination and normalizes voice metadata', async () => {
    const service = new ElevenLabsService();
    service.setApiKey('el-test-key');
    const fetchMock = vi.fn(async () => jsonResponse({
      voices: [
        {
          voice_id: 'voice_1',
          name: 'Rachel',
          category: 'premade',
          description: 'Warm narration',
          preview_url: 'https://example.test/preview.mp3',
          labels: { accent: 'American', gender: 'female', ignored: 12 },
          settings: {
            stability: 0.6,
            similarity_boost: 0.8,
            style: 0.2,
            use_speaker_boost: true,
            speed: 1,
          },
          high_quality_base_model_ids: ['eleven_multilingual_v2'],
          verified_languages: [{ language: 'en', model_id: 'eleven_multilingual_v2', locale: 'en-US' }],
          available_for_tiers: ['creator'],
          is_owner: true,
          created_at_unix: 1714204800,
        },
      ],
      has_more: true,
      total_count: 42,
      next_page_token: 'next-token',
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await service.listVoices({
      search: 'Rachel',
      pageSize: 250,
      sort: 'name',
      sortDirection: 'asc',
      voiceType: 'personal',
      includeTotalCount: false,
      voiceIds: ['voice_1', 'voice_2', ''],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url);
    expect(parsedUrl.origin).toBe('https://api.elevenlabs.io');
    expect(parsedUrl.pathname).toBe('/v2/voices');
    expect(parsedUrl.searchParams.get('search')).toBe('Rachel');
    expect(parsedUrl.searchParams.get('page_size')).toBe('100');
    expect(parsedUrl.searchParams.get('sort')).toBe('name');
    expect(parsedUrl.searchParams.get('sort_direction')).toBe('asc');
    expect(parsedUrl.searchParams.get('voice_type')).toBe('personal');
    expect(parsedUrl.searchParams.get('include_total_count')).toBe('false');
    expect(parsedUrl.searchParams.getAll('voice_ids')).toEqual(['voice_1', 'voice_2']);
    expect(init.headers).toMatchObject({ 'xi-api-key': 'el-test-key' });
    expect(result).toEqual({
      voices: [
        {
          voiceId: 'voice_1',
          name: 'Rachel',
          category: 'premade',
          description: 'Warm narration',
          previewUrl: 'https://example.test/preview.mp3',
          labels: { accent: 'American', gender: 'female' },
          settings: {
            stability: 0.6,
            similarityBoost: 0.8,
            style: 0.2,
            useSpeakerBoost: true,
            speed: 1,
          },
          highQualityBaseModelIds: ['eleven_multilingual_v2'],
          verifiedLanguages: [
            {
              language: 'en',
              modelId: 'eleven_multilingual_v2',
              accent: undefined,
              locale: 'en-US',
              previewUrl: undefined,
            },
          ],
          availableForTiers: ['creator'],
          isOwner: true,
          isLegacy: undefined,
          isMixed: undefined,
          createdAtUnix: 1714204800,
        },
      ],
      hasMore: true,
      totalCount: 42,
      nextPageToken: 'next-token',
    });
  });

  it('creates speech as MP3 without logging raw key or text', async () => {
    const service = new ElevenLabsService();
    service.setApiKey('el-secret-key');
    const sensitiveText = 'Confidential script payload that must not be logged.';
    const fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await service.createSpeech({
      voiceId: 'voice/1',
      text: sensitiveText,
      modelId: 'eleven_multilingual_v2',
      languageCode: 'en',
      outputFormat: 'mp3_22050_32',
      voiceSettings: {
        speed: 1,
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: true,
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice%2F1?output_format=mp3_22050_32');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'xi-api-key': 'el-secret-key',
      Accept: ELEVENLABS_MP3_MIME_TYPE,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: sensitiveText,
      model_id: 'eleven_multilingual_v2',
      language_code: 'en',
      voice_settings: {
        speed: 1,
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
      },
    });
    expect(result).toMatchObject({
      mimeType: ELEVENLABS_MP3_MIME_TYPE,
      extension: 'mp3',
      outputFormat: 'mp3_22050_32',
      size: 4,
    });

    const logPayload = JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logPayload).not.toContain('el-secret-key');
    expect(logPayload).not.toContain(sensitiveText);
  });

  it('rejects missing credentials, invalid speech input, and non-MP3 formats cleanly', async () => {
    const service = new ElevenLabsService();

    await expect(service.listModels()).rejects.toMatchObject({
      code: 'missing_api_key',
      message: 'ElevenLabs API key is not configured.',
    });

    service.setApiKey('el-test-key');

    await expect(service.createSpeech({ voiceId: '', text: 'hello' })).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'Choose an ElevenLabs voice before generating speech.',
    });

    await expect(service.createSpeech({ voiceId: 'voice_1', text: '   ' })).rejects.toMatchObject({
      code: 'invalid_request',
      message: 'Enter text to generate speech.',
    });

    await expect(service.createSpeech({
      voiceId: 'voice_1',
      text: 'hello',
      outputFormat: 'pcm_44100' as ElevenLabsMp3OutputFormat,
    })).rejects.toMatchObject({
      code: 'unsupported_format',
    });
  });

  it('normalizes provider and network failures', async () => {
    const service = new ElevenLabsService();
    service.setApiKey('el-secret-key');
    const sensitiveText = 'Never write this prompt to logs.';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ detail: { message: 'Monthly quota exceeded' } }, 402))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(service.createSpeech({ voiceId: 'voice_1', text: sensitiveText })).rejects.toMatchObject({
      code: 'quota_exceeded',
      status: 402,
      message: 'Monthly quota exceeded',
    });

    await expect(service.listVoices()).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    });

    const logPayload = JSON.stringify(logger.warn.mock.calls);
    expect(logPayload).toContain('quota_exceeded');
    expect(logPayload).toContain('network_error');
    expect(logPayload).not.toContain('el-secret-key');
    expect(logPayload).not.toContain(sensitiveText);
  });

  it('uses a typed service error for aborted requests', async () => {
    const error = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    const service = new ElevenLabsService();
    service.setApiKey('el-test-key');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw error;
    }) as unknown as typeof fetch);

    await expect(service.listModels()).rejects.toEqual(expect.any(ElevenLabsServiceError));
    await expect(service.listModels()).rejects.toMatchObject({ code: 'aborted' });
  });

  it('estimates hosted speech credits from text length and model multiplier', () => {
    expect(getElevenLabsModelCharacterCostMultiplier('eleven_flash_v2_5')).toBe(0.5);
    expect(getElevenLabsModelCharacterCostMultiplier('eleven_turbo_v2_5')).toBe(0.5);
    expect(getElevenLabsModelCharacterCostMultiplier('eleven_multilingual_v2')).toBe(1);
    expect(getElevenLabsModelCharacterCostMultiplier('custom', { characterCostMultiplier: 0.25 })).toBe(0.25);

    expect(estimateHostedElevenLabsSpeechCredits('a'.repeat(1000), 'eleven_flash_v2_5')).toMatchObject({
      providerCredits: 500,
      creditsRequired: 50,
      usdEstimate: 0.05,
      textCharacters: 1000,
    });
    expect(estimateHostedElevenLabsSpeechCredits('a'.repeat(1000), 'eleven_multilingual_v2')).toMatchObject({
      providerCredits: 1000,
      creditsRequired: 100,
      usdEstimate: 0.1,
      textCharacters: 1000,
    });
    expect(calculateHostedElevenLabsCredits(0)).toBe(0);
    expect(calculateHostedElevenLabsCredits(1)).toBe(1);
  });
});
