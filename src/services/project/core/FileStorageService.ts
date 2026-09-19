// Low-level file I/O operations for project storage
// Provides reusable primitives for all domain services

import { Logger } from '../../logger';
import { PROJECT_FOLDERS, type ProjectFolderKey } from './constants';
import {
  getFsaProjectPackageSession,
  getFsaProjectFolderPath,
  isPackagedProjectFolder,
} from './projectPackage';

const log = Logger.create('FileStorage');

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

export class FileStorageService {
  /**
   * Navigate to a subfolder within a base directory, optionally creating it
   */
  async navigateToFolder(
    baseHandle: FileSystemDirectoryHandle,
    folderPath: string,
    create = false
  ): Promise<FileSystemDirectoryHandle | null> {
    try {
      let folder = baseHandle;
      for (const part of folderPath.split('/')) {
        folder = await folder.getDirectoryHandle(part, { create });
      }
      return folder;
    } catch (e) {
      if (!create) return null;
      throw e;
    }
  }

  /**
   * Get a file handle from a project subfolder
   */
  async getFileHandle(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey,
    fileName: string,
    create = false
  ): Promise<FileSystemFileHandle | null> {
    if (getFsaProjectPackageSession(projectHandle) && isPackagedProjectFolder(subFolder)) {
      return null;
    }
    try {
      const folderPath = getFsaProjectFolderPath(projectHandle, subFolder);
      const folder = await this.navigateToFolder(projectHandle, folderPath, create);
      if (!folder) return null;
      return await folder.getFileHandle(fileName, { create });
    } catch (e) {
      if (!create) return null;
      throw e;
    }
  }

  /**
   * Write a file to a project subfolder
   */
  async writeFile(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey,
    fileName: string,
    content: Blob | string
  ): Promise<boolean> {
    const packageSession = getFsaProjectPackageSession(projectHandle);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.writeEntry(subFolder, fileName, content);
    }

    try {
      const handle = await this.getFileHandle(projectHandle, subFolder, fileName, true);
      if (!handle) return false;

      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (e) {
      log.error(`Failed to write ${subFolder}/${fileName}:`, e);
      return false;
    }
  }

  /**
   * Read a file from a project subfolder
   */
  async readFile(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<File | null> {
    const packageSession = getFsaProjectPackageSession(projectHandle);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      const bytes = packageSession.readEntry(subFolder, fileName);
      if (!bytes) return null;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new File([buffer], fileName);
    }

    try {
      const handle = await this.getFileHandle(projectHandle, subFolder, fileName);
      if (!handle) return null;
      return await handle.getFile();
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if a file exists in a project subfolder
   */
  async fileExists(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<boolean> {
    const packageSession = getFsaProjectPackageSession(projectHandle);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.hasEntry(subFolder, fileName);
    }
    const handle = await this.getFileHandle(projectHandle, subFolder, fileName);
    return handle !== null;
  }

  /**
   * Delete a file or directory from a project subfolder
   */
  async deleteEntry(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey,
    entryName: string,
    options?: { recursive?: boolean }
  ): Promise<boolean> {
    const packageSession = getFsaProjectPackageSession(projectHandle);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.deleteEntry(subFolder, entryName, options?.recursive ?? false);
    }

    try {
      const folderPath = getFsaProjectFolderPath(projectHandle, subFolder);
      const entryParts = entryName
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);
      const leafName = entryParts.pop();
      if (!leafName || leafName === '.' || leafName === '..' || entryParts.some(part => part === '.' || part === '..')) {
        return false;
      }

      const parentPath = [folderPath, ...entryParts].filter(Boolean).join('/');
      const folder = await this.navigateToFolder(projectHandle, parentPath, false);
      if (!folder) return false;

      await folder.removeEntry(leafName, { recursive: options?.recursive ?? false });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Delete a file from a project subfolder
   */
  async deleteFile(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<boolean> {
    return this.deleteEntry(projectHandle, subFolder, fileName);
  }

  /**
   * List files in a project subfolder
   */
  async listFiles(
    projectHandle: FileSystemDirectoryHandle,
    subFolder: ProjectFolderKey
  ): Promise<string[]> {
    const packageSession = getFsaProjectPackageSession(projectHandle);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.listFiles(subFolder);
    }

    try {
      const folderPath = getFsaProjectFolderPath(projectHandle, subFolder);
      const folder = await this.navigateToFolder(projectHandle, folderPath, false);
      if (!folder) return [];

      const files: string[] = [];
      for await (const entry of (folder as IterableDirectoryHandle).values()) {
        if (entry.kind === 'file') {
          files.push(entry.name);
        }
      }
      return files;
    } catch (e) {
      return [];
    }
  }

  /**
   * Create all project subfolders
   */
  async createProjectFolders(handle: FileSystemDirectoryHandle): Promise<void> {
    const createdPaths = new Set<string>();
    for (const folderKey of Object.keys(PROJECT_FOLDERS) as ProjectFolderKey[]) {
      if (getFsaProjectPackageSession(handle) && isPackagedProjectFolder(folderKey)) continue;
      const folderPath = getFsaProjectFolderPath(handle, folderKey);
      if (createdPaths.has(folderPath)) continue;
      await this.navigateToFolder(handle, folderPath, true);
      createdPaths.add(folderPath);
    }
  }
}

// Singleton instance
export const fileStorageService = new FileStorageService();
