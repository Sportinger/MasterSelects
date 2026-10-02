import type { RepositoryBackend, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import type { RepositoryLocation, RepositoryOpenProgress } from '../storageWorkerProtocol';
import { fileDigest, readFileChunks, readJson } from '../archive/streamIO';
import { restoreRepositoryArchive } from '../archive/archiveTransport';
import { prepareArchive } from '../archive/selectiveArchive';
import { openLegacySource, RepositoryArchiveSourceError, type ReadOnlyProjectSource } from '../import/legacySource';
import { importLegacyRepository } from '../import/legacyImport';
import { newRepositoryDescriptor } from './RepositoryLifecycle';
import type { ProjectMediaSourceRoot } from '../../types/project.types';

const IMPORTS = '.masterselects/imports/';

export async function findLegacyPackage(source: Pick<RepositoryBackend, 'list'>): Promise<string | null> {
  let packagePath: string | null = null; let cursor: string | undefined;
  do {
    const page = await source.list('', cursor, 1024);
    for (const path of page.paths) if (!path.includes('/') && path.toLowerCase().endsWith('.msproj')) {
      if (packagePath) throw new RepositoryError('conflict', 'Multiple legacy packages exist; select a single source package');
      packagePath = path;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return packagePath;
}

/** Old-format folders have a package or project JSON but no repository descriptor. */
export async function isLegacyProjectBackend(backend: RepositoryBackend): Promise<boolean> {
  if (await backend.stat('project.msrepo.json')) return false;
  return Boolean(await backend.stat('project.json') || await findLegacyPackage(backend));
}

async function importBindings(target: RepositoryBackend): Promise<Array<{ importId: string; sourceId: string; complete: boolean }>> {
  const ids = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await target.list(IMPORTS, cursor, 1024);
    for (const path of page.paths) { const id = path.slice(IMPORTS.length).split('/')[0]; if (id) ids.add(id); }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const bindings = [];
  for (const importId of ids) {
    if (!await target.stat(`${IMPORTS}${importId}/target.json`)) continue;
    const binding = await readJson<{ sourceId: string }>(target, `${IMPORTS}${importId}/target.json`, 65536);
    bindings.push({ importId, sourceId: binding.sourceId, complete: Boolean(await target.stat(`${IMPORTS}${importId}/complete.json`)) });
  }
  return bindings;
}

/** A converted folder whose import stopped midway must be resumed from the original, not opened empty. */
export async function assertLegacyImportComplete(target: RepositoryBackend): Promise<void> {
  if ((await importBindings(target)).some(binding => !binding.complete)) {
    throw new RepositoryError('conflict', 'Project conversion did not finish. Open the original project again and choose this folder to resume.');
  }
}

async function chooseImport(source: ReadOnlyProjectSource, targetLocation: RepositoryLocation | null, backendFor: LegacyImportRequest['backendFor']) {
  if (!targetLocation) {
    // Without a chosen folder (native/Android restore) the conversion stays resumable in browser storage.
    const cacheKey = 'ms.repository.import:' + encodeURIComponent(source.sourceId);
    const saved = localStorage.getItem(cacheKey);
    const cached = saved ? JSON.parse(saved) as { importId: string; descriptor: RepositoryDescriptor; packageHash?: string } : null;
    const importId = cached?.importId ?? crypto.randomUUID();
    const descriptor = cached?.descriptor ?? newRepositoryDescriptor();
    if (!cached) localStorage.setItem(cacheKey, JSON.stringify({ importId, descriptor }));
    const location: RepositoryLocation = { kind: 'opfs', path: 'repository-imports/' + importId };
    return { importId, descriptor, location, target: await backendFor(location), cacheKey, cached };
  }
  const target = await backendFor(targetLocation);
  if (!await target.stat('project.msrepo.json')) {
    // Leftovers of an interrupted conversion (before its repository existed) do not block a fresh one.
    const existing = (await target.list('', undefined, 1024)).paths;
    if (existing.some(path => !path.startsWith(IMPORTS))) throw new RepositoryError('conflict', 'Choose an empty folder for the converted project');
    return { importId: crypto.randomUUID(), descriptor: newRepositoryDescriptor(), location: targetLocation, target, cacheKey: null, cached: null };
  }
  // The same folder may hold an interrupted conversion of this source; resume it instead of duplicating.
  const resumable = (await importBindings(target)).find(binding => binding.sourceId === source.sourceId);
  if (!resumable) throw new RepositoryError('conflict', 'This folder already contains a different project; choose an empty folder');
  const descriptor = await readJson<RepositoryDescriptor>(target, 'project.msrepo.json', 65536);
  return { importId: resumable.importId, descriptor, location: targetLocation, target, cacheKey: null, cached: null };
}

export interface LegacyImportRequest {
  source: ReadOnlyProjectSource;
  /** Old project folder; its media stay there and resolve through a media source root. */
  sourceHandle: FileSystemDirectoryHandle | null;
  target: RepositoryLocation | null;
  workspaceId: string;
  backendFor(location: RepositoryLocation): Promise<RepositoryBackend>;
  onProgress?(progress: RepositoryOpenProgress): void;
}

/** Reads the legacy source only; the converted repository is written to a separate target folder. */
export async function prepareLegacyImport(request: LegacyImportRequest): Promise<{ descriptor: RepositoryDescriptor; location: RepositoryLocation }> {
  const { source, workspaceId, backendFor } = request;
  const packagePath = await findLegacyPackage(source);
  const chosen = await chooseImport(source, request.target, backendFor);
  const { importId, target, location, cacheKey, cached } = chosen; let { descriptor } = chosen;
  const owner = await target.acquireOwner(descriptor.repositoryId);
  if (!owner) throw new RepositoryError('ownership', 'Import target is owned by another session');
  try {
    const packageIdentity = packagePath ? await fileDigest(source, packagePath) : null;
    if (cached?.packageHash && packageIdentity?.hash !== cached.packageHash) throw new RepositoryError('conflict', 'Archive source changed since the previous restore');
    if (cached?.packageHash && await target.stat('project.msrepo.json')) {
      descriptor = await readJson<RepositoryDescriptor>(target, 'project.msrepo.json', 65536);
      return { descriptor, location };
    }
    let mediaSourceRoot: ProjectMediaSourceRoot | undefined;
    if (request.sourceHandle) {
      mediaSourceRoot = { id: `source-root:legacy-${importId}`, name: request.sourceHandle.name };
      // Loaded lazily: the source-root registry depends on the project file service.
      const { storeProjectMediaSourceRootHandle } = await import('../../mediaSourceRoots');
      await storeProjectMediaSourceRootHandle(mediaSourceRoot.id, request.sourceHandle);
    }
    try {
      const bundle = await openLegacySource(source, packagePath ? { kind: 'package', path: packagePath } : { kind: 'directory' }, { staging: target, importId });
      request.onProgress?.({ phase: 'importing' });
      await importLegacyRepository(bundle, descriptor, target, owner, { importId, workspaceId, mediaSourceRoot,
        onProgress: processedRecords => request.onProgress?.({ phase: 'importing', processedRecords }) });
    } catch (error) {
      if (!(error instanceof RepositoryArchiveSourceError) || !packagePath) throw error;
      const restored = await backendFor({ kind: 'opfs', path: 'repository-archive-staging/' + importId });
      const stagingOwner = await restored.acquireOwner('archive-stage-' + importId);
      if (!stagingOwner) throw new RepositoryError('ownership', 'Archive restore staging is owned by another session');
      try {
        const manifest = await restoreRepositoryArchive(readFileChunks(source, packagePath), restored, stagingOwner);
        const current = await fileDigest(source, packagePath);
        if (current.hash !== packageIdentity?.hash || current.length !== packageIdentity?.length) throw new RepositoryError('conflict', 'Archive source changed during restore');
        const duplicated = await prepareArchive(restored, manifest.repository, manifest.targetCommit, target, owner,
          { history: { kind: 'all' }, journals: 'all', workspace: manifest.workspace, media: 'linked', targetRepositoryId: descriptor.repositoryId });
        descriptor = duplicated.repository;
        if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify({ importId, descriptor, packageHash: current.hash }));
      } finally { await stagingOwner.release(); }
    }
  } finally { await owner.release(); }
  return { descriptor, location };
}
