import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudApi } from '../../src/services/cloudApi';

describe('cloudApi AI chat timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('allows hosted chat requests to run longer than the default JSON timeout', async () => {
    vi.useFakeTimers();

    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const request = cloudApi.ai.chat.create({
      messages: [{ content: 'make vhs filter', role: 'user' }],
      model: 'gpt-5.1',
    });
    const rejection = expect(request).rejects.toThrow('Request to /api/ai/chat timed out after 180000ms.');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(169_999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });
});
