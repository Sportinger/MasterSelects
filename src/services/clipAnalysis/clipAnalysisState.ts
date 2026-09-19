import { triggerTimelineSave } from '../../stores/mediaStore';
import { Logger } from '../logger';
import { projectFileService } from '../projectFileService';
import { hasCompatibleFaceAnalysis } from '../faceAnalysis/faceAnalysisPersistence';
import type {
  AnalysisStatus,
  ClipAnalysis,
} from '../../types/clipMetadata';
import type { TimelineClip } from '../../types/timeline';
import { applySharedClipAnalysisState } from './sourceAnalysisSharing';
import {
  findTimelineAnalysisMediaFile,
  readTimelineAnalysisClips,
  updateTimelineAnalysisClips,
  updateTimelineAnalysisMediaFiles,
} from '../timeline/timelineRuntimeCoordinator';

const log = Logger.create('ClipAnalysisState');

export interface ClipAnalysisStateUpdate {
  status?: AnalysisStatus;
  progress?: number;
  analysis?: ClipAnalysis | null;
  faceStatus?: AnalysisStatus;
  faceProgress?: number;
  faceMessage?: string | null;
}

function applyAnalysisUpdate<T extends {
  analysis?: ClipAnalysis;
  analysisProgress?: number;
  analysisStatus?: AnalysisStatus;
  faceAnalysisMessage?: string;
  faceAnalysisProgress?: number;
  faceAnalysisStatus?: AnalysisStatus;
}>(value: T, data: ClipAnalysisStateUpdate): T {
  const next = {
    ...value,
    analysisStatus: data.status ?? value.analysisStatus,
    analysisProgress: data.progress ?? value.analysisProgress,
    faceAnalysisStatus: data.faceStatus ?? value.faceAnalysisStatus,
    faceAnalysisProgress: data.faceProgress ?? value.faceAnalysisProgress,
    faceAnalysisMessage: data.faceMessage === null
      ? undefined
      : data.faceMessage ?? value.faceAnalysisMessage,
  };
  if ('analysis' in data) next.analysis = data.analysis ?? undefined;
  return next;
}

export function createStaleAnalysisRecoveryUpdate(
  clip: Pick<
    TimelineClip,
    | 'analysis'
    | 'analysisProgress'
    | 'analysisStatus'
    | 'faceAnalysisProgress'
    | 'faceAnalysisStatus'
  >,
): ClipAnalysisStateUpdate | null {
  const metricsWereAnalyzing = clip.analysisStatus === 'analyzing';
  const facesWereAnalyzing = clip.faceAnalysisStatus === 'analyzing';
  if (!metricsWereAnalyzing && !facesWereAnalyzing) return null;

  const hasPartialMetrics = (clip.analysis?.frames.length ?? 0) > 0;
  const hasPartialFaces = hasCompatibleFaceAnalysis(clip.analysis);
  return {
    status: metricsWereAnalyzing
      ? (hasPartialMetrics ? 'ready' : 'none')
      : undefined,
    progress: metricsWereAnalyzing
      ? (hasPartialMetrics ? clip.analysisProgress : 0)
      : undefined,
    faceStatus: facesWereAnalyzing
      ? (hasPartialFaces ? 'ready' : 'none')
      : undefined,
    faceProgress: facesWereAnalyzing
      ? (hasPartialFaces ? clip.faceAnalysisProgress : 0)
      : undefined,
    faceMessage: facesWereAnalyzing
      ? hasPartialFaces
        ? 'Face analysis was interrupted by a page reload. Reanalyze to finish it.'
        : 'Face analysis was interrupted by a page reload.'
      : undefined,
  };
}

export function updateClipAnalysis(
  clipId: string,
  data: ClipAnalysisStateUpdate,
): TimelineClip | undefined {
  const clips = readTimelineAnalysisClips();
  const originalClip = clips.find(clip => clip.id === clipId);
  const updatedClips = applySharedClipAnalysisState(
    clips,
    clipId,
    clip => applyAnalysisUpdate(clip, data),
  );

  updateTimelineAnalysisClips(() => updatedClips);
  const mediaFileId = originalClip?.source?.mediaFileId || originalClip?.mediaFileId;
  if (mediaFileId) {
    updateTimelineAnalysisMediaFiles(files => files.map(file => {
      if (file.id !== mediaFileId) return file;
      return applyAnalysisUpdate(file, data);
    }));
  }
  return originalClip;
}

/** Update a source-owned analysis even when it has no timeline occurrence. */
export function updateMediaFileAnalysis(
  mediaFileId: string,
  data: ClipAnalysisStateUpdate,
): void {
  updateTimelineAnalysisMediaFiles(files => files.map(file => (
    file.id === mediaFileId ? applyAnalysisUpdate(file, data) : file
  )));
  const clips = readTimelineAnalysisClips();
  const hasTimelineOccurrence = clips.some(clip => (
    (clip.source?.mediaFileId || clip.mediaFileId) === mediaFileId
  ));
  if (!hasTimelineOccurrence) return;
  updateTimelineAnalysisClips(currentClips => currentClips.map(clip => {
    const clipMediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
    return clipMediaFileId === mediaFileId ? applyAnalysisUpdate(clip, data) : clip;
  }));
}

function calculateCoverage(ranges: [number, number][], totalDuration: number): number {
  if (totalDuration <= 0 || ranges.length === 0) return 0;
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[...sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }
  const covered = merged.reduce((sum, [start, end]) => sum + (end - start), 0);
  return Math.min(1, covered / totalDuration);
}

export async function propagateAnalysisToMediaFile(mediaFileId: string): Promise<void> {
  try {
    const file = findTimelineAnalysisMediaFile(mediaFileId);
    if (!file?.duration || file.duration <= 0) return;

    const ranges: [number, number][] = [];
    if (projectFileService.isProjectOpen()) {
      try {
        const rangeKeys = await projectFileService.getAnalysisRanges(mediaFileId);
        for (const key of rangeKeys) {
          const [start, end] = key.split('-').map(Number);
          if (!Number.isNaN(start) && !Number.isNaN(end)) ranges.push([start, end]);
        }
      } catch {
        // Timeline state below remains a valid coverage fallback.
      }
    }

    const analyzedClip = readTimelineAnalysisClips().find((clip) => {
      const clipMediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
      return clipMediaFileId === mediaFileId && Boolean(clip.analysis?.frames.length);
    });
    if (analyzedClip?.analysis?.frames.length) {
      const sampleDuration = Math.max(0.001, analyzedClip.analysis.sampleInterval / 1000);
      for (const frame of analyzedClip.analysis.frames) {
        const start = Math.max(0, frame.timestamp);
        const end = Math.min(file.duration, start + sampleDuration);
        if (end > start) ranges.push([start, end]);
      }
    }

    const analysisCoverage = calculateCoverage(ranges, file.duration);
    updateTimelineAnalysisMediaFiles(files =>
      files.map(candidate =>
        candidate.id === mediaFileId
          ? { ...candidate, analysisStatus: 'ready' as const, analysisCoverage }
          : candidate
      )
    );
    log.debug('Propagated analysis status to MediaFile', {
      mediaFileId,
      analysisCoverage: analysisCoverage.toFixed(2),
    });
  } catch (error) {
    log.warn('Failed to propagate analysis status to MediaFile', error);
  }
}

export async function clearClipAnalysis(clipId: string): Promise<void> {
  const clip = updateClipAnalysis(clipId, {
    status: 'none',
    progress: 0,
    faceStatus: 'none',
    faceProgress: 0,
    faceMessage: null,
    analysis: null,
  });
  const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
  if (clip && mediaFileId && projectFileService.isProjectOpen()) {
    try {
      const deleted = await projectFileService.deleteAnalysis(mediaFileId);
      if (!deleted) log.warn('Could not delete persisted source analysis', { clipId, mediaFileId });
    } catch (error) {
      log.warn('Failed to delete persisted source analysis', error);
    }
  }
  if (mediaFileId) {
    updateTimelineAnalysisMediaFiles(files =>
      files.map(file => (
        file.id === mediaFileId
          ? {
              ...file,
              analysis: undefined,
              analysisStatus: 'none' as const,
              analysisProgress: 0,
              analysisCoverage: 0,
              faceAnalysisStatus: 'none' as const,
              faceAnalysisProgress: 0,
              faceAnalysisMessage: undefined,
            }
          : file
      ))
    );
  }
  triggerTimelineSave();
}
