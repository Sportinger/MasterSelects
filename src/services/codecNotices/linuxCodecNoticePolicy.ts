import type { RuntimePlatform } from '../../utils/runtimeDeviceContext';

/**
 * One notice per codec and direction: knowing that H.265 cannot be exported
 * says nothing about whether an H.265 clip plays smoothly, so each is
 * dismissed on its own.
 */
export type LinuxCodecNoticeId = 'aac-encode' | 'h265-encode' | 'h265-decode';

export const LINUX_CODEC_NOTICE_IDS: readonly LinuxCodecNoticeId[] = ['aac-encode', 'h265-encode', 'h265-decode'];

export interface LinuxCodecNoticeDecisionInput {
  platform: RuntimePlatform;
  /** Result of the browser's own capability check for the config actually used. */
  supported: boolean | null | undefined;
  dismissed: boolean;
}

/**
 * Linux only, and only when the browser itself said no. An unknown result
 * (check not finished, API missing on another platform) never shows a notice.
 */
export function shouldShowLinuxCodecNotice({ platform, supported, dismissed }: LinuxCodecNoticeDecisionInput): boolean {
  return platform === 'linux' && supported === false && !dismissed;
}

export interface LinuxCodecNoticeContext {
  /** Codec the export uses instead, e.g. "H.264" after a saved H.265 setting. */
  fallbackCodec?: string;
  /** File name of the clip that is decoded in software. */
  sourceName?: string;
  /** The FFmpeg export (WebAssembly) can encode AAC in .mov. */
  ffmpegAvailable?: boolean;
}

export interface LinuxCodecNoticeMessage {
  title: string;
  body: string;
}

const ELSEWHERE = 'or use Chrome on Windows or macOS.';

export function getLinuxCodecNoticeMessage(
  id: LinuxCodecNoticeId,
  context: LinuxCodecNoticeContext = {},
): LinuxCodecNoticeMessage {
  switch (id) {
    case 'aac-encode':
      return {
        title: 'AAC audio is not available in this browser on Linux.',
        body: 'This MP4 export uses Opus audio in MP4 instead, which some players and editors (e.g. QuickTime) cannot open. '
          + (context.ffmpegAvailable === false
            ? 'For AAC, use Chrome on Windows or macOS.'
            : `For AAC, choose the .mov container (FFmpeg export with AAC audio), ${ELSEWHERE}`),
      };
    case 'h265-encode':
      return {
        title: 'H.265 (HEVC) encoding is not available in this browser on Linux.',
        body: (context.fallbackCodec ? `The selected H.265 setting cannot be used here, so this export uses ${context.fallbackCodec}. ` : '')
          + `Choose H.264, VP9 or AV1 instead (the FFmpeg export has no H.265 either), ${ELSEWHERE}`,
      };
    case 'h265-decode':
      return {
        title: 'H.265 (HEVC) decoding is not available in this browser on Linux.',
        body: `${context.sourceName ? `"${context.sourceName}"` : 'This clip'} is decoded in software instead, so playback and export are slower. `
          + `For smooth editing, convert it to H.264, ${ELSEWHERE}`,
      };
  }
}
