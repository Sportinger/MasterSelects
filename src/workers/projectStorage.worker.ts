import { attestWritableRepositoryLocation } from '../services/project/repository/backends/repositoryLocationIdentity';
import { readCommit, commitPath } from '../services/project/repository/persistence/publication';
import { CommittedMetadataReader } from '../services/project/repository/index/CommittedMetadataReader';
import { StreamHash } from '../services/project/repository/segments/streamHash';
import { RepositoryJournalReader, createJournalIndexCache } from '../services/project/repository/journal/RepositoryJournalReader';
import { RepositoryError, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner } from '../services/project/repository/contracts';
import { createFsaRepositoryBackend } from '../services/project/repository/backends/fsaBackend';
import { createOpfsRepositoryBackend } from '../services/project/repository/backends/opfsBackend';
import { createNativeRepositoryBackend } from '../services/project/repository/backends/nativeBackend';
import { RepositoryPersistence } from '../services/project/repository/persistence/RepositoryPersistence';
import { recoverRepository } from '../services/project/repository/persistence/recovery';
import { materializeProjection, materializeEntityReferences } from '../services/project/repository/persistence/projection';
import { draftPublication } from '../services/project/repository/persistence/draftPublication';
import { readRecord } from '../services/project/repository/segments/recordSegment';
import { canonicalBytes, canonicalJson, parseJson } from '../services/project/repository/segments/canonical';
import { IndexedDBMetadataIndex } from '../services/project/repository/index/IndexedDBMetadataIndex';
import { WorkspaceViewStore } from '../services/project/repository/workspace/WorkspaceViewStore';
import { IncomingBlobTransfer } from '../services/project/repository/persistence/IncomingBlobTransfer';
import { blobPath, verifyBlob } from '../services/project/repository/persistence/blobStorage';
import type { NativeCommandResponse, StorageCancel, StorageEnvelope, StorageRequest, StorageOpenResult, RepositoryOpenProgress } from '../services/project/repository/storageWorkerProtocol';
import type { OkResponse, RepositoryCommand } from '../services/nativeHelper/protocol';

const scope = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent) => void) | null };
let epoch: string | null = null;
let backend: RepositoryBackend | null = null;
let owner: RepositoryOwner | null = null;
let persistence: RepositoryPersistence | null = null;
let index: IndexedDBMetadataIndex | null = null;
let views: WorkspaceViewStore | null = null;
let recovery: StorageOpenResult['recovery'] | null = null;
// Opening a project looks up one journal per entity; the index turns each lookup into a map read.
const journalIndex = createJournalIndexCache();
let hashingSources = 0;
let indexedReady = false;
let indexPhase: 'ready' | 'fallback' | 'rebuilding' = 'fallback';
let indexedRecords = 0;
let publicationTail: Promise<unknown> = Promise.resolve();
const requests = new Map<string, AbortController>();
const nativeRequests = new Map<string, { resolve: (value: OkResponse) => void; reject: (error: unknown) => void }>();
const transfers = new Map<string, { stream: IncomingBlobTransfer; done: Promise<void> }>();

function openProgress(progress: RepositoryOpenProgress): void {
  scope.postMessage({ type: 'open-progress', sessionEpoch: epoch, progress });
}

async function nativeCommand(command: Omit<RepositoryCommand, 'id'>): Promise<OkResponse> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    nativeRequests.set(requestId, { resolve, reject });
    scope.postMessage({ type: 'native-command', requestId, sessionEpoch: epoch, command });
  });
}
async function nativeBlob(path: string): Promise<Blob | null> {
  const requestId = crypto.randomUUID();
  const response = await new Promise<OkResponse>((resolve, reject) => {
    nativeRequests.set(requestId, { resolve, reject });
    scope.postMessage({ type: 'native-blob', requestId, sessionEpoch: epoch, path });
  });
  return response.blob instanceof Blob ? response.blob : null;
}
function queryState(options: { cursor?: string; offset?: number; limit: number; [key: string]: unknown }) {
  const { cursor: token, offset, limit: _limit, ...filters } = options;
  const query = canonicalJson(filters);
  let state = { query, offset: offset ?? 0, head: recovery?.head ?? null, indexCursor: undefined as string | undefined };
  if (token) {
    try { const parsed = JSON.parse(token);
      if (parsed.query !== query || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error('query mismatch');
      state = parsed;
    } catch { throw new RepositoryError('corrupt', 'Invalid metadata continuation'); }
  }
  return state;
}
function fallback() { return new CommittedMetadataReader(requireBackend(), () => recovery?.head ?? null, records => { indexedRecords = records; }); }
function requireBackend(): RepositoryBackend { if (!backend) throw new RepositoryError('ownership', 'Storage worker has no open repository'); return backend; }
function requireWriter(): RepositoryPersistence { if (!persistence) throw new RepositoryError('ownership', 'Repository is read-only'); return persistence; }
async function close(): Promise<void> {
  for (const transfer of transfers.values()) transfer.stream.abort(new RepositoryError('cancelled', 'Project storage session closed'));
  await Promise.allSettled([...transfers.values()].map(value => value.done)); transfers.clear();
  if (views) await views.stop();
  if (owner) await owner.release();
  index?.close(); index = null; owner = null; views = null; persistence = null; backend = null; recovery = null;
  journalIndex.head = null; journalIndex.entries = null;
}
async function open(request: Extract<StorageRequest, { type: 'open' }>, signal: AbortSignal): Promise<StorageOpenResult> {
  if (backend) throw new RepositoryError('ownership', 'Close the previous worker repository before opening another');
  const descriptor = request.descriptor;
  if (descriptor.format !== 'masterselects-repository' || descriptor.formatVersion !== 1 || !descriptor.repositoryId || !descriptor.lineageId)
    throw new RepositoryError('unsupported', 'Unsupported repository descriptor');

  openProgress({ phase: 'opening' });
  backend = request.location.kind === 'fsa' ? await createFsaRepositoryBackend(request.location.handle)
    : request.location.kind === 'opfs' ? await createOpfsRepositoryBackend(request.location.path)
    : await createNativeRepositoryBackend(request.location.path, { repositoryCommand: nativeCommand, readRepositoryBlob: nativeBlob });
  try {

    const existing = await backend.stat('project.msrepo.json');
    if (existing) {
      if (existing.length > 64 * 1024) throw new RepositoryError('corrupt', 'Repository descriptor exceeds size limit');
      const actual = parseJson<RepositoryDescriptor>(await backend.read('project.msrepo.json', 0, existing.length, signal));
      if (actual.format !== descriptor.format || actual.formatVersion !== 1 || actual.repositoryId !== descriptor.repositoryId || actual.lineageId !== descriptor.lineageId)
        throw new RepositoryError('conflict', 'Repository descriptor identity changed before opening');
      const supported = new Set(['records-v1', 'views-v1', 'sha256']);
      if (actual.requiredReaderCapabilities.some(value => !supported.has(value))) throw new RepositoryError('unsupported', 'Repository requires a newer reader');
    }

    owner = await backend.acquireOwner(descriptor.repositoryId, signal);

    let ownershipReason: 'needs-copy-restore' | 'location-registry-unavailable' | undefined;
    if (owner) {

      const attestation = await attestWritableRepositoryLocation(descriptor.repositoryId, backend.locationId);

      if (attestation !== 'same-location') { ownershipReason = attestation; await owner.release(); owner = null; }
    }
    if (!existing) {
      if (!owner) throw new RepositoryError('ownership', 'Creating a repository requires an exclusive writer');
      await backend.writeNew('project.msrepo.json', (async function* () { yield canonicalBytes(descriptor); })(), signal);
    }
    if (owner) {

      try { index = await IndexedDBMetadataIndex.open(descriptor.repositoryId, backend.locationId); }
      catch { index = null; }
    } else index = null;
    let progressAt = 0; let openingRecovery = false;
    if (owner) {
      indexedReady = index !== null; indexPhase = index ? 'rebuilding' : 'fallback';
      // Retain the disposable index. Recovery still validates authoritative bytes;
      // completed commit markers avoid rebuilding unchanged entries on every open.
      persistence = new RepositoryPersistence(backend, descriptor, owner, { sessionEpoch: epoch!, index: indexedReady ? index ?? undefined : undefined,
        onIndexError: () => { indexedReady = false; indexPhase = 'fallback'; }, onIndexProgress: () => {
          indexedRecords++;
          if (openingRecovery && (performance.now() - progressAt >= 100 || indexedRecords === 1)) {
            progressAt = performance.now(); openProgress({ phase: 'recovery', processedRecords: indexedRecords });
          }
        } });

      openingRecovery = true;
      openProgress({ phase: 'recovery', processedRecords: 0 });
      recovery = await persistence.recover(signal);
      openProgress({ phase: 'recovery', processedRecords: indexedRecords });
      openingRecovery = false;

      indexPhase = indexedReady ? 'ready' : 'fallback';
      views = new WorkspaceViewStore(backend, owner, descriptor.repositoryId, request.workspaceId);
    } else {
      indexedReady = false; indexPhase = 'fallback';

      openProgress({ phase: 'recovery' });
      recovery = await recoverRepository(backend, descriptor, signal);

      views = new WorkspaceViewStore(backend, { writerEpoch: 'readonly', assertOwned() { throw new RepositoryError('ownership', 'Reader workspace cannot mutate shared views'); }, release: async () => {} }, descriptor.repositoryId, request.workspaceId);
      // A read-only tab never updates shared index metadata outside the owner.
    }
    if (ownershipReason === 'needs-copy-restore') recovery.warnings.push('Repository identity is registered at another location; use Copy/Restore to create an independent writer identity');
    else if (ownershipReason) recovery.warnings.push('Repository location identity registry is unavailable; opened read-only');

    return { ownershipReason, writable: owner !== null, writerEpoch: owner?.writerEpoch ?? null, locationId: backend.locationId, recovery };
  } catch (error) {
    await owner?.release().catch(() => {}); index?.close(); owner = null; index = null; backend = null; persistence = null;
    throw error;
  }
}
async function verifyIndexedRevision(item: import('../services/project/repository/contracts').RevisionMetadata, signal: AbortSignal): Promise<void> {
  const record = await readRecord(requireBackend(), item.reference, signal);
  const value = record.payload as unknown as import('../services/project/repository/contracts').RevisionPayload;
  if (record.kind !== 'revision' || value.revisionId !== item.revisionId || value.parentRevisionId !== item.parentRevisionId
    || value.label !== item.label || value.source !== item.source || value.createdAt !== item.createdAt) throw new RepositoryError('corrupt', 'Derived revision index disagrees with authoritative record');
  const attestation = await index?.getMetadata(`revision-publication:${item.revisionId}`) as { commitId?: string; hash?: string; operationSequence?: number } | null;
  if (!attestation?.commitId || !attestation.hash) throw new RepositoryError('corrupt', 'Derived revision index lacks publication proof');
  const publication = await readCommit(requireBackend(), commitPath(attestation.commitId), signal);
  if (publication.reference.hash !== attestation.hash || publication.commit.lastOperation !== item.operationSequence
    || attestation.operationSequence !== item.operationSequence || !publication.commit.segments.some(segment => segment.segmentId === item.reference.segmentId)) throw new RepositoryError('corrupt', 'Derived revision sequence is not authoritative');
}
async function execute(request: StorageRequest, signal: AbortSignal): Promise<unknown> {
  switch (request.type) {
    case 'open': return open(request, signal);
    case 'close': return close();
    case 'publish': {
      const result = await requireWriter().publish(draftPublication(request.batch), signal);
      if (recovery) {
        recovery.head = result.reference; recovery.commit = result.commit; recovery.operationSequence = result.commit.lastOperation;
        Object.assign(recovery.heads, result.commit.heads);
        if (result.commit.checkpoints.length) recovery.checkpoints = result.commit.checkpoints;
      }
      return result;
    }
    case 'record': return readRecord(requireBackend(), request.reference, signal);
    case 'projection': return persistence ? persistence.materializeProjection(request.reference, request.generation, signal)
      : materializeProjection(requireBackend(), request.reference, recovery?.checkpoints ?? [], request.generation, signal);
    case 'projection-references': return materializeEntityReferences(requireBackend(), request.reference, recovery?.checkpoints ?? [], signal);
    case 'revision': {
      if (indexedReady && index) { try { const result = await index.getRevision(request.revisionId);
        if (result) { await verifyIndexedRevision(result, signal); return result; }
      } catch (error) { if (signal.aborted) throw error; indexedReady = false; indexPhase = 'fallback'; } }
      return fallback().getRevision(request.revisionId, signal);
    }
    case 'query': {
      const state = queryState(request.options);
      const pinned = { ...request.options, cursor: JSON.stringify(state), offset: undefined };
      if (indexedReady && state.head?.hash === recovery?.head?.hash && index && !(request.options.search && state.offset > 0)) { try {
        const page = await index.queryRevisions({ ...request.options, cursor: state.indexCursor, offset: state.indexCursor ? undefined : state.offset });
        for (const item of page.items) await verifyIndexedRevision(item, signal);
        return { ...page, offset: state.offset, nextCursor: page.nextCursor ? JSON.stringify({ ...state, offset: state.offset + page.items.length, indexCursor: page.nextCursor }) : null };
      } catch (error) { if (signal.aborted || error instanceof RepositoryError && ['budget', 'unsupported'].includes(error.code)) throw error; indexedReady = false; indexPhase = 'fallback'; } }
      return fallback().queryRevisions(pinned, signal);
    }
    case 'metadata': return fallback().getMetadata(request.key, signal);
    case 'metadata-query': {
      const state = queryState(request.options);
      const pinned = { ...request.options, cursor: JSON.stringify(state), offset: undefined };
      if (indexedReady && state.head?.hash === recovery?.head?.hash && index) { try {
        const page = await index.queryMetadata({ ...request.options, cursor: state.indexCursor, offset: state.indexCursor ? undefined : state.offset });
        for (const item of page.items) {
          const actual = await fallback().getMetadata(item.key, signal);
          if (canonicalJson(actual) !== canonicalJson(item.value)) throw new RepositoryError('corrupt', 'Derived metadata index disagrees with committed records');
        }
        return { ...page, offset: state.offset, nextCursor: page.nextCursor ? JSON.stringify({ ...state, offset: state.offset + page.items.length, indexCursor: page.nextCursor }) : null };
      } catch (error) { if (signal.aborted || error instanceof RepositoryError && error.code === 'budget') throw error; indexedReady = false; indexPhase = 'fallback'; } }
      return fallback().queryMetadata(pinned, signal);
    }
    case 'index-status': return { phase: indexPhase, scannedRecords: indexedRecords, writable: owner !== null };
    case 'view-read': {
      if (!views) throw new RepositoryError('ownership', 'Read-only views must use a separate local workspace');
      return views.read(request.key, request.previous);
    }
    case 'view-keys': {
      if (!views) throw new RepositoryError('ownership', 'Read-only views must use a separate local workspace');
      return views.keys();
    }
    case 'view-update': {
      if (!views || !owner) throw new RepositoryError('ownership', 'Repository views are read-only');
      return views.update(request.key, request.value);
    }
    case 'view-flush': {
      if (owner) { await views?.flush(request.views); await persistence?.saveStartupCache(); }
      return;
    }
    case 'hash-source': {
      requireBackend();
      if (!(request.blob instanceof Blob)) throw new RepositoryError('corrupt', 'Source verification requires a Blob');
      if (hashingSources >= 2) throw new RepositoryError('budget', 'Source verification queue is full');
      hashingSources++;
      try {
        // Native SHA-256 is ~40x faster; bounded originals are read whole, larger ones keep the streaming hash.
        if (request.blob.size <= 512 * 1024 * 1024) {
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await request.blob.arrayBuffer()));
          signal.throwIfAborted();
          return { hash: 'sha256:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join(''), length: request.blob.size };
        }
        const hash = new StreamHash();
        for (let offset = 0; offset < request.blob.size; offset += 256 * 1024) {
          signal.throwIfAborted();
          hash.update(new Uint8Array(await request.blob.slice(offset, offset + 256 * 1024).arrayBuffer()));
        }
        signal.throwIfAborted();
        return { hash: hash.digest(), length: request.blob.size };
      } finally { hashingSources--; }
    }
    case 'verify-blob': return verifyBlob(requireBackend(), request.reference, signal);
    case 'blob-read': {
      const backend = requireBackend();
      const path = blobPath(request.reference.hash);
      if (!await backend.stat(path)) return null;
      await verifyBlob(backend, request.reference, signal);
      if (backend.readBlob) {
        const blob = await backend.readBlob(path, signal);
        if (!blob || blob.size !== request.reference.length) throw new RepositoryError('corrupt', 'Required repository blob is missing');
        return blob.slice(0, blob.size, request.mimeType ?? blob.type);
      }
      if (request.reference.length > 32 * 1024 * 1024) throw new RepositoryError('budget', 'Large artifact requires file-backed Blob access');
      const parts: BlobPart[] = [];
      for (let offset = 0; offset < request.reference.length; offset += 256 * 1024) {
        signal.throwIfAborted();
        const part = await backend.read(path, offset, Math.min(256 * 1024, request.reference.length - offset), signal);
        parts.push(part.slice().buffer as ArrayBuffer);
      }
      return new Blob(parts, { type: request.mimeType });
    }
    case 'blob-range': {
      if (!Number.isSafeInteger(request.offset) || !Number.isSafeInteger(request.length) || request.offset < 0
        || request.length < 0 || request.length > 256 * 1024 || request.offset + request.length > request.reference.length)
        throw new RepositoryError('budget', 'Invalid artifact range');
      return requireBackend().read(blobPath(request.reference.hash), request.offset, request.length, signal);
    }
    case 'journal-entry': return new RepositoryJournalReader({ getHead: () => recovery?.heads.journal ?? null, index: journalIndex,
      readRecord: reference => readRecord(requireBackend(), reference, signal) }).latestEntry(request.id, signal);
    case 'journal-read': return new RepositoryJournalReader({ getHead: () => recovery?.heads.journal ?? null, index: journalIndex,
      readRecord: reference => readRecord(requireBackend(), reference, signal) }).latest(request.id, signal);
    case 'journal-page': return new RepositoryJournalReader({ getHead: () => recovery?.heads.journal ?? null,
      readRecord: reference => readRecord(requireBackend(), reference, signal) }).page(request.cursor, request.limit ?? 128, signal);
    case 'blob-start': {
      if (await requireBackend().stat(blobPath(request.reference.hash))) {
        await verifyBlob(requireBackend(), request.reference, signal); return { skip: true };
      }
      if (transfers.size >= 4 || transfers.has(request.transferId)) throw new RepositoryError('budget', 'Too many concurrent repository blob transfers');
      const stream = new IncomingBlobTransfer();
      const done = requireWriter().storeBlob(request.reference, stream.chunks, signal);
      done.catch(error => stream.abort(error));
      transfers.set(request.transferId, { stream, done }); return { skip: false };
    }
    case 'blob-chunk': {
      const transfer = transfers.get(request.transferId);
      if (!transfer) throw new RepositoryError('ownership', 'Blob transfer is no longer owned');
      return transfer.stream.push(request.offset, request.bytes);
    }
    case 'blob-finish': {
      const transfer = transfers.get(request.transferId);
      if (!transfer) throw new RepositoryError('ownership', 'Blob transfer is no longer owned');
      transfer.stream.finish();
      try { await transfer.done; } finally { transfers.delete(request.transferId); }
      return;
    }
    case 'blob-abort': {
      const transfer = transfers.get(request.transferId);
      if (transfer) {
        transfer.stream.abort(new RepositoryError('cancelled', 'Blob transfer cancelled'));
        await transfer.done.catch(() => {}); transfers.delete(request.transferId);
      }
      return;
    }
  }
}
scope.onmessage = event => {
  const message = event.data as StorageEnvelope | StorageCancel | NativeCommandResponse;
  if ('type' in message && message.type === 'native-response') {
    if (message.sessionEpoch !== epoch) return;
    const pending = nativeRequests.get(message.requestId); nativeRequests.delete(message.requestId);
    if (message.error || !message.data) pending?.reject(new RepositoryError('io', message.error ?? 'Native helper returned no response'));
    else pending?.resolve(message.data);
    return;
  }
  if ('type' in message && message.type === 'cancel') { if (message.sessionEpoch === epoch) requests.get(message.requestId)?.abort(); return; }
  const envelope = message as StorageEnvelope;
  if (envelope.request.type === 'open' && epoch === null) epoch = envelope.sessionEpoch;
  const controller = new AbortController(); requests.set(envelope.requestId, controller);
  void (async () => {
    try {
      if (envelope.sessionEpoch !== epoch) throw new RepositoryError('ownership', 'Stale storage worker request epoch');
      const serial = ['open', 'publish', 'close'].includes(envelope.request.type);
      if (envelope.request.type === 'close') {
        for (const transfer of transfers.values()) transfer.stream.abort(new RepositoryError('cancelled', 'Storage session closing'));
        for (const [id, request] of requests) if (id !== envelope.requestId) request.abort();
      }
      const run = serial ? publicationTail.catch(() => {}).then(() => execute(envelope.request, controller.signal)) : execute(envelope.request, controller.signal);
      if (serial) publicationTail = run;
      const data = await run;
      scope.postMessage({ requestId: envelope.requestId, sessionEpoch: epoch, ok: true, data });
    } catch (error) {
      const failure = error instanceof RepositoryError ? error : new RepositoryError('io', String(error));
      scope.postMessage({ requestId: envelope.requestId, sessionEpoch: envelope.sessionEpoch, ok: false, error: { code: failure.code, message: failure.message } });
    } finally { requests.delete(envelope.requestId); }
  })();
};
