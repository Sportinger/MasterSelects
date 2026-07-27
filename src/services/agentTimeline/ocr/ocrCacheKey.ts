import type { OcrPipelineRequest } from '../../../types/agentTimeline/ocr';

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Includes analyzer/model/language/candidate metadata, never decoded frame data. */
export function createOcrCacheKey(request: Pick<OcrPipelineRequest,
  'sourceIdentityHash' | 'profile' | 'analyzerId' | 'analyzerVersion' | 'modelId' | 'modelVersion' | 'languages' | 'candidates'
>): string {
  const required = [request.sourceIdentityHash, request.analyzerId, request.analyzerVersion, request.modelId, request.modelVersion];
  if (required.some((value) => !value.trim())) throw new TypeError('OCR cache keys require source, analyzer, and model identities');
  const candidates = request.candidates.map((candidate) => [
    candidate.shotId, candidate.sourceTime, candidate.visibilityEnd, candidate.reason,
    candidate.imageHash ?? null, candidate.textRegionHash ?? null,
  ]).toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return `ocr-cache-${stableHash(JSON.stringify([
    request.sourceIdentityHash, request.profile, request.analyzerId, request.analyzerVersion,
    request.modelId, request.modelVersion, [...new Set(request.languages)].toSorted(), candidates,
  ]))}`;
}
