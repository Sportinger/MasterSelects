import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAccountStore } from '../../src/stores/accountStore';
import { useSettingsStore, type TranscriptionProvider } from '../../src/stores/settingsStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  SIGNED_OUT_HOSTED_TRANSCRIPTION_MESSAGE,
  transcribeClip,
} from '../../src/services/clipTranscriber';
import {
  transcribeWithHostedProvider,
} from '../../src/services/transcription/cloudProviders';
import type { TimelineClip } from '../../src/types/timeline';

const signedOutProviderCases = ['openai', 'deepgram', 'hybrid'] satisfies TranscriptionProvider[];
const directProviderOrigins = [
  'https://api.openai.com',
  'https://api.deepgram.com',
];

function smallAudioBlob(): Blob {
  return {
    arrayBuffer: async () => new TextEncoder().encode('audio').buffer,
    size: 5,
    type: 'audio/wav',
  } as Blob;
}

function audioClip(): TimelineClip {
  return {
    duration: 1,
    effects: [],
    file: new File(['audio'], 'seeded-audio.wav', { type: 'audio/wav' }),
    id: 'seeded-clip',
    inPoint: 0,
    name: 'Seeded audio',
    outPoint: 1,
    source: null,
    startTime: 0,
    trackId: 'audio-1',
    transform: {} as TimelineClip['transform'],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  useAccountStore.setState({ session: null, user: null });
  useSettingsStore.setState({ transcriptionProvider: 'local' });
  useTimelineStore.setState({ clips: [] });
});

describe('hosted-only transcription boundary', () => {
  it('physically removes direct browser provider transports', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'src/services/transcription/cloudProviders.ts',
    ), 'utf8');
    expect(source).not.toContain('https://api.openai.com');
    expect(source).not.toContain('https://api.deepgram.com');
    expect(source).not.toContain('https://api.assemblyai.com');
    expect(source).not.toContain('transcribeWithCloudProvider');
  });

  it.each(signedOutProviderCases)(
    'fails closed for signed-out %s with no provider request',
    async (provider) => {
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      useAccountStore.setState({ session: null, user: null });
      useSettingsStore.setState({ transcriptionProvider: provider });
      useTimelineStore.setState({ clips: [audioClip()] });

      await transcribeClip('seeded-clip', 'de');

      const directProviderRequests = fetchMock.mock.calls.filter(([input]) => (
        directProviderOrigins.some((origin) => String(input).startsWith(origin))
      ));
      expect(directProviderRequests).toEqual([]);
      expect(useTimelineStore.getState().clips[0]).toMatchObject({
        transcriptMessage: SIGNED_OUT_HOSTED_TRANSCRIPTION_MESSAGE,
        transcriptProgress: 0,
        transcriptStatus: 'error',
      });
    },
  );

  it.each([
    { provider: 'openai' as const, status: 401 },
    { provider: 'deepgram' as const, status: 403 },
    { provider: 'openai' as const, status: 500 },
  ])('keeps hosted $status failures on the hosted boundary for $provider', async ({ provider, status }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { message: `Hosted transcription failed with ${status}` },
    }), {
      headers: { 'Content-Type': 'application/json' },
      status,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeWithHostedProvider(
      provider,
      'seeded-clip',
      smallAudioBlob(),
      'de',
      0,
      vi.fn(),
    )).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe('/api/ai/audio');
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('xi-api-key')).toBe(false);
    expect(headers.has('x-api-key')).toBe(false);
    expect(JSON.stringify(init?.body)).not.toMatch(/seeded-(?:openai|deepgram|assembly)-key/);
  });
});
