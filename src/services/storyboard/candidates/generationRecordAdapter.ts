import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationOutput,
  FlashBoardMediaType,
  FlashBoardResult,
} from '../../../stores/flashboardStore/types';
import type {
  StoryboardCandidate,
  StoryboardCandidateKind,
  StoryboardCandidateState,
} from '../contracts';
import { assertStoryboardCandidate } from '../contracts';

interface GenerationOutputUnit {
  identity: string;
  mediaType: FlashBoardMediaType;
  output?: FlashBoardGenerationOutput;
  result?: FlashBoardResult;
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface AdaptGenerationRecordInput {
  generationBriefRevision: number;
  generationRequestKey?: string;
  record: FlashBoardActiveGenerationRecord;
  sceneId: string;
}

function encodeCandidateIdentity(value: string): string {
  return encodeURIComponent(value);
}

export function createGenerationCandidateId(
  recordId: string,
  identity: { mediaFileId?: string; outputId?: string },
): string {
  const unitIdentity = identity.outputId
    ? `output:${identity.outputId}`
    : identity.mediaFileId
      ? `media:${identity.mediaFileId}`
      : 'pending';
  return [
    'storyboard-candidate',
    encodeCandidateIdentity(recordId),
    encodeCandidateIdentity(unitIdentity),
  ].join(':');
}

function candidateKind(mediaType: FlashBoardMediaType): StoryboardCandidateKind {
  switch (mediaType) {
    case 'audio':
      return 'generated-audio';
    case 'image':
      return 'generated-image';
    case 'video':
      return 'generated-video';
  }
}

function fallbackMediaType(record: FlashBoardActiveGenerationRecord): FlashBoardMediaType {
  if (record.request?.outputType === 'audio') return 'audio';
  if (record.request?.outputType === 'image') return 'image';
  return 'video';
}

function uniqueResults(record: FlashBoardActiveGenerationRecord): FlashBoardResult[] {
  const results = [...(record.results ?? [])];
  if (
    record.result
    && !results.some((result) => (
      (record.result?.outputId && result.outputId === record.result.outputId)
      || result.mediaFileId === record.result?.mediaFileId
    ))
  ) {
    results.push(record.result);
  }
  return results;
}

function findResultForOutput(
  output: FlashBoardGenerationOutput,
  results: readonly FlashBoardResult[],
  outputCount: number,
): FlashBoardResult | undefined {
  return results.find((result) => result.outputId === output.id)
    ?? results.find((result) => result.mediaFileId === output.mediaFileId)
    ?? (outputCount === 1 && results.length === 1 ? results[0] : undefined);
}

function collectOutputUnits(record: FlashBoardActiveGenerationRecord): GenerationOutputUnit[] {
  const outputs = record.outputs ?? [];
  const results = uniqueResults(record);
  const units = outputs.map((output): GenerationOutputUnit => ({
    identity: `output:${output.id}`,
    mediaType: output.mediaType,
    output,
    result: findResultForOutput(output, results, outputs.length),
  }));
  const claimedResults = new Set(
    units.flatMap((unit) => unit.result ? [unit.result] : []),
  );

  for (const result of results) {
    if (claimedResults.has(result)) continue;
    units.push({
      identity: result.outputId
        ? `output:${result.outputId}`
        : `media:${result.mediaFileId}`,
      mediaType: result.mediaType,
      result,
    });
  }

  if (units.length === 0) {
    units.push({
      identity: 'pending',
      mediaType: fallbackMediaType(record),
    });
  }

  return units.sort((left, right) => compareStableStrings(left.identity, right.identity));
}

export function deriveGenerationCandidateState(
  record: FlashBoardActiveGenerationRecord,
  unit: Pick<GenerationOutputUnit, 'output' | 'result'>,
): StoryboardCandidateState {
  if (unit.result?.mediaFileId || unit.output?.mediaFileId) return 'ready';
  if (unit.output?.importStatus === 'failed') return 'failed';

  switch (record.job?.status) {
    case 'queued':
      return 'queued';
    case 'processing':
      return 'processing';
    case 'completed':
      // Provider completion is not yet a usable storyboard candidate until
      // FlashBoardMediaBridge has imported a project-local mediaFileId.
      return 'processing';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'draft':
      return 'awaiting-approval';
    case undefined:
      return 'proposed';
  }
}

function resolveDuration(
  record: FlashBoardActiveGenerationRecord,
  unit: GenerationOutputUnit,
): number | undefined {
  return unit.result?.duration
    ?? unit.output?.duration
    ?? record.request?.duration;
}

/**
 * Projects persisted FlashBoard job state into normalized storyboard
 * candidates. Provider URLs and binary output are deliberately not copied.
 */
export function adaptFlashBoardGenerationRecord(
  input: AdaptGenerationRecordInput,
): StoryboardCandidate[] {
  const requestKey = input.generationRequestKey ?? input.record.request?.idempotencyKey;

  return collectOutputUnits(input.record).map((unit) => {
    const outputId = unit.output?.id ?? unit.result?.outputId;
    const mediaFileId = unit.result?.mediaFileId ?? unit.output?.mediaFileId;
    const candidate: StoryboardCandidate = {
      schemaVersion: 1,
      id: createGenerationCandidateId(input.record.id, { mediaFileId, outputId }),
      sceneId: input.sceneId,
      kind: candidateKind(unit.mediaType),
      state: deriveGenerationCandidateState(input.record, unit),
      generationBriefRevision: input.generationBriefRevision,
      generationRecordId: input.record.id,
      sourceMomentHandles: [],
      createdAt: input.record.createdAt,
    };
    const durationSeconds = resolveDuration(input.record, unit);
    if (requestKey) candidate.generationRequestKey = requestKey;
    if (outputId) candidate.outputId = outputId;
    if (mediaFileId) candidate.mediaFileId = mediaFileId;
    if (durationSeconds !== undefined) candidate.durationSeconds = durationSeconds;
    assertStoryboardCandidate(candidate);
    return candidate;
  });
}
