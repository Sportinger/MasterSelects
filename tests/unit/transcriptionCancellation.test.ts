import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudApi } from '../../src/services/cloudApi';
import { transcribeWithCloudProvider } from '../../src/services/transcription/cloudProviders';

function pendingFetch(): typeof fetch {
  return vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transcription cancellation', () => {
  it('aborts a direct provider request', async () => {
    vi.stubGlobal('fetch', pendingFetch());
    const controller = new AbortController();
    const request = transcribeWithCloudProvider(
      'openai',
      'clip-1',
      new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
      'de',
      'browser-secret',
      0,
      vi.fn(),
      { openAIVariant: 'diarized-speakers', signal: controller.signal },
    );

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves AbortError for the hosted Cloudflare request', async () => {
    vi.stubGlobal('fetch', pendingFetch());
    const controller = new AbortController();
    const request = cloudApi.ai.audio.transcription({
      action: 'transcription',
      params: {
        audioBase64: 'UklGRg==',
        provider: 'deepgram',
      },
    }, controller.signal);

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
