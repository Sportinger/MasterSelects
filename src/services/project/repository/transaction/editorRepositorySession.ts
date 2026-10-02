import type { ArtifactManifest } from '../../../../artifacts/types';
import type { RepositorySession } from '../RepositorySession';
import type { RecordReference } from '../contracts';
import { decodeAggregate, domainJson, entityKey } from '../domains/jsonBoundary';
import { encodeProjectDomains } from '../domains/projectDomains';
import type { ProjectFile } from '../../types/project.types';
import { queueEditorRepositoryView, getEditorRepositorySession, getEditorTransactionToken } from './editorMutationRuntime';
import { object } from './domainAdapters/aggregatePlan';
import { emptyPlan, ensureRootField, existingAggregate } from './domainAdapters/aggregatePlan';
import { projectSkeleton } from './domainAdapters/projectPatchCodec';
import { PROJECT_ENTITY_KEY } from '../domains/projectDomains';
import { prepareDomainMutation, finishDomainMutation } from './domainMutationAdapter';
import { normalizeEditorStructuredDomains } from './domainAdapters/structuredDomain';
export { installEditorRepositorySession, getEditorRepositorySession, subscribeEditorRepositorySession, beginEditorTransaction, runEditorTransaction,
  commitEditorTransaction, cancelEditorTransaction, bindEditorSourceJob, ownsEditorTransaction, flushEditorRepositoryViews } from './editorMutationRuntime';
export { activateRepositoryProjection, createEditorRepositoryActivation } from './editorProjectionActivation';

export function captureEditorProjectDomains(project: ProjectFile): ReturnType<typeof encodeProjectDomains> {
  return normalizeEditorStructuredDomains(encodeProjectDomains(project));
}
export async function readEditorRepositoryWorkspace(session: RepositorySession, baseWorkspace: import('../contracts').JsonValue): Promise<import('../contracts').JsonValue> {
  const result = { ...object(baseWorkspace) };
  const keys = ['media/activeCompositionId', 'media/openCompositionIds', 'media/selectedIds', 'media/expandedFolderIds', 'media/previewCompositionId',
    'media/sourceMonitorFileId', 'documents/activeDocumentId', 'tracking/selectedAssetId', 'midi/isEnabled', 'export/selectedPresetId',
    'seedance/activeRunId', 'flashboard/composer', 'flashboard/activeAIWorkspaceId', 'flashboard/selectedActiveGenerationRecordIds', 'dock/layout', 'project-codec'];
  const entities = session.coordinator.getEntities();
  for (const key of entities.keys()) {
    if (!key.includes('/block/') && !key.includes('/item/') && !key.startsWith('artifact-') && !key.startsWith('source-identity:')) {
      for (const category of ['fields', 'resolvers', 'nested']) keys.push(`codec/${category}/${key}`);
    }
    const match = /^composition\/project\/([^/]+)$/u.exec(key); if (!match) continue;
    const id = decodeURIComponent(match[1]);
    for (const field of ['playheadPosition', 'zoom', 'scrollX', 'selectedClipIds', 'selectedKeyframeIds']) keys.push(`timeline/${id}/${field}`);
  }
  // Candidate keys are filtered by one listing of stored views: ~3 candidates per entity mostly do not exist.
  const stored = await session.viewKeys();
  const present = stored ? keys.filter(key => stored.has(key)) : keys;
  for (let index = 0; index < present.length; index += 8) {
    const entries = await Promise.all(present.slice(index, index + 8).map(async key => [key, await session.readView(key)] as const));
    for (const [key, value] of entries) if (value !== null) result[key] = value;
  }
  return domainJson(result);
}
/** Core metadata setters share the editor's transaction instead of maintaining a second writer. */
export function updateEditorRepositoryProjectFields(session: RepositorySession, updates: Partial<ProjectFile>): void {
  if (session !== getEditorRepositorySession()) throw new Error('Project field update belongs to an inactive repository session');
  const entities = session.coordinator.getEntities(), encoded = encodeProjectDomains(projectSkeleton(updates));
  const root = object(encoded.entities.get(PROJECT_ENTITY_KEY)?.value), plan = emptyPlan();
  for (const field of Object.keys(updates).flatMap(field => field === 'uiState' ? ['midi', 'export'] : [field])) {
    if (!(field in root)) continue;
    const value = root[field] as import('../contracts').JsonValue;
    ensureRootField(plan, entities, field, value);
    const pending = [value], keys = new Set<string>();
    while (pending.length) {
      const item = pending.pop();
      if (!item || typeof item !== 'object') continue;
      if (!Array.isArray(item) && typeof item.$repositoryEntity === 'string') {
        const key = item.$repositoryEntity;
        if (!keys.has(key)) { keys.add(key); const entity = encoded.entities.get(key); if (entity) pending.push(entity.value); }
      }
      pending.push(...Object.values(item));
    }
    for (const key of keys) if (encoded.entities.has(key)) plan.aggregates.push({ key, before: existingAggregate(entities, key), after: existingAggregate(encoded.entities, key) });
  }
  const joined = getEditorTransactionToken(), token = joined ?? session.coordinator.begin('Update project metadata', 'project');
  try {
    finishDomainMutation(session.coordinator, prepareDomainMutation(session.coordinator, token, plan));
    for (const journal of encoded.journals) session.coordinator.appendJournal(journal.id, journal.value);
    if (!joined) session.coordinator.commit(token);
    // The replaceable workspace does not participate in the content revision.
    const workspace = object(encoded.workspace);
    for (const category of ['fields', 'resolvers', 'nested']) {
      for (const [key, value] of Object.entries(object(workspace[category]))) {
        if (plan.aggregates.some(aggregate => aggregate.key === key)) queueEditorRepositoryView(`codec/${category}/${key}`, value as import('../contracts').JsonValue);
      }
    }
  } catch (error) { if (!joined && session.coordinator.owns(token)) session.coordinator.cancel(token); throw error; }
}
function ownerId(target: string, session: RepositorySession): string | null {
  if (target.startsWith('media:')) return target.slice(6);
  if (target.startsWith('tracking:')) {
    const clipId = target.split(':').at(-1)!;
    const compositionId = target.split(':')[1];
    const entities = session.coordinator.getEntities();
    const key = compositionId ? entityKey('clip', compositionId, clipId) : [...entities.keys()].find(key => key.startsWith('clip/') && key.endsWith(`/${encodeURIComponent(clipId)}`));
    const clip = key ? object(decodeAggregate(key, entities)) : {};
    return typeof clip.mediaFileId === 'string' ? clip.mediaFileId : null;
  }
  const landmarks = /^landmarks-(.+)\.tracking\.json(?:\.gz)?$/u.exec(target);
  if (landmarks) return ownerId(`tracking::${landmarks[1]}`, session);
  return target.endsWith('.json') ? target.slice(0, -5) : target;
}
/** Only a full original-byte identity authorizes late result attachment. */
export function getEditorRepositorySourceVersion(session: RepositorySession, target: string): string | null {
  if (session !== getEditorRepositorySession()) return null;
  const id = ownerId(target, session); if (!id) return null;
  const entities = session.coordinator.getEntities();
  const adjunct = entities.get(`source-identity:${id}`);
  const media = entities.get(entityKey('media', 'project', id));
  const identity = object(adjunct?.value ?? object(media?.value).$sourceIdentity);
  return identity.identityStatus === 'verified' && typeof identity.contentHash === 'string' &&
    /^(?:sha256:)?[a-f0-9]{64}$/u.test(identity.contentHash)
    ? `sha256:${identity.contentHash.replace(/^sha256:/u, '')}` : null;
}
const RESULT_DOMAINS = new Set(['transcript', 'analysis', 'scene-descriptions', 'landmarks', 'tracking', 'audio-artifact', 'document-artifact']);
export function applyEditorRepositoryResult(session: RepositorySession, domain: string, target: string,
  sourceVersion: string, manifest: ArtifactManifest, manifestReference?: RecordReference): boolean {
  if (!manifestReference) return false;
  if (session !== getEditorRepositorySession() || !RESULT_DOMAINS.has(domain) || getEditorRepositorySourceVersion(session, target) !== sourceVersion) return false;
  const id = ownerId(target, session); if (!id) return false;
  const entities = session.coordinator.getEntities();
  const ownerKey = target.startsWith('tracking:') ? (() => {
    const [, compositionId, clipId] = target.split(':'); return entityKey('clip', compositionId, clipId);
  })() : entityKey('media', 'project', id);
  const owner = entities.get(ownerKey); if (!owner) return false;
  const token = session.coordinator.begin(`Attach ${domain} result`, 'background');
  try {
    const key = `result:${domain}:${encodeURIComponent(target)}:${encodeURIComponent(sourceVersion)}`;
    session.coordinator.touch(token, ownerKey); session.coordinator.touch(token, key);
    session.coordinator.write(token, key, { type: 'repository-result-binding', schemaVersion: 1,
      value: domainJson({ domain, target, sourceVersion, artifactId: manifest.artifactId }), references: [manifestReference],
      blobs: [{ hash: `sha256:${manifest.hash.replace(/^sha256:/u, '')}`, length: manifest.size }] });
    const root = object(owner.value), refs = object(root.$resultBindings);
    session.coordinator.write(token, ownerKey, { ...owner, value: domainJson({ ...root, $resultBindings: { ...refs, [domain]: { $repositoryEntity: key } } }), references: [...owner.references, manifestReference],
      blobs: [...owner.blobs.filter(blob => blob.hash !== `sha256:${manifest.hash.replace(/^sha256:/u, '')}`), { hash: `sha256:${manifest.hash.replace(/^sha256:/u, '')}`, length: manifest.size }] });
    session.coordinator.commit(token); return true;
  } catch (error) { if (session.coordinator.owns(token)) session.coordinator.cancel(token); throw error; }
}
