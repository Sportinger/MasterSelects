import { describe, expect, it, vi } from 'vitest';
import {
  isKernelServiceAvailable,
  KernelServiceClient,
} from '../../src/services/kernelClient';

function jsonResponse(data: unknown, status = 200): Response {
  return {
    json: vi.fn(async () => data),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe('KernelServiceClient', () => {
  it('uses the health URL without authorization', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }));
    const client = new KernelServiceClient({
      authToken: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.health();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/health');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { status: 'ok' },
    });
  });

  it('posts run requests with authorization and the complete body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'run-1' }, 202));
    const client = new KernelServiceClient({
      authToken: 'secret',
      baseUrl: 'http://localhost:9000/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.run({
      request: { operation: 'render' },
      seed: 42,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:9000/kernel/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      request: { operation: 'render' },
      seed: 42,
    });
  });

  it('posts validation requests and addresses manifest and run endpoints', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = new KernelServiceClient({
      authToken: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.validate({
      request: 'compile',
      snapshot: { revision: 3 },
    });
    await client.manifests();
    await client.getRun('run/with spaces');

    const [validateUrl, validateInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(validateUrl).toBe('http://127.0.0.1:8787/kernel/validate');
    expect(JSON.parse(validateInit.body as string)).toEqual({
      request: 'compile',
      snapshot: { revision: 3 },
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('http://127.0.0.1:8787/kernel/manifests');
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('http://127.0.0.1:8787/kernel/runs/run%2Fwith%20spaces');
  });

  it('passes the configured timeout through as an abort signal', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    ));
    const client = new KernelServiceClient({
      authToken: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 25,
    });

    const pending = client.manifests();
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({
      ok: false,
      status: 0,
      error: 'Kernel service request timed out after 25ms.',
    });
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    vi.useRealTimers();
  });

  it('maps HTTP and network errors to typed failures', async () => {
    const httpFetch = vi.fn(async () => jsonResponse({
      error: { message: 'Snapshot rejected' },
    }, 422));
    const httpClient = new KernelServiceClient({
      authToken: 'secret',
      fetchImpl: httpFetch as unknown as typeof fetch,
    });

    await expect(httpClient.validate({
      request: {},
      snapshot: {},
    })).resolves.toEqual({
      ok: false,
      status: 422,
      error: 'Snapshot rejected',
    });

    const networkFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const networkClient = new KernelServiceClient({
      authToken: 'secret',
      fetchImpl: networkFetch as unknown as typeof fetch,
    });

    await expect(networkClient.getRun('run-1')).resolves.toEqual({
      ok: false,
      status: 0,
      error: 'Failed to fetch',
    });
  });

  it('checks availability with the health endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }));
    const client = new KernelServiceClient({
      authToken: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(isKernelServiceAvailable(client)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8787/health');
  });
});
