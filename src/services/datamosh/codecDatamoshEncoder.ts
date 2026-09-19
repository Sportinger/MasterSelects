import { MediaBunnyMuxerAdapter } from '../../engine/export/MediaBunnyMuxerAdapter';
import { getCodecString } from '../../engine/export/codecHelpers';
import { Logger } from '../logger';

const log = Logger.create('CodecDatamosh');
const MAX_ENCODE_QUEUE_SIZE = 4;

export const DATAMOSH_PLAYBACK_CONTAINER = 'mp4' as const;
export const DATAMOSH_PLAYBACK_MIME_TYPE = 'video/mp4' as const;
export const DATAMOSH_PLAYBACK_EXTENSION = '.mp4' as const;
export const DATAMOSH_PLAYBACK_VIDEO_CODEC = 'h264' as const;

export interface DatamoshPlaybackEncodeInput {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  frameCount: number;
  getFrame: (index: number, timestampMicros: number, durationMicros: number) => Promise<VideoFrame>;
  onProgress?: (completed: number, total: number) => void;
}

export interface CodecDatamoshEncodeResult {
  blob: Blob;
  inputFrameCount: number;
  outputPacketCount: number;
  droppedKeyPacketCount: number;
  codec: string;
}

function assertWebCodecs(): void {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Datamosh requires WebCodecs VideoEncoder support.');
  }
}

async function chooseEncoderConfig(input: DatamoshPlaybackEncodeInput): Promise<VideoEncoderConfig> {
  const base = {
    codec: getCodecString(DATAMOSH_PLAYBACK_VIDEO_CODEC),
    width: input.width,
    height: input.height,
    bitrate: input.bitrate,
    framerate: input.fps,
    latencyMode: 'quality' as const,
    hardwareAcceleration: 'prefer-hardware' as const,
    bitrateMode: 'variable' as const,
    contentHint: 'motion',
  } satisfies VideoEncoderConfig;
  const candidates: VideoEncoderConfig[] = [
    base,
    { ...base, hardwareAcceleration: 'no-preference' },
    { ...base, hardwareAcceleration: 'prefer-software' },
    { ...base, latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware' },
    { ...base, latencyMode: 'realtime', hardwareAcceleration: 'no-preference' },
    { ...base, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' },
  ];

  for (const candidate of candidates) {
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support.supported && support.config) return support.config;
  }
  throw new Error(`No H.264 encoder is available for ${input.width}x${input.height}.`);
}

async function waitForCapacity(encoder: VideoEncoder): Promise<void> {
  while (encoder.encodeQueueSize >= MAX_ENCODE_QUEUE_SIZE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (encoder.state === 'closed') throw new Error('Datamosh encoder closed while waiting for capacity.');
  }
}

function cloneChunkAt(
  chunk: EncodedVideoChunk,
  timestampMicros: number,
  durationMicros: number,
): EncodedVideoChunk {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return new EncodedVideoChunk({
    type: chunk.type,
    timestamp: timestampMicros,
    duration: durationMicros,
    data,
  });
}

/** Encodes already-moshed pixels into an ordinary seekable H.264/MP4 cache. */
export async function encodeDatamoshPlaybackArtifact(
  input: DatamoshPlaybackEncodeInput,
): Promise<CodecDatamoshEncodeResult> {
  assertWebCodecs();
  if (input.frameCount < 2) throw new Error('Datamosh requires at least two output frames.');

  const frameDurationMicros = Math.max(1, Math.round(1_000_000 / input.fps));
  const config = await chooseEncoderConfig(input);
  const muxer = new MediaBunnyMuxerAdapter({
    container: DATAMOSH_PLAYBACK_CONTAINER,
    videoCodec: DATAMOSH_PLAYBACK_VIDEO_CODEC,
    fps: input.fps,
    hasAudio: false,
    audioCodec: 'aac',
  });
  let packetCount = 0;
  let sawKeyPacket = false;
  let callbackError: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      try {
        if (chunk.type === 'key') sawKeyPacket = true;
        const rewritten = cloneChunkAt(chunk, packetCount * frameDurationMicros, frameDurationMicros);
        muxer.addVideoChunk(rewritten, metadata);
        packetCount += 1;
      } catch (error) {
        callbackError = error instanceof Error ? error : new Error(String(error));
      }
    },
    error: (error) => {
      callbackError = error instanceof Error ? error : new Error(String(error));
    },
  });

  try {
    encoder.configure(config);
    for (let index = 0; index < input.frameCount; index += 1) {
      if (callbackError) throw callbackError;
      await waitForCapacity(encoder);
      const timestampMicros = index * frameDurationMicros;
      const sourceFrame = await input.getFrame(index, timestampMicros, frameDurationMicros);
      const stampedFrame = new VideoFrame(sourceFrame, {
        timestamp: timestampMicros,
        duration: frameDurationMicros,
      });
      sourceFrame.close();
      try {
        const keyframeInterval = Math.max(1, Math.round(input.fps));
        encoder.encode(stampedFrame, { keyFrame: index % keyframeInterval === 0 });
      } finally {
        stampedFrame.close();
      }
      input.onProgress?.(index + 1, input.frameCount);
    }

    await encoder.flush();
    if (callbackError) throw callbackError;
    if (!sawKeyPacket) throw new Error('The playback-cache encoder did not emit a key packet.');
    if (packetCount < 2) throw new Error('The datamosh playback cache did not contain usable frames.');

    await muxer.finalize();
    const buffer = muxer.getBuffer();
    log.info('Encoded datamosh playback cache', {
      inputFrameCount: input.frameCount,
      outputPacketCount: packetCount,
      bytes: buffer.byteLength,
    });
    return {
      blob: new Blob([buffer], { type: DATAMOSH_PLAYBACK_MIME_TYPE }),
      inputFrameCount: input.frameCount,
      outputPacketCount: packetCount,
      droppedKeyPacketCount: 0,
      codec: config.codec,
    };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}
