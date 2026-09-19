import { describe, expect, it } from 'vitest';
import {
  MOBILE_APPLE_WEBKIT_H264_MAX_BITRATE,
  resolveVideoEncoderBitrate,
} from '../../src/engine/export/videoEncoderConfigPolicy';

const IPAD_WEBKIT = {
  userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 5,
};

const DESKTOP_CHROME = {
  userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
  platform: 'Win32',
  maxTouchPoints: 0,
};

describe('resolveVideoEncoderBitrate', () => {
  it('limits iPadOS H.264 to the AVC Level 4.0 ceiling', () => {
    expect(resolveVideoEncoderBitrate('h264', 35_000_000, IPAD_WEBKIT)).toEqual({
      bitrate: MOBILE_APPLE_WEBKIT_H264_MAX_BITRATE,
      limited: true,
    });
  });

  it('keeps an iPadOS H.264 bitrate that is already within the ceiling', () => {
    expect(resolveVideoEncoderBitrate('h264', 15_000_000, IPAD_WEBKIT)).toEqual({
      bitrate: 15_000_000,
      limited: false,
    });
  });

  it('does not limit HEVC or non-iPad encoders', () => {
    expect(resolveVideoEncoderBitrate('h265', 35_000_000, IPAD_WEBKIT).bitrate).toBe(35_000_000);
    expect(resolveVideoEncoderBitrate('h264', 35_000_000, DESKTOP_CHROME).bitrate).toBe(35_000_000);
  });
});
