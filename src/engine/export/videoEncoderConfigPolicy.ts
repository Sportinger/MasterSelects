import type { VideoCodec } from './types';
import {
  isMobileAppleWebKit,
  type MobileAppleWebKitEnvironment,
} from '../../utils/mobileAppleWebKit';

// The H.264 codec string used by the browser exporter declares Main Profile,
// Level 4.0. WebKit accepts higher rates in isConfigSupported(), but its
// VideoToolbox encode task rejects anything above the level's 20 Mbit/s limit.
export const MOBILE_APPLE_WEBKIT_H264_MAX_BITRATE = 20_000_000;

export interface VideoEncoderBitratePolicyResult {
  readonly bitrate: number;
  readonly limited: boolean;
}

export function resolveVideoEncoderBitrate(
  codec: VideoCodec,
  requestedBitrate: number,
  environment?: MobileAppleWebKitEnvironment,
): VideoEncoderBitratePolicyResult {
  const mobileAppleWebKit = environment
    ? isMobileAppleWebKit(environment)
    : isMobileAppleWebKit();
  const bitrate = codec === 'h264' && mobileAppleWebKit
    ? Math.min(requestedBitrate, MOBILE_APPLE_WEBKIT_H264_MAX_BITRATE)
    : requestedBitrate;

  return { bitrate, limited: bitrate !== requestedBitrate };
}
