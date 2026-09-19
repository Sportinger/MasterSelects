import { afterEach, describe, expect, it, vi } from 'vitest';

import { VideoEncoderWrapper } from '../../src/engine/export/VideoEncoderWrapper';
import type { ExportSettings } from '../../src/engine/export/types';

class MockVideoFrame {
  static instances: MockVideoFrame[] = [];
  readonly close = vi.fn();

  constructor(
    readonly data: AllowSharedBufferSource,
    readonly init: VideoFrameBufferInit,
  ) {
    MockVideoFrame.instances.push(this);
  }
}

class MockVideoEncoder {
  static instances: MockVideoEncoder[] = [];
  static isConfigSupported = vi.fn(async (config: VideoEncoderConfig) => ({
    supported: true,
    config,
  }));

  readonly configure = vi.fn(() => {
    this.state = 'configured';
  });
  readonly encode = vi.fn(() => {
    this.encodeQueueSize += 1;
  });
  readonly flush = vi.fn(async () => {
    this.encodeQueueSize = 0;
  });
  readonly close = vi.fn(() => {
    this.state = 'closed';
  });
  encodeQueueSize = 0;
  state: CodecState = 'unconfigured';

  constructor(_init: VideoEncoderInit) {
    MockVideoEncoder.instances.push(this);
  }
}

function createSettings(): ExportSettings {
  return {
    width: 2,
    height: 2,
    fps: 30,
    bitrate: 1_000_000,
    codec: 'h264',
    container: 'mp4',
    includeAudio: false,
    rateControl: 'vbr',
  } as ExportSettings;
}

describe('VideoEncoderWrapper export backpressure', () => {
  it.each(['rgba', 'zero-copy'] as const)('holds no codec during preparation and starts on the first %s frame', async (mode) => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    const wrapper = new VideoEncoderWrapper(createSettings());
    await expect(wrapper.init({ deferVideoEncoder: true })).resolves.toBe(true);
    expect(MockVideoEncoder.isConfigSupported).toHaveBeenCalled();
    expect(MockVideoEncoder.instances).toHaveLength(0);
    if (mode === 'rgba') await wrapper.encodeFrame(new Uint8ClampedArray(16), 0);
    else await wrapper.encodeVideoFrame({} as VideoFrame, 0);
    expect(MockVideoEncoder.instances).toHaveLength(1);
    expect(MockVideoEncoder.instances[0].encode).toHaveBeenCalledOnce();
    wrapper.cancel();
  });

  it('cancels deferred preparation without allocating a codec afterward', async () => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    const wrapper = new VideoEncoderWrapper(createSettings());
    await wrapper.init({ deferVideoEncoder: true });
    wrapper.cancel();
    await expect(wrapper.encodeVideoFrame({} as VideoFrame, 0)).rejects.toThrow('closed');
    expect(MockVideoEncoder.instances).toHaveLength(0);
  });

  it('does not resume initialization after cancellation during a support check', async () => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    let resolve!: (result: { supported: boolean; config: VideoEncoderConfig }) => void;
    MockVideoEncoder.isConfigSupported.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const wrapper = new VideoEncoderWrapper(createSettings());
    const pending = wrapper.init({ deferVideoEncoder: true });
    await Promise.resolve();
    wrapper.cancel();
    resolve({ supported: true, config: {} as VideoEncoderConfig });
    await expect(pending).resolves.toBe(false);
    expect(MockVideoEncoder.instances).toHaveLength(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MockVideoEncoder.instances = [];
    MockVideoFrame.instances = [];
    MockVideoEncoder.isConfigSupported.mockClear();
  });

  it('flushes a full encode queue before allocating another RGBA VideoFrame', async () => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    Object.defineProperty(window, 'VideoEncoder', {
      configurable: true,
      value: MockVideoEncoder,
    });

    const wrapper = new VideoEncoderWrapper(createSettings());
    await expect(wrapper.init()).resolves.toBe(true);

    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    for (let frame = 0; frame < 5; frame++) {
      await wrapper.encodeFrame(pixels, frame);
    }

    const encoder = MockVideoEncoder.instances[0];
    expect(encoder.flush).toHaveBeenCalledOnce();
    expect(encoder.encodeQueueSize).toBe(1);
    expect(MockVideoFrame.instances).toHaveLength(5);
    for (const frame of MockVideoFrame.instances) {
      expect(frame.close).toHaveBeenCalledOnce();
    }

    wrapper.cancel();
  });

  it('periodically flushes even when Chromium reports an empty encode queue', async () => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    Object.defineProperty(window, 'VideoEncoder', {
      configurable: true,
      value: MockVideoEncoder,
    });

    const settings = {
      ...createSettings(),
      width: 1024,
      height: 1024,
    };
    const wrapper = new VideoEncoderWrapper(settings);
    await expect(wrapper.init()).resolves.toBe(true);

    const encoder = MockVideoEncoder.instances[0];
    encoder.encode.mockImplementation(() => {
      // Chromium may accept the control message immediately while retaining the
      // frame's backing surface inside the codec process.
      encoder.encodeQueueSize = 0;
    });

    const pixels = new Uint8ClampedArray(settings.width * settings.height * 4);
    for (let frame = 0; frame < 25; frame++) {
      await wrapper.encodeFrame(pixels, frame);
    }

    expect(encoder.flush).toHaveBeenCalledOnce();
    expect(encoder.encode).toHaveBeenCalledTimes(25);

    wrapper.cancel();
  });

  it('drains each iPadOS zero-copy frame before the GPU canvas is reused', async () => {
    vi.stubGlobal('VideoEncoder', MockVideoEncoder);
    vi.stubGlobal('VideoFrame', MockVideoFrame);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    Object.defineProperty(window, 'VideoEncoder', {
      configurable: true,
      value: MockVideoEncoder,
    });

    const wrapper = new VideoEncoderWrapper(createSettings());
    await expect(wrapper.init()).resolves.toBe(true);

    const gpuFrame = { close: vi.fn() } as unknown as VideoFrame;
    await wrapper.encodeVideoFrame(gpuFrame, 0);

    const encoder = MockVideoEncoder.instances[0];
    expect(encoder.encode).toHaveBeenCalledWith(gpuFrame, { keyFrame: true });
    expect(encoder.flush).toHaveBeenCalledOnce();
    expect(encoder.encodeQueueSize).toBe(0);

    wrapper.cancel();
  });
});
