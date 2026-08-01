import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudApi } from '../../src/services/cloudApi';

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
