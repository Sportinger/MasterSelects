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
});
