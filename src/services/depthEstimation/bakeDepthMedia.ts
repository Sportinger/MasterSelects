import { bakeDepthVideo, type DepthBakeOptions } from './bakeDepthVideo';
import { DEPTH_MODEL } from './depthModel';
import { readMediaSourceFingerprint } from '../project/mediaSourceValidation';
import { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile } from '../../stores/mediaStore/types';
import type { DepthMapMetadata } from '../../types/depthMap';

/** Bake once and retain provenance on the ordinary imported media asset. */
export async function bakeDepthMedia(source: MediaFile, name: string, options: DepthBakeOptions,
  isCurrent: () => boolean): Promise<MediaFile> {
  const file = source.file ?? (options.file instanceof File ? options.file : undefined);
  const fingerprint = file ? await readMediaSourceFingerprint(file) : source.fileHash;
  if (!fingerprint) throw new Error('Depth source fingerprint is unavailable. Relink the source file before baking.');
  const valid = () => {
    options.signal.throwIfAborted();
    const current = useMediaStore.getState().files.find(item => item.id === source.id);
    if (!isCurrent() || !current || current.file !== source.file || current.url !== source.url) {
      throw new Error('The source or composition changed. Bake again.');
    }
  };
  valid();
  const blob = await bakeDepthVideo(options);
  valid();
  const depthMap: DepthMapMetadata = { version: 1, sourceMediaId: source.id, sourceFingerprint: fingerprint,
    sourceStart: options.from, sourceEnd: options.to, fps: options.fps, nearIsWhite: !options.invert,
    model: DEPTH_MODEL.id, modelRevision: DEPTH_MODEL.revision, edge: options.edge, rangeSmoothing: options.smoothing };
  options.progress(1, 'Adding depth video to Media');
  const imported = await useMediaStore.getState().importFile(new File([blob], name, { type: 'video/mp4' }), undefined,
    { forceCopyToProject: true });
  if (!('type' in imported) || imported.type !== 'video') throw new Error('Depth bake was not imported as video.');
  // Provenance is attached even if the user changed selection during import.
  // Applying the result to an effect still requires a fresh context check.
  useMediaStore.setState(state => ({ files: state.files.map(item => item.id === imported.id ? { ...item, depthMap }
    : item.id === source.id && item.file === source.file && item.url === source.url ? { ...item, fileHash: fingerprint } : item) }));
  valid();
  return { ...imported, depthMap };
}
