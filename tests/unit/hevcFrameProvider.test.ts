import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ nativeSupported: true, nativeFails: false, nativeSilent: false,
  nativeOpenFails: false, nativeStalls: false, wasmFails: false, nativeOpened: vi.fn(), wasmOpened: vi.fn(), closed: vi.fn(), disposed: vi.fn(),
}));
vi.mock('../../src/services/mediaRuntime/hevc/HevcPacketSource', () => ({
  HevcPacketSource: { create: async () => {
    const packet = { data: new Uint8Array([1]), timestamp: 0, duration: 1, microsecondTimestamp: 0,
      microsecondDuration: 1000000, storedIndex: 0, displayIndex: 0, isKeyframe: true };
    return { metadata: { duration: 1, width: 4, height: 2, codedWidth: 4, codedHeight: 2, rotation: 90, fps: 1 },
      config: { codec: 'hvc1.1.6.L120.B0' }, frameCount: 1,
      getPacketAt: async () => packet, getNextPacket: async () => null,
      getPacketByStoredIndex: async () => packet, displayToStoredIndex: () => 0,
      storedToDisplayIndex: () => 0, keyframeStoredIndexFor: () => 0, timestampToDisplayIndex: () => 0,
      dispose: mocks.disposed,
    };
  } },
}));
vi.mock('../../src/services/mediaRuntime/hevc/hevcDecoders', () => {
  function decoder(callbacks: any, native: boolean) {
    return { queueSize: 0,
      decode: (packet: any) => queueMicrotask(() => {
        if (native && (mocks.nativeSilent || mocks.nativeStalls)) return;
        if (native && mocks.nativeFails) callbacks.error(new Error('Native HEVC failed'));
        else callbacks.output({ timestamp: packet.microsecondTimestamp, codedWidth: 4, codedHeight: 2, close: vi.fn() });
      }),
      flush: async () => { if (native && mocks.nativeStalls) await new Promise(() => {}); }, reset: () => {}, close: mocks.closed,
      waitForCapacity: async () => {},
    };
  }
  return { supportsNativeHevc: async () => mocks.nativeSupported,
    NativeHevcDecoder: class { constructor(_config: unknown, callbacks: any) {
      mocks.nativeOpened(); if (mocks.nativeOpenFails) throw new Error('configure failed');
      return decoder(callbacks, true);
    } },
    WasmHevcDecoder: { create: async (_config: unknown, callbacks: any) => { mocks.wasmOpened(); if (mocks.wasmFails) throw new Error("WASM unavailable"); return decoder(callbacks, false); } },
  };
});
import { createHevcFrameProvider } from '../../src/services/mediaRuntime/hevc/HevcFrameProvider';
import { selectRuntimeFrameProviderPlan } from '../../src/services/mediaRuntime/providerSelection';
afterEach(() => {
  vi.clearAllMocks(); vi.useRealTimers(); mocks.nativeSupported = true; mocks.nativeFails = false;
  mocks.nativeOpenFails = false; mocks.nativeSilent = false; mocks.nativeStalls = false; mocks.wasmFails = false;
});
async function open() { return createHevcFrameProvider({ sourceId: 'test', file: new File(['hevc'], 'camera.mp4') }); }
describe('adaptive HEVC provider', () => {
  it('bounds a native decoder that never produces or flushes and releases it before falling back', async () => {
    vi.useFakeTimers(); mocks.nativeStalls = true;
    const pending = createHevcFrameProvider({ sourceId: 'stall', file: new File(['hevc'], 'stall.mp4'), loadTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const provider = await pending;
    expect(provider?.getDebugInfo().hwAccel).toBe('wasm-worker');
    expect(mocks.closed).toHaveBeenCalled();
    await provider!.destroyAsync();
  });
  it('reports a WASM startup failure and releases the source instead of leaving a silent black preview', async () => {
    mocks.nativeSupported = false; mocks.wasmFails = true;
    const onError = vi.fn();
    const provider = await createHevcFrameProvider({ sourceId: 'failed', file: new File(['hevc'], 'bad.mp4'), onError });
    expect(provider).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'WASM unavailable' }));
    expect(mocks.disposed).toHaveBeenCalledOnce();
  });
  it.each(['hvc1', 'hev1', 'hvc1.2.4.L153.B0', 'hevc'])('routes %s through the shared provider on every platform', codecId => {
    expect(selectRuntimeFrameProviderPlan({ videoCodecId: codecId, turboResEnabled: false })).toEqual({ backend: 'hevc', codecId });
  });
  it('keeps a working native decoder and does not load WASM', async () => {
    const provider = await open();
    expect(provider).not.toBeNull();
    await provider!.seekExact(0.5);
    expect(provider!.getCurrentFrame()?.timestamp).toBe(0);
    expect(provider!.getDebugInfo().hwAccel).toBe('webcodecs');
    expect(mocks.wasmOpened).not.toHaveBeenCalled();
    await provider!.destroyAsync();
    expect(mocks.closed).toHaveBeenCalled();
    expect(mocks.disposed).toHaveBeenCalledOnce();
  });
  it('uses WASM when the actual codec configuration is unsupported', async () => {
    mocks.nativeSupported = false;
    const provider = await open();
    expect(provider?.getDebugInfo().hwAccel).toBe('wasm-worker');
    expect(mocks.nativeOpened).not.toHaveBeenCalled();
    expect(mocks.wasmOpened).toHaveBeenCalledOnce();
    await provider!.destroyAsync();
  });
  it.each(['nativeFails', 'nativeOpenFails', 'nativeSilent'] as const)('recovers from %s after a positive capability check', async failure => {
    mocks[failure] = true;
    const provider = await open();
    expect(provider?.getDebugInfo().hwAccel).toBe('wasm-worker');
    expect(mocks.wasmOpened).toHaveBeenCalledOnce();
    await provider!.seekExact(0.4);
    expect(provider!.getCurrentFrame()).not.toBeNull();
    await provider!.destroyAsync();
  });
});
