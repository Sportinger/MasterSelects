import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { captureSnapshot } from '../../stores/historyStore';
import { Logger } from '../logger';
import { mediaRuntimeRegistry } from './registry';
import { renderHostPort } from '../render/renderHostPort';

/**
 * Data levels of a video file: how its 8/10-bit code values map to black and white.
 * Camera files flagged as video range (16-235) often record "superwhites" up to 255: highlights
 * such as a spot-lit face. Decoded as video range they clip to white, so no grade can recover them.
 * 'full' decodes the file as full range (0-255): the superwhites keep their detail, blacks and
 * whites sit slightly inside the picture, and a grade sets the levels from there.
 */
export type MediaDataLevels = 'video' | 'full';

const log = Logger.create('MediaDataLevels');

/** Video codecs whose decoders take the override: MXF camera files (H.264, DNxHD, MPEG-2). */
export function supportsDataLevelsOverride(file: Pick<MediaFile, 'type' | 'videoCodecId'> | undefined): boolean {
  return file?.type === 'video' && Boolean(file.videoCodecId?.match(/^mxf:(avc-intra|avc-lgop|dnxhd|mpeg2-intra|mpeg2-lgop)$/));
}

/** Read by every codec decoder that is created; from then on level changes re-create decoders. */
export function mediaDecodesFullRange(mediaFileId: string | undefined): boolean {
  ensureDataLevelsWatch();
  if (!mediaFileId) return false;
  const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
  return file?.dataLevels === 'full' && supportsDataLevelsOverride(file);
}

/** Sets the data levels of one video file and re-creates its decoders, so preview and export follow. */
export function setMediaDataLevels(mediaFileId: string, levels: MediaDataLevels): boolean {
  ensureDataLevelsWatch();
  const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
  if (!file) return false;
  if (!supportsDataLevelsOverride(file)) {
    log.warn('Data levels override is not supported for this file; it keeps its flagged range', { mediaFileId, codec: file.videoCodecId });
    return false;
  }
  if ((file.dataLevels ?? 'video') === levels) return false;
  useMediaStore.setState(state => ({
    files: state.files.map(candidate => candidate.id === mediaFileId
      ? { ...candidate, dataLevels: levels === 'full' ? 'full' as const : undefined }
      : candidate),
  }));
  captureSnapshot(levels === 'full' ? 'Data levels: full' : 'Data levels: video');
  return true;
}

/** Any change of a file's data levels (command, undo, redo, project load) re-creates its decoders. */
function watchDataLevels(): () => void {
  let previous = new Map(useMediaStore.getState().files.map(file => [file.id, file.dataLevels]));
  return useMediaStore.subscribe(state => state.files, files => {
    const next = new Map(files.map(file => [file.id, file.dataLevels]));
    for (const [id, levels] of next) {
      if (!previous.has(id) || previous.get(id) === levels) continue;
      const dropped = mediaRuntimeRegistry.resetMediaDecoders(id);
      log.info('Data levels changed; decoders re-created on demand', { mediaFileId: id, levels: levels ?? 'video', dropped });
      renderHostPort.requestNewFrameRender();
    }
    previous = next;
  });
}

let stopWatching: (() => void) | null = null;
function ensureDataLevelsWatch(): void {
  if (stopWatching) return;
  stopWatching = watchDataLevels();
}
if (import.meta.hot) import.meta.hot.dispose(() => { stopWatching?.(); stopWatching = null; });
