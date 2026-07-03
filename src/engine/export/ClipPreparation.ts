// Clip preparation and initialization for export

import { Logger } from '../../services/logger';
import type { TimelineClip } from '../../stores/timeline/types';
import type { Composition, MediaFile } from '../../stores/mediaStore/types';
import type { ExportSettings, ExportClipState, ExportMode } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { getExportRunOwnerId } from '../../services/timeline/exportRuntimeReporting';
import { cleanupExportMode } from './clipPreparation/cleanup';
import { initializeFastMode } from './clipPreparation/fastMode';
import { prepareImageClipsForExport } from './clipPreparation/mediaElements';
import { initializePreciseMode } from './clipPreparation/preciseMode';
import { getFastModeFileSizeStats, loadClipFileData } from './clipPreparation/sourceResolution';

const log = Logger.create('ClipPreparation');
const FAST_EXPORT_SINGLE_FILE_LIMIT_BYTES = 1536 * 1024 * 1024; // 1.5 GB
const FAST_EXPORT_TOTAL_FILE_LIMIT_BYTES = 2048 * 1024 * 1024; // 2 GB

interface FastExportFileSizeStats {
  totalBytes: number;
  largestBytes: number;
  largestClipName: string | null;
  uniqueSourceCount: number;
}

export type { ExportClipState, ExportMode } from './types';
export { cleanupExportMode, loadClipFileData };

export interface ClipPreparationModeResult {
  clipStates: Map<string, ExportClipState>;
  parallelDecoder: ParallelDecodeManager | null;
  useParallelDecode: boolean;
  exportMode: ExportMode;
}

export interface ClipPreparationResult extends ClipPreparationModeResult {
  mediaFiles: MediaFile[];
  mediaCompositions: Composition[];
}

export function shouldUsePreciseForFastExportFileSizes(stats: FastExportFileSizeStats): boolean {
  return stats.largestBytes >= FAST_EXPORT_SINGLE_FILE_LIMIT_BYTES ||
    stats.totalBytes >= FAST_EXPORT_TOTAL_FILE_LIMIT_BYTES;
}

function formatLargeFastExportFallbackMessage(
  stats: FastExportFileSizeStats,
  videoClipCount: number
): string {
  const largestMb = (stats.largestBytes / 1024 / 1024).toFixed(0);
  const totalMb = (stats.totalBytes / 1024 / 1024).toFixed(0);
  return (
    `FAST export is using HTMLVideo Precise for large source media ` +
    `(largest=${largestMb}MB, uniqueTotal=${totalMb}MB, ` +
    `uniqueSources=${stats.uniqueSourceCount}/${videoClipCount}, ` +
    `largestClip="${stats.largestClipName ?? 'unknown'}").`
  );
}

function shouldAutoFallbackToPrecise(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);

  return (
    message.includes('FAST export failed') ||
    message.includes('NotReadableError') ||
    message.includes('The requested file could not be read') ||
    message.includes('Array buffer allocation failed') ||
    message.includes('out of memory')
  );
}

/**
 * Prepare all video clips for export based on export mode.
 * FAST mode: WebCodecs with MP4Box parsing - strict decoder path, no HTML fallback
 * PRECISE mode: explicit HTMLVideoElement seeking - frame-accurate but slower
 */
export async function prepareClipsForExport(
  settings: ExportSettings,
  exportMode: ExportMode,
  exportRunId?: string
): Promise<ClipPreparationResult> {
  const endPrepare = log.time('prepareClipsForExport TOTAL');
  const { clips, tracks } = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const mediaFiles = mediaState.files;
  const mediaCompositions = mediaState.compositions;
  const startTime = settings.startTime;
  const endTime = settings.endTime;
  const withMedia = (result: ClipPreparationModeResult): ClipPreparationResult => ({
    ...result,
    mediaFiles,
    mediaCompositions,
  });

  const clipStates = new Map<string, ExportClipState>();

  const videoClips = clips.filter(clip => {
    const track = tracks.find(t => t.id === clip.trackId);
    if (!track?.visible || track.type !== 'video') return false;
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime < endTime && clipEnd > startTime;
  });

  const vectorAnimationClips: TimelineClip[] = [];
  for (const clip of videoClips) {
    if (isVectorAnimationSourceType(clip.source?.type)) {
      vectorAnimationClips.push(clip);
    }
    if (clip.isComposition && clip.nestedClips?.length) {
      for (const nestedClip of clip.nestedClips) {
        if (isVectorAnimationSourceType(nestedClip.source?.type)) {
          vectorAnimationClips.push(nestedClip);
        }
      }
    }
  }

  if (vectorAnimationClips.length > 0) {
    await Promise.all(vectorAnimationClips.map(async (clip) => {
      if (!clip.file) {
        return;
      }
      await vectorAnimationRuntimeManager.prepareClipSource(
        clip,
        clip.file,
        exportRunId
          ? {
              policyId: 'export',
              ownerId: getExportRunOwnerId(exportRunId),
              ownerType: 'export',
              resourceId: `export:${exportRunId}:clip:${clip.id}:vector-canvas`,
              imageId: `export:${exportRunId}:clip:${clip.id}:vector-canvas`,
              label: 'Export vector runtime canvas',
              tags: ['export', 'clip-state', 'vector-animation', clip.source?.type ?? 'vector'],
            }
          : undefined,
      );
    }));
  }

  await prepareImageClipsForExport(videoClips, mediaFiles, clipStates, exportRunId);

  log.info(`Preparing ${videoClips.length} video clips for ${exportMode.toUpperCase()} export...`);

  if (exportMode === 'precise') {
    const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime, exportRunId);
    endPrepare();
    return withMedia(result);
  }

  const fileSizeStats = getFastModeFileSizeStats(videoClips, mediaFiles);
  if (shouldUsePreciseForFastExportFileSizes(fileSizeStats)) {
    log.warn(formatLargeFastExportFallbackMessage(fileSizeStats, videoClips.length));
    const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime, exportRunId);
    endPrepare();
    return withMedia(result);
  }

  try {
    return withMedia(await initializeFastMode(
      videoClips,
      mediaFiles,
      startTime,
      endTime,
      clipStates,
      settings.fps,
      exportRunId,
      endPrepare
    ));
  } catch (e) {
    if (shouldAutoFallbackToPrecise(e)) {
      log.warn('FAST export failed; retrying with PRECISE HTMLVideo export mode', e);
      cleanupExportMode(clipStates, null);
      clipStates.clear();
      await prepareImageClipsForExport(videoClips, mediaFiles, clipStates, exportRunId);
      const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime, exportRunId);
      endPrepare();
      return withMedia(result);
    }
    cleanupExportMode(clipStates, null);
    endPrepare();
    throw e;
  }
}
