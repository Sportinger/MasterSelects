import { isLinkedArtifactEntry, linkedArtifactPath } from './linkedArtifactFiles';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import type { ProjectFile } from '../types/project.types';
import { PROJECT_FOLDERS, type ProjectFolderKey } from './constants';
import {
  decodeProjectPackage,
  getProjectPackageFileName,
  isPackagedProjectFolder,
  isProjectPackageFileName,
  ProjectPackageSession,
} from './projectPackage';

type NativeClient = typeof NativeHelperClient;

export interface LoadedNativeProjectPackage {
  projectData: ProjectFile;
  session: ProjectPackageSession;
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  if (!first) return '';
  return [
    first.replace(/\\/g, '/').replace(/\/+$/g, ''),
    ...rest.map((part) => part.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')),
  ].filter(Boolean).join('/');
}

async function findNativePackageFileName(
  client: NativeClient,
  projectPath: string,
): Promise<string | null> {
  const entries = await client.listDir(projectPath);
  const packageFiles = entries
    .filter((entry) => entry.kind === 'file' && isProjectPackageFileName(entry.name))
    .map((entry) => entry.name);
  if (packageFiles.length === 0) return null;
  if (packageFiles.length === 1) return packageFiles[0] ?? null;
  const projectFolderName = projectPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) ?? 'Project';
  const preferredName = getProjectPackageFileName(projectFolderName).toLowerCase();
  return packageFiles.find((name) => name.toLowerCase() === preferredName)
    ?? packageFiles.toSorted((left, right) => left.localeCompare(right))[0]
    ?? null;
}

export async function readNativeProjectPackage(
  client: NativeClient,
  projectPath: string,
): Promise<LoadedNativeProjectPackage | null> {
  const packageFileName = await findNativePackageFileName(client, projectPath);
  if (!packageFileName) return null;
  const bytes = await client.getDownloadedFile(joinPath(projectPath, packageFileName));
  if (!bytes) throw new Error(`Cannot read ${packageFileName}`);
  const archive = await decodeProjectPackage(bytes, async (mediaFolder, path) => {
    const geometry = await client.getDownloadedFile(joinPath(projectPath, mediaFolder, isLinkedArtifactEntry(path) ? linkedArtifactPath(path) : path));
    if (!geometry) throw new Error(`Cannot read linked project data: ${path}`);
    return new Uint8Array(geometry);
  });
  return {
    projectData: archive.projectData,
    session: ProjectPackageSession.fromArchive(archive, packageFileName),
  };
}

const persistedArtifacts = new Map<string, Set<string>>();

export async function writeNativeProjectPackage(
  client: NativeClient,
  projectPath: string,
  session: ProjectPackageSession,
  projectData: ProjectFile,
): Promise<boolean> {
  const entries = new Map(session.getEntries());
  const linkedArtifacts = new Set([...entries.keys()].filter(isLinkedArtifactEntry));
  const mediaPath = joinPath(projectPath, session.getMediaFolderName());
  let known = persistedArtifacts.get(mediaPath);
  if (!known) { known = new Set(); persistedArtifacts.set(mediaPath, known); }
  for (const path of linkedArtifacts) {
    if (known.has(path)) continue;
    const target = joinPath(mediaPath, linkedArtifactPath(path));
    if (!await client.createDir(target.slice(0, target.lastIndexOf('/')), true)
      || !await client.writeFileBinary(target, entries.get(path)!)) return false;
    known.add(path);
  }
  const chunks: Uint8Array[] = [];
  await session.streamEncode(projectData, async chunk => { chunks.push(chunk); }, false, linkedArtifacts, entries);
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return client.writeFileBinary(joinPath(projectPath, session.getPackageFileName()), bytes);
}

async function importNativeDirectory(
  client: NativeClient,
  absolutePath: string,
  entryPrefix: string,
  session: ProjectPackageSession,
): Promise<void> {
  const entries = await client.listDir(absolutePath);
  for (const entry of entries) {
    const entryPath = joinPath(absolutePath, entry.name);
    const packagePath = `${entryPrefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      await importNativeDirectory(client, entryPath, packagePath, session);
      continue;
    }
    const bytes = await client.getDownloadedFile(entryPath);
    if (bytes) session.addMigratedEntry(packagePath, new Uint8Array(bytes));
  }
}

export async function importLegacyNativePackageEntries(
  client: NativeClient,
  projectPath: string,
  session: ProjectPackageSession,
): Promise<void> {
  for (const [folderKey, folderPath] of Object.entries(PROJECT_FOLDERS) as Array<[ProjectFolderKey, string]>) {
    if (!isPackagedProjectFolder(folderKey)) continue;
    const absolutePath = joinPath(projectPath, folderPath);
    const { exists, kind } = await client.exists(absolutePath);
    if (!exists || kind !== 'directory') continue;
    await importNativeDirectory(client, absolutePath, folderPath, session);
  }
}

export function joinNativeProjectPath(...parts: string[]): string {
  return joinPath(...parts);
}
