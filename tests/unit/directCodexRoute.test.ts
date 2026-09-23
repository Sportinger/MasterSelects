import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/direct-codex/ws';
import type { AppContext } from '../../functions/lib/env';

const guest = {
  email: 'guest-id@guest.masterselects.invalid',
  id: 'guest:00000000-0000-4000-8000-000000000000',
};

function contextFor(data: AppContext['data']): AppContext {
  return {
    data,
    env: {
      DB: {} as AppContext['env']['DB'],
      KERNEL_AUTH_TOKEN: 'kernel-token',
      KV: {} as AppContext['env']['KV'],
      MEDIA: {} as AppContext['env']['MEDIA'],
    },
    next: async () => new Response(null),
    params: {},
    request: new Request('https://www.masterselects.com/api/direct-codex/ws', {
      headers: {
        Origin: 'https://www.masterselects.com',
        Upgrade: 'websocket',
      },
    }),
    waitUntil: vi.fn(),
  };
}

describe('Codex Direct edge route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('relays a verified guest principal to the private kernel', async () => {
    const upstream = new Response(null, { status: 204 });
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest(contextFor({ guestUser: guest, user: null }));

    expect(response).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://fassandra.de/kernel/direct-codex/ws'),
      {
        headers: {
          Authorization: 'Bearer kernel-token',
          Upgrade: 'websocket',
          'X-MasterSelects-Principal': guest.id,
        },
        method: 'GET',
      },
    );
  });

  it('passes Cloudflare client IP to the authenticated kernel relay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const context = contextFor({ guestUser: guest, user: null });
    context.request = new Request(context.request.url, { headers: {
      Origin: 'https://www.masterselects.com', Upgrade: 'websocket',
      'CF-Connecting-IP': '198.51.100.23',
    } });
    await onRequest(context);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-MasterSelects-Client-IP': '198.51.100.23',
    });
  });

  it('rejects a request without a verified account or guest principal', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest(contextFor({ guestUser: null, user: null }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
