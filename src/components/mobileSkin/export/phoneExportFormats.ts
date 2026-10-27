// The export formats the phone offers: exactly the editor's export paths (WebCodecs video, FFmpeg
// pro video, browser GIF, image sequence, still frame, audio only), plus the desktop-only ones
// shown greyed. Availability comes from probed browser capabilities; nothing is hidden.

export type PhoneExportFormatId =
  | 'mp4-h264' | 'mp4-hevc' | 'mp4-av1' | 'webm-vp9' | 'webm-av1'
  | 'mov-prores' | 'mov-dnxhr'
  | 'gif' | 'image-sequence' | 'still'
  | 'audio-wav' | 'audio-mp3' | 'audio-aac'
  | 'mov-hap' | 'fcpxml';

export type PhoneExportKind = 'webcodecs' | 'ffmpeg' | 'gif' | 'sequence' | 'still' | 'audio' | 'desktop-only';
export type PhoneVideoCodec = 'h264' | 'h265' | 'vp9' | 'av1';

export interface PhoneExportFormat {
  id: PhoneExportFormatId;
  label: string;
  group: 'Video' | 'Pro video' | 'Animation and images' | 'Audio' | 'Desktop only';
  kind: PhoneExportKind;
  /** File extension of the result (image formats override it). */
  extension: string;
  videoCodec?: PhoneVideoCodec;
  container?: 'mp4' | 'webm';
  ffmpegCodec?: 'prores' | 'dnxhd';
  audioFormat?: 'wav' | 'mp3' | 'browser';
}

export const PHONE_EXPORT_FORMATS: readonly PhoneExportFormat[] = [
  { id: 'mp4-h264', label: 'MP4 · H.264', group: 'Video', kind: 'webcodecs', extension: 'mp4', videoCodec: 'h264', container: 'mp4' },
  { id: 'mp4-hevc', label: 'MP4 · HEVC', group: 'Video', kind: 'webcodecs', extension: 'mp4', videoCodec: 'h265', container: 'mp4' },
  { id: 'mp4-av1', label: 'MP4 · AV1', group: 'Video', kind: 'webcodecs', extension: 'mp4', videoCodec: 'av1', container: 'mp4' },
  { id: 'webm-vp9', label: 'WebM · VP9', group: 'Video', kind: 'webcodecs', extension: 'webm', videoCodec: 'vp9', container: 'webm' },
  { id: 'webm-av1', label: 'WebM · AV1', group: 'Video', kind: 'webcodecs', extension: 'webm', videoCodec: 'av1', container: 'webm' },
  { id: 'mov-prores', label: 'MOV · ProRes', group: 'Pro video', kind: 'ffmpeg', extension: 'mov', ffmpegCodec: 'prores' },
  { id: 'mov-dnxhr', label: 'MOV · DNxHR', group: 'Pro video', kind: 'ffmpeg', extension: 'mov', ffmpegCodec: 'dnxhd' },
  { id: 'gif', label: 'GIF', group: 'Animation and images', kind: 'gif', extension: 'gif' },
  { id: 'image-sequence', label: 'Image sequence', group: 'Animation and images', kind: 'sequence', extension: 'zip' },
  { id: 'still', label: 'Still frame', group: 'Animation and images', kind: 'still', extension: 'png' },
  { id: 'audio-wav', label: 'WAV', group: 'Audio', kind: 'audio', extension: 'wav', audioFormat: 'wav' },
  { id: 'audio-mp3', label: 'MP3', group: 'Audio', kind: 'audio', extension: 'mp3', audioFormat: 'mp3' },
  { id: 'audio-aac', label: 'AAC', group: 'Audio', kind: 'audio', extension: 'aac', audioFormat: 'browser' },
  { id: 'mov-hap', label: 'MOV · HAP', group: 'Desktop only', kind: 'desktop-only', extension: 'mov' },
  { id: 'fcpxml', label: 'FCPXML', group: 'Desktop only', kind: 'desktop-only', extension: 'fcpxml' },
];

export const PHONE_EXPORT_FORMAT_GROUPS: ReadonlyArray<PhoneExportFormat['group']> = [
  'Video', 'Pro video', 'Animation and images', 'Audio', 'Desktop only',
];

export function getPhoneExportFormat(id: PhoneExportFormatId): PhoneExportFormat {
  return PHONE_EXPORT_FORMATS.find((format) => format.id === id) ?? PHONE_EXPORT_FORMATS[0];
}

export function isPhoneExportFormatId(value: unknown): value is PhoneExportFormatId {
  return typeof value === 'string' && PHONE_EXPORT_FORMATS.some((format) => format.id === value);
}

/** True for formats that render pictures (they need a size and frame rate). */
export function rendersPictures(format: PhoneExportFormat): boolean {
  return format.kind !== 'audio' && format.kind !== 'desktop-only';
}

/** True for formats with a bitrate the person can choose. */
export function hasBitrate(format: PhoneExportFormat): boolean {
  return format.kind === 'webcodecs';
}

/** What the browser can do, probed by the caller for the chosen size and frame rate. */
export interface PhoneExportBrowserCapabilities {
  /** VideoEncoder and VideoFrame exist. */
  webCodecs: boolean;
  /** checkCodecSupport per codec; null while still probing. */
  codecs: Record<PhoneVideoCodec, boolean | null>;
  /** WebAssembly exists (FFmpeg can load). */
  wasm: boolean;
  /** AudioEncoder codec, null when sound cannot be encoded. */
  audioCodec: 'aac' | 'opus' | null;
}

export type PhoneFormatAvailability =
  | { available: true; notice?: string }
  | { available: false; reason: string };

const CODEC_NAMES: Record<PhoneVideoCodec, string> = { h264: 'H.264', h265: 'HEVC', vp9: 'VP9', av1: 'AV1' };

export function resolvePhoneFormatAvailability(
  format: PhoneExportFormat,
  capabilities: PhoneExportBrowserCapabilities,
  size: { width: number; height: number },
): PhoneFormatAvailability {
  switch (format.kind) {
    case 'webcodecs': {
      if (!capabilities.webCodecs) return { available: false, reason: 'This browser cannot encode video (WebCodecs is missing).' };
      const codec = format.videoCodec ?? 'h264';
      const supported = capabilities.codecs[codec];
      if (supported === null) return { available: false, reason: 'Still checking what this browser can encode.' };
      if (!supported) {
        return { available: false, reason: `This browser cannot encode ${CODEC_NAMES[codec]} at ${size.width} × ${size.height}.` };
      }
      return { available: true };
    }
    case 'ffmpeg':
      if (!capabilities.wasm) return { available: false, reason: 'This browser has no WebAssembly, so the FFmpeg encoder cannot run.' };
      return { available: true, notice: 'Loads the FFmpeg encoder first (a large download). Slow on a phone.' };
    case 'gif':
    case 'sequence':
    case 'still':
      return { available: true };
    case 'audio':
      if (format.audioFormat === 'browser' && capabilities.audioCodec !== 'aac') {
        return { available: false, reason: capabilities.audioCodec === 'opus'
          ? 'This browser can only encode Opus, not AAC. Use WAV or MP3.'
          : 'This browser cannot encode AAC. Use WAV or MP3.' };
      }
      return { available: true };
    case 'desktop-only':
      return { available: false, reason: 'Not in the phone export yet. Tap "All options" to use the desktop export panel.' };
  }
}
