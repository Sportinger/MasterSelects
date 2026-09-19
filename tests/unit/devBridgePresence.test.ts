import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerBridgePresence,
  type BrowserHot,
} from '../../src/services/aiTools/devBridge/browser/presence';

interface HotHarness {
  dispose: ReturnType<typeof vi.fn>;
  handlers: Map<string, (data?: unknown) => void>;
  hot: BrowserHot;
  send: ReturnType<typeof vi.fn>;
}

function createHotHarness(): HotHarness {
  const handlers = new Map<string, (data?: unknown) => void>();
  const send = vi.fn();
  const dispose = vi.fn();
  const hot = {
    data: {},
    accept: vi.fn(),
    decline: vi.fn(),
    dispose,
    invalidate: vi.fn(),
    on: vi.fn((event: string, handler: (data?: unknown) => void) => handlers.set(event, handler)),
    off: vi.fn((event: string) => handlers.delete(event)),
    prune: vi.fn(),
    send,
  } as unknown as BrowserHot;
  return { dispose, handlers, hot, send };
}

describe('dev bridge presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('waits for Vite to connect before sending presence', () => {
    const harness = createHotHarness();
    registerBridgePresence(harness.hot, () => vi.fn(), () => ({ projectName: 'CRazy' }));

    expect(harness.send).not.toHaveBeenCalled();
    harness.handlers.get('vite:ws:connect')?.();

    expect(harness.send).toHaveBeenCalledOnce();
    expect(harness.send).toHaveBeenCalledWith('ai-tools:presence', expect.objectContaining({
      session: { projectName: 'CRazy' },
    }));
  });

  it('stops interval sends after the Vite socket disconnects', () => {
    const harness = createHotHarness();
    registerBridgePresence(harness.hot, () => vi.fn());
    harness.handlers.get('vite:ws:connect')?.();
    expect(harness.send).toHaveBeenCalledOnce();

    harness.handlers.get('vite:ws:disconnect')?.();
    vi.advanceTimersByTime(9_000);

    expect(harness.send).toHaveBeenCalledOnce();
  });

  it('falls back after confirming Vite is reachable when connect fired before registration', async () => {
    const harness = createHotHarness();
    registerBridgePresence(harness.hot, () => vi.fn());

    await vi.advanceTimersByTimeAsync(499);
    expect(harness.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.send).toHaveBeenCalledOnce();
  });

  it('does not start presence sends when the Vite server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));
    const harness = createHotHarness();
    registerBridgePresence(harness.hot, () => vi.fn());

    await vi.advanceTimersByTimeAsync(10_000);

    expect(harness.send).not.toHaveBeenCalled();
  });

  it('removes connection listeners and timers during HMR disposal', () => {
    const harness = createHotHarness();
    const disposeResources = vi.fn();
    registerBridgePresence(harness.hot, () => disposeResources);
    const disposeHandler = harness.dispose.mock.calls[0]?.[0] as (() => void) | undefined;

    disposeHandler?.();
    vi.advanceTimersByTime(10_000);

    expect(disposeResources).toHaveBeenCalledOnce();
    expect(harness.handlers.has('vite:ws:connect')).toBe(false);
    expect(harness.handlers.has('vite:ws:disconnect')).toBe(false);
    expect(harness.send).not.toHaveBeenCalled();
  });
});
