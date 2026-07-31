export type { MP4VideoTrack } from '../webCodecsTypes';
import type { MP4VideoTrack } from '../webCodecsTypes';

export interface CodecConfigurationBox {
  write: (stream: { buffer: ArrayBuffer; position?: number }) => void;
}

export interface MP4TrackDetails {
  mdia?: {
    minf?: {
      stbl?: {
        stsd?: {
          entries?: Array<{
            avcC?: CodecConfigurationBox;
            hvcC?: CodecConfigurationBox;
            vpcC?: CodecConfigurationBox;
            av1C?: CodecConfigurationBox;
          }>;
        };
      };
    };
  };
}

export interface MP4DataStreamConstructor {
  new (buffer?: unknown, byteOffset?: number, endianness?: number): {
    buffer: ArrayBuffer;
    position?: number;
  };
  BIG_ENDIAN: number;
}

export const HARDWARE_ACCELERATION_MODES: readonly HardwareAcceleration[] = [
  'prefer-software',
  'prefer-hardware',
  'no-preference',
];

export function getCodecString(track: MP4VideoTrack): string {
  const codec = track.codec;

  if (codec.startsWith('avc1') || codec.startsWith('avc3')) {
    return codec;
  }

  if (codec.startsWith('hvc1') || codec.startsWith('hev1')) {
    return codec;
  }

  if (codec.startsWith('vp09')) {
    return codec;
  }

  if (codec.startsWith('av01')) {
    return codec;
  }

  return codec;
}

export function extractCodecDescription(
  trackDetails: MP4TrackDetails | undefined,
  DataStream: MP4DataStreamConstructor
): ArrayBuffer | undefined {
  const entry = trackDetails?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  const configBox = entry?.avcC || entry?.hvcC || entry?.vpcC || entry?.av1C;

  if (!configBox) {
    return undefined;
  }

  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  configBox.write(stream);
  return stream.buffer.slice(8);
}

export function createBaseDecoderConfig(
  videoTrack: MP4VideoTrack,
  description?: ArrayBuffer
): VideoDecoderConfig {
  return {
    codec: getCodecString(videoTrack),
    codedWidth: videoTrack.video.width,
    codedHeight: videoTrack.video.height,
    optimizeForLatency: true,
    description,
  };
}

export function createHardwareDecoderConfig(
  baseConfig: VideoDecoderConfig,
  hardwareAcceleration: HardwareAcceleration
): VideoDecoderConfig {
  return {
    ...baseConfig,
    hardwareAcceleration,
  };
}
