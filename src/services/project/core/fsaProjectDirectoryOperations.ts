import { Logger } from '../../logger';
import type { FileStorageService } from './FileStorageService';
import { MAX_BACKUPS } from './constants';
import {
  getFsaProjectFolderPath,
  getFsaProjectPackageSession,
  isProjectPackageFileName,
} from './projectPackage';
import { PROJECT_FILE_NAME } from './projectCorePersistence';

const log = Logger.create('ProjectCore');

type FileSystemEntryHandle = FileSystemFileHandle | FileSystemDirectoryHandle;
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemEntryHandle>;
};

export async function createFsaProjectBackup(
  projectHandle: FileSystemDirectoryHandle,
  fileStorage: FileStorageService,
): Promise<boolean> {
  try {
    const packageSession = getFsaProjectPackageSession(projectHandle);
    const projectFileName = packageSession?.getPackageFileName() ?? PROJECT_FILE_NAME;
    const projectFile = await projectHandle.getFileHandle(projectFileName);
    const file = await projectFile.getFile();
    const content = await file.arrayBuffer();
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);
    const backupFileName = `project_${timestamp}${packageSession ? '.msproj' : '.json'}`;
    const backupsFolder = await fileStorage.navigateToFolder(
      projectHandle,
      getFsaProjectFolderPath(projectHandle, 'BACKUPS'),
      true,
    );
    if (!backupsFolder) return false;

    const backupHandle = await backupsFolder.getFileHandle(backupFileName, { create: true });
    const writable = await backupHandle.createWritable();
    await writable.write(content);
    await writable.close();
    await cleanupOldBackups(backupsFolder);
    log.debug(`Created backup: ${backupFileName}`);
    return true;
  } catch (error) {
    log.error('Failed to create backup:', error);
    return false;
  }
}

async function cleanupOldBackups(backupsFolder: FileSystemDirectoryHandle): Promise<void> {
  try {
    const backups: Array<{ name: string; file: File }> = [];
    for await (const entry of (backupsFolder as IterableDirectoryHandle).values()) {
      if (entry.kind !== 'file' || !entry.name.startsWith('project_')) continue;
      if (!entry.name.endsWith('.json') && !entry.name.endsWith('.msproj')) continue;
      backups.push({ name: entry.name, file: await entry.getFile() });
    }

    for (const backup of backups.toSorted((left, right) => right.file.lastModified - left.file.lastModified).slice(MAX_BACKUPS)) {
      await backupsFolder.removeEntry(backup.name);
      log.debug(`Removed old backup: ${backup.name}`);
    }
  } catch (error) {
    log.warn('Failed to cleanup old backups:', error);
  }
}

export async function copyFsaDirectoryContents(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
  renamedTopLevelDirectory?: { from: string; to: string },
): Promise<void> {
  for await (const entry of (source as IterableDirectoryHandle).values()) {
    if (entry.kind === 'file') {
      const sourceFile = await entry.getFile();
      const targetFile = await target.getFileHandle(entry.name, { create: true });
      const writable = await targetFile.createWritable();
      await writable.write(sourceFile);
      await writable.close();
      continue;
    }

    const targetName = renamedTopLevelDirectory?.from === entry.name
      ? renamedTopLevelDirectory.to
      : entry.name;
    const subDirectory = await target.getDirectoryHandle(targetName, { create: true });
    await copyFsaDirectoryContents(entry, subDirectory);
  }
}

export async function fsaFolderContainsProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const entry of (handle as IterableDirectoryHandle).values()) {
    if (entry.kind === 'file' && (entry.name === PROJECT_FILE_NAME || isProjectPackageFileName(entry.name))) {
      return true;
    }
  }
  return false;
}
