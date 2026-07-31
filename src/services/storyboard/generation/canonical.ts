import type { FlashBoardGenerationRequest } from '../../../stores/flashboardStore/types';
import type { PreparedStoryboardGeneration } from './types';

type CanonicalValue =
  | boolean
  | number
  | string
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Generation fingerprints require finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const output: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalize(child);
    }
    return output;
  }
  throw new Error(`Unsupported generation fingerprint value: ${typeof value}`);
}

export function stableStringifyGenerationValue(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function hashGenerationValue(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('SHA-256 is unavailable in this runtime.');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableStringifyGenerationValue(value)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function generationRequestsEqual(
  left: FlashBoardGenerationRequest | undefined,
  right: FlashBoardGenerationRequest,
): boolean {
  return left !== undefined
    && stableStringifyGenerationValue(left) === stableStringifyGenerationValue(right);
}

export function preparedGenerationFingerprintMaterial(
  prepared: PreparedStoryboardGeneration,
): unknown {
  return {
    batchKey: prepared.batchKey,
    briefId: prepared.briefId,
    briefRevision: prepared.briefRevision,
    candidateCount: prepared.candidateCount,
    capability: prepared.capability,
    entries: prepared.entries.map((entry) => ({
      candidate: {
        id: entry.candidate.id,
        kind: entry.candidate.kind,
        sceneId: entry.candidate.sceneId,
        generationBriefRevision: entry.candidate.generationBriefRevision,
        generationRequestKey: entry.candidate.generationRequestKey,
      },
      generationRequestKey: entry.generationRequestKey,
      index: entry.index,
      request: entry.request,
    })),
    projectId: prepared.projectId,
    quote: prepared.quote,
    sceneId: prepared.sceneId,
    schemaVersion: prepared.schemaVersion,
    userId: prepared.userId,
  };
}

export async function recomputePreparedGenerationFingerprint(
  prepared: PreparedStoryboardGeneration,
): Promise<string> {
  return hashGenerationValue(preparedGenerationFingerprintMaterial(prepared));
}
