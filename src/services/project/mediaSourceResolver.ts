import { fileSystemService } from '../fileSystemService';
import { projectDB } from '../projectDB';

export interface ProjectMediaSourceDescriptor {
  mediaFileId?: string | null;
  projectPath?: string | null;
  filePath?: string | null;
  name?: string | null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

export function getProjectRawPathCandidates(descriptor: ProjectMediaSourceDescriptor): string[] {
  const candidates = new Set<string>();

  if (descriptor.projectPath) {
    candidates.add(normalizePath(descriptor.projectPath));
  }

  for (const value of [descriptor.filePath, descriptor.name]) {
    if (!value) continue;
    const normalized = normalizePath(value);

    if (normalized.startsWith('Raw/')) {
      candidates.add(normalized);
    }

    const baseName = getBaseName(normalized);
    if (baseName) {
      candidates.add(`Raw/${baseName}`);
    }
  }

  return [...candidates];
}

export async function getStoredProjectFileHandle(mediaFileId?: string | null): Promise<FileSystemFileHandle | null> {
  if (!mediaFileId) {
    return null;
  }

  const cacheKey = `${mediaFileId}_project`;
  const cachedHandle = fileSystemService.getFileHandle(cacheKey);
  if (cachedHandle) {
    return cachedHandle;
  }

  try {
    const storedHandle = await projectDB.getStoredHandle(`media_${cacheKey}`);
    if (storedHandle && storedHandle.kind === 'file' && 'getFile' in storedHandle) {
      const handle = storedHandle as FileSystemFileHandle;
      fileSystemService.storeFileHandle(cacheKey, handle);
      return handle;
    }
  } catch {
    // Ignore IndexedDB restore failures here. Callers will try path-based resolution next.
  }

  return null;
}

export async function cacheProjectFileHandle(
  mediaFileId: string,
  handle: FileSystemFileHandle,
  promotePrimary = false
): Promise<void> {
  const projectKey = `${mediaFileId}_project`;
  fileSystemService.storeFileHandle(projectKey, handle);
  await projectDB.storeHandle(`media_${projectKey}`, handle);

  if (promotePrimary) {
    fileSystemService.storeFileHandle(mediaFileId, handle);
    await projectDB.storeHandle(`media_${mediaFileId}`, handle);
  }
}
