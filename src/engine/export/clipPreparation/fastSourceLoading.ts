import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { WebCodecsPlayer } from '../../WebCodecsPlayer';
import { StreamedMp4UnsupportedError } from '../../webcodecs/fileSampleData';
import { type ClipFileDataCache, loadClipFileDataCached, resolveReadableClipExportFile } from './sourceResolution';
import { describeFastUnsupportedContainer, fastUnsupportedContainerMessage } from './fastSourceContainer';

const log = Logger.create('ClipPreparation');

/**
 * From this size on FAST export reads a source's sample bytes on demand. Chromium cannot read
 * a file of several GB into one ArrayBuffer (NotReadableError), and below that a whole-file
 * load still holds the entire source in memory for the length of the export.
 */
export const FAST_EXPORT_ON_DEMAND_MIN_BYTES = 512 * 1024 * 1024;

function formatSize(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function isQuickTime(header: Uint8Array): boolean {
  return header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 &&
    header[8] === 0x71 && header[9] === 0x74;
}

function parsingFailed(clip: TimelineClip, error: unknown, header: Uint8Array): Error {
  const hint = isQuickTime(header) ? ' MOV containers may have unsupported audio codecs.' : '';
  return new Error(`FAST export failed: WebCodecs/MP4Box parsing failed for clip "${clip.name}": ${error}.${hint} Try PRECISE mode instead.`);
}

/** Stops before parsing when the source is not ISO-BMFF (MP4/MOV), with the container's name. */
function refuseUnsupportedContainer(clip: TimelineClip, header: Uint8Array): void {
  const container = describeFastUnsupportedContainer(header);
  if (container) throw new Error(fastUnsupportedContainerMessage(container, clip.name));
}

/** Loads the clip's source into the export player: large files on demand, smaller ones whole. */
export async function loadFastExportSource(
  exportPlayer: WebCodecsPlayer,
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  fileDataCache: ClipFileDataCache,
): Promise<void> {
  const source = await resolveReadableClipExportFile(clip, mediaFile);
  if (source) refuseUnsupportedContainer(clip, source.header);
  let onDemandFailure = '';
  if (source && source.file.size >= FAST_EXPORT_ON_DEMAND_MIN_BYTES) {
    const endParse = log.time(`loadFileOnDemand "${clip.name}"`);
    try {
      await exportPlayer.loadFileOnDemand(source.file);
      log.info(`Clip ${clip.name}: ${formatSize(source.file.size)} source, sample bytes read on demand`);
      return;
    } catch (e) {
      if (!(e instanceof StreamedMp4UnsupportedError)) {
        throw parsingFailed(clip, e, source.header);
      }
      onDemandFailure = e.message;
      log.warn(`Clip ${clip.name}: cannot read on demand (${e.message}); loading the whole file`);
    } finally {
      endParse();
    }
  }

  const endLoad = log.time(`loadClipFileData "${clip.name}"`);
  const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);
  endLoad();
  if (!fileData) {
    const details = source ? ` (${formatSize(source.file.size)}${onDemandFailure ? `; ${onDemandFailure}` : ''})` : '';
    throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}"${details}. Try PRECISE mode instead.`);
  }
  const header = new Uint8Array(fileData.slice(0, 12));
  refuseUnsupportedContainer(clip, header);
  log.debug(`Loaded ${clip.name} (${(fileData.byteLength / 1024 / 1024).toFixed(1)}MB, ${isQuickTime(header) ? 'MOV' : 'MP4'})`);

  const endParse = log.time(`loadArrayBuffer "${clip.name}"`);
  try {
    await exportPlayer.loadArrayBuffer(fileData);
  } catch (e) {
    throw parsingFailed(clip, e, header);
  } finally {
    endParse();
  }
}
