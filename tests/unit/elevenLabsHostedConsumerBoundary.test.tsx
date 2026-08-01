import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlashBoardElevenLabsController } from '../../src/components/panels/flashboard/useFlashBoardElevenLabsController';
import {
  resumeFlashBoardProviderJob,
  runFlashBoardProviderJob,
} from '../../src/services/flashboard/FlashBoardProviderRunners';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function hostedEnvelope(data: unknown): Record<string, unknown> {
  return {
    data,
    kind: 'result',
    mode: 'hosted',
    ok: true,
    provider: 'elevenlabs',
    requestId: 'request-test',
    status: 'completed',
  };
}

function expectHostedAudioOnly(fetchMock: ReturnType<typeof vi.fn>): void {
  for (const rawCall of fetchMock.mock.calls) {
    const [input, init] = rawCall as [RequestInfo | URL, RequestInit | undefined];
    const url = new URL(String(input), window.location.origin);
    const headers = new Headers(init?.headers);
    const serializedRequest = JSON.stringify({
      body: init?.body,
      headers: Object.fromEntries(headers.entries()),
      url: url.toString(),
    });

    expect(url.pathname).toBe('/api/ai/audio');
    expect(headers.has('xi-api-key')).toBe(false);
    expect(serializedRequest).not.toMatch(/apiKey/i);
  }
}

describe('ElevenLabs hosted consumer boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('contains no Composer authorization or UI branch driven by a personal ElevenLabs key', () => {
    const affectedSources = [
      'src/components/panels/flashboard/useFlashBoardComposerAccessState.ts',
      'src/components/panels/flashboard/FlashBoardGenerationActionStatePlanner.ts',
      'src/components/panels/flashboard/FlashBoardComposer.tsx',
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

    for (const forbiddenSource of [
      'apiKeys.elevenlabs',
      'elevenLabsApiKey',
      'hasElevenLabsKey',
      'Configure ElevenLabs key',
      'Add an ElevenLabs API key',
    ]) {
      expect(affectedSources).not.toContain(forbiddenSource);
    }
  });

  it('lists models and voices only through /api/ai/audio', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.searchParams.get('action') === 'models') {
        return jsonResponse(hostedEnvelope({
          models: [{
            canDoTextToSpeech: true,
            canUseSpeakerBoost: true,
            canUseStyle: true,
            languages: [],
            modelId: 'eleven_multilingual_v2',
            name: 'Eleven Multilingual v2',
          }],
        }));
      }
      if (url.searchParams.get('action') === 'voices') {
        return jsonResponse(hostedEnvelope({
          hasMore: false,
          nextPageToken: null,
          voices: [{
            availableForTiers: [],
            highQualityBaseModelIds: [],
            labels: { accent: 'neutral' },
            name: 'Hosted Narrator',
            verifiedLanguages: [],
            voiceId: 'hosted-voice-1',
          }],
        }));
      }
      throw new Error(`Unexpected request: ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const setVersion = vi.fn();

    const { result } = renderHook(() => useFlashBoardElevenLabsController({
      hasHostedAudioAccess: true,
      isElevenLabsMode: true,
      setVersion,
      version: 'eleven_multilingual_v2',
    }));

    await waitFor(() => {
      expect(result.current.voiceOptions).toEqual([
        expect.objectContaining({ id: 'hosted-voice-1', name: 'Hosted Narrator' }),
      ]);
      expect(result.current.modelOptions).toEqual([
        expect.objectContaining({ id: 'eleven_multilingual_v2' }),
      ]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectHostedAudioOnly(fetchMock);
  });

  it('starts a hosted ElevenLabs speech request only through /api/ai/audio', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-MasterSelects-Output-Format': 'mp3_44100_128',
      },
      status: 200,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runFlashBoardProviderJob({
      abortController: new AbortController(),
      onProcessing: vi.fn(),
      recordId: 'speech-boundary',
      registerRunningJob: vi.fn(),
      request: {
        idempotencyKey: 'persisted-speech-start',
        outputFormat: 'mp3_44100_128',
        outputType: 'audio',
        prompt: 'Hosted only',
        providerId: 'cloud-elevenlabs-tts',
        referenceMediaFileIds: [],
        service: 'cloud',
        version: 'eleven_multilingual_v2',
        voiceId: 'voice-1',
        voiceName: 'Narrator',
      },
      resolveHostedReferenceMedia: vi.fn(),
      resolveReferenceImage: vi.fn(),
    });

    expect(result).toEqual(expect.objectContaining({
      mediaType: 'audio',
      status: 'completed',
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectHostedAudioOnly(fetchMock);
  });

  it.each([
    { providerId: 'cloud-elevenlabs-tts', service: 'cloud' as const },
  ])('fails persisted $providerId speech resume closed without any provider request', async (identity) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onProcessing = vi.fn();

    const result = await resumeFlashBoardProviderJob({
      abortController: new AbortController(),
      onProcessing,
      remoteTaskId: 'elevenlabs-persisted-speech',
      request: {
        ...identity,
        prompt: 'Do not replay this request',
        referenceMediaFileIds: [],
        version: 'eleven_multilingual_v2',
        voiceId: 'voice-1',
      },
    });

    expect(result).toEqual(expect.objectContaining({
      error: expect.stringContaining('/api/ai/audio does not expose a durable speech job/status contract'),
      status: 'failed',
    }));
    expect(onProcessing).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
