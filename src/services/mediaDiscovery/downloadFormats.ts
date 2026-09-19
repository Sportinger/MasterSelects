import type { FormatRecommendation } from '../nativeHelper';
import type { MediaDiscoveryKind } from './types';

export const AUDIO_MP3_FORMAT_ID = '__masterselects_audio_mp3';

export function compactDownloadCodecLabel(codec: string | null, emptyLabel: string): string {
  if (!codec || codec === 'none') return emptyLabel;

  const normalized = codec.toLowerCase();
  if (normalized.includes('h.264') || normalized.includes('avc')) return 'H.264';
  if (normalized.includes('h.265') || normalized.includes('hevc') || normalized.includes('hvc1')) return 'H.265';
  if (normalized.includes('vp9') || normalized.includes('vp09')) return 'VP9';
  if (normalized.includes('av01')) return 'AV1';
  if (normalized.includes('mp4a') || normalized.includes('aac')) return 'AAC';
  if (normalized.includes('opus')) return 'Opus';

  return codec.split('.')[0].toUpperCase();
}

export function downloadFormatAudioCodecLabel(format: FormatRecommendation): string {
  if (format.id === AUDIO_MP3_FORMAT_ID || format.acodec?.toLowerCase() === 'mp3') return 'MP3';
  if (format.needsMerge && !format.acodec) return 'M4A audio';
  return compactDownloadCodecLabel(format.acodec, 'No audio');
}

export function isAudioOnlyDownloadFormat(format: FormatRecommendation): boolean {
  return format.id === AUDIO_MP3_FORMAT_ID
    || (format.resolution.toLowerCase() === 'audio' && !format.vcodec && Boolean(format.acodec));
}

export function downloadFormatQueueLabel(format: FormatRecommendation): string {
  if (isAudioOnlyDownloadFormat(format)) {
    return [format.label || 'Audio', downloadFormatAudioCodecLabel(format)].filter(Boolean).join(' / ');
  }

  return [
    format.resolution || 'Auto',
    compactDownloadCodecLabel(format.vcodec, 'Video'),
    downloadFormatAudioCodecLabel(format),
  ].filter(Boolean).join(' / ');
}

export function recommendedFormatsForKind(
  formats: FormatRecommendation[],
  kind: Exclude<MediaDiscoveryKind, 'image'>,
): FormatRecommendation[] {
  const matching = formats.filter((format) => (
    kind === 'audio' ? isAudioOnlyDownloadFormat(format) : !isAudioOnlyDownloadFormat(format)
  ));
  return matching.length > 0 ? matching : formats;
}
