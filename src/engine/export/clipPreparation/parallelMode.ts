import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { ParallelDecodeManager } from '../../ParallelDecodeManager';
import type { ClipPreparationModeResult, ExportClipState } from '../ClipPreparation';
import { getClipMediaFileId } from './admission';
import { type ClipFileDataCache, loadClipFileData } from './sourceResolution';
import { createExportRuntimeSource, getExportRuntimeOwnerId } from './runtimeBinding';
import type { NestedVideoClip } from './nestedVideoClips';

const log = Logger.create('ClipPreparation');

type ParallelClipInfo = Parameters<ParallelDecodeManager['initialize']>[0][number];

export async function initializeParallelDecoding(
  clips: TimelineClip[],
  mediaFiles: MediaFile[],
  _startTime: number,
  _endTime: number,
  nestedClips: NestedVideoClip[],
  clipStates: Map<string, ExportClipState>,
  fps: number,
  exportRunId: string | undefined,
  endPrepare: () => void,
  _fileDataCache: ClipFileDataCache
): Promise<ClipPreparationModeResult> {
  const parallelDecoder = new ParallelDecodeManager();

  try {
    const createFileDataLoader = (
      clip: TimelineClip,
      mediaFile: MediaFile | null,
      nested: boolean
    ): (() => Promise<ArrayBuffer>) => async () => {
      const fileData = await loadClipFileData(clip, mediaFile);
      if (!fileData) {
        throw new Error(
          `FAST export failed: Could not load file data for ${nested ? 'nested ' : ''}` +
          `clip "${clip.name}".`
        );
      }
      return fileData;
    };

    const loadedClips: ParallelClipInfo[] = clips.map((clip) => {
      const mediaFileId = getClipMediaFileId(clip);
      const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;

      return {
        clipId: clip.id,
        clipName: clip.name,
        loadFileData: createFileDataLoader(clip, mediaFile ?? null, false),
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        reversed: clip.reversed || false,
        speed: clip.speed ?? 1,
      };
    });

    const loadedNestedClips: ParallelClipInfo[] = nestedClips.map(({
      clip,
      parentClip,
      mainTimelineStart,
      mainTimelineDuration,
    }) => {
      const mediaFileId = getClipMediaFileId(clip);
      const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;

      return {
        clipId: clip.id,
        clipName: `${parentClip.name}/${clip.name}`,
        loadFileData: createFileDataLoader(clip, mediaFile ?? null, true),
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        reversed: clip.reversed || false,
        speed: clip.speed ?? 1,
        isNested: true,
        mainTimelineStart,
        mainTimelineDuration,
        parentClipId: parentClip.id,
        parentStartTime: parentClip.startTime,
        parentInPoint: parentClip.inPoint || 0,
      };
    });

    const clipInfos: ParallelClipInfo[] = [...loadedClips, ...loadedNestedClips];

    log.info(`Registered ${loadedClips.length} regular + ${loadedNestedClips.length} nested clips for windowed decoding`);

    const endParallelInit = log.time('parallelDecoder.initialize');
    await parallelDecoder.initialize(clipInfos, fps);
    endParallelInit();

    const endPrefetch = log.time('parallelDecoder.prefetchFirstFrame');
    await parallelDecoder.prefetchFramesForTime(_startTime);

    const MAX_RETRIES = 5;
    for (const clipInfo of clipInfos) {
      let clipActiveAtStart: boolean;
      let clipTimeAtExportStart: number;

      if (clipInfo.mainTimelineStart !== undefined) {
        const mainDuration = clipInfo.mainTimelineDuration ?? clipInfo.duration;
        clipActiveAtStart =
          _startTime >= clipInfo.mainTimelineStart &&
          _startTime < clipInfo.mainTimelineStart + mainDuration;
        clipTimeAtExportStart = _startTime;
      } else if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
        const compTime = _startTime - clipInfo.parentStartTime + (clipInfo.parentInPoint || 0);
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
    parallelDecoder.cleanup();
    throw e;
  }
}
