import type {
  AnalysisStatus,
  ClipAnalysis,
} from '../../types/clipMetadata';
import type { TimelineClip } from '../../types/timeline';

export interface SharedClipAnalysisState {
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  analysisProgress?: number;
  faceAnalysisStatus?: AnalysisStatus;
  faceAnalysisProgress?: number;
  faceAnalysisMessage?: string;
}

/**
 * Visual analysis is owned by the imported media source. A timeline clip is
 * only a source-time view over that artifact, so trims and copies keep using
 * the same media-scoped data.
 */
export function getClipAnalysisSourceId(
  clip: Pick<TimelineClip, 'file' | 'mediaFileId' | 'source'>,
): string | null {
  if (clip.source?.type && clip.source.type !== 'video') return null;
  if (!clip.source?.type && !clip.file.type.startsWith('video/')) return null;
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

export function clipsShareAnalysisSource(
  source: Pick<TimelineClip, 'file' | 'mediaFileId' | 'source'>,
  candidate: Pick<TimelineClip, 'file' | 'mediaFileId' | 'source'>,
): boolean {
  const sourceId = getClipAnalysisSourceId(source);
  return sourceId !== null && sourceId === getClipAnalysisSourceId(candidate);
}

export function getSharedClipAnalysisState(
  clip: Pick<
    TimelineClip,
    | 'analysis'
    | 'analysisProgress'
    | 'analysisStatus'
    | 'faceAnalysisMessage'
    | 'faceAnalysisProgress'
    | 'faceAnalysisStatus'
  >,
): SharedClipAnalysisState {
  return {
    analysis: clip.analysis,
    analysisStatus: clip.analysisStatus,
    analysisProgress: clip.analysisProgress,
    faceAnalysisStatus: clip.faceAnalysisStatus,
    faceAnalysisProgress: clip.faceAnalysisProgress,
    faceAnalysisMessage: clip.faceAnalysisMessage,
  };
}

export function applySharedClipAnalysisState(
  clips: readonly TimelineClip[],
  sourceClipId: string,
  update: (clip: TimelineClip) => TimelineClip,
): TimelineClip[] {
  const source = clips.find(clip => clip.id === sourceClipId);
  if (!source) return [...clips];

  return clips.map(clip => (
    clip.id === sourceClipId || clipsShareAnalysisSource(source, clip)
      ? update(clip)
      : clip
  ));
}

export function findClipWithSharedAnalysis(
  clips: readonly TimelineClip[],
  source: Pick<TimelineClip, 'file' | 'mediaFileId' | 'source'>,
): TimelineClip | undefined {
  return clips.find(candidate => (
    clipsShareAnalysisSource(source, candidate)
    && candidate.analysis !== undefined
  ));
}
