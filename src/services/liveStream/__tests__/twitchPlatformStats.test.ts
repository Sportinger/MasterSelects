import { describe, expect, it, vi } from 'vitest';

import {
  fetchTwitchPlatformStats,
  startTwitchPlatformStatsPolling,
} from '../twitchPlatformStats';

const liveStats = {
  configured: true as const,
  channel: 'creator',
  displayName: 'Creator',
  profileImageUrl: '',
  live: true,
  viewerCount: 12,
  title: 'Live now',
  gameName: 'Art',
  startedAt: '2026-08-24T10:00:00Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushAsync(): Promise<void> {
  // Response.json() consumes a body stream, which needs a macrotask tick.
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Twitch platform stats browser client', () => {
  it('maps signed-out and rate-limited responses to typed variants', async () => {
    const signedOutFetch = vi.fn(async () => jsonResponse({}, 401)) as unknown as typeof fetch;
    const limitedFetch = vi.fn(async () => jsonResponse({}, 429)) as unknown as typeof fetch;
    await expect(fetchTwitchPlatformStats('creator', { fetch: signedOutFetch })).resolves.toMatchObject({ error: 'signed_out' });
    await expect(fetchTwitchPlatformStats('creator', { fetch: limitedFetch })).resolves.toEqual({
      configured: true,
      error: 'rate_limited',
      keepLastValue: true,
    });
  });

  it('fires immediately, repeats every 30 seconds, preserves the last value on 429, and stops', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(liveStats))
      .mockResolvedValueOnce(jsonResponse({}, 429)) as unknown as typeof fetch;
    const onUpdate = vi.fn();
    const clearInterval = vi.fn();
    let intervalCallback: (() => void) | undefined;
    const stop = startTwitchPlatformStatsPolling(
      () => 'creator',
      onUpdate,
      {
        fetch: fetchMock,
        getVisibilityState: () => 'visible',
        setInterval: (callback, delayMs) => {
          expect(delayMs).toBe(30_000);
          intervalCallback = callback;
          return 'timer';
        },
        clearInterval,
      },
    );

    await flushAsync();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith(liveStats);

    intervalCallback?.();
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    stop();
    expect(clearInterval).toHaveBeenCalledWith('timer');
    intervalCallback?.();
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips hidden-tab ticks until the document is visible', async () => {
    let visibility = 'hidden';
    let intervalCallback: (() => void) | undefined;
    const fetchMock = vi.fn(async () => jsonResponse(liveStats)) as unknown as typeof fetch;
    const stop = startTwitchPlatformStatsPolling(
      () => 'creator',
      vi.fn(),
      {
        fetch: fetchMock,
        getVisibilityState: () => visibility,
        setInterval: callback => {
          intervalCallback = callback;
          return 1;
        },
        clearInterval: vi.fn(),
      },
    );

    await flushAsync();
    expect(fetchMock).not.toHaveBeenCalled();
    visibility = 'visible';
    intervalCallback?.();
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });
});
