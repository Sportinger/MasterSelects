import type { RepositoryBackend, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import type { RepositoryLocation, RepositoryOpenProgress } from '../storageWorkerProtocol';
import { fileDigest, readFileChunks, readJson, writeJson } from '../archive/streamIO';
import { recoverRepository } from '../persistence/recovery';
import { restoreRepositoryArchive } from '../archive/archiveTransport';
import { prepareArchive } from '../archive/selectiveArchive';
import { openLegacySource, RepositoryArchiveSourceError, type ReadOnlyProjectSource } from '../import/legacySource';
import { importLegacyRepository } from '../import/legacyImport';
import { newRepositoryDescriptor } from './RepositoryLifecycle';
import { PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID, type ProjectMediaSourceRoot } from '../../types/project.types';

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

/** Unfinished imports only matter while no import of the folder has finished; a restarted one supersedes them. */
const unfinished = (bindings: Awaited<ReturnType<typeof importBindings>>) => bindings.length > 0 && !bindings.some(binding => binding.complete);

/** A converted folder whose import stopped midway must be resumed from the original, not opened empty. */
export async function assertLegacyImportComplete(target: RepositoryBackend): Promise<void> {
  if (unfinished(await importBindings(target))) {
    throw new RepositoryError('conflict', 'Project conversion did not finish. Open the original project again and choose this folder to resume.');
  }
}

/** An in-place conversion that stopped midway: the old project files sit next to an unfinished repository. */
export async function hasResumableInPlaceImport(backend: RepositoryBackend): Promise<boolean> {
  if (!unfinished(await importBindings(backend))) return false;
  return Boolean(await backend.stat('project.json') || await findLegacyPackage(backend));
}

type ImportChoice = { importId: string; descriptor: RepositoryDescriptor; target: RepositoryBackend; complete: boolean };
async function chooseImport(source: ReadOnlyProjectSource, target: RepositoryBackend, inPlace: boolean): Promise<ImportChoice> {
  if (!await target.stat('project.msrepo.json')) {
    // Leftovers of an interrupted conversion (before its repository existed) do not block a fresh one.
    const existing = (await target.list('', undefined, 1024)).paths;
    if (!inPlace && existing.some(path => !path.startsWith(IMPORTS))) throw new RepositoryError('conflict', 'Choose an empty folder for the converted project');
    return { importId: crypto.randomUUID(), descriptor: newRepositoryDescriptor(), target, complete: false };
  }
  const descriptor = await readJson<RepositoryDescriptor>(target, 'project.msrepo.json', 65536);
  const bindings = await importBindings(target);
  if (inPlace) {
    // The folder can only hold its own conversion, even when another browser registered the source.
    if (!unfinished(bindings)) throw new RepositoryError('conflict', 'This folder already contains a converted project');
    return restartInPlaceImport(target, descriptor, bindings[0].importId);
  }
  const resumable = bindings.find(binding => binding.sourceId === source.sourceId);
  if (!resumable) throw new RepositoryError('conflict', 'This folder already contains a different project; choose an empty folder');
  return { importId: resumable.importId, descriptor, target, complete: resumable.complete };
}

/**
 * The old files may have changed since the interrupted attempt (e.g. edited in an older build), so an
 * unfinished in-place import starts over under a new identity instead of failing on its stale binding.
 * An attempt that already published its commit only lacks the completion marker and opens as it is.
 */
async function restartInPlaceImport(target: RepositoryBackend, descriptor: RepositoryDescriptor, previousImportId: string): Promise<ImportChoice> {
  const recovered = await recoverRepository(target, descriptor);
  if (!recovered.head) return { importId: crypto.randomUUID(), descriptor, target, complete: false };
  const binding = await readJson<Record<string, unknown>>(target, `${IMPORTS}${previousImportId}/target.json`, 65536);
  await writeJson(target, `${IMPORTS}${previousImportId}/complete.json`, { ...binding, commit: recovered.head });
  return { importId: previousImportId, descriptor, target, complete: true };
}

export interface LegacyImportRequest {
  source: ReadOnlyProjectSource;
  /** Old project folder, used as media source root when the repository goes to a separate folder. */
  sourceHandle: FileSystemDirectoryHandle | null;
  /** Repository destination; the source location itself converts in place. */
  target: RepositoryLocation;
  inPlace: boolean;
  workspaceId: string;
  backendFor(location: RepositoryLocation): Promise<RepositoryBackend>;
  onProgress?(progress: RepositoryOpenProgress): void;
}

/**
 * Converts an old project into a repository. In place, only `project.msrepo.json` and `.masterselects/`
 * are added; every old file stays byte-identical and media resolve through the project folder itself.
 */
export async function prepareLegacyImport(request: LegacyImportRequest): Promise<{ descriptor: RepositoryDescriptor; location: RepositoryLocation }> {
  const { source, workspaceId, backendFor, inPlace, target: location } = request;
  const packagePath = await findLegacyPackage(source);
  const chosen = await chooseImport(source, await backendFor(location), inPlace);
  const { importId, target } = chosen; let { descriptor } = chosen;
  // A finished conversion opens as it is now; edits made since then are not an import conflict.
  if (chosen.complete) return { descriptor, location };
  const owner = await target.acquireOwner(descriptor.repositoryId);
  if (!owner) throw new RepositoryError('ownership', inPlace ? 'The project folder is read-only or open in another tab' : 'Import target is owned by another session');
  try {
    const packageIdentity = packagePath ? await fileDigest(source, packagePath) : null;
    let mediaSourceRoot: ProjectMediaSourceRoot | undefined;
    if (inPlace) {
      const name = request.sourceHandle?.name ?? (location.kind === 'fsa' ? null : location.path.split(/[\\/]/).filter(Boolean).at(-1));
      mediaSourceRoot = { id: PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID, name: name || 'Project folder' };
    }
    else if (request.sourceHandle) {
      mediaSourceRoot = { id: `source-root:legacy-${importId}`, name: request.sourceHandle.name };
      // Loaded lazily: the source-root registry depends on the project file service.
      const { storeProjectMediaSourceRootHandle } = await import('../../mediaSourceRoots');
      await storeProjectMediaSourceRootHandle(mediaSourceRoot.id, request.sourceHandle);
    }
    try {
      const bundle = await openLegacySource(source, packagePath ? { kind: 'package', path: packagePath } : { kind: 'directory' }, { staging: target, importId, inPlace });
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
      } finally { await stagingOwner.release(); }
    }
  } finally { await owner.release(); }
  return { descriptor, location };
}
