import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { ParallelDecodeManager } from '../../ParallelDecodeManager';
import type { ClipPreparationModeResult, ExportClipState } from '../ClipPreparation';
import type { ExportParallelDecodeAdmissionReport } from '../../../services/timeline/exportRuntimeReporting';
import {
  createParallelDecodeAdmissionReport,
  getClipMediaFileId,
  releaseParallelDecodeAdmission,
  reserveParallelDecodeAdmission,
} from './admission';
import { type ClipFileDataCache, loadClipFileDataCached } from './sourceResolution';
import { createExportRuntimeSource, getExportRuntimeOwnerId } from './runtimeBinding';

const log = Logger.create('ClipPreparation');

type ParallelClipInfo = Parameters<ParallelDecodeManager['initialize']>[0][number];

export async function initializeParallelDecoding(
  clips: TimelineClip[],
  mediaFiles: MediaFile[],
  _startTime: number,
  endTime: number,
  nestedClips: Array<{ clip: TimelineClip; parentClip: TimelineClip }>,
  clipStates: Map<string, ExportClipState>,
  fps: number,
  exportRunId: string | undefined,
  endPrepare: () => void,
  fileDataCache: ClipFileDataCache
): Promise<ClipPreparationModeResult> {
  const reservedParallelReports: ExportParallelDecodeAdmissionReport[] = [];
  if (exportRunId) {
    try {
      for (const clip of clips) {
        const mediaFileId = getClipMediaFileId(clip);
        const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
        const report = createParallelDecodeAdmissionReport({
          runId: exportRunId,
          clip,
          mediaFile,
          fps,
        });
        reserveParallelDecodeAdmission(report, clip);
        reservedParallelReports.push(report);
      }

      for (const { clip } of nestedClips) {
        const mediaFileId = getClipMediaFileId(clip);
        const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
        const report = createParallelDecodeAdmissionReport({
          runId: exportRunId,
          clip,
          mediaFile,
          fps,
          isNested: true,
        });
        reserveParallelDecodeAdmission(report, clip);
        reservedParallelReports.push(report);
      }
    } catch (e) {
      for (const report of reservedParallelReports) {
        releaseParallelDecodeAdmission(report);
      }
      throw e;
    }
  }

  const parallelDecoder = new ParallelDecodeManager();

  try {
    const endLoadAll = log.time('loadAllClipFileData');
    const loadPromises: Promise<ParallelClipInfo>[] = clips.map(async (clip) => {
      const mediaFileId = getClipMediaFileId(clip);
      const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
      const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);

      if (!fileData) {
        throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}". Try PRECISE mode instead.`);
      }

      return {
        clipId: clip.id,
        clipName: clip.name,
        fileData,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        reversed: clip.reversed || false,
        speed: clip.speed ?? 1,
      };
    });

    const nestedLoadPromises: Promise<ParallelClipInfo | null>[] = nestedClips.map(async ({ clip, parentClip }) => {
      const mediaFileId = getClipMediaFileId(clip);
      const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
      const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);

      if (!fileData) {
        throw new Error(`FAST export failed: Could not load file data for nested clip "${clip.name}". Select HTMLVideo Precise explicitly if this export should use HTMLVideo decoding.`);
      }

      return {
        clipId: clip.id,
        clipName: `${parentClip.name}/${clip.name}`,
        fileData,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        reversed: clip.reversed || false,
        speed: clip.speed ?? 1,
        isNested: true,
        parentClipId: parentClip.id,
        parentStartTime: parentClip.startTime,
        parentInPoint: parentClip.inPoint || 0,
      };
    });

    const loadedClips = await Promise.all(loadPromises);
    const loadedNestedClips = (await Promise.all(nestedLoadPromises)).filter(
      (clipInfo): clipInfo is ParallelClipInfo => clipInfo !== null
    );
    endLoadAll();

    const clipInfos: ParallelClipInfo[] = [...loadedClips, ...loadedNestedClips];

    log.info(`Loaded ${loadedClips.length} regular + ${loadedNestedClips.length} nested clips for parallel decoding`);

    const endParallelInit = log.time('parallelDecoder.initialize');
    await parallelDecoder.initialize(clipInfos, fps);
    endParallelInit();

    const endPrefetch = log.time('parallelDecoder.prefetchFirstFrame');
    await parallelDecoder.prefetchFramesForTime(_startTime);

    const MAX_RETRIES = 5;
    for (const clipInfo of clipInfos) {
      let clipActiveAtStart: boolean;
      let clipTimeAtExportStart: number;

      if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
        const compTime = _startTime - clipInfo.parentStartTime - (clipInfo.parentInPoint || 0);
        clipActiveAtStart = compTime >= clipInfo.startTime && compTime < clipInfo.startTime + clipInfo.duration;
        clipTimeAtExportStart = _startTime;
      } else {
        clipActiveAtStart = _startTime >= clipInfo.startTime && _startTime < clipInfo.startTime + clipInfo.duration;
        clipTimeAtExportStart = _startTime;
      }

      log.debug(`Clip "${clipInfo.clipName}": startTime=${clipInfo.startTime}, exportStart=${_startTime}, active=${clipActiveAtStart}`);

      if (!clipActiveAtStart) {
        log.debug(`"${clipInfo.clipName}" not active at export start, skipping first frame verification`);
        continue;
      }

      log.info(`Verifying first frame for "${clipInfo.clipName}"`);

      let frame = parallelDecoder.getFrameForClip(clipInfo.clipId, clipTimeAtExportStart);

      if (!frame) {
        for (let retry = 0; retry < MAX_RETRIES && !frame; retry++) {
          log.warn(`First frame not ready for "${clipInfo.clipName}" (attempt ${retry + 1}/${MAX_RETRIES}), retrying...`);
          await new Promise(r => setTimeout(r, 200));
          await parallelDecoder.prefetchFramesForTime(clipTimeAtExportStart);
          frame = parallelDecoder.getFrameForClip(clipInfo.clipId, clipTimeAtExportStart);
        }
      }

      if (!frame) {
        throw new Error(`Failed to decode first frame for clip "${clipInfo.clipName}" after ${MAX_RETRIES} attempts. The video file may be corrupted or use an unsupported codec.`);
      }
    }

    const prewarmedClipStarts = await parallelDecoder.prewarmClipStarts(_startTime, endTime);
    if (prewarmedClipStarts > 0) {
      log.info(`Prewarmed ${prewarmedClipStarts} clip start frames for smoother cuts`);
    }
    endPrefetch();

    for (const clip of clips) {
      const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        runtimeOwnerId,
        runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, null, exportRunId),
      });
    }

    for (const { clip } of nestedClips) {
      const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
        runtimeOwnerId,
        runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, null, exportRunId),
      });
    }

    log.info(`Parallel decoding initialized for ${clipInfos.length} total clips`);
    endPrepare();

    return {
      clipStates,
      parallelDecoder,
      useParallelDecode: true,
      exportMode: 'fast',
    };
  } catch (e) {
    for (const report of reservedParallelReports) {
      releaseParallelDecodeAdmission(report);
    }
    parallelDecoder.cleanup();
    throw e;
  }
}
