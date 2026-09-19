// Low-level file I/O operations via Native Helper
// Mirrors FileStorageService but uses string paths + NativeHelperClient
// instead of FileSystemDirectoryHandle

import { Logger } from '../../logger';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import { PROJECT_FOLDERS, type ProjectFolderKey } from './constants';
import {
  getNativeProjectPackageSession,
  getNativeProjectFolderPath,
  isPackagedProjectFolder,
} from './projectPackage';

const log = Logger.create('NativeFileStorage');

export class NativeFileStorageService {
  private client = NativeHelperClient;

  private joinPath(...parts: string[]): string {
    return parts
      .map(p => p.replace(/\\/g, '/').replace(/\/+$/, ''))
      .join('/');
  }

  /**
   * Resolve the full path for a file in a project subfolder
   */
  resolvePath(projectPath: string, subFolder: ProjectFolderKey, fileName: string): string {
    const folderPath = getNativeProjectFolderPath(projectPath, subFolder);
    return this.joinPath(projectPath, folderPath, fileName);
  }

  /**
   * Write a file to a project subfolder
   */
  async writeFile(
    projectPath: string,
    subFolder: ProjectFolderKey,
    fileName: string,
    content: Blob | string
  ): Promise<boolean> {
    const packageSession = getNativeProjectPackageSession(projectPath);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.writeEntry(subFolder, fileName, content);
    }

    try {
      const folderPath = getNativeProjectFolderPath(projectPath, subFolder);
      await this.client.createDir(this.joinPath(projectPath, folderPath));
      const fullPath = this.resolvePath(projectPath, subFolder, fileName);

      if (typeof content === 'string') {
        return await this.client.writeFile(fullPath, content);
      } else {
        return await this.client.writeFileBinary(fullPath, content);
      }
    } catch (e) {
      log.error(`Failed to write ${subFolder}/${fileName}:`, e);
      return false;
    }
  }

  /**
   * Read a file as text from a project subfolder
   */
  async readFileText(
    projectPath: string,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<string | null> {
    const packageSession = getNativeProjectPackageSession(projectPath);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      const bytes = packageSession.readEntry(subFolder, fileName);
      return bytes ? new TextDecoder().decode(bytes) : null;
    }

    try {
      const fullPath = this.resolvePath(projectPath, subFolder, fileName);
      return await this.client.readFileText(fullPath);
    } catch {
      return null;
    }
  }

  /**
   * Read a file as ArrayBuffer from a project subfolder (via HTTP)
   */
  async readFileBinary(
    projectPath: string,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<ArrayBuffer | null> {
    const packageSession = getNativeProjectPackageSession(projectPath);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      const bytes = packageSession.readEntry(subFolder, fileName);
      return bytes
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        : null;
    }

    try {
      const fullPath = this.resolvePath(projectPath, subFolder, fileName);
      return await this.client.getDownloadedFile(fullPath);
    } catch {
      return null;
    }
  }

  /**
   * Check if a file exists in a project subfolder
   */
  async fileExists(
    projectPath: string,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<boolean> {
    const packageSession = getNativeProjectPackageSession(projectPath);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.hasEntry(subFolder, fileName);
    }
    const fullPath = this.resolvePath(projectPath, subFolder, fileName);
    const { exists } = await this.client.exists(fullPath);
    return exists;
  }

  /**
   * Delete a file or directory from a project subfolder
   */
  async deleteEntry(
    projectPath: string,
    subFolder: ProjectFolderKey,
    entryName: string,
    options?: { recursive?: boolean }
  ): Promise<boolean> {
    const packageSession = getNativeProjectPackageSession(projectPath);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.deleteEntry(subFolder, entryName, options?.recursive ?? false);
    }

    try {
      const fullPath = this.resolvePath(projectPath, subFolder, entryName);
      return await this.client.deleteFile(fullPath, options?.recursive ?? false);
    } catch {
      return false;
    }
  }

  /**
   * Delete a file from a project subfolder
   */
  async deleteFile(
    projectPath: string,
    subFolder: ProjectFolderKey,
    fileName: string
  ): Promise<boolean> {
    return this.deleteEntry(projectPath, subFolder, fileName);
  }

  /**
   * List files in a project subfolder
   */
  async listFiles(
    projectPath: string,
    subFolder: ProjectFolderKey
  ): Promise<string[]> {
    const packageSession = getNativeProjectPackageSession(projectPath);
    if (packageSession && isPackagedProjectFolder(subFolder)) {
      return packageSession.listFiles(subFolder);
    }

    try {
      const folderPath = getNativeProjectFolderPath(projectPath, subFolder);
      const fullPath = this.joinPath(projectPath, folderPath);
      const entries = await this.client.listDir(fullPath);
      return entries
        .filter(e => e.kind === 'file')
        .map(e => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Create all project subfolders
   */
  async createProjectFolders(projectPath: string): Promise<void> {
    const createdPaths = new Set<string>();
    for (const folderKey of Object.keys(PROJECT_FOLDERS) as ProjectFolderKey[]) {
      if (getNativeProjectPackageSession(projectPath) && isPackagedProjectFolder(folderKey)) continue;
      const folderPath = getNativeProjectFolderPath(projectPath, folderKey);
      if (createdPaths.has(folderPath)) continue;
      await this.client.createDir(this.joinPath(projectPath, folderPath));
      createdPaths.add(folderPath);
    }
  }

  /**
   * Get an HTTP URL that serves a file from the project via Native Helper
   */
  getFileUrl(projectPath: string, subFolder: ProjectFolderKey, fileName: string): string {
    const fullPath = this.resolvePath(projectPath, subFolder, fileName);
    return this.client.getFileUrl(fullPath);
  }
}

// Singleton instance
export const nativeFileStorageService = new NativeFileStorageService();
