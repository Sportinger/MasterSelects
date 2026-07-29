import { useMediaStore, type MediaFile } from '../../stores/mediaStore';

export function readAudioExportMediaFiles(): readonly MediaFile[] {
  return useMediaStore.getState().files;
}
