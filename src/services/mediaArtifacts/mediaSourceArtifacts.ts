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

// Reactivation rebuilds media records, so equal artifact arrays arrive as new objects; compare each pair once.
const equalArtifactPairs = new WeakMap<object, WeakMap<object, boolean>>();
function sameArtifactValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  let known = equalArtifactPairs.get(a);
  const cached = known?.get(b);
  if (cached !== undefined) return cached;
  const equal = JSON.stringify(a) === JSON.stringify(b);
  if (!known) { known = new WeakMap(); equalArtifactPairs.set(a, known); }
  known.set(b, equal);
  return equal;
}

export function projectMediaSourceArtifactsOntoClip(
  clip: TimelineClip,
  projection: MediaSourceArtifactProjection = getMediaSourceArtifactProjection(getClipMediaFileId(clip)),
): TimelineClip {
  const isVisualSource = clip.source?.type === 'video'
    || (!clip.source?.type && clip.file.type.startsWith('video/'));
  const hasTranscript = Boolean(projection.transcript?.length)
    || (projection.transcriptStatus !== undefined && projection.transcriptStatus !== 'none');
  const hasAnalysis = isVisualSource && Boolean(projection.analysis);
  const hasScenes = isVisualSource && Boolean(projection.sceneDescriptions?.length);
  if (!hasTranscript && !hasAnalysis && !hasScenes) return clip;
  const patch: Partial<TimelineClip> = {
    ...(hasTranscript
      ? {
          // Words not loaded (yet) on the media never erase the words a clip already shows.
          transcript: projection.transcript ?? clip.transcript ?? [],
          transcriptProgress: projection.transcriptStatus === 'ready' ? 100 : clip.transcriptProgress,
          transcriptStatus: projection.transcriptStatus ?? 'ready' as const,
        }
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
  // Keep identity when the clip already carries this projection: re-projecting a media's artifacts
  // onto hundreds of its clips must not re-render the whole timeline for nothing.
  const changed = (Object.keys(patch) as Array<keyof TimelineClip>).some(key => !sameArtifactValue(clip[key], patch[key]));
  return changed ? { ...clip, ...patch } : clip;
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
  const hasStoredTranscript = Array.isArray(storedTranscript?.words);
  const transcriptRanges = storedTranscript?.transcribedRanges;
  const restoredAnalysis = storedAnalysis
    ? restoreCachedClipAnalysis(storedAnalysis)
    : null;
  const parsedAnalysisRanges = analysisRanges.flatMap((key): [number, number][] => {
    const [start, end] = key.split('-').map(Number);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, end]] : [];
  });
  const sceneDescriptions = storedScenes as SceneSegment[] | null;

  const storeStarted = performance.now();
  if (hasStoredTranscript || restoredAnalysis || sceneDescriptions?.length) {
    useMediaStore.setState(state => ({
      files: state.files.map(file => file.id === mediaFileId
        ? {
            ...file,
            ...(hasStoredTranscript
              ? {
                  transcript: transcriptWords ?? [],
                  transcriptStatus: 'ready' as const,
                  transcriptArtifact: storedTranscript?.artifact as MediaFile['transcriptArtifact'],
                  transcribedRanges: transcriptRanges,
                  transcriptCoverage: calculateCoverage(
                    transcriptRanges?.length
                      ? transcriptRanges
                      : (transcriptWords ?? []).map(word => [word.start, word.end] as [number, number]),
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
    mediaFileId, needsTranscript, needsAnalysis, needsScenes, storeUpdateMs: Math.round(performance.now() - storeStarted),
    analysisFrames: hydrated?.analysis?.frames.length ?? 0,
    sceneSegments: hydrated?.sceneDescriptions?.length ?? 0,
    transcriptWords: hydrated?.transcript?.length ?? 0,
  });
  return hydrated;
}

export function hydrateMediaSourceArtifacts(mediaFileId: string): Promise<MediaFile | undefined> {
  const current = useMediaStore.getState().files.find(file => file.id === mediaFileId);
  // A rebuilt media record (project reactivation, undo/redo) keeps its ready status without the loaded
  // words; hydrate it again instead of trusting the earlier run.
  const lostTranscript = current?.transcriptStatus === 'ready' && !current.transcript?.length;
  if (hydratedMediaIds.has(mediaFileId) && !lostTranscript) {
    return Promise.resolve(current);
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

const scheduledProjections = new Map<string, { rerun: boolean }>();

/** Coalesced per media: adding or restoring hundreds of its clips projects at most twice, not once per clip. */
export function scheduleMediaSourceArtifactProjection(mediaFileId: string): void {
  const active = scheduledProjections.get(mediaFileId);
  if (active) { active.rerun = true; return; }
  const run = { rerun: false };
  scheduledProjections.set(mediaFileId, run);
  void (async () => {
    do { run.rerun = false; await hydrateAndProjectMediaSourceArtifacts(mediaFileId); } while (run.rerun);
  })().catch(error => log.warn('Failed to project media-scoped source artifacts', { mediaFileId, error }))
    .finally(() => scheduledProjections.delete(mediaFileId));
}

/** After a timeline becomes active: one coalesced projection per media of its clips. */
export function scheduleMediaSourceArtifactProjectionForClips(clips: readonly TimelineClip[]): void {
  for (const mediaFileId of new Set(clips.map(getClipMediaFileId))) if (mediaFileId) scheduleMediaSourceArtifactProjection(mediaFileId);
}

export async function hydrateAndProjectMediaSourceArtifacts(mediaFileId: string): Promise<void> {
  const file = await hydrateMediaSourceArtifacts(mediaFileId);
  if (!file) return;
  const projection = getMediaSourceArtifactProjection(mediaFileId);
  if (
    !projection.transcript?.length
    && (projection.transcriptStatus === undefined || projection.transcriptStatus === 'none')
    && !projection.analysis
    && !projection.sceneDescriptions?.length
  ) {
    return;
  }
  const { updateDerivedTimelineClips } = await import('../../stores/timeline/revisionMiddleware');
  const started = performance.now();
  let changed = 0, matched = 0;
  updateDerivedTimelineClips(clips => {
    const next = clips.map(clip => {
      if (getClipMediaFileId(clip) !== mediaFileId) return clip;
      matched++;
      const projected = projectMediaSourceArtifactsOntoClip(clip, projection);
      if (projected !== clip) changed++;
      return projected;
    });
    return changed ? next : clips;
  });
  log.debug('Projected source artifacts onto clips', { mediaFileId, matched, changed, durationMs: Math.round(performance.now() - started) });
}
