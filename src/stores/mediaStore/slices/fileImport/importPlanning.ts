import type { MediaFile, SignalAssetItem } from '../../types';
import type { ModelSequenceImportEntry } from '../../../../utils/modelSequence';
import { artifactService } from '../../../../services/project/domains/ArtifactService';
import { projectFileService } from '../../../../services/projectFileService';
import {
  createDefaultUniversalImportOrchestrator,
  type SignalUniversalImportResult,
  type UniversalImportPlan,
} from '../../../../importers';
import type { SignalArtifact } from '../../../../signals';
import { generateId } from '../../helpers/importPipeline';
import { detectMediaType } from '../../../timeline/helpers/mediaTypeHelpers';
import {
  createSignalAssetItem,
  remapSignalAssetArtifacts,
} from '../../helpers/signalItems';
import { fileImportLog as log } from './log';

const universalImportOrchestrator = createDefaultUniversalImportOrchestrator();

export type ImportableMediaType = MediaFile['type'];

export interface ResolvedLegacyImportEntry extends ModelSequenceImportEntry {
  id: string;
  route: 'legacy-media';
  type: ImportableMediaType;
}

export interface ResolvedSignalImportEntry extends ModelSequenceImportEntry {
  id: string;
  route: 'signal';
  plan: Extract<UniversalImportPlan, { route: 'signal' }>;
}

export type ResolvedImportEntry = ResolvedLegacyImportEntry | ResolvedSignalImportEntry;

export async function resolveImportEntry(
  file: File,
  options: {
    id?: string;
    handle?: FileSystemFileHandle;
    absolutePath?: string;
  } = {},
): Promise<ResolvedImportEntry> {
  const id = options.id ?? generateId();
  const knownMediaType = detectMediaType(file);

  // Photos-backed files on iPadOS can be lazy. Reading even the first bytes
  // may wait for Photos/iCloud to materialize the asset, so route formats the
  // editor already recognizes without probing their contents first.
  if (knownMediaType !== 'unknown') {
    return {
      file,
      handle: options.handle,
      absolutePath: options.absolutePath,
      id,
      route: 'legacy-media',
      type: knownMediaType,
    };
  }

  const plan = await universalImportOrchestrator.planImport(file);

  if (plan.route === 'legacy-media') {
    return {
      file,
      handle: options.handle,
      absolutePath: options.absolutePath,
      id,
      route: 'legacy-media',
      type: plan.legacyMediaType as ImportableMediaType,
    };
  }

  return {
    file,
    handle: options.handle,
    absolutePath: options.absolutePath,
    id,
    route: 'signal',
    plan,
  };
}

async function persistSignalImportArtifacts(
  result: SignalUniversalImportResult,
): Promise<{ asset: SignalUniversalImportResult['asset']; artifacts: SignalArtifact[] }> {
  const projectHandle = (
    projectFileService as typeof projectFileService & {
      getProjectHandle?: () => FileSystemDirectoryHandle | null;
    }
  ).getProjectHandle?.() ?? null;
  const packageSession = (
    projectFileService as typeof projectFileService & {
      getProjectPackageSession?: () => ReturnType<typeof projectFileService.getProjectPackageSession>;
    }
  ).getProjectPackageSession?.() ?? null;

  const store = packageSession
    ? artifactService.createPackageStore(packageSession)
    : projectHandle
    ? artifactService.createStore(projectHandle)
    : artifactService.createIndexedDBStore();
  const artifactsByOriginalId = new Map<string, SignalArtifact>();

  try {
    for (const payload of result.artifactPayloads) {
      const stored = await store.putArtifact(payload.bytes, {
        mimeType: payload.mimeType,
        encoding: payload.artifact.encoding,
        producer: payload.artifact.producer,
        sourceRefs: payload.artifact.sourceRefs,
        metadata: payload.artifact.metadata,
        createdAt: payload.artifact.createdAt,
      });
      artifactsByOriginalId.set(payload.artifactId, stored.manifest);
    }
  } catch (error) {
    const target = packageSession ? '.msproj package' : projectHandle ? 'project cache' : 'IndexedDB';
    log.warn(`Signal artifact persistence to ${target} failed; keeping transient memory artifact refs.`, error);
    return {
      asset: result.asset,
      artifacts: result.asset.artifacts,
    };
  }

  const asset = remapSignalAssetArtifacts(result.asset, artifactsByOriginalId);
  return {
    asset,
    artifacts: asset.artifacts,
  };
}

export async function runSignalImport(
  entry: ResolvedSignalImportEntry,
  parentId?: string | null,
): Promise<SignalAssetItem> {
  const result = await universalImportOrchestrator.importPlannedFile(entry.plan, {
    absolutePath: entry.absolutePath,
  });

  if (result.route !== 'signal') {
    throw new Error(`Signal importer resolved "${entry.file.name}" as a legacy media route.`);
  }

  const persisted = await persistSignalImportArtifacts(result);
  return createSignalAssetItem(persisted.asset, {
    parentId,
    diagnostics: result.diagnostics,
    providerId: result.provider.id,
  });
}
