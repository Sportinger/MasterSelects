import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type {
  TranscriptFusionArtifact,
  TranscriptWord,
} from '../../types/clipMetadata';
import { projectFileService } from '../project/ProjectFileService';
import { updateClipTranscript } from './artifactPersistence';
import { findCoherentTranscriptWordMatches } from './resultMapping';

export interface RepairTranscriptDuplicatesReport {
  removed: number;
  kept: number;
  runsDetected: number;
}

interface TranscriptRunGroup {
  id: string;
  words: TranscriptWord[];
  artifactCreatedAt?: number;
  idCreatedAt: number;
  meanConfidence: number;
}

const RUN_WORD_ID = /^(.*):word-\d+$/;
const RUN_CREATED_AT = /-(\d+)$/;
const ANNOTATION_KEYS = [
  'alignedStart',
  'alignedEnd',
  'alignmentConfidence',
  'alignmentMethod',
  'emphasis',
  'speaker',
  'speakerConfidence',
  'speakerSourceProvider',
  'originalSpeaker',
] as const satisfies readonly (keyof TranscriptWord)[];

function runIdForWord(word: TranscriptWord): string | undefined {
  return RUN_WORD_ID.exec(word.id)?.[1];
}

function createdAtFromRunId(runId: string): number {
  const value = Number(RUN_CREATED_AT.exec(runId)?.[1] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function meanConfidence(words: TranscriptWord[]): number {
  if (words.length === 0) return 0;
  return words.reduce((total, word) => total + (word.confidence ?? 0), 0) / words.length;
}

function artifactDeepgramRuns(
  artifact: TranscriptFusionArtifact | undefined,
  groupedRunIds: ReadonlySet<string>,
): Map<string, number> {
  const runs = new Map<string, number>();
  for (const run of artifact?.rawRuns ?? []) {
    if (run.provider !== 'deepgram' || !groupedRunIds.has(run.id) || run.words.length < 3) {
      continue;
    }
    runs.set(run.id, Math.max(runs.get(run.id) ?? 0, run.createdAt));
  }
  return runs;
}

function compareRunPriority(left: TranscriptRunGroup, right: TranscriptRunGroup): number {
  const leftArtifact = left.artifactCreatedAt !== undefined;
  const rightArtifact = right.artifactCreatedAt !== undefined;
  if (leftArtifact !== rightArtifact) return leftArtifact ? -1 : 1;
  if (leftArtifact && rightArtifact && left.artifactCreatedAt !== right.artifactCreatedAt) {
    return right.artifactCreatedAt! - left.artifactCreatedAt!;
  }
  if (left.words.length !== right.words.length) return right.words.length - left.words.length;
  if (left.meanConfidence !== right.meanConfidence) {
    return right.meanConfidence - left.meanConfidence;
  }
  if (left.idCreatedAt !== right.idCreatedAt) return right.idCreatedAt - left.idCreatedAt;
  return left.id.localeCompare(right.id);
}

function partitionRuns(
  words: TranscriptWord[],
  artifact: TranscriptFusionArtifact | undefined,
): TranscriptRunGroup[] {
  const groups = new Map<string, TranscriptWord[]>();
  for (const word of words) {
    const runId = runIdForWord(word);
    if (!runId) continue;
    const group = groups.get(runId) ?? [];
    group.push(word);
    groups.set(runId, group);
  }

  const artifactRuns = artifactDeepgramRuns(artifact, new Set(groups.keys()));
  return [...groups].map(([id, runWords]) => ({
    id,
    words: runWords.toSorted((left, right) => left.start - right.start),
    artifactCreatedAt: artifactRuns.get(id),
    idCreatedAt: createdAtFromRunId(id),
    meanConfidence: meanConfidence(runWords),
  })).toSorted(compareRunPriority);
}

function copyMissingAnnotations(
  canonical: TranscriptWord,
  discarded: TranscriptWord,
): TranscriptWord {
  let result = canonical;
  for (const key of ANNOTATION_KEYS) {
    if (result[key] === undefined && discarded[key] !== undefined) {
      result = { ...result, [key]: discarded[key] };
    }
  }
  return result;
}

function repairedArtifact(
  artifact: TranscriptFusionArtifact | undefined,
  words: TranscriptWord[],
  removedIds: ReadonlySet<string>,
): TranscriptFusionArtifact | undefined {
  return artifact
    ? {
        ...artifact,
        words,
        patches: artifact.patches.filter(
          patch => !patch.wordIds.some(wordId => removedIds.has(wordId)),
        ),
      }
    : undefined;
}

/**
 * Remove duplicated complete ASR passes without collapsing isolated repeated
 * speech. Only words with run-scoped IDs participate; legacy IDs stay intact.
 */
export async function repairTranscriptDuplicates(
  mediaFileId: string,
): Promise<RepairTranscriptDuplicatesReport> {
  const mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFileId);
  if (!mediaFile) throw new Error(`Media file not found: ${mediaFileId}`);

  const originalWords = mediaFile.transcript ?? [];
  const groups = partitionRuns(originalWords, mediaFile.transcriptArtifact);
  const report: RepairTranscriptDuplicatesReport = {
    removed: 0,
    kept: originalWords.length,
    runsDetected: groups.length,
  };
  if (groups.length < 2 || originalWords.length < 3) return report;

  const wordsById = new Map(originalWords.map(word => [word.id, word]));
  const removedIds = new Set<string>();
  for (let canonicalIndex = 0; canonicalIndex < groups.length - 1; canonicalIndex++) {
    for (let discardedIndex = canonicalIndex + 1; discardedIndex < groups.length; discardedIndex++) {
      const canonicalWords = groups[canonicalIndex].words
        .filter(word => !removedIds.has(word.id))
        .map(word => wordsById.get(word.id) ?? word);
      const discardedWords = groups[discardedIndex].words
        .filter(word => !removedIds.has(word.id))
        .map(word => wordsById.get(word.id) ?? word);
      for (const match of findCoherentTranscriptWordMatches(canonicalWords, discardedWords)) {
        const canonical = canonicalWords[match.existingIndex];
        const discarded = discardedWords[match.newIndex];
        if (!canonical || !discarded || removedIds.has(discarded.id)) continue;
        wordsById.set(canonical.id, copyMissingAnnotations(canonical, discarded));
        removedIds.add(discarded.id);
      }
    }
  }

  if (removedIds.size === 0) return report;
  const words = originalWords
    .filter(word => !removedIds.has(word.id))
    .map(word => wordsById.get(word.id) ?? word)
    .toSorted((left, right) => left.start - right.start);
  const artifact = repairedArtifact(mediaFile.transcriptArtifact, words, removedIds);

  useMediaStore.setState(state => ({
    files: state.files.map(file => file.id === mediaFileId
      ? { ...file, transcript: words, transcriptArtifact: artifact }
      : file),
  }));

  await projectFileService.saveTranscript(mediaFileId, {
    words,
    artifact,
  }, mediaFile.transcribedRanges).catch(() => false);

  for (const clip of useTimelineStore.getState().clips) {
    const clipMediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
    if (clipMediaFileId === mediaFileId) updateClipTranscript(clip.id, { words });
  }

  return {
    removed: removedIds.size,
    kept: words.length,
    runsDetected: groups.length,
  };
}
