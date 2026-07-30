import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import type {
  ClipAnalysis,
  SceneDescriptionStatus,
  SceneSegment,
  TranscriptStatus,
  TranscriptWord,
} from '../../types/clipMetadata';
import type { TimelineClip } from '../../types/timeline';
import { restoreCachedClipAnalysis } from '../faceAnalysis/faceAnalysisPersistence';
import { Logger } from '../logger';
import { projectFileService } from '../projectFileService';

const log = Logger.create('MediaSourceArtifacts');
const hydrationRuns = new Map<string, Promise<MediaFile | undefined>>();
const hydratedMediaIds = new Set<string>();

function calculateCoverage(ranges: [number, number][], duration: number | undefined): number {
  if (!duration || duration <= 0 || ranges.length === 0) return 0;
  const sorted = ranges
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .toSorted((left, right) => left[0] - right[0]);
  if (sorted.length === 0) return 0;
  const merged: [number, number][] = [[...sorted[0]]];
  for (let index = 1; index < sorted.length; index += 1) {
    const range = sorted[index];
    const previous = merged[merged.length - 1];
    if (range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return Math.min(1, merged.reduce((sum, [start, end]) => sum + end - start, 0) / duration);
}

export function getClipMediaFileId(
  clip: Pick<TimelineClip, 'mediaFileId' | 'source'>,
): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

export type MediaSourceArtifactProjection = {
  analysis?: ClipAnalysis;
  analysisStatus?: MediaFile['analysisStatus'];
  analysisProgress?: number;
  faceAnalysisStatus?: MediaFile['faceAnalysisStatus'];
  faceAnalysisProgress?: number;
  faceAnalysisMessage?: string;
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  sceneDescriptionProgress?: number;
  sceneDescriptionMessage?: string;
  transcript?: TranscriptWord[];
  transcriptStatus?: TranscriptStatus;
};

export function getMediaSourceArtifactProjection(
  mediaFileId: string | undefined,
): MediaSourceArtifactProjection {
  if (!mediaFileId) return {};
  const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
  if (!file) return {};
  return {
    analysis: file.analysis,
    analysisStatus: file.analysisStatus,
    analysisProgress: file.analysisProgress,
    faceAnalysisStatus: file.faceAnalysisStatus,
    faceAnalysisProgress: file.faceAnalysisProgress,
    faceAnalysisMessage: file.faceAnalysisMessage,
    sceneDescriptions: file.sceneDescriptions,
    sceneDescriptionStatus: file.sceneDescriptionStatus,
    sceneDescriptionProgress: file.sceneDescriptionProgress,
    sceneDescriptionMessage: file.sceneDescriptionMessage,
    transcript: file.transcript,
    transcriptStatus: file.transcriptStatus,
  };
}

export function projectMediaSourceArtifactsOntoClip(
  clip: TimelineClip,
  projection: MediaSourceArtifactProjection = getMediaSourceArtifactProjection(getClipMediaFileId(clip)),
): TimelineClip {
  const isVisualSource = clip.source?.type === 'video'
    || (!clip.source?.type && clip.file.type.startsWith('video/'));
  const hasTranscript = Boolean(projection.transcript?.length);
  const hasAnalysis = isVisualSource && Boolean(projection.analysis);
  const hasScenes = isVisualSource && Boolean(projection.sceneDescriptions?.length);
  if (!hasTranscript && !hasAnalysis && !hasScenes) return clip;
  return {
    ...clip,
    ...(hasTranscript
      ? { transcript: projection.transcript, transcriptStatus: projection.transcriptStatus ?? 'ready' as const }
      : {}),
    ...(hasAnalysis
      ? {
          analysis: projection.analysis,
          analysisStatus: projection.analysisStatus ?? 'ready' as const,
          analysisProgress: projection.analysisProgress ?? 100,
          faceAnalysisStatus: projection.faceAnalysisStatus,
          faceAnalysisProgress: projection.faceAnalysisProgress,
          faceAnalysisMessage: projection.faceAnalysisMessage,
        }
      : {}),
    ...(hasScenes
      ? {
          sceneDescriptions: projection.sceneDescriptions,
          sceneDescriptionStatus: projection.sceneDescriptionStatus ?? 'ready' as const,
          sceneDescriptionProgress: projection.sceneDescriptionProgress ?? 100,
          sceneDescriptionMessage: projection.sceneDescriptionMessage,
        }
      : {}),
  };
}

async function runHydration(mediaFileId: string): Promise<MediaFile | undefined> {
  const current = useMediaStore.getState().files.find(file => file.id === mediaFileId);
  if (!current || !projectFileService.isProjectOpen()) return current;

  const needsTranscript = !current.transcript?.length;
  const needsAnalysis = !current.analysis?.frames.length;
  const needsScenes = !current.sceneDescriptions?.length;
  if (!needsTranscript && !needsAnalysis && !needsScenes) return current;

  const [storedTranscript, storedAnalysis, analysisRanges, storedScenes] = await Promise.all([
    needsTranscript ? projectFileService.getTranscript(mediaFileId) : Promise.resolve(null),
    needsAnalysis ? projectFileService.getAllAnalysisMerged(mediaFileId) : Promise.resolve(null),
    needsAnalysis ? projectFileService.getAnalysisRanges(mediaFileId) : Promise.resolve([]),
    needsScenes ? projectFileService.getSceneDescriptions(mediaFileId) : Promise.resolve(null),
  ]);

  const transcriptWords = storedTranscript?.words as TranscriptWord[] | undefined;
  const transcriptRanges = storedTranscript?.transcribedRanges;
  const restoredAnalysis = storedAnalysis
    ? restoreCachedClipAnalysis(storedAnalysis)
    : null;
  const parsedAnalysisRanges = analysisRanges.flatMap((key): [number, number][] => {
    const [start, end] = key.split('-').map(Number);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, end]] : [];
  });
  const sceneDescriptions = storedScenes as SceneSegment[] | null;

  if (transcriptWords?.length || restoredAnalysis || sceneDescriptions?.length) {
    useMediaStore.setState(state => ({
      files: state.files.map(file => file.id === mediaFileId
        ? {
            ...file,
            ...(transcriptWords?.length
              ? {
                  transcript: transcriptWords,
                  transcriptStatus: 'ready' as const,
                  transcriptArtifact: storedTranscript?.artifact as MediaFile['transcriptArtifact'],
                  transcribedRanges: transcriptRanges,
                  transcriptCoverage: calculateCoverage(
                    transcriptRanges?.length
                      ? transcriptRanges
                      : transcriptWords.map(word => [word.start, word.end] as [number, number]),
                    file.duration,
                  ),
                }
              : {}),
            ...(restoredAnalysis
              ? {
                  analysis: restoredAnalysis.analysis,
                  analysisStatus: 'ready' as const,
                  analysisProgress: 100,
                  analysisCoverage: calculateCoverage(parsedAnalysisRanges, file.duration),
                  faceAnalysisStatus: restoredAnalysis.hasFaces ? 'ready' as const : 'none' as const,
                  faceAnalysisProgress: restoredAnalysis.hasFaces ? 100 : 0,
                }
              : {}),
            ...(sceneDescriptions?.length
              ? {
                  sceneDescriptions,
                  sceneDescriptionStatus: 'ready' as const,
                  sceneDescriptionProgress: 100,
                }
              : {}),
          }
        : file),
    }));
  }

  const hydrated = useMediaStore.getState().files.find(file => file.id === mediaFileId);
  log.debug('Hydrated source artifacts', {
    mediaFileId,
    analysisFrames: hydrated?.analysis?.frames.length ?? 0,
    sceneSegments: hydrated?.sceneDescriptions?.length ?? 0,
    transcriptWords: hydrated?.transcript?.length ?? 0,
  });
  return hydrated;
}

export function hydrateMediaSourceArtifacts(mediaFileId: string): Promise<MediaFile | undefined> {
  if (hydratedMediaIds.has(mediaFileId)) {
    return Promise.resolve(
      useMediaStore.getState().files.find(file => file.id === mediaFileId),
    );
  }
  const running = hydrationRuns.get(mediaFileId);
  if (running) return running;
  const run = runHydration(mediaFileId).finally(() => {
    hydrationRuns.delete(mediaFileId);
    hydratedMediaIds.add(mediaFileId);
  });
  hydrationRuns.set(mediaFileId, run);
  return run;
}

export async function hydrateAndProjectMediaSourceArtifacts(mediaFileId: string): Promise<void> {
  const file = await hydrateMediaSourceArtifacts(mediaFileId);
  if (!file) return;
  const projection = getMediaSourceArtifactProjection(mediaFileId);
  if (
    !projection.transcript?.length
    && !projection.analysis
    && !projection.sceneDescriptions?.length
  ) {
    return;
  }
  const { useTimelineStore } = await import('../../stores/timeline');
  useTimelineStore.setState(state => ({
    clips: state.clips.map(clip => {
      if (getClipMediaFileId(clip) !== mediaFileId) return clip;
      return projectMediaSourceArtifactsOntoClip(clip, projection);
    }),
  }));
}
