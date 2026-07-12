import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { releaseReservedExportFrameProvider, reserveExportFrameProvider } from '../../../services/timeline/exportRuntimeReporting';
import type { WebCodecsPlayer } from '../../WebCodecsPlayer';
import type { ClipPreparationModeResult, ExportClipState } from '../ClipPreparation';
import {
  createExportPreparationAdmissionError,
  createRuntimeBindingPlan,
  createSequentialFrameProviderAdmissionReport,
  getClipMediaFileId,
} from './admission';
import { initializeParallelDecoding } from './parallelMode';
import { type ClipFileDataCache, loadClipFileDataCached } from './sourceResolution';
import { createExportRuntimeSource, getExportRuntimeOwnerId } from './runtimeBinding';
import { getMappedClipSourceTime } from '../layerBuilder/timing';
import { collectNestedVideoClips, type NestedVideoClip } from './nestedVideoClips';

const log = Logger.create('ClipPreparation');

export async function initializeFastMode(
  videoClips: TimelineClip[],
  mediaFiles: MediaFile[],
  startTime: number,
  endTime: number,
  clipStates: Map<string, ExportClipState>,
  fps: number,
  exportRunId: string | undefined,
  endPrepare: () => void
): Promise<ClipPreparationModeResult> {
  const { WebCodecsPlayer } = await import('../../WebCodecsPlayer');
  const fileDataCache: ClipFileDataCache = new Map();
  const initializeSequentialClip = async (clip: TimelineClip): Promise<void> => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    const runtimePlan = createRuntimeBindingPlan(clip, runtimeOwnerId);
    const providerAdmissionReport = exportRunId
      ? createSequentialFrameProviderAdmissionReport(exportRunId, clip, mediaFile, runtimePlan)
      : null;
    if (providerAdmissionReport) {
      const providerDecision = reserveExportFrameProvider(providerAdmissionReport);
      if (!providerDecision.admitted) {
        throw createExportPreparationAdmissionError('FAST WebCodecs frame provider', clip, providerDecision);
      }
    }

    let exportPlayer: WebCodecsPlayer | null = null;
    try {
      const endLoad = log.time(`loadClipFileData "${clip.name}"`);
      const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);
      endLoad();

      if (!fileData) {
        throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}". Try PRECISE mode instead.`);
      }

      const header = new Uint8Array(fileData.slice(0, 12));
      const isMOV = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 &&
                    (header[8] === 0x71 && header[9] === 0x74);
      const fileType = isMOV ? 'MOV' : 'MP4';

      log.debug(`Loaded ${clip.name} (${(fileData.byteLength / 1024 / 1024).toFixed(1)}MB, ${fileType})`);

      exportPlayer = new WebCodecsPlayer({ useSimpleMode: false, loop: false });

      const endParse = log.time(`loadArrayBuffer "${clip.name}"`);
      try {
        await exportPlayer.loadArrayBuffer(fileData);
        endParse();
      } catch (e) {
        endParse();
        const hint = isMOV ? ' MOV containers may have unsupported audio codecs.' : '';
        throw new Error(`FAST export failed: WebCodecs/MP4Box parsing failed for clip "${clip.name}": ${e}.${hint} Try PRECISE mode instead.`);
      }

      const clipStartInExport = Math.max(0, startTime - clip.startTime);
      const mappedSourceTime = getMappedClipSourceTime(clip, clipStartInExport);
      const clipSpeed = clip.speed ?? 1;
      const speedAdjusted = clipStartInExport * Math.abs(clipSpeed);
      const clipTime = mappedSourceTime ?? ((clip.reversed !== (clipSpeed < 0))
        ? clip.outPoint - speedAdjusted
        : clip.inPoint + speedAdjusted);

      const endSeqPrep = log.time(`prepareForSequentialExport "${clip.name}"`);
      await exportPlayer.prepareForSequentialExport(clipTime);
      endSeqPrep();

      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: exportPlayer,
        lastSampleIndex: exportPlayer.getCurrentSampleIndex(),
        isSequential: true,
        runtimeOwnerId,
        runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, exportPlayer, exportRunId),
      });

      log.debug(`Clip ${clip.name}: FAST mode enabled (${exportPlayer.width}x${exportPlayer.height})`);
    } catch (e) {
      if (!clipStates.has(clip.id) && providerAdmissionReport) {
        releaseReservedExportFrameProvider(providerAdmissionReport);
      }
      if (!clipStates.has(clip.id) && exportPlayer) {
        try {
          exportPlayer.destroy();
        } catch {
          // Ignore cleanup errors for a failed export-preparation player.
        }
      }
      throw e;
    }
  };

  const regularVideoClips: TimelineClip[] = [];
  const nestedVideoClips: NestedVideoClip[] = [];
  const preparedVideoClipIds = new Set<string>();

  for (const clip of videoClips) {
    if (clip.isComposition) {
      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
      });
      log.debug(`Clip ${clip.name}: Composition with nested clips`);

      for (const nestedVideoClip of collectNestedVideoClips(clip)) {
        if (!preparedVideoClipIds.has(nestedVideoClip.clip.id)) {
          preparedVideoClipIds.add(nestedVideoClip.clip.id);
          nestedVideoClips.push(nestedVideoClip);
        }
      }
    } else if (clip.source?.type === 'video' && !preparedVideoClipIds.has(clip.id)) {
      preparedVideoClipIds.add(clip.id);
      regularVideoClips.push(clip);
    }
  }

  const totalVideoClips = regularVideoClips.length + nestedVideoClips.length;
  if (nestedVideoClips.length > 0) {
    log.info(`Using PARALLEL decoding for ${regularVideoClips.length} regular + ${nestedVideoClips.length} nested = ${totalVideoClips} video clips`);
    return initializeParallelDecoding(
      regularVideoClips,
      mediaFiles,
      startTime,
      endTime,
      nestedVideoClips,
      clipStates,
      fps,
      exportRunId,
      endPrepare,
      fileDataCache
    );
  }

  if (totalVideoClips >= 2) {
    log.info(`Using multi-clip sequential WebCodecs export for ${regularVideoClips.length} regular video clips`);
    for (const clip of regularVideoClips) {
      await initializeSequentialClip(clip);
    }

    log.info(`All ${regularVideoClips.length} clips using FAST WebCodecs sequential decoding`);
    endPrepare();

    return {
      clipStates,
      parallelDecoder: null,
      useParallelDecode: false,
      exportMode: 'fast',
    };
  }

  for (const clip of regularVideoClips) {
    await initializeSequentialClip(clip);
  }

  log.info(`All ${videoClips.length} clips using FAST WebCodecs sequential decoding`);
  endPrepare();

  return {
    clipStates,
    parallelDecoder: null,
    useParallelDecode: false,
    exportMode: 'fast',
  };
}
