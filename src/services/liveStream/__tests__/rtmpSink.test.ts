import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HELPER_STREAM_FRAME_HEADER_BYTES } from '../streamTypes';
import type { LiveStreamConfig } from '../streamTypes';
import type { HelperStreamConnection, HelperStreamEvent } from '../helperStreamClient';

const audioMixMocks = vi.hoisted(() => ({
  format: { sampleRate: 48_000, numberOfChannels: 2 } as { sampleRate: number; numberOfChannels: number } | null,
}));

vi.mock('../../capture/recording/audioMixing', () => ({
  getCaptureAudioFormat: () => audioMixMocks.format,
  createCaptureAudioTap: vi.fn(async () => async () => undefined),
}));

import { startRtmpSink } from '../rtmpSink';

function createConfig(): LiveStreamConfig {
  return {
    transport: 'rtmp',
    rtmpRelay: 'auto',
    rtmpUrl: 'rtmp://ingest.example/live',
    rtmpStreamKey: 'secret',
    whipUrl: '',
    whipBearerToken: '',
    resolution: '720p',
    fps: 30,
    videoBitrateKbps: 4_500,
    audioBitrateKbps: 160,
    includeMasterAudio: true,
    includeMicrophone: false,
    recordLocally: false,
    chatPlatform: 'twitch',
    chatChannel: '',
  };
}

class FakeConnection implements HelperStreamConnection {
  readonly controls: object[] = [];
  readonly frames: Uint8Array[] = [];
  readonly listeners = new Set<(event: HelperStreamEvent) => void>();
  buffered = 0;
  closed = false;

  sendControl(command: object): void {
    this.controls.push(command);
    if ((command as { cmd?: string }).cmd === 'rtmpStart') {
      queueMicrotask(() => this.emit({ type: 'rtmp-status', state: 'publishing' }));
    }
  }
  sendBinary(frame: Uint8Array): void { this.frames.push(frame.slice()); }
  bufferedAmount(): number { return this.buffered; }
  onEvent(listener: (event: HelperStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close(): void { this.closed = true; }
  emit(event: HelperStreamEvent): void { this.listeners.forEach(listener => listener(event)); }
}

class FakeSourceFrame {
  timestamp: number;
  displayWidth = 1280;
  displayHeight = 720;
  close = vi.fn();
  constructor(timestamp: number) { this.timestamp = timestamp; }
}

class FakeNormalizedFrame extends FakeSourceFrame {
  constructor(_source: VideoFrame, init?: VideoFrameInit) { super(init?.timestamp ?? 0); }
}

class FakeProcessor {
  readonly readable: ReadableStream<VideoFrame>;
  constructor(_init: { track: MediaStreamTrack }) {
    this.readable = new ReadableStream({
      start(controller) {
        controller.enqueue(new FakeSourceFrame(10_000) as unknown as VideoFrame);
        controller.enqueue(new FakeSourceFrame(20_000) as unknown as VideoFrame);
        controller.close();
      },
    });
  }
}

const encoderSpies = vi.hoisted(() => ({ videoFlush: vi.fn(), audioFlush: vi.fn() }));

class FakeVideoEncoder {
  static async isConfigSupported(config: VideoEncoderConfig) { return { supported: true, config }; }
  encodeQueueSize = 0;
  private outputs = 0;
  private readonly init: VideoEncoderInit;
  constructor(init: VideoEncoderInit) { this.init = init; }
  configure(_config: VideoEncoderConfig): void {}
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    const key = options?.keyFrame === true;
    const payload = new Uint8Array(key ? [7, 8] : [9]);
    const chunk = {
      byteLength: payload.byteLength,
      timestamp: frame.timestamp,
      type: key ? 'key' : 'delta',
      copyTo: (target: AllowSharedBufferSource) => new Uint8Array(
        ArrayBuffer.isView(target) ? target.buffer : target,
        ArrayBuffer.isView(target) ? target.byteOffset : 0,
        payload.byteLength,
      ).set(payload),
    } as EncodedVideoChunk;
    const metadata = this.outputs++ === 0
      ? { decoderConfig: { codec: 'avc1.42E01E', description: new Uint8Array([1, 2, 3, 4]) } } as EncodedVideoChunkMetadata
      : undefined;
    this.init.output(chunk, metadata);
  }
  async flush(): Promise<void> { encoderSpies.videoFlush(); }
  close(): void {}
}

class FakeAudioEncoder {
  static async isConfigSupported(config: AudioEncoderConfig) { return { supported: true, config }; }
  encodeQueueSize = 0;
  constructor(_init: AudioEncoderInit) {}
  configure(_config: AudioEncoderConfig): void {}
  encode(_data: AudioData): void {}
  async flush(): Promise<void> { encoderSpies.audioFlush(); }
  close(): void {}
}

class OpusOnlyAudioEncoder extends FakeAudioEncoder {
  static override async isConfigSupported(config: AudioEncoderConfig) {
    return { supported: config.codec === 'opus', config };
  }
}

function createStream(): MediaStream {
  const track = { getSettings: () => ({ width: 1280, height: 720 }) } as MediaStreamTrack;
  return { getVideoTracks: () => [track] } as MediaStream;
}

function frameKind(frame: Uint8Array): number { return frame[0]; }
function frameFlags(frame: Uint8Array): number { return frame[1]; }
function framePayload(frame: Uint8Array): number[] {
  return [...frame.subarray(HELPER_STREAM_FRAME_HEADER_BYTES)];
}

describe('startRtmpSink', () => {
  beforeEach(() => {
    audioMixMocks.format = { sampleRate: 48_000, numberOfChannels: 2 };
    encoderSpies.videoFlush.mockClear();
    encoderSpies.audioFlush.mockClear();
  });

  it('rejects an Opus-only browser before opening the helper connection', async () => {
    const connectionFactory = vi.fn(async () => new FakeConnection());
    await expect(startRtmpSink({
      mixedStream: createStream(),
      config: createConfig(),
      callbacks: { onFatalError: vi.fn() },
      deps: { AudioEncoderImpl: OpusOnlyAudioEncoder, connectionFactory },
    })).rejects.toThrow('RTMP streaming requires an AAC encoder in this browser');
    expect(connectionFactory).not.toHaveBeenCalled();
  });

  it('sends decoder config first, maps keyframes, drops backed-up deltas, and flushes on stop', async () => {
    const connection = new FakeConnection();
    connection.buffered = 5 * 1024 * 1024;
    const sink = await startRtmpSink({
      mixedStream: createStream(),
      config: createConfig(),
      callbacks: { onFatalError: vi.fn() },
      deps: {
        Processor: FakeProcessor,
        VideoEncoderImpl: FakeVideoEncoder,
        AudioEncoderImpl: FakeAudioEncoder,
        VideoFrameImpl: FakeNormalizedFrame as unknown as typeof VideoFrame,
        AudioDataImpl: class {} as unknown as typeof AudioData,
        connectionFactory: async () => connection,
        nowUs: () => 1_000_000,
      },
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(connection.frames.map(frameKind)).toEqual([1, 3]);
    expect(framePayload(connection.frames[0])).toEqual([1, 2, 3, 4]);
    expect(frameFlags(connection.frames[1]) & 1).toBe(1);
    expect(sink.getStats().droppedFrames).toBe(1);

    await sink.stop();
    expect(connection.controls.at(-1)).toMatchObject({ cmd: 'rtmpStop' });
    expect(encoderSpies.videoFlush).toHaveBeenCalledOnce();
    expect(encoderSpies.audioFlush).toHaveBeenCalledOnce();
    expect(connection.closed).toBe(true);
  });
});
