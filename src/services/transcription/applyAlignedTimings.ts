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
import type { ProsodyContourManifest } from '../audio/prosodyContourManifest';
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

export interface ApplyWordEmphasisInput {
  mediaFileId: string;
  artifact: AudioAnalysisArtifact;
  artifactStore: AudioArtifactStore;
}

export interface ApplyWordEmphasisResult {
  applied: number;
  skipped: 'stale-transcript' | 'already-applied' | 'no-emphasis' | 'no-transcript' | null;
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

function prosodyContourManifest(artifact: AudioAnalysisArtifact): ProsodyContourManifest {
  const manifest = artifact.metadata?.prosodyContourManifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Prosody contour artifact ${artifact.id} has no prosody manifest.`);
  }
  return manifest as unknown as ProsodyContourManifest;
}

function transcriptHashFromFingerprint(sourceFingerprint: string): string | undefined {
  const marker = '+transcript=';
  const markerIndex = sourceFingerprint.lastIndexOf(marker);
  return markerIndex < 0 ? undefined : sourceFingerprint.slice(markerIndex + marker.length);
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

  const transcribedRanges = mediaFile.transcribedRanges
    ?? await projectFileService.getTranscribedRanges(input.mediaFileId).catch(() => undefined);
  await projectFileService.saveTranscript(input.mediaFileId, {
    words: mergedWords,
    artifact: transcriptArtifact,
  }, transcribedRanges).catch(() => false);

  for (const clip of useTimelineStore.getState().clips) {
    const clipMediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    if (clipMediaFileId === input.mediaFileId) {
      updateClipTranscript(clip.id, { words: mergedWords });
    }
  }

  return { applied, skipped: null };
}

export async function applyWordEmphasisFromArtifact(
  input: ApplyWordEmphasisInput,
): Promise<ApplyWordEmphasisResult> {
  const storedArtifact = await input.artifactStore.getAnalysisArtifact(
    input.artifact.manifestRef.artifactId,
  );
  if (!storedArtifact || storedArtifact.kind !== 'prosody-contour') {
    throw new Error(`Prosody contour artifact not found: ${input.artifact.id}`);
  }
  if (storedArtifact.mediaFileId !== input.mediaFileId) {
    throw new Error(`Prosody contour artifact ${storedArtifact.id} belongs to another media file.`);
  }

  const manifest = prosodyContourManifest(storedArtifact);
  if (manifest.wordEmphasis === undefined) {
    return { applied: 0, skipped: 'no-emphasis' };
  }

  const mediaFile = useMediaStore.getState().files.find(file => file.id === input.mediaFileId);
  if (!mediaFile?.transcript?.length) {
    return { applied: 0, skipped: 'no-transcript' };
  }

  const currentWords = mediaFile.transcript;
  const expectedTranscriptHash = transcriptHashFromFingerprint(storedArtifact.sourceFingerprint);
  if (
    storedArtifact.stale
    || (expectedTranscriptHash !== undefined
      && await computeTranscriptWordsHash(currentWords) !== expectedTranscriptHash)
  ) {
    return { applied: 0, skipped: 'stale-transcript' };
  }

  const emphasisById = new Map(
    manifest.wordEmphasis.map(entry => [entry.wordId, entry.emphasis]),
  );
  let applied = 0;
  const mergedWords = currentWords.map(word => {
    const emphasis = emphasisById.get(word.id);
    if (emphasis === undefined || word.emphasis === emphasis) return word;
    applied += 1;
    return { ...word, emphasis };
  });
  if (applied === 0) {
    return { applied: 0, skipped: 'already-applied' };
  }

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

export async function applyWordEmphasisForMedia(
  mediaFileId: string,
  artifactStore: AudioArtifactStore,
): Promise<ApplyWordEmphasisResult | null> {
  const artifacts = await artifactStore.listAnalysisArtifacts(mediaFileId, 'prosody-contour');
  const artifact = artifacts
    .filter(candidate => !candidate.stale && candidate.clipAudioStateHash === undefined)
    .toSorted((left, right) => right.createdAt - left.createdAt)[0];
  return artifact
    ? applyWordEmphasisFromArtifact({ mediaFileId, artifact, artifactStore })
    : null;
}
