import type { MediaFile } from '../../../stores/mediaStore';
import type {
  ClipAnalysis,
  SceneSegment,
  TranscriptWord,
} from '../../../types/clipMetadata';
import type { TimelineClip } from '../../../types/timeline';
import { Logger } from '../../logger';
import { projectFileService } from '../../projectFileService';
import type { ProjectClip } from '../types';

const log = Logger.create('MediaArtifactMigration');

export interface LegacyMediaArtifactSeed {
  analysis?: ClipAnalysis;
  analysisRange?: [number, number];
  sceneDescriptions?: SceneSegment[];
  transcript?: TranscriptWord[];
  transcriptRange?: [number, number];
}

export interface LegacyMediaArtifactMigrationReport {
  analysisFilesWritten: number;
  sceneDescriptionFilesWritten: number;
  transcriptFilesWritten: number;
}

type MediaArtifactSeedClip = {
  analysis?: ProjectClip['analysis'];
  inPoint?: number;
  mediaId?: string;
  outPoint?: number;
  sceneDescriptions?: ProjectClip['sceneDescriptions'];
  transcript?: ProjectClip['transcript'];
  source?: TimelineClip['source'];
};

export interface MediaArtifactSeedSource {
  media: ReadonlyArray<{ id: string; duration?: number }>;
  compositions: ReadonlyArray<{ clips: ReadonlyArray<MediaArtifactSeedClip> }>;
}

function clipMediaId(clip: MediaArtifactSeedClip): string | undefined {
  return (clip.source?.mediaFileId ?? clip.mediaId) || undefined;
}

function preferLonger<T>(current: T[] | undefined, candidate: T[] | undefined): candidate is T[] {
  return Boolean(candidate?.length) && (!current || candidate!.length > current.length);
}

function transcriptRange(
  words: TranscriptWord[],
  clip: MediaArtifactSeedClip,
  mediaDuration: number | undefined,
): [number, number] {
  const first = words.reduce((value, word) => Math.min(value, word.start), Number.POSITIVE_INFINITY);
  const last = words.reduce((value, word) => Math.max(value, word.end), 0);
  if (mediaDuration && last >= mediaDuration * 0.9) return [0, mediaDuration];
  const start = Number.isFinite(first) ? first : clip.inPoint ?? 0;
  const end = last > start ? last : clip.outPoint ?? start;
  return [start, end];
}

function analysisRange(
  analysis: ClipAnalysis,
  clip: MediaArtifactSeedClip,
  mediaDuration: number | undefined,
): [number, number] {
  const timestamps = analysis.frames
    .map(frame => frame.timestamp)
    .filter(Number.isFinite);
  if (timestamps.length === 0) {
    return [clip.inPoint ?? 0, clip.outPoint ?? mediaDuration ?? 0];
  }
  const start = Math.max(0, Math.min(...timestamps));
  const sampleDuration = Math.max(0.001, analysis.sampleInterval / 1000);
  const end = Math.min(
    mediaDuration ?? Number.POSITIVE_INFINITY,
    Math.max(...timestamps) + sampleDuration,
  );
  if (mediaDuration && end >= mediaDuration * 0.9 && start <= mediaDuration * 0.1) {
    return [0, mediaDuration];
  }
  return [start, end];
}

export function collectLegacyMediaArtifactSeeds(
  projectData: MediaArtifactSeedSource,
): Map<string, LegacyMediaArtifactSeed> {
  const seeds = new Map<string, LegacyMediaArtifactSeed>();
  const durations = new Map(projectData.media.map(media => [media.id, media.duration]));

  for (const composition of projectData.compositions) {
    for (const clip of composition.clips) {
      const mediaId = clipMediaId(clip);
      if (!mediaId) continue;
      const seed = seeds.get(mediaId) ?? {};
      const duration = durations.get(mediaId);
      const transcript = clip.transcript as TranscriptWord[] | undefined;
      if (preferLonger(seed.transcript, transcript)) {
        seed.transcript = transcript;
        seed.transcriptRange = transcriptRange(transcript, clip, duration);
      }
      const analysis = clip.analysis as ClipAnalysis | undefined;
      if (
        analysis?.frames.length
        && (!seed.analysis || analysis.frames.length > seed.analysis.frames.length)
      ) {
        seed.analysis = analysis;
        seed.analysisRange = analysisRange(analysis, clip, duration);
      }
      const scenes = clip.sceneDescriptions as SceneSegment[] | undefined;
      if (preferLonger(seed.sceneDescriptions, scenes)) {
        seed.sceneDescriptions = scenes;
      }
      seeds.set(mediaId, seed);
    }
  }
  return seeds;
}

export function applyLegacyMediaArtifactSeeds(
  files: MediaFile[],
  seeds: ReadonlyMap<string, LegacyMediaArtifactSeed>,
): MediaFile[] {
  return files.map(file => {
    const seed = seeds.get(file.id);
    if (!seed) return file;
    return {
      ...file,
      ...(seed.transcript?.length
        ? {
            transcript: seed.transcript,
            transcriptStatus: 'ready' as const,
            transcriptCoverage: seed.transcriptRange && file.duration
              ? Math.min(1, (seed.transcriptRange[1] - seed.transcriptRange[0]) / file.duration)
              : undefined,
            transcribedRanges: seed.transcriptRange ? [seed.transcriptRange] : undefined,
          }
        : {}),
      ...(seed.analysis
        ? {
            analysis: seed.analysis,
            analysisStatus: 'ready' as const,
            analysisProgress: 100,
            analysisCoverage: seed.analysisRange && file.duration
              ? Math.min(1, (seed.analysisRange[1] - seed.analysisRange[0]) / file.duration)
              : undefined,
            faceAnalysisStatus: seed.analysis.faceAnalysis ? 'ready' as const : 'none' as const,
            faceAnalysisProgress: seed.analysis.faceAnalysis ? 100 : 0,
          }
        : {}),
      ...(seed.sceneDescriptions?.length
        ? {
            sceneDescriptions: seed.sceneDescriptions,
            sceneDescriptionStatus: 'ready' as const,
            sceneDescriptionProgress: 100,
          }
        : {}),
    };
  });
}

export async function persistLegacyMediaArtifactSeeds(
  seeds: ReadonlyMap<string, LegacyMediaArtifactSeed>,
): Promise<LegacyMediaArtifactMigrationReport> {
  const report: LegacyMediaArtifactMigrationReport = {
    analysisFilesWritten: 0,
    sceneDescriptionFilesWritten: 0,
    transcriptFilesWritten: 0,
  };
  if (!projectFileService.isProjectOpen()) return report;

  for (const [mediaId, seed] of seeds) {
    if (seed.transcript?.length) {
      const current = await projectFileService.getTranscript(mediaId);
      const currentWords = current?.words as TranscriptWord[] | undefined;
      if (!currentWords?.length || currentWords.length < seed.transcript.length) {
        const saved = await projectFileService.saveTranscript(
          mediaId,
          { words: seed.transcript },
          seed.transcriptRange ? [seed.transcriptRange] : undefined,
        );
        if (!saved) throw new Error(`Could not migrate transcript for media ${mediaId}`);
        report.transcriptFilesWritten += 1;
      }
    }

    if (seed.analysis?.frames.length && seed.analysisRange) {
      const existingRanges = await projectFileService.getAnalysisRanges(mediaId);
      if (existingRanges.length === 0) {
        const saved = await projectFileService.saveAnalysis(
          mediaId,
          seed.analysisRange[0],
          seed.analysisRange[1],
          seed.analysis.frames,
          seed.analysis.sampleInterval,
          seed.analysis.faceAnalysis,
        );
        if (!saved) throw new Error(`Could not migrate analysis for media ${mediaId}`);
        report.analysisFilesWritten += 1;
      }
    }

    if (seed.sceneDescriptions?.length) {
      const current = await projectFileService.getSceneDescriptions(mediaId);
      if (!current?.length || current.length < seed.sceneDescriptions.length) {
        const saved = await projectFileService.saveSceneDescriptions(mediaId, seed.sceneDescriptions);
        if (!saved) throw new Error(`Could not migrate scene descriptions for media ${mediaId}`);
        report.sceneDescriptionFilesWritten += 1;
      }
    }
  }

  if (
    report.analysisFilesWritten
    || report.sceneDescriptionFilesWritten
    || report.transcriptFilesWritten
  ) {
    log.info('Migrated clip-scoped source artifacts to media files', report);
  }
  return report;
}
