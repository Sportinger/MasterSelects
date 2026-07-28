import { blobToArrayBuffer } from '../../artifacts';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TranscriptWord } from '../../types/clipMetadata';
import type { AudioArtifactStore } from '../audio/AudioArtifactStore';
import type { AudioAnalysisArtifact } from '../audio/audioArtifactTypes';
import {
  computeTranscriptWordsHash,
  decodeTranscriptTimingPayload,
  payloadToTimings,
  type AlignedWordTiming,
  type TranscriptTimingManifest,
} from '../audio/transcriptTimingManifest';
import { projectFileService } from '../project/ProjectFileService';
import { updateClipTranscript } from './artifactPersistence';

export interface ApplyAlignedTimingsInput {
  mediaFileId: string;
  artifact: AudioAnalysisArtifact;
  artifactStore: AudioArtifactStore;
}

export interface ApplyAlignedTimingsResult {
  applied: number;
  skipped: 'stale-transcript' | 'already-applied' | 'no-transcript' | null;
}

function transcriptTimingManifest(artifact: AudioAnalysisArtifact): TranscriptTimingManifest {
  const manifest = artifact.metadata?.transcriptTimingManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Transcript timing artifact ${artifact.id} has no timing manifest.`);
  }
  return manifest as unknown as TranscriptTimingManifest;
}

function timingMatches(
  word: TranscriptWord,
  timing: AlignedWordTiming,
  method: TranscriptTimingManifest['method'],
): boolean {
  return word.alignedStart === timing.alignedStart
    && word.alignedEnd === timing.alignedEnd
    && word.alignmentConfidence === timing.confidence
    && word.alignmentMethod === method;
}

export async function applyAlignedTimingsFromArtifact(
  input: ApplyAlignedTimingsInput,
): Promise<ApplyAlignedTimingsResult> {
  const storedArtifact = await input.artifactStore.getAnalysisArtifact(
    input.artifact.manifestRef.artifactId,
  );
  if (!storedArtifact || storedArtifact.kind !== 'transcript-timing') {
    throw new Error(`Transcript timing artifact not found: ${input.artifact.id}`);
  }
  if (storedArtifact.mediaFileId !== input.mediaFileId) {
    throw new Error(`Transcript timing artifact ${storedArtifact.id} belongs to another media file.`);
  }

  const manifest = transcriptTimingManifest(storedArtifact);
  const payloadBlob = await input.artifactStore.getPayload(
    manifest.timingsPayloadRef.artifactId,
  );
  if (!payloadBlob) {
    throw new Error(`Transcript timing payload not found: ${manifest.timingsPayloadRef.artifactId}`);
  }
  const timings = payloadToTimings(
    decodeTranscriptTimingPayload(await blobToArrayBuffer(payloadBlob)),
  );

  const mediaFile = useMediaStore.getState().files.find(file => file.id === input.mediaFileId);
  if (!mediaFile?.transcript?.length) {
    return { applied: 0, skipped: 'no-transcript' };
  }

  const currentWords = mediaFile.transcript;
  if (await computeTranscriptWordsHash(currentWords) !== manifest.transcriptHash) {
    return { applied: 0, skipped: 'stale-transcript' };
  }

  const wordsById = new Map(currentWords.map(word => [word.id, word]));
  if (timings.every(timing => {
    const word = wordsById.get(timing.wordId);
    return word !== undefined && timingMatches(word, timing, manifest.method);
  })) {
    return { applied: 0, skipped: 'already-applied' };
  }

  const timingsById = new Map(timings.map(timing => [timing.wordId, timing]));
  let applied = 0;
  const mergedWords = currentWords.map(word => {
    const timing = timingsById.get(word.id);
    if (!timing || timingMatches(word, timing, manifest.method)) return word;
    applied += 1;
    return {
      ...word,
      alignedStart: timing.alignedStart,
      alignedEnd: timing.alignedEnd,
      alignmentConfidence: timing.confidence,
      alignmentMethod: manifest.method,
    };
  });
  const transcriptArtifact = mediaFile.transcriptArtifact
    ? { ...mediaFile.transcriptArtifact, words: mergedWords }
    : undefined;

  useMediaStore.setState(state => ({
    files: state.files.map(file => file.id === input.mediaFileId
      ? { ...file, transcript: mergedWords, transcriptArtifact }
      : file),
  }));

  await projectFileService.saveTranscript(input.mediaFileId, {
    words: mergedWords,
    artifact: transcriptArtifact,
  }, mediaFile.transcribedRanges).catch(() => false);

  for (const clip of useTimelineStore.getState().clips) {
    const clipMediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    if (clipMediaFileId === input.mediaFileId) {
      updateClipTranscript(clip.id, { words: mergedWords });
    }
  }

  return { applied, skipped: null };
}

export async function applyAlignedTimingsForMedia(
  mediaFileId: string,
  artifactStore: AudioArtifactStore,
): Promise<ApplyAlignedTimingsResult | null> {
  const artifacts = await artifactStore.listAnalysisArtifacts(mediaFileId, 'transcript-timing');
  const artifact = artifacts
    .filter(candidate => !candidate.stale)
    .toSorted((left, right) => right.createdAt - left.createdAt)[0];
  return artifact
    ? applyAlignedTimingsFromArtifact({ mediaFileId, artifact, artifactStore })
    : null;
}
