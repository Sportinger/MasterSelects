import { Gunzip } from 'fflate';
import type { ProjectFile } from '../../types/project.types';
import { shouldPreferAutosave } from '../../core/autosaveRecovery';
import { PROJECT_FOLDERS } from '../../core/constants';
import { RepositoryError, type RepositoryBackend } from '../contracts';
import { parseJson } from '../segments/canonical';
import { StreamHash } from '../segments/streamHash';
import { canonicalBytes } from '../segments/canonical';
import { extractZip } from '../archive/streamZip';
import { fileDigest, readFileChunks, readJson, safePath, TRANSPORT_LIMITS, writeJson } from '../archive/streamIO';
import { isLegacyLinkedPath, legacyLogicalPath, legacyPhysicalCandidates, legacySourceRole, type LegacySourceRole } from './legacyPackageLayout';

export interface ReadOnlyProjectSource extends Pick<RepositoryBackend, 'read' | 'stat' | 'list'> { readonly sourceId: string; readonly locationId: string; }
/** Reader over logical package paths that also reports where linked bytes physically remain. */
interface LegacyReader extends ReadOnlyProjectSource { physicalPath(path: string): Promise<string | null>; }
export type LegacyInput = { kind: 'directory' } | { kind: 'package'; path: string };
export interface LegacyProvenance {
  selectedProjectPath: string;
  candidates: Array<{ path: string; hash: string; updatedAt: string }>;
  conflicts: string[];
  missingRequired: string[];
}
export interface LegacySourceBundle {
  readonly sourceId: string;
  readonly sourceVersion: { hash: string; length: number };
  readonly project: ProjectFile;
  readonly provenance: LegacyProvenance;
  readJson<T>(path: string, budget?: number): Promise<T>;
  readChunks(path: string): AsyncIterable<Uint8Array>;
  stat(path: string): Promise<{ length: number } | null>;
  list(prefix: string, cursor?: string, limit?: number): ReturnType<RepositoryBackend['list']>;
  /** Source-relative path of a linked media/cache file that stays in the old folder; null when imported. */
  linkedPath(path: string): Promise<string | null>;
  assertUnchanged(): Promise<void>;
}
export interface LegacyReadOptions {
  staging: RepositoryBackend; importId: string; signal?: AbortSignal;
  /** The repository is written into the old folder itself; only `project.msrepo.json` and `.masterselects/` are added. */
  inPlace?: boolean;
}
/** A new-format repository archive was selected; it restores through the archive path instead. */
export class RepositoryArchiveSourceError extends RepositoryError {
  constructor() { super('unsupported', 'Repository archives require repository restore, not legacy migration'); }
}
type EntryStore = Pick<RepositoryBackend, 'stat' | 'read' | 'list'>;
/**
 * Package entries are staged in memory: they are small (project JSON, sidecars, manifests), end up as
 * repository blobs anyway, and hundreds of per-entry directory writes are slow and can stall FSA.
 */
const PACKAGE_STAGING_BYTES = 512 * 1024 * 1024;
function memoryEntries(): EntryStore & { add(path: string, bytes: Uint8Array): void } {
  const entries = new Map<string, Uint8Array>(); let total = 0;
  return {
    add(path, bytes) {
      total += bytes.length;
      if (total > PACKAGE_STAGING_BYTES) throw new RepositoryError('budget', 'Legacy package entries exceed the conversion budget');
      entries.set(path, bytes);
    },
    async stat(path) { const bytes = entries.get(path); return bytes ? { length: bytes.length } : null; },
    async read(path, offset = 0, length) {
      const bytes = entries.get(path); if (!bytes) throw new RepositoryError('io', `Missing package entry: ${path}`);
      return bytes.slice(offset, length === undefined ? undefined : offset + length);
    },
    async list(prefix, cursor, limit = 128) {
      const names = [...entries.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted();
      const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null };
    },
  };
}

/** Imported bytes are fully hashed; linked media (often hundreds of GB) contribute path and size only. */
async function directoryVersion(source: ReadOnlyProjectSource, role: (path: string) => LegacySourceRole, signal?: AbortSignal): Promise<{ hash: string; length: number }> {
  const hash = new StreamHash(); let length = 0; let cursor: string | undefined;
  do {
    const page = await source.list('', cursor, 1024, signal);
    for (const path of page.paths.toSorted()) {
      const kind = role(path); if (kind === 'ignored') continue;
      const size = kind === 'linked' ? await source.stat(path) : null;
      const digest = size ? { linkedLength: size.length } : await fileDigest(source, path, signal);
      length += 'linkedLength' in digest ? digest.linkedLength : digest.length;
      hash.update(canonicalBytes({ path, ...digest })); hash.update(new Uint8Array([10]));
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { hash: hash.digest(), length };
}
function assertProject(value: unknown): asserts value is ProjectFile {
  const project = value as ProjectFile;
  if (!project || project.version !== 1 || typeof project.name !== 'string' || !project.settings || !Array.isArray(project.media) || !Array.isArray(project.compositions) || !Array.isArray(project.folders)) throw new RepositoryError('unsupported', 'Unsupported or malformed legacy project schema');
}
/** Unpackaged legacy folders keep the logical layout at their root; unrelated files are not listed. */
function directoryReader(source: ReadOnlyProjectSource): LegacyReader {
  return { ...source, stat: path => source.stat(path), read: (path, offset, length, signal) => source.read(path, offset, length, signal),
    async list(prefix, cursor, limit, signal) {
      const page = await source.list(prefix, cursor, limit, signal);
      return { ...page, paths: page.paths.filter(path => legacySourceRole(path, PROJECT_FOLDERS.RAW, null) !== 'ignored') };
    },
    async physicalPath(path) { return await source.stat(path) ? path : null; } };
}
function packageSource(staging: EntryStore, prefix: string, source: ReadOnlyProjectSource, mediaFolder: string): LegacyReader {
  const staged = (path: string) => `${prefix}/${safePath(path)}`;
  const folder = safePath(mediaFolder);
  // Package entries win; linked files resolve through the legacy physical layout.
  async function locate(path: string): Promise<{ backend: Pick<RepositoryBackend, 'read'>; path: string; length: number } | null> {
    const packed = await staging.stat(staged(path));
    if (packed) return { backend: staging, path: staged(path), length: packed.length };
    for (const candidate of legacyPhysicalCandidates(safePath(path), folder)) {
      const linked = await source.stat(candidate);
      if (linked) return { backend: source, path: candidate, length: linked.length };
    }
    return null;
  }
  let names: Promise<string[]> | null = null;
  async function logicalNames(signal?: AbortSignal): Promise<string[]> {
    const all = new Set<string>(); let cursor: string | undefined;
    do {
      const page = await staging.list(`${prefix}/`, cursor, 1024, signal);
      for (const path of page.paths) all.add(path.slice(prefix.length + 1));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    do {
      const page = await source.list('', cursor, 1024, signal);
      for (const path of page.paths) { const logical = legacyLogicalPath(path, folder); if (logical) all.add(logical); }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return [...all].toSorted();
  }
  return {
    sourceId: source.sourceId, locationId: source.locationId,
    async stat(path) { const found = await locate(path); return found ? { length: found.length } : null; },
    async physicalPath(path) { const found = await locate(path); return found?.backend === source ? found.path : null; },
    async read(path, offset, length, signal) {
      const found = await locate(path);
      if (!found) throw new RepositoryError('io', `Missing legacy source file: ${path}`);
      return found.backend.read(found.path, offset, length, signal);
    },
    async list(pathPrefix, cursor, limit = 128, signal) {
      names ??= logicalNames(signal).catch(error => { names = null; throw error; });
      const matching = (await names).filter(path => path.startsWith(pathPrefix) && (!cursor || path > cursor));
      const paths = matching.slice(0, limit);
      return { paths, nextCursor: matching.length > limit ? paths.at(-1) ?? null : null };
    },
  };
}
async function boundedGunzip(source: ReadOnlyProjectSource, path: string, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = []; let bytes = 0; let failure: unknown;
  const gunzip = new Gunzip((data) => {
    bytes += data.length;
    if (bytes > TRANSPORT_LIMITS.jsonBytes) { failure = new RepositoryError('budget', 'Legacy terrain JSON exceeds decompressed budget'); return; }
    parts.push(data);
  });
  for await (const input of readFileChunks(source, path, signal)) for (let offset = 0; offset < input.length; offset += 1024) {
    gunzip.push(input.subarray(offset, offset + 1024)); if (failure) throw failure;
  }
  gunzip.push(new Uint8Array(), true); if (failure) throw failure;
  const result = new Uint8Array(bytes); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
async function resolveTerrain(project: ProjectFile, source: ReadOnlyProjectSource, signal?: AbortSignal): Promise<ProjectFile> {
  const meshes = new Map<string, unknown>(); let totalBytes = 0;
  async function visit(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(visit));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if ('$msTerrainMesh' in object) {
      const path = object.$msTerrainMesh;
      if (typeof path !== 'string' || !/^Geometry\/terrain\/[a-zA-Z0-9_-]+\.json\.gz$/.test(path)) throw new RepositoryError('corrupt', 'Invalid packed terrain path');
      if (meshes.has(path)) return meshes.get(path);
      const bytes = await boundedGunzip(source, path, signal); totalBytes += bytes.length;
      if (totalBytes > TRANSPORT_LIMITS.jsonBytes) throw new RepositoryError('budget', 'Legacy terrain aggregate budget exceeded');
      const mesh = parseJson<Record<string, unknown>>(bytes);
      if (!['positions', 'indices', 'origin', 'axisX', 'axisY', 'normal', 'size'].every(key => Array.isArray(mesh[key]) && (mesh[key] as unknown[]).every(item => typeof item === 'number' && Number.isFinite(item)))) throw new RepositoryError('corrupt', 'Invalid packed terrain mesh');
      meshes.set(path, mesh); return mesh;
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(object)) output[key] = await visit(item);
    return output;
  }
  return await visit(project) as ProjectFile;
}

export async function openLegacySource(source: ReadOnlyProjectSource, input: LegacyInput, options: LegacyReadOptions): Promise<LegacySourceBundle> {
  if (!options.inPlace && source.locationId === options.staging.locationId) throw new RepositoryError('conflict', 'Legacy source and import target must be separate locations');
  if (!/^[a-zA-Z0-9_-]+$/.test(options.importId)) throw new RepositoryError('corrupt', 'Invalid import ID');
  const signal = options.signal;
  let reader = directoryReader(source); let mediaFolder: string = PROJECT_FOLDERS.RAW; let extracted: { hash: string; length: number } | null = null;
  const missingRequired: string[] = [];
  if (input.kind === 'package') {
    const prefix = 'package'; const staged = memoryEntries();
    const packageHash = new StreamHash(); let packageLength = 0; const packagePath = safePath(input.path);
    async function* teed() { for await (const chunk of readFileChunks(source, packagePath, signal)) { packageHash.update(chunk); packageLength += chunk.length; yield chunk; } }
    await extractZip(teed(), async entry => {
      const parts: Uint8Array[] = []; let length = 0;
      for await (const chunk of entry.chunks) { parts.push(chunk.slice()); length += chunk.length; }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      staged.add(`${prefix}/${entry.path}`, bytes);
    }, signal);
    if (await staged.stat(`${prefix}/archive-manifest.json`)) throw new RepositoryArchiveSourceError();
    const manifest = await readJson<{ format: string; formatVersion: number; projectSchemaVersion: number; mediaFolderName: string; linkedArtifactEntries?: string[] }>(staged, `${prefix}/manifest.json`, 1024 * 1024, signal);
    if (manifest.format !== 'masterselects-project' || manifest.formatVersion !== 1 || manifest.projectSchemaVersion !== 1 || typeof manifest.mediaFolderName !== 'string') throw new RepositoryError('unsupported', 'Unsupported legacy package format');
    extracted = { hash: packageHash.digest(), length: packageLength };
    mediaFolder = manifest.mediaFolderName;
    reader = packageSource(staged, prefix, source, mediaFolder);
    for (const path of manifest.linkedArtifactEntries ?? []) if (!await reader.stat(path)) missingRequired.push(path);
  }
  // Package, sidecars and project JSON are fully hashed; linked media only by path and size.
  const role = (path: string) => legacySourceRole(path, mediaFolder, input.kind === 'package' ? safePath(input.path) : null);
  const sourceVersion = await directoryVersion(source, role, signal);
  if (input.kind === 'package') {
    const current = await fileDigest(source, safePath(input.path), signal);
    if (current.hash !== extracted?.hash || current.length !== extracted.length) throw new RepositoryError('conflict', 'Legacy package changed while it was read');
  }
  await writeJson(options.staging, `.masterselects/imports/${options.importId}/binding.json`, { sourceId: source.sourceId, sourceLocationId: source.locationId, targetLocationId: options.staging.locationId, sourceVersion, input }, signal);
  const candidates: LegacyProvenance['candidates'] = [];
  let selected: ProjectFile | null = null; let selectedProjectPath = '';
  for (const path of ['project.json', 'project.autosave.json']) {
    if (!await reader.stat(path)) continue;
    const candidate = await readJson<unknown>(reader, path, TRANSPORT_LIMITS.jsonBytes, signal); assertProject(candidate);
    const identity = await fileDigest(reader, path, signal);
    candidates.push({ path, hash: identity.hash, updatedAt: candidate.updatedAt });
    if (!selected || path === 'project.autosave.json' && shouldPreferAutosave(selected, candidate)) { selected = candidate; selectedProjectPath = path; }
  }
  if (!selected) throw new RepositoryError('corrupt', 'Legacy source has no project state');
  const project = await resolveTerrain(selected, reader, signal);
  const provenance: LegacyProvenance = { selectedProjectPath, candidates, missingRequired,
    conflicts: candidates.length > 1 && candidates[0].hash !== candidates[1].hash ? ['project.json and autosave differ; both originals retained'] : [] };
  await writeJson(options.staging, `.masterselects/imports/${options.importId}/source.json`, { sourceId: source.sourceId, sourceLocationId: source.locationId, targetLocationId: options.staging.locationId, sourceVersion, input, provenance }, signal);
  const bundle: LegacySourceBundle = {
    sourceId: source.sourceId, sourceVersion, project, provenance,
    readJson: <T>(path: string, budget = TRANSPORT_LIMITS.jsonBytes) => readJson<T>(reader, safePath(path), budget, signal),
    readChunks: path => readFileChunks(reader, safePath(path), signal),
    stat: path => reader.stat(safePath(path)),
    list: (prefix, cursor, limit) => reader.list(prefix, cursor, limit, signal),
    async linkedPath(path) { return isLegacyLinkedPath(safePath(path)) ? reader.physicalPath(safePath(path)) : null; },
    async assertUnchanged() {
      const current = await directoryVersion(source, role, signal);
      if (current.hash !== sourceVersion.hash || current.length !== sourceVersion.length) throw new RepositoryError('conflict', 'Legacy source changed during import; existing target retained for recovery');
    },
  };
  await bundle.assertUnchanged(); return bundle;
}
