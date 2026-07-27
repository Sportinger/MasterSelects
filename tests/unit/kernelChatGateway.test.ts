import { describe, expect, it, vi } from 'vitest';
import type { KernelServiceClient } from '../../src/services/kernelClient';
import { tryKernelFirst } from '../../src/services/kernelClient/kernelChatGateway';

function createStorage(values: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(values));

  return {
    clear: vi.fn(() => entries.clear()),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    get length() {
      return entries.size;
    },
    removeItem: vi.fn((key: string) => entries.delete(key)),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
  };
}

function createClient(result: unknown): {
  client: KernelServiceClient;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn().mockResolvedValue(result);
  return {
    client: { run } as unknown as KernelServiceClient,
    run,
  };
}

const enabledStorage = () => createStorage({
  'ms.kernel.enabled': 'true',
  'ms.kernel.token': 'test-token',
});

describe('tryKernelFirst', () => {
  it('falls through without calling the client when the gateway is disabled', async () => {
    const { client, run } = createClient({
      ok: true,
      status: 200,
      data: { status: 'succeeded' },
    });

    await expect(tryKernelFirst('Schneide den Clip', {
      client,
      storage: createStorage({ 'ms.kernel.token': 'test-token' }),
    })).resolves.toEqual({ handled: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('handles succeeded runs and includes the fingerprint fragment', async () => {
    const { client, run } = createClient({
      ok: true,
      status: 200,
      data: {
        fingerprint: 'abcdef1234567890',
        runId: 'run-1',
        status: 'succeeded',
      },
    });

    const result = await tryKernelFirst('Schneide den Clip', {
      client,
      storage: enabledStorage(),
    });

    expect(run).toHaveBeenCalledWith({ request: 'Schneide den Clip' });
    expect(result).toMatchObject({
      handled: true,
      message: expect.stringContaining('Kernel-verifiziert'),
      runId: 'run-1',
    });
    expect(result.handled && result.message).toContain('abcdef12');
  });

  it('falls through for aborted runs', async () => {
    const { client } = createClient({
      ok: true,
      status: 200,
      data: {
        reason: 'capability not migrated',
        status: 'aborted',
      },
    });

    await expect(tryKernelFirst('Erstelle Untertitel', {
      client,
      storage: enabledStorage(),
    })).resolves.toEqual({ handled: false });
  });

  it('falls through when the kernel client throws a network error', async () => {
    const run = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = { run } as unknown as KernelServiceClient;

    await expect(tryKernelFirst('Schneide den Clip', {
      client,
      storage: enabledStorage(),
    })).resolves.toEqual({ handled: false });
  });

  it('handles failed runs with an honest failure message', async () => {
    const { client } = createClient({
      ok: true,
      status: 200,
      data: {
        error: 'Timeline revision changed',
        runId: 'run-2',
        status: 'failed',
      },
    });

    const result = await tryKernelFirst('Schneide den Clip', {
      client,
      storage: enabledStorage(),
    });

    expect(result).toEqual({
      handled: true,
      message: 'Kernel-Ausf\u00fchrung fehlgeschlagen: Timeline revision changed',
      runId: 'run-2',
    });
  });
});
