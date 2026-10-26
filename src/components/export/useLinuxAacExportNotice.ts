import { useEffect, useRef } from 'react';
import type { AudioCodec } from '../../engine/audio';
import { reportLinuxCodecSupport, withdrawLinuxCodecNotice } from '../../services/codecNotices/linuxCodecNotices';

interface LinuxAacExportNoticeInput {
  /** Browser (WebCodecs) MP4 video export with audio: the export that carries AAC where the browser can encode it. */
  usesBrowserMp4Audio: boolean;
  /** Result of AudioEncoderWrapper.detectSupportedCodec (AAC first, then Opus); null until it answered. */
  detectedAudioCodec: AudioCodec | null;
  ffmpegAvailable: boolean;
}

/**
 * When a choice in the export settings turns on a browser MP4 export with
 * audio (container, method, audio toggle, preset), report the AAC check so a
 * Linux user learns that Opus is used instead. Opening the panel with saved
 * settings stays quiet; starting the export reports it in VideoEncoderWrapper.
 * Leaving that export type withdraws the notice without remembering anything.
 */
export function useLinuxAacExportNotice({
  usesBrowserMp4Audio,
  detectedAudioCodec,
  ffmpegAvailable,
}: LinuxAacExportNoticeInput): void {
  const previousRef = useRef(usesBrowserMp4Audio);
  const pendingRef = useRef(false);

  useEffect(() => {
    const wasActive = previousRef.current;
    previousRef.current = usesBrowserMp4Audio;
    if (!usesBrowserMp4Audio) {
      pendingRef.current = false;
      if (wasActive) withdrawLinuxCodecNotice('aac-encode');
      return;
    }
    if (!wasActive) pendingRef.current = true;
    if (!pendingRef.current || detectedAudioCodec === null) return;
    pendingRef.current = false;
    reportLinuxCodecSupport('aac-encode', detectedAudioCodec === 'aac', { ffmpegAvailable });
  }, [detectedAudioCodec, ffmpegAvailable, usesBrowserMp4Audio]);
}
