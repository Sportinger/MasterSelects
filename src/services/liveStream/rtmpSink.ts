import { CaptureAudioEncoder, detectCaptureAudioCodec } from '../capture/recording/captureAudioEncoder';
import { CaptureVideoEncoder } from '../capture/recording/captureVideoEncoder';
import {
  createCaptureAudioTap,
  getCaptureAudioFormat,
  type CapturePcmChunk,
} from '../capture/recording/audioMixing';
import { CaptureSyncClock } from '../capture/recording/syncClock';
import {
  encodeHelperStreamFrame,
  HELPER_STREAM_FLAG_KEYFRAME,
  HELPER_STREAM_FRAME_KIND,
  type ActiveStreamSink,
  type LiveStreamConfig,
  type StreamSinkCallbacks,
} from './streamTypes';
import {
  openHelperStreamConnection,
  type HelperStreamConnection,
  type HelperStreamEvent,
} from './helperStreamClient';

type TrackProcessorConstructor = new(init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};

type VideoEncoderConstructor = {
  new(init: VideoEncoderInit): {
    readonly encodeQueueSize: number;
    configure(config: VideoEncoderConfig): void;
    encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
    flush(): Promise<void>;
    close(): void;
  };
  isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
};

type AudioEncoderConstructor = {
  new(init: AudioEncoderInit): {
    readonly encodeQueueSize: number;
    configure(config: AudioEncoderConfig): void;
    encode(data: AudioData): void;
    flush(): Promise<void>;
    close(): void;
  };
  isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
};

export interface RtmpSinkDeps {
  Processor?: TrackProcessorConstructor;
  VideoEncoderImpl?: VideoEncoderConstructor;
  AudioEncoderImpl?: AudioEncoderConstructor;
  VideoFrameImpl?: typeof VideoFrame;
  AudioDataImpl?: typeof AudioData;
  connectionFactory?: () => Promise<HelperStreamConnection>;
  nowUs?: () => number;
  statusTimeoutMs?: number;
}

const VIDEO_DROP_BUFFER_BYTES = 4 * 1024 * 1024;
const VIDEO_ACCEPT_BUFFER_BYTES = 8 * 1024 * 1024;
let commandSequence = 0;

function nextCommandId(): string {
  commandSequence += 1;
  return `rtmp_${commandSequence}`;
}

function copyDescription(description: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice();
  }
  return new Uint8Array(description).slice();
}

function copyChunk(chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array {
  const payload = new Uint8Array(chunk.byteLength);
  chunk.copyTo(payload);
  return payload;
}

function waitForPublishing(
  connection: HelperStreamConnection,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(new Error('RTMP relay connection timed out after 30 seconds.'));
    }, timeoutMs);
    unsubscribe = connection.onEvent(event => {
      if (event.type !== 'rtmp-status') return;
      if (event.state === 'connected' || event.state === 'publishing') {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        resolve();
      } else if (event.state === 'error' || event.state === 'ended') {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        reject(new Error(event.message || `RTMP relay ${event.state}.`));
      }
    });
  });
}

export async function startRtmpSink(input: {
  mixedStream: MediaStream;
  config: LiveStreamConfig;
  callbacks: StreamSinkCallbacks;
  deps?: RtmpSinkDeps;
}): Promise<ActiveStreamSink> {
  const deps = input.deps ?? {};
  const audioFormat = getCaptureAudioFormat(input.mixedStream);
  const detectedAudioCodec = audioFormat
    ? await detectCaptureAudioCodec({
        sampleRate: audioFormat.sampleRate,
        numberOfChannels: audioFormat.numberOfChannels,
        bitrate: input.config.audioBitrateKbps * 1000,
        Encoder: deps.AudioEncoderImpl,
      })
    : null;
  if (!audioFormat || detectedAudioCodec?.codec !== 'aac') {
    throw new Error('RTMP streaming requires an AAC encoder in this browser â€” use the WHIP transport instead.');
  }

  const videoTrack = input.mixedStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('The live program has no video track.');
  const videoSettings = videoTrack.getSettings();
  const width = videoSettings.width ?? 0;
  const height = videoSettings.height ?? 0;
  if (width < 2 || height < 2) throw new Error('The live program dimensions are unavailable.');

  const Processor = deps.Processor
    ?? (globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessorConstructor }).MediaStreamTrackProcessor;
  const VideoFrameImpl = deps.VideoFrameImpl ?? globalThis.VideoFrame;
  const AudioDataImpl = deps.AudioDataImpl ?? globalThis.AudioData;
  if (!Processor || !VideoFrameImpl) throw new Error('WebCodecs video streaming is not supported in this browser.');
  if (!AudioDataImpl) throw new Error('WebCodecs audio streaming is not supported in this browser.');

  const connection = await (deps.connectionFactory ?? openHelperStreamConnection)();
  let active = true;
  let stopping = false;
  let fatalReported = false;
  let readyForFatal = false;
  let relayStats = { sentBytes: 0, queuedBytes: 0 };
  let browserDroppedFrames = 0;

  const reportFatal = (cause: unknown) => {
    if (stopping || fatalReported) return;
    fatalReported = true;
    active = false;
    input.callbacks.onFatalError(cause instanceof Error ? cause : new Error('RTMP streaming failed.'));
  };

  const unsubscribeEvents = connection.onEvent((event: HelperStreamEvent) => {
    if (event.type === 'rtmp-stats') {
      relayStats = { sentBytes: event.sentBytes, queuedBytes: event.queuedBytes };
      return;
    }
    input.callbacks.onStatusMessage?.(event.message ?? `RTMP relay: ${event.state}`);
    if (readyForFatal && (event.state === 'error' || event.state === 'ended')) {
      reportFatal(new Error(event.message || `RTMP relay ${event.state}.`));
    }
  });

  const startCommand = {
    cmd: 'rtmpStart',
    id: nextCommandId(),
    url: input.config.rtmpUrl,
    streamKey: input.config.rtmpStreamKey,
    video: {
      width,
      height,
      fps: input.config.fps,
      bitrateKbps: input.config.videoBitrateKbps,
    },
    audio: {
      sampleRate: audioFormat.sampleRate,
      channels: audioFormat.numberOfChannels,
      bitrateKbps: input.config.audioBitrateKbps,
    },
  };

  try {
    const ready = waitForPublishing(connection, deps.statusTimeoutMs ?? 30_000);
    connection.sendControl(startCommand);
    await ready;
    readyForFatal = true;
  } catch (error) {
    unsubscribeEvents();
    connection.close();
    throw error;
  }

  let videoConfigSent = false;
  let audioConfigSent = false;
  const forwardingSink = {
    canAcceptVideoFrame: () => connection.bufferedAmount() < VIDEO_ACCEPT_BUFFER_BYTES,
    addVideoChunk: async (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
      const description = metadata?.decoderConfig?.description;
      if (description) {
        connection.sendBinary(encodeHelperStreamFrame(
          HELPER_STREAM_FRAME_KIND.videoConfig,
          0,
          0,
          copyDescription(description),
        ));
        videoConfigSent = true;
      }
      if (!videoConfigSent) return;
      if (chunk.type === 'delta' && connection.bufferedAmount() > VIDEO_DROP_BUFFER_BYTES) {
        browserDroppedFrames += 1;
        return;
      }
      connection.sendBinary(encodeHelperStreamFrame(
        HELPER_STREAM_FRAME_KIND.video,
        chunk.type === 'key' ? HELPER_STREAM_FLAG_KEYFRAME : 0,
        chunk.timestamp,
        copyChunk(chunk),
      ));
    },
    addAudioChunk: async (chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata) => {
      const description = metadata?.decoderConfig?.description;
      if (!audioConfigSent && description) {
        connection.sendBinary(encodeHelperStreamFrame(
          HELPER_STREAM_FRAME_KIND.audioConfig,
          0,
          0,
          copyDescription(description),
        ));
        audioConfigSent = true;
      }
      connection.sendBinary(encodeHelperStreamFrame(
        HELPER_STREAM_FRAME_KIND.audio,
        0,
        chunk.timestamp,
        copyChunk(chunk),
      ));
    },
  };

  const videoEncoder = new CaptureVideoEncoder({
    width,
    height,
    fps: input.config.fps,
    bitrate: input.config.videoBitrateKbps * 1000,
    muxer: forwardingSink,
    Encoder: deps.VideoEncoderImpl,
    onError: reportFatal,
  });
  const audioEncoder = new CaptureAudioEncoder({
    sampleRate: audioFormat.sampleRate,
    numberOfChannels: audioFormat.numberOfChannels,
    bitrate: input.config.audioBitrateKbps * 1000,
    muxer: forwardingSink,
    Encoder: deps.AudioEncoderImpl,
    detectCodec: async () => detectedAudioCodec,
    onError: reportFatal,
  });

  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let closeAudioTap: (() => Promise<void>) | null = null;
  let readPromise: Promise<void> = Promise.resolve();
  let audioWrite = Promise.resolve();
  const clock = new CaptureSyncClock();
  const nowUs = deps.nowUs ?? (() => performance.now() * 1000);
  const captureStartUs = nowUs();
  clock.start(captureStartUs);
  let videoTimestampBase: number | null = null;

  try {
    await videoEncoder.initialize();
    await audioEncoder.initialize();
    reader = new Processor({ track: videoTrack }).readable.getReader();
    readPromise = (async () => {
      try {
        while (active && reader) {
          const { value: frame, done } = await reader.read();
          if (done) break;
          videoTimestampBase ??= frame.timestamp;
          const sourceTimestamp = captureStartUs + frame.timestamp - videoTimestampBase;
          const timestamp = clock.timestamp('video', sourceTimestamp, nowUs());
          const normalizedFrame = new VideoFrameImpl(frame, { timestamp });
          frame.close();
          videoEncoder.encode(normalizedFrame);
          normalizedFrame.close();
        }
      } catch (error) {
        if (active) reportFatal(error);
      }
    })();
    closeAudioTap = await createCaptureAudioTap(
      input.mixedStream,
      (chunk: CapturePcmChunk) => {
        if (!active) return;
        const timestamp = clock.timestamp('audio', chunk.sourceTimestampUs, chunk.observedAtUs);
        audioWrite = audioWrite.then(async () => {
          if (!active) return;
          await audioEncoder.encode(new AudioDataImpl({
            format: 'f32-planar',
            sampleRate: chunk.sampleRate,
            numberOfFrames: chunk.numberOfFrames,
            numberOfChannels: chunk.numberOfChannels,
            timestamp,
            data: chunk.data,
          }));
        }).catch(reportFatal);
      },
      reportFatal,
    );
  } catch (error) {
    active = false;
    await reader?.cancel().catch(() => undefined);
    await closeAudioTap?.().catch(() => undefined);
    videoEncoder.close();
    audioEncoder.close();
    try { connection.sendControl({ cmd: 'rtmpStop', id: nextCommandId() }); } catch { /* best effort */ }
    unsubscribeEvents();
    connection.close();
    throw error;
  }

  let stopPromise: Promise<void> | null = null;
  return {
    stop: () => {
      stopPromise ??= (async () => {
        stopping = true;
        active = false;
        await reader?.cancel().catch(() => undefined);
        await closeAudioTap?.().catch(() => undefined);
        await readPromise.catch(() => undefined);
        await audioWrite.catch(() => undefined);
        let flushError: unknown;
        try {
          const flushes = await Promise.allSettled([
            videoEncoder.flush(),
            audioEncoder.flush(),
          ]);
          flushError = flushes.find(result => result.status === 'rejected')?.reason;
        } finally {
          videoEncoder.close();
          audioEncoder.close();
          try { connection.sendControl({ cmd: 'rtmpStop', id: nextCommandId() }); } catch { /* best effort */ }
          unsubscribeEvents();
          connection.close();
        }
        if (flushError) throw flushError;
      })();
      return stopPromise;
    },
    getStats: () => {
      const encoderStats = videoEncoder.getStats();
      return {
        droppedFrames: browserDroppedFrames + encoderStats.droppedFrames,
        encodeQueueSize: encoderStats.encodeQueueSize,
        bytesSent: relayStats.sentBytes,
        queuedBytes: relayStats.queuedBytes,
      };
    },
  };
}
