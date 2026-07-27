import { blobToArrayBuffer, getHashFromArtifactId, sha256ArrayBuffer } from '../../../artifacts';
import type { AgentTimelineStoredArtifactManifest } from '../../../types/agentTimeline/storage';
import type { AgentTimelineArtifactStore } from './artifactStoreBoundary';

export const DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES = 4 * 1024 * 1024;

export function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Agent Timeline storage operation was cancelled.', 'AbortError');
}

export function jsonBytes(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function assertArtifactIntegrity(
  ref: string,
  manifest: AgentTimelineStoredArtifactManifest,
  bytes: ArrayBuffer,
): Promise<void> {
  const expectedHash = getHashFromArtifactId(ref);
  if (!expectedHash || manifest.artifactId !== ref || manifest.hash !== expectedHash) {
    throw new TypeError(`Artifact reference integrity mismatch for ${ref}.`);
  }
  if (manifest.size !== bytes.byteLength) throw new TypeError(`Artifact byte size mismatch for ${ref}.`);
  return sha256ArrayBuffer(bytes).then((actualHash) => {
    if (actualHash !== expectedHash) throw new TypeError(`Artifact content hash mismatch for ${ref}.`);
  });
}

export async function readBoundedJson<T>(
  artifacts: AgentTimelineArtifactStore,
  ref: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<T> {
  assertNotAborted(signal);
  const stored = await artifacts.getArtifact(ref);
  assertNotAborted(signal);
  if (!stored) throw new Error(`Artifact is missing: ${ref}`);
  if (!Number.isSafeInteger(stored.blob.size) || stored.blob.size > maximumBytes) {
    throw new RangeError(`Artifact exceeds the ${maximumBytes}-byte read limit: ${ref}`);
  }
  const bytes = await blobToArrayBuffer(stored.blob);
  assertNotAborted(signal);
  if (bytes.byteLength > maximumBytes) throw new RangeError(`Artifact exceeds the ${maximumBytes}-byte read limit: ${ref}`);
  await assertArtifactIntegrity(ref, stored.manifest, bytes);
  assertNotAborted(signal);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse failure';
    throw new TypeError(`Artifact contains invalid UTF-8 JSON: ${message}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
