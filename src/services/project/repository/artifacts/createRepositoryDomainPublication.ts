import { getWorkerArtifactManifestReference } from './WorkerRepositoryArtifactStore';
import type { ArtifactStore } from '../../../../artifacts/ArtifactStore';
import type { ArtifactManifest } from '../../../../artifacts/types';
import { RepositoryError, type EntityDTO, type JsonValue } from '../contracts';
import type { ProjectTransactionCoordinator } from '../transaction/ProjectTransactionCoordinator';
import type { ProjectFolderKey } from '../../core/constants';
import type { RepositoryDomainPublication } from './RepositoryDomainPublication';
import { Logger } from '../../../logger';
import { timeMediaCopyPhase } from '../../mediaCopy/mediaCopyPhaseTimings';
const log = Logger.create('RepositoryArtifacts');
export interface DomainPublicationOptions {
  coordinator: ProjectTransactionCoordinator;
  artifacts: ArtifactStore;
  /** Journal heads are independent of current content projection. */
  readJournal(id: string): Promise<JsonValue | null>;
  /** Source-bound read-only import evidence; never current source lifecycle reads. */
  readLegacyFile?(folder: ProjectFolderKey, name: string): Promise<File | null>;
  /** Full verified source identity; null means no source-bound result may attach. */
  sourceVersion(target: string): string | null;
  /** Verify the captured original before saving a source-bound result. */
  prepareSourceVersion?(target: string): Promise<string | null>;
  /** Rechecks active session/source/target and commits synchronously; no await. */
  applyResult(domain: string, target: string, sourceVersion: string, manifest: ArtifactManifest, manifestReference?: import('../contracts').RecordReference): boolean;
}
const pathKey = (folder: ProjectFolderKey, name: string) => `artifact-file:${folder}:${encodeURIComponent(name)}`;
const isSourceBound = (folder: ProjectFolderKey, name: string) =>
  (folder === 'ANALYSIS' || folder === 'TRANSCRIPTS') && name.endsWith('.json');
function fileEntity(manifest: ArtifactManifest, reference: import('../contracts').RecordReference): EntityDTO {
  return { type: 'repository-artifact-file', schemaVersion: 1,
    value: { artifactId: manifest.artifactId, mimeType: manifest.mimeType }, references: [reference],
    blobs: [{ hash: `sha256:${manifest.hash}`, length: manifest.size }] };
}
/** All operations share the project's coordinator, receipt queue and ownership guard. */
export function createRepositoryDomainPublication(options: DomainPublicationOptions): RepositoryDomainPublication {
  const { coordinator, artifacts } = options;
  const reportedBindings = new Set<string>();
  const reportBinding = (folder: ProjectFolderKey, name: string, reason: string) => {
    const key = `${folder}:${name}:${reason}`;
    if (reportedBindings.has(key)) return;
    reportedBindings.add(key);
    log.warn('Saved source artifact could not be loaded', { folder, name, reason });
  };
  const journal = async (id: string, value: JsonValue) => { await coordinator.flush(coordinator.appendJournal(id, value)); };
  const mutate = async (key: string, entity: EntityDTO | null) => {
    await coordinator.whenNavigationIdle();
    const token = coordinator.begin('Persist project result', 'artifact');
    let committed = false;
    try { coordinator.write(token, key, entity); const result = coordinator.commit(token); committed = true; await coordinator.flush(result.receipt); }
    catch (error) { if (!committed) coordinator.cancel(token); throw error; }
  };
  return {
    repositoryId: coordinator.repositoryId, sessionEpoch: coordinator.sessionEpoch, artifacts,
    async readFile(folder, name) {
      const sourceBound = isSourceBound(folder, name);
      const version = sourceBound ? options.sourceVersion(name) : null;
      const entity = coordinator.getProjection().entities.get(pathKey(folder, name));
      if (sourceBound && !version) {
        if (entity?.type === 'repository-artifact-file') reportBinding(folder, name, 'source-not-verified');
        return null;
      }
      const matchesSource = (manifest: ArtifactManifest) => {
        if (!sourceBound) return true;
        const matches = options.sourceVersion(name) === version && manifest.sourceRefs.includes(version!);
        if (!matches) reportBinding(folder, name, manifest.sourceRefs.length ? 'source-version-mismatch' : 'source-binding-missing');
        return matches;
      };
      if (!entity) {
        const event = await options.readJournal(`artifact-file:${folder}:${name}`);
        if (event && typeof event === 'object' && !Array.isArray(event) && event.type === 'artifact-file-tombstone') return null;
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.artifactId !== 'string') return sourceBound ? null : options.readLegacyFile?.(folder, name) ?? null;
        const stored = await artifacts.getArtifact(event.artifactId);
        return stored && matchesSource(stored.manifest) ? new File([stored.blob], name, { type: stored.manifest.mimeType }) : null;
      }
      if (entity.type === 'repository-artifact-tombstone') return null;
      const value = entity.value as { artifactId?: string };
      if (entity.type !== 'repository-artifact-file' || typeof value.artifactId !== 'string') throw new RepositoryError('corrupt', 'Invalid file artifact binding');
      const stored = await artifacts.getArtifact(value.artifactId);
      if (!stored) throw new RepositoryError('corrupt', `Required artifact file ${name} is missing`);
      return matchesSource(stored.manifest) ? new File([stored.blob], name, { type: stored.manifest.mimeType }) : null;
    },
    async writeFile(folder, name, input, writeOptions = {}) {
      // Capture source and current target binding BEFORE hashing/publishing any bytes.
      const prior = coordinator.getProjection().entities.get(pathKey(folder, name));
      const sourceBound = isSourceBound(folder, name);
      const sourceVersion = options.sourceVersion(name)
        ?? (sourceBound ? await options.prepareSourceVersion?.(name) ?? null : null);
      if (sourceBound && (!sourceVersion || options.sourceVersion(name) !== sourceVersion)) {
        throw new RepositoryError('ownership', `Cannot save ${folder}/${name}: original media source is not verified`);
      }
      if (coordinator.getProjection().entities.get(pathKey(folder, name)) !== prior) return false;
      const journalOnly = folder === 'AI_CHAT' || name.startsWith('agent-timeline-pointer-');
      const cacheOnly = folder.startsWith('CACHE') || folder === 'PROXY' || folder === 'AUDIO_PROXIES';
      const blob = typeof input === 'string' ? new Blob([input], { type: 'application/json' }) : input;
      const { manifest } = await artifacts.putArtifact(blob, { retention: cacheOnly ? 'reproducible-cache' : 'required', sourceRefs: sourceVersion ? [sourceVersion] : [],
        writeConfirmation: writeOptions.writeConfirmation });
      const event = { type: 'artifact-file-result', folder, name, artifactId: manifest.artifactId, sourceVersion, sessionEpoch: coordinator.sessionEpoch };
      if (journalOnly || cacheOnly) { await journal(`artifact-file:${folder}:${name}`, event); return true; }
      const current = coordinator.getProjection().entities.get(pathKey(folder, name));
      const matches = current === prior && options.sourceVersion(name) === sourceVersion;
      const published = !matches || await timeMediaCopyPhase(blob, 'copy_publish', (async () => {
        const reference = await getWorkerArtifactManifestReference(artifacts, manifest.artifactId);
        if (!reference) throw new RepositoryError('corrupt', 'Required standalone manifest reference is missing');
        // Recheck after resolving manifest dependency: source/binding can change during IO.
        if (coordinator.getProjection().entities.get(pathKey(folder, name)) !== prior || options.sourceVersion(name) !== sourceVersion) {
          await journal(`artifact-file-result:${crypto.randomUUID()}`, { ...event, applied: false });
          return false;
        }
        await mutate(pathKey(folder, name), fileEntity(manifest, reference));
        return true;
      })());
      if (!published) return false;
      await journal(`artifact-file-result:${crypto.randomUUID()}`, { ...event, applied: matches });
      return matches;
    },
    async deleteFile(folder, name) {
      if (folder === 'AI_CHAT' || folder.startsWith('CACHE') || folder === 'PROXY' || folder === 'AUDIO_PROXIES' || name.startsWith('agent-timeline-pointer-')) {
        await journal(`artifact-file:${folder}:${name}`, { type: 'artifact-file-tombstone' });
      } else {
        await mutate(pathKey(folder, name), { type: 'repository-artifact-tombstone', schemaVersion: 1, value: null, references: [], blobs: [] });
      }
      return true;
    },
    appendJournal: journal, readJournal: options.readJournal,
    async publishResult(domain, target, sourceVersion, manifest) {
      const manifestReference = await getWorkerArtifactManifestReference(artifacts, manifest.artifactId);
      if (!manifestReference) throw new RepositoryError('corrupt', 'Result has no standalone immutable manifest dependency');
      const applied = options.sourceVersion(target) === sourceVersion && options.applyResult(domain, target, sourceVersion, manifest, manifestReference);
      await journal(`result:${crypto.randomUUID()}`, { type: 'result-completed', domain, target, sourceVersion, artifactId: manifest.artifactId, applied });
    },
  };
}
