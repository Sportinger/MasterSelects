import { entityKey, encodeAggregate } from '../domains/jsonBoundary';
import { decodeOwnedAggregate, existingAggregate } from '../transaction/domainAdapters/aggregatePlan';
import { RepositoryError } from '../contracts';
import type { RepositorySession } from '../RepositorySession';
import type { SourceIdentity } from '../domains/sourceIdentity';
export type VerifiedSourceIdentity = Extract<SourceIdentity, { identityStatus: 'verified' }>;
const tails = new WeakMap<RepositorySession, Promise<unknown>>();
const pendingCounts = new WeakMap<RepositorySession, number>();
/** Hash the captured source in the worker; caller guards the exact runtime File/version binding. */
export function queueSourceIdentity(session: RepositorySession, mediaId: string, blob: Blob,
  isCurrent: () => boolean, signal?: AbortSignal): Promise<VerifiedSourceIdentity | null> {
  const count = pendingCounts.get(session) ?? 0;
  if (count >= 256) return Promise.reject(new RepositoryError('budget', 'Too many pending source verifications'));
  pendingCounts.set(session, count + 1);
  const run = (tails.get(session) ?? Promise.resolve()).catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    if (!isCurrent()) return null;
    const identity = await session.client.request<{ hash: string; length: number }>({ type: 'hash-source', blob }, signal);
    if (!/^sha256:[a-f0-9]{64}$/.test(identity.hash) || identity.length !== blob.size) throw new RepositoryError('corrupt', 'Invalid source verification response');
    const value: VerifiedSourceIdentity = { identityStatus: 'verified', algorithm: 'sha256', contentHash: identity.hash, byteLength: identity.length };
    // No await between the final original-source check and the owned logical commit.
    signal?.throwIfAborted();
    if (!isCurrent()) return null;
    session.coordinator.assertMutable();
    const token = session.coordinator.begin('Verify media source', 'source-identity');
    let committed = false;
    try {
      session.coordinator.write(token, `source-identity:${mediaId}`, { type: 'verified-source-identity', schemaVersion: 1,
        value: { ...value }, references: [], blobs: [] });
      const key = entityKey('media', 'project', mediaId), entities = session.coordinator.getEntities(), media = entities.get(key);
      if (!media) throw new RepositoryError('ownership', 'Verified media source no longer has an owner');
      const valueWithProof = { ...decodeOwnedAggregate(key, entities) as Record<string, import('../contracts').JsonValue>, $sourceIdentity: { ...value } };
      const encoded = encodeAggregate(key, media.type, valueWithProof, media.blobs);
      const root = encoded.get(key)!; root.references = media.references;
      for (const old of existingAggregate(entities, key).keys()) if (!encoded.has(old)) session.coordinator.write(token, old, null);
      for (const [entityKey, entity] of encoded) session.coordinator.write(token, entityKey, entity);
      const result = session.coordinator.commit(token); committed = true;
      await session.coordinator.flush(result.receipt);
    } catch (error) { if (!committed) session.coordinator.cancel(token); throw error; }
    return value;
  }).finally(() => pendingCounts.set(session, (pendingCounts.get(session) ?? 1) - 1));
  tails.set(session, run); return run;
}
