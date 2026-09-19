import { isLinkedArtifactEntry } from './linkedArtifactFiles';
import { encodeProjectTerrain, decodeProjectTerrain, isTerrainGeometryEntry, terrainGeometryReferences } from './packageTerrainGeometry';
import { AsyncZipDeflate, strFromU8, strToU8, unzip, zip, Zip, ZipPassThrough } from 'fflate';
import type { ProjectFile } from '../types/project.types';
import { PROJECT_FOLDERS, type ProjectFolderKey } from './constants';

export const PROJECT_PACKAGE_EXTENSION = '.msproj';
export const PROJECT_PACKAGE_FORMAT = 'masterselects-project';
export const PROJECT_PACKAGE_FORMAT_VERSION = 1;
export const PROJECT_PACKAGE_MANIFEST_ENTRY = 'manifest.json';
export const PROJECT_PACKAGE_PROJECT_ENTRY = 'project.json';

const PACKAGED_FOLDER_KEYS = new Set<ProjectFolderKey>([
  'ANALYSIS',
  'TRANSCRIPTS',
  'CACHE_ARTIFACTS',
  'PROMPTS',
  'AI_CHAT',
]);

export interface ProjectPackageManifest {
  format: typeof PROJECT_PACKAGE_FORMAT;
  formatVersion: typeof PROJECT_PACKAGE_FORMAT_VERSION;
  projectSchemaVersion: ProjectFile['version'];
  projectId: string;
  projectName: string;
  mediaFolderName: string;
  createdAt: string;
  updatedAt: string;
  contentMode: 'linked-media';
  terrainStorage?: 'linked-media-v1';
  linkedArtifactEntries?: string[];
  excludes: Array<'raw-media' | 'generated-media' | 'rendered-media' | 'runtime-cache' | 'undo-snapshots' | 'secrets'>;
}

interface ProjectPackageArchive {
  manifest: ProjectPackageManifest;
  projectData: ProjectFile;
  entries: Map<string, Uint8Array>;
}

type PackagePersistence = () => Promise<boolean>;
type PackageChunkWriter = (chunk: Uint8Array) => Promise<void>;

const PACKAGE_INPUT_CHUNK_SIZE = 512 * 1024;

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function replaceAsciiControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => (
    character.charCodeAt(0) <= 0x1f ? replacement : character
  )).join('');
}

export function sanitizeProjectFileStem(name: string): string {
  const sanitized = replaceAsciiControlCharacters(name.trim(), '-')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '');
  return sanitized || 'Untitled';
}

export function getProjectPackageFileName(projectName: string): string {
  return `${sanitizeProjectFileStem(projectName)}${PROJECT_PACKAGE_EXTENSION}`;
}

export function getProjectMediaFolderName(projectName: string): string {
  return `${sanitizeProjectFileStem(projectName)} Media`;
}

export function isProjectPackageFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(PROJECT_PACKAGE_EXTENSION);
}

export function isPackagedProjectFolder(folder: ProjectFolderKey): boolean {
  return PACKAGED_FOLDER_KEYS.has(folder);
}

function getPackagedPhysicalFolderPath(
  session: ProjectPackageSession,
  folder: ProjectFolderKey,
): string {
  const mediaFolder = session.getMediaFolderName();
  // Auto-migrated legacy projects keep their established media/cache layout.
  // The package becomes authoritative without moving or duplicating large files.
  if (mediaFolder === PROJECT_FOLDERS.RAW) return PROJECT_FOLDERS[folder];
  switch (folder) {
    case 'RAW': return mediaFolder;
    case 'RAW_BAKED_AUDIO': return `${mediaFolder}/Baked Audio`;
    case 'DOWNLOADS': return `${mediaFolder}/Downloads`;
    case 'RENDERS': return `${mediaFolder}/Renders`;
    case 'PROXY': return `${mediaFolder}/.masterselects-cache/Proxy`;
    case 'AUDIO_PROXIES': return `${mediaFolder}/.masterselects-cache/Audio Proxies`;
    case 'CACHE': return `${mediaFolder}/.masterselects-cache`;
    case 'CACHE_THUMBNAILS': return `${mediaFolder}/.masterselects-cache/thumbnails`;
    case 'CACHE_FACE_THUMBNAILS': return `${mediaFolder}/.masterselects-cache/face-thumbnails`;
    case 'CACHE_SPLATS': return `${mediaFolder}/.masterselects-cache/splats`;
    case 'CACHE_ARTIFACTS': return `${mediaFolder}/.masterselects-cache/artifacts`;
    case 'CACHE_WAVEFORMS': return `${mediaFolder}/.masterselects-cache/waveforms`;
    case 'BACKUPS': return `${mediaFolder}/.masterselects-cache/Backups`;
    default: return PROJECT_FOLDERS[folder];
  }
}

export function getFsaProjectFolderPath(
  handle: FileSystemDirectoryHandle,
  folder: ProjectFolderKey,
): string {
  const session = getFsaProjectPackageSession(handle);
  return session ? getPackagedPhysicalFolderPath(session, folder) : PROJECT_FOLDERS[folder];
}

export function getNativeProjectFolderPath(projectPath: string, folder: ProjectFolderKey): string {
  const session = getNativeProjectPackageSession(projectPath);
  return session ? getPackagedPhysicalFolderPath(session, folder) : PROJECT_FOLDERS[folder];
}

export function getFsaProjectFolderReadCandidates(
  handle: FileSystemDirectoryHandle,
  folder: ProjectFolderKey,
): string[] {
  return [...new Set([getFsaProjectFolderPath(handle, folder), PROJECT_FOLDERS[folder]])];
}

export function getNativeProjectFolderReadCandidates(projectPath: string, folder: ProjectFolderKey): string[] {
  return [...new Set([getNativeProjectFolderPath(projectPath, folder), PROJECT_FOLDERS[folder]])];
}

function normalizeEntryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid project package entry path: ${path}`);
  }
  return parts.join('/');
}

export function getProjectPackageEntryPath(folder: ProjectFolderKey, fileName: string): string {
  return normalizeEntryPath(`${PROJECT_FOLDERS[folder]}/${fileName}`);
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bytesToBlobPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read project package content'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

function zipArchive(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function yieldBetweenPackageChunks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function pushPackageEntry(
  archive: Zip,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  // Tiny manifests must not each spawn a worker during cache hydration.
  const entry = bytes.byteLength <= 64 * 1024 || isTerrainGeometryEntry(path)
    ? new ZipPassThrough(path)
    : new AsyncZipDeflate(path, { level: 1 });
  archive.add(entry);

  if (bytes.byteLength === 0) {
    entry.push(new Uint8Array(), true);
    return;
  }

  for (let offset = 0; offset < bytes.byteLength; offset += PACKAGE_INPUT_CHUNK_SIZE) {
    const end = Math.min(offset + PACKAGE_INPUT_CHUNK_SIZE, bytes.byteLength);
    const chunk = bytes.slice(offset, end);
    entry.push(chunk, end === bytes.byteLength);
    await yieldBetweenPackageChunks();
  }
}

async function streamProjectPackageArchive(
  entries: Array<readonly [string, Uint8Array]>,
  writeChunk: PackageChunkWriter,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let failed = false;
    let writeQueue = Promise.resolve();
    const archive = new Zip((error, chunk, final) => {
      if (failed) return;
      if (error) {
        failed = true;
        reject(error);
        return;
      }

      writeQueue = writeQueue.then(() => writeChunk(chunk));
      void writeQueue.catch((writeError: unknown) => {
        if (failed) return;
        failed = true;
        archive.terminate();
        reject(writeError);
      });
      if (final) void writeQueue.then(resolve, reject);
    });

    void (async () => {
      try {
        for (const [path, bytes] of entries) {
          if (failed) return;
          await pushPackageEntry(archive, path, bytes);
        }
        if (!failed) archive.end();
      } catch (error) {
        if (failed) return;
        failed = true;
        archive.terminate();
        reject(error);
      }
    })();
  });
}

function unzipArchive(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, entries) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(entries);
    });
  });
}

function parseJsonEntry<T>(entries: Record<string, Uint8Array>, name: string): T {
  const value = entries[name];
  if (!value) {
    throw new Error(`Project package is missing ${name} (found: ${Object.keys(entries).join(', ') || 'none'})`);
  }
  return JSON.parse(strFromU8(value)) as T;
}

function validateManifest(value: ProjectPackageManifest): void {
  if (value.format !== PROJECT_PACKAGE_FORMAT) {
    throw new Error('Not a MasterSelects project package');
  }
  if (value.formatVersion !== PROJECT_PACKAGE_FORMAT_VERSION) {
    throw new Error(`Unsupported project package version: ${String(value.formatVersion)}`);
  }
  if (!value.projectId || !value.projectName || !value.mediaFolderName) {
    throw new Error('Project package manifest is incomplete');
  }
}

export function createProjectPackageManifest(
  projectData: ProjectFile,
  previous?: ProjectPackageManifest,
): ProjectPackageManifest {
  return {
    format: PROJECT_PACKAGE_FORMAT,
    formatVersion: PROJECT_PACKAGE_FORMAT_VERSION,
    projectSchemaVersion: projectData.version,
    projectId: previous?.projectId ?? createProjectId(),
    projectName: projectData.name,
    mediaFolderName: previous?.mediaFolderName ?? getProjectMediaFolderName(projectData.name),
    createdAt: previous?.createdAt ?? projectData.createdAt,
    updatedAt: projectData.updatedAt,
    contentMode: 'linked-media',
    excludes: [
      'raw-media',
      'generated-media',
      'rendered-media',
      'runtime-cache',
      'undo-snapshots',
      'secrets',
    ],
  };
}

export async function encodeProjectPackage(
  projectData: ProjectFile,
  manifest: ProjectPackageManifest,
  sidecarEntries: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const nextManifest = createProjectPackageManifest(projectData, manifest);
  const archiveEntries: Record<string, Uint8Array> = {};
  archiveEntries[PROJECT_PACKAGE_MANIFEST_ENTRY] = cloneBytes(strToU8(JSON.stringify(nextManifest, null, 2)));
  const terrain = await encodeProjectTerrain(projectData);
  archiveEntries[PROJECT_PACKAGE_PROJECT_ENTRY] = cloneBytes(terrain.bytes);
  for (const [path, bytes] of terrain.entries) archiveEntries[path] = cloneBytes(bytes);

  for (const [path, bytes] of sidecarEntries) {
    const normalizedPath = normalizeEntryPath(path);
    if (normalizedPath === PROJECT_PACKAGE_MANIFEST_ENTRY || normalizedPath === PROJECT_PACKAGE_PROJECT_ENTRY || isTerrainGeometryEntry(normalizedPath)) continue;
    archiveEntries[normalizedPath] = cloneBytes(bytes);
  }

  return zipArchive(archiveEntries);
}

export async function streamProjectPackage(
  projectData: ProjectFile,
  manifest: ProjectPackageManifest,
  sidecarEntries: ReadonlyMap<string, Uint8Array>,
  writeChunk: PackageChunkWriter,
  linkedTerrain = false,
  linkedArtifacts: ReadonlySet<string> = new Set(),
): Promise<void> {
  const nextManifest = createProjectPackageManifest(projectData, manifest);
  if (linkedTerrain) nextManifest.terrainStorage = 'linked-media-v1';
  if (linkedArtifacts.size) {
    nextManifest.linkedArtifactEntries = [...linkedArtifacts].filter(path => sidecarEntries.has(path) && isLinkedArtifactEntry(path));
  }
  const terrain = await encodeProjectTerrain(projectData);
  const archiveEntries: Array<readonly [string, Uint8Array]> = [
    [PROJECT_PACKAGE_MANIFEST_ENTRY, strToU8(JSON.stringify(nextManifest, null, 2))],
    [PROJECT_PACKAGE_PROJECT_ENTRY, terrain.bytes],
    ...(linkedTerrain ? [] : terrain.entries),
  ];

  for (const [path, bytes] of sidecarEntries) {
    const normalizedPath = normalizeEntryPath(path);
    if (normalizedPath === PROJECT_PACKAGE_MANIFEST_ENTRY || normalizedPath === PROJECT_PACKAGE_PROJECT_ENTRY || isTerrainGeometryEntry(normalizedPath)) continue;
    if (isLinkedArtifactEntry(normalizedPath) && linkedArtifacts.has(normalizedPath)) continue;
    archiveEntries.push([normalizedPath, bytes]);
  }

  await streamProjectPackageArchive(archiveEntries, writeChunk);
}

export async function decodeProjectPackage(data: ArrayBuffer | Uint8Array,
  readLinkedEntry?: (mediaFolder: string, path: string) => Promise<Uint8Array>,
): Promise<ProjectPackageArchive> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const archiveEntries = await unzipArchive(bytes);
  const manifest = parseJsonEntry<ProjectPackageManifest>(archiveEntries, PROJECT_PACKAGE_MANIFEST_ENTRY);
  validateManifest(manifest);
  const projectBytes = archiveEntries[PROJECT_PACKAGE_PROJECT_ENTRY];
  if (!projectBytes) throw new Error('Project package is missing project.json');
  if (manifest.terrainStorage === 'linked-media-v1') {
    for (const path of terrainGeometryReferences(projectBytes)) {
      if (archiveEntries[path]) continue;
      if (!readLinkedEntry) throw new Error('This project requires its linked media folder for terrain geometry');
      archiveEntries[path] = await readLinkedEntry(manifest.mediaFolderName, path);
    }
  }
  for (const path of manifest.linkedArtifactEntries ?? []) {
    if (!isLinkedArtifactEntry(path)) throw new Error('Invalid linked artifact path');
    if (archiveEntries[path]) continue;
    if (!readLinkedEntry) throw new Error('This project requires its linked media folder for artifacts');
    archiveEntries[path] = await readLinkedEntry(manifest.mediaFolderName, path);
  }
  const projectData = decodeProjectTerrain(projectBytes, archiveEntries);
  if (projectData.version !== manifest.projectSchemaVersion) {
    throw new Error('Project package schema version does not match its manifest');
  }

  const entries = new Map<string, Uint8Array>();
  for (const [path, entryBytes] of Object.entries(archiveEntries)) {
    const normalizedPath = normalizeEntryPath(path);
    if (normalizedPath === PROJECT_PACKAGE_MANIFEST_ENTRY || normalizedPath === PROJECT_PACKAGE_PROJECT_ENTRY || isTerrainGeometryEntry(normalizedPath)) continue;
    entries.set(normalizedPath, cloneBytes(entryBytes));
  }
  return { manifest, projectData, entries };
}

export class ProjectPackageSession {
  private entries: Map<string, Uint8Array>;
  private persistCallback: PackagePersistence | null = null;
  private entryRevision = 0;
  private persistedEntryRevision = 0;
  private writeBatchDepth = 0;
  private batchNeedsPersist = false;
  private batchSettled: Promise<void> = Promise.resolve();
  private resolveBatchSettled: (() => void) | null = null;
  private manifest: ProjectPackageManifest;
  private packageFileName: string;

  constructor(
    manifest: ProjectPackageManifest,
    entries: ReadonlyMap<string, Uint8Array> = new Map(),
    packageFileName = getProjectPackageFileName(manifest.projectName),
  ) {
    this.manifest = manifest;
    this.packageFileName = packageFileName;
    this.entries = new Map([...entries].map(([path, bytes]) => [normalizeEntryPath(path), cloneBytes(bytes)]));
  }

  static create(projectData: ProjectFile): ProjectPackageSession {
    return new ProjectPackageSession(createProjectPackageManifest(projectData));
  }

  static fromArchive(archive: ProjectPackageArchive, packageFileName: string): ProjectPackageSession {
    return new ProjectPackageSession(archive.manifest, archive.entries, packageFileName);
  }

  get isBatchingWrites(): boolean { return this.writeBatchDepth > 0; }
  waitForWriteBatch(): Promise<void> { return this.batchSettled; }

  /** Artifact steps stage in memory; the last operation in the group flushes before returning.
   * Nested/concurrent jobs join the same group. No intermediate package save is needed.
   */
  async batchWrites<T>(work: () => Promise<T>): Promise<T> {
    if (this.writeBatchDepth++ === 0) {
      this.batchSettled = new Promise(resolve => { this.resolveBatchSettled = resolve; });
    }
    try {
      return await work();
    } finally {
      this.writeBatchDepth--;
      if (this.writeBatchDepth === 0) {
        this.resolveBatchSettled?.();
        this.resolveBatchSettled = null;
        if (this.batchNeedsPersist) {
          this.batchNeedsPersist = false;
          if (!await this.persist()) throw new Error('Could not persist project artifact batch');
        }
      }
    }
  }

  setPersistCallback(callback: PackagePersistence): void {
    this.persistCallback = callback;
  }

  getManifest(): ProjectPackageManifest {
    return { ...this.manifest, excludes: [...this.manifest.excludes] };
  }

  syncManifest(projectData: ProjectFile): void {
    this.manifest = createProjectPackageManifest(projectData, this.manifest);
  }

  getPackageFileName(): string {
    return this.packageFileName;
  }

  setPackageFileName(fileName: string): void {
    if (!isProjectPackageFileName(fileName)) throw new Error('Project package file must use the .msproj extension');
    this.packageFileName = fileName;
  }

  getMediaFolderName(): string {
    return this.manifest.mediaFolderName;
  }

  setMediaFolderName(folderName: string): void {
    this.manifest = { ...this.manifest, mediaFolderName: folderName };
  }

  getEntries(): ReadonlyMap<string, Uint8Array> {
    return this.entries;
  }

  hasEntry(folder: ProjectFolderKey, fileName: string): boolean {
    return this.entries.has(getProjectPackageEntryPath(folder, fileName));
  }

  readEntry(folder: ProjectFolderKey, fileName: string): Uint8Array | null {
    const value = this.entries.get(getProjectPackageEntryPath(folder, fileName));
    return value ? cloneBytes(value) : null;
  }

  async writeEntry(folder: ProjectFolderKey, fileName: string, content: Blob | string): Promise<boolean> {
    if (!await this.setEntry(folder, fileName, content) && this.entryRevision === this.persistedEntryRevision) return true;
    return this.persist();
  }

  async writeEntries(
    entries: Array<{ folder: ProjectFolderKey; fileName: string; content: Blob | string }>,
  ): Promise<boolean> {
    let changed = false;
    for (const entry of entries) changed = await this.setEntry(entry.folder, entry.fileName, entry.content) || changed;
    return changed || this.entryRevision !== this.persistedEntryRevision ? this.persist() : true;
  }

  async deleteEntry(folder: ProjectFolderKey, entryName: string, recursive = false): Promise<boolean> {
    const path = getProjectPackageEntryPath(folder, entryName);
    let changed = this.entries.delete(path);
    if (recursive) {
      const prefix = `${path}/`;
      for (const candidate of [...this.entries.keys()]) {
        if (candidate.startsWith(prefix)) {
          this.entries.delete(candidate);
          changed = true;
        }
      }
    }
    if (!changed) return false;
    this.entryRevision++;
    return this.persist();
  }

  listFiles(folder: ProjectFolderKey): string[] {
    const prefix = `${normalizeEntryPath(PROJECT_FOLDERS[folder])}/`;
    const names = new Set<string>();
    for (const path of this.entries.keys()) {
      if (!path.startsWith(prefix)) continue;
      const remainder = path.slice(prefix.length);
      if (remainder && !remainder.includes('/')) names.add(remainder);
    }
    return [...names].toSorted();
  }

  listEntryPaths(folder: ProjectFolderKey): string[] {
    const prefix = `${normalizeEntryPath(PROJECT_FOLDERS[folder])}/`;
    return [...this.entries.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .toSorted();
  }

  addMigratedEntry(path: string, bytes: Uint8Array): void {
    const normalizedPath = normalizeEntryPath(path);
    if (normalizedPath === PROJECT_PACKAGE_MANIFEST_ENTRY || normalizedPath === PROJECT_PACKAGE_PROJECT_ENTRY) return;
    this.entries.set(normalizedPath, cloneBytes(bytes));
  }

  async encode(projectData: ProjectFile): Promise<Uint8Array> {
    this.syncManifest(projectData);
    return encodeProjectPackage(projectData, this.manifest, this.entries);
  }

  async streamEncode(projectData: ProjectFile, writeChunk: PackageChunkWriter, linkedTerrain = false,
    linkedArtifacts: ReadonlySet<string> = new Set(), entries: ReadonlyMap<string, Uint8Array> = this.entries,
  ): Promise<void> {
    this.syncManifest(projectData);
    await streamProjectPackage(projectData, this.manifest, entries, writeChunk, linkedTerrain, linkedArtifacts);
  }

  toFile(content: Uint8Array): File {
    return new File([bytesToBlobPart(content)], this.packageFileName, { type: 'application/vnd.masterselects.project+zip' });
  }

  private async persist(): Promise<boolean> {
    if (this.isBatchingWrites) { this.batchNeedsPersist = true; return true; }
    const revision = this.entryRevision;
    const saved = this.persistCallback ? await this.persistCallback() : true;
    if (saved) this.persistedEntryRevision = Math.max(this.persistedEntryRevision, revision);
    return saved;
  }

  private async setEntry(folder: ProjectFolderKey, fileName: string, content: Blob | string): Promise<boolean> {
    const bytes = typeof content === 'string'
      ? cloneBytes(strToU8(content))
      : await blobToBytes(content);
    const path = getProjectPackageEntryPath(folder, fileName);
    const existing = this.entries.get(path);
    if (existing?.byteLength === bytes.byteLength && existing.every((value, index) => value === bytes[index])) return false;
    this.entries.set(path, bytes);
    this.entryRevision++;
    return true;
  }
}

const fsaSessions = new WeakMap<FileSystemDirectoryHandle, ProjectPackageSession>();
const nativeSessions = new Map<string, ProjectPackageSession>();

function normalizeNativeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function registerFsaProjectPackageSession(
  handle: FileSystemDirectoryHandle,
  session: ProjectPackageSession,
): void {
  fsaSessions.set(handle, session);
}

export function getFsaProjectPackageSession(handle: FileSystemDirectoryHandle): ProjectPackageSession | null {
  return fsaSessions.get(handle) ?? null;
}

export function unregisterFsaProjectPackageSession(handle: FileSystemDirectoryHandle): void {
  fsaSessions.delete(handle);
}

export function registerNativeProjectPackageSession(path: string, session: ProjectPackageSession): void {
  nativeSessions.set(normalizeNativeProjectPath(path), session);
}

export function getNativeProjectPackageSession(path: string): ProjectPackageSession | null {
  return nativeSessions.get(normalizeNativeProjectPath(path)) ?? null;
}

export function unregisterNativeProjectPackageSession(path: string): void {
  nativeSessions.delete(normalizeNativeProjectPath(path));
}

export function moveNativeProjectPackageSession(oldPath: string, newPath: string): ProjectPackageSession | null {
  const session = getNativeProjectPackageSession(oldPath);
  unregisterNativeProjectPackageSession(oldPath);
  if (session) registerNativeProjectPackageSession(newPath, session);
  return session;
}
