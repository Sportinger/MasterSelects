// Phone Advanced settings <-> the editor's ExportSettings, so the phone saves and loads the same
// project export presets as the desktop export panel (exportStore.presets).
import type { ExportSettings } from '../../../stores/exportStore';
import {
  createDefaultPhoneAdvancedSettings,
  PHONE_EXPORT_PRORES_PROFILES,
  type PhoneAdvancedSettings,
  type PhoneExportImageFormat,
  type PhoneExportProResProfile,
  type PhoneExportRunSpec,
} from './phoneExportAdvancedPlan';
import type { PhoneExportFormatId } from './phoneExportFormats';
import type { PhoneExportCompositionInput } from './phoneExportPlan';

/** The phone's choices written onto `base` (fields the phone does not edit stay as they are). */
export function phoneSpecToExportSettings(spec: PhoneExportRunSpec, range: PhoneAdvancedSettings['range'], base: ExportSettings): ExportSettings {
  const visualMode: ExportSettings['visualMode'] = spec.kind === 'gif' ? 'gif' : spec.kind === 'still' || spec.kind === 'sequence' ? 'image' : 'video';
  return {
    ...base,
    encoder: spec.kind === 'ffmpeg' ? 'ffmpeg' : 'webcodecs',
    width: spec.width,
    height: spec.height,
    customWidth: spec.width,
    customHeight: spec.height,
    useCustomResolution: true,
    fps: spec.fps,
    customFps: spec.fps,
    useCustomFps: true,
    useInOut: range === 'in-out',
    bitrate: spec.bitrate > 0 ? spec.bitrate : base.bitrate,
    containerFormat: spec.container,
    videoCodec: spec.videoCodec,
    rateControl: spec.rateControl,
    ffmpegCodec: spec.ffmpegCodec,
    ffmpegContainer: 'mov',
    proresProfile: spec.proresProfile,
    includeAudio: spec.includeAudio,
    audioOnlyFormat: spec.audioFormat,
    videoEnabled: spec.kind !== 'audio',
    visualMode,
    imageFormat: spec.imageFormat,
    imageExportMode: spec.kind === 'sequence' ? 'sequence' : 'frame',
    specialContainer: 'none',
  };
}

function formatIdFromSettings(settings: ExportSettings): PhoneExportFormatId {
  if (!settings.videoEnabled) {
    return settings.audioOnlyFormat === 'mp3' ? 'audio-mp3' : settings.audioOnlyFormat === 'browser' ? 'audio-aac' : 'audio-wav';
  }
  if (settings.specialContainer === 'xml') return 'fcpxml';
  if (settings.visualMode === 'gif') return 'gif';
  if (settings.visualMode === 'image') return settings.imageExportMode === 'sequence' ? 'image-sequence' : 'still';
  if (settings.encoder === 'hap') return 'mov-hap';
  if (settings.encoder === 'ffmpeg') return settings.ffmpegCodec === 'dnxhd' ? 'mov-dnxhr' : 'mov-prores';
  if (settings.containerFormat === 'webm') return settings.videoCodec === 'av1' ? 'webm-av1' : 'webm-vp9';
  if (settings.videoCodec === 'h265') return 'mp4-hevc';
  if (settings.videoCodec === 'av1') return 'mp4-av1';
  return 'mp4-h264';
}

/** A preset's settings as phone Advanced settings; unknown values fall back to the phone default. */
export function exportSettingsToPhone(settings: ExportSettings, composition: PhoneExportCompositionInput | null): PhoneAdvancedSettings {
  const defaults = createDefaultPhoneAdvancedSettings(composition);
  const width = settings.useCustomResolution ? settings.customWidth : settings.width;
  const height = settings.useCustomResolution ? settings.customHeight : settings.height;
  const fps = settings.useCustomFps ? settings.customFps : settings.fps;
  const imageFormat: PhoneExportImageFormat = settings.imageFormat === 'jpg' || settings.imageFormat === 'webp' ? settings.imageFormat : 'png';
  const proresProfile: PhoneExportProResProfile = (PHONE_EXPORT_PRORES_PROFILES as readonly string[]).includes(settings.proresProfile)
    ? settings.proresProfile as PhoneExportProResProfile
    : defaults.proresProfile;
  return {
    ...defaults,
    formatId: formatIdFromSettings(settings),
    resolution: 'custom',
    customWidth: width > 0 ? width : defaults.customWidth,
    customHeight: height > 0 ? height : defaults.customHeight,
    fps: fps > 0 ? fps : 'composition',
    quality: 'custom',
    customBitrate: settings.bitrate > 0 ? settings.bitrate : defaults.customBitrate,
    rateControl: settings.rateControl,
    range: settings.useInOut ? 'in-out' : 'content',
    includeAudio: settings.includeAudio,
    imageFormat,
    proresProfile,
  };
}
