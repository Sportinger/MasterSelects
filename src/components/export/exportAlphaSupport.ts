import type { DnxhrProfile, FFmpegVideoCodec, HapFormat, ProResProfile } from '../../engine/ffmpeg';
import type { ExportEncoderType } from '../../stores/exportStore';

export interface NativeAlphaSelection {
  encoder: ExportEncoderType;
  ffmpegCodec: FFmpegVideoCodec;
  proresProfile: ProResProfile;
  dnxhrProfile: DnxhrProfile;
  hapFormat: HapFormat;
}

export function supportsNativeVideoAlpha(selection: NativeAlphaSelection): boolean {
  if (selection.encoder === 'hap') {
    return selection.hapFormat === 'hap_alpha';
  }

  if (selection.encoder !== 'ffmpeg') {
    return false;
  }

  if (selection.ffmpegCodec === 'prores') {
    return selection.proresProfile === '4444' || selection.proresProfile === '4444xq';
  }

  return selection.ffmpegCodec === 'utvideo' || selection.ffmpegCodec === 'ffv1';
}
