// Raw folder operations and media import service

import { Logger } from '../../logger';
import { PROJECT_FOLDERS } from '../core/constants';
import {
  addFileNameSuffix,
  buildRawTargetPath,
  getRawRelativePath,
  parseRawRelativePath,
} from '../core/rawPath';

const log = Logger.create('RawMedia');
import { FileStorageService } from '../core/FileStorageService';
import type { ProjectMediaFile } from '../types';

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

export class RawMediaService {
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  private async getRawTargetFolder(
    rawFolder: FileSystemDirectoryHandle,
    folderPath: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    if (!folderPath) {
      return rawFolder;
    }

    return this.fileStorage.navigateToFolder(rawFolder, folderPath, create);
  }

  // ============================================
  // RAW FOLDER OPERATIONS
  // ============================================

  /**
   * Copy a file to the Raw/ folder in the project
   * Returns the file handle and relative path if successful
   * If file with same name and size already exists, returns existing file instead of copying
   */
  async copyToRawFolder(
    projectHandle: FileSystemDirectoryHandle,
    file: File,
    fileName?: string
  ): Promise<{ handle: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
    try {
      const rawFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.RAW, { create: true });
      const target = buildRawTargetPath(fileName, file.name);
      const targetFolder = await this.getRawTargetFolder(rawFolder, target.folderPath, true);
      if (!targetFolder) {
        return null;
      }

      let finalName = target.fileName;
      let counter = 0;
      while (true) {
        try {
          const existingHandle = await targetFolder.getFileHandle(finalName, { create: false });
          const existingFile = await existingHandle.getFile();

          if (existingFile.size === file.size) {
            const relativePath = getRawRelativePath(target.folderPath, finalName);
            log.debug(`File already exists in Raw folder with same size: ${relativePath}`);
            return { handle: existingHandle, relativePath, alreadyExisted: true };
          }

          counter += 1;
          finalName = addFileNameSuffix(target.fileName, counter);
        } catch {
          break;
        }
      }

      const fileHandle = await targetFolder.getFileHandle(finalName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      const relativePath = getRawRelativePath(target.folderPath, finalName);
      log.debug(`Copied ${file.name} to ${relativePath} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      return { handle: fileHandle, relativePath, alreadyExisted: false };
    } catch (e) {
      log.error('Failed to copy file to Raw folder:', e);
      return null;
    }
  }

  /**
   * Get a file from the Raw/ folder by relative path
   */
  async getFileFromRaw(
    projectHandle: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
    try {
      const target = parseRawRelativePath(relativePath);
      if (!target) {
        return null;
      }

      const rawFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.RAW);
      const targetFolder = await this.getRawTargetFolder(rawFolder, target.folderPath, false);
      if (!targetFolder) {
        return null;
      }

      const fileHandle = await targetFolder.getFileHandle(target.fileName);
      const file = await fileHandle.getFile();

      return { file, handle: fileHandle };
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if a file exists in the Raw/ folder by name
   */
  async hasFileInRaw(
    projectHandle: FileSystemDirectoryHandle,
    fileName: string
  ): Promise<boolean> {
    try {
      const rawFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.RAW);
      const target = buildRawTargetPath(fileName, fileName);
      const targetFolder = await this.getRawTargetFolder(rawFolder, target.folderPath, false);
      if (!targetFolder) {
        return false;
      }

      await targetFolder.getFileHandle(target.fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scan the Raw/ folder for files matching missing file names
   * Returns a map of lowercase filename -> file handle
   */
  async scanRawFolder(
    projectHandle: FileSystemDirectoryHandle
  ): Promise<Map<string, FileSystemFileHandle>> {
    const foundFiles = new Map<string, FileSystemFileHandle>();

    try {
      const rawFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.RAW);

      const scanDirectory = async (directory: FileSystemDirectoryHandle): Promise<void> => {
        for await (const entry of (directory as IterableDirectoryHandle).values()) {
          if (entry.kind === 'file') {
            const key = entry.name.toLowerCase();
            if (!foundFiles.has(key)) {
              foundFiles.set(key, entry);
            }
          } else if (entry.kind === 'directory') {
            await scanDirectory(entry);
          }
        }
      };

      await scanDirectory(rawFolder);
    } catch {
      // Raw folder doesn't exist or can't be read
    }

    return foundFiles;
  }

  // ============================================
  // MEDIA IMPORT
  // ============================================

  /**
   * Import media file (creates reference, doesn't copy)
   */
  async importMediaFile(
    file: File,
    fileHandle?: FileSystemFileHandle
  ): Promise<ProjectMediaFile | null> {
    const id = `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Determine file type
    let type: 'video' | 'audio' | 'image' | 'lottie' | 'rive' = 'video';
    if (file.type.startsWith('audio/')) type = 'audio';
    else if (file.type.startsWith('image/')) type = 'image';
    else if (file.name.toLowerCase().endsWith('.lottie')) type = 'lottie';
    else if (file.name.toLowerCase().endsWith('.riv')) type = 'rive';

    // Get source path (if available from File System Access API)
    let sourcePath = file.name;
    if (fileHandle) {
      sourcePath = fileHandle.name;
    }

    const mediaFile: ProjectMediaFile = {
      id,
      name: file.name,
      type,
      sourcePath,
      hasProxy: false,
      folderId: null,
      importedAt: new Date().toISOString(),
    };

    // Get metadata (will be filled in async)
    if (type === 'video' || type === 'audio') {
      // Create temp URL to get duration
      const url = URL.createObjectURL(file);
      const media = type === 'video' ? document.createElement('video') : document.createElement('audio');

      await new Promise<void>((resolve) => {
        media.onloadedmetadata = () => {
          mediaFile.duration = media.duration;
          if (type === 'video' && media instanceof HTMLVideoElement) {
            mediaFile.width = media.videoWidth;
            mediaFile.height = media.videoHeight;
          }
          URL.revokeObjectURL(url);
          resolve();
        };
        media.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        media.src = url;
      });
    } else if (type === 'image') {
      const url = URL.createObjectURL(file);
      const img = new Image();

      await new Promise<void>((resolve) => {
        img.onload = () => {
          mediaFile.width = img.naturalWidth;
          mediaFile.height = img.naturalHeight;
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        img.src = url;
      });
    }

    return mediaFile;
  }

  // ============================================
  // VIDEO DOWNLOADS
  // ============================================

  /** Map platform string to subfolder name */
  private static readonly PLATFORM_FOLDERS: Record<string, string> = {
    youtube: 'YT',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    twitter: 'Twitter',
    facebook: 'Facebook',
    reddit: 'Reddit',
    vimeo: 'Vimeo',
    twitch: 'Twitch',
  };

  /** Sanitize a title to a safe filename */
  static sanitizeDownloadName(title: string): string {
    return title.replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 100).trim();
  }

  /** Get the expected filename for a download */
  static getDownloadFileName(title: string): string {
    return `${RawMediaService.sanitizeDownloadName(title)}.mp4`;
  }

  /** Get the expected folder path for a platform download */
  static getDownloadFolderPath(platform: string): string {
    const subfolder = RawMediaService.PLATFORM_FOLDERS[platform] || 'Other';
    return `Downloads/${subfolder}`;
  }

  /**
   * Check if a downloaded file already exists in the project
   */
  async checkDownloadExists(
    projectHandle: FileSystemDirectoryHandle,
    title: string,
    platform: string
  ): Promise<boolean> {
    try {
      const folderPath = RawMediaService.getDownloadFolderPath(platform);
      const folder = await this.fileStorage.navigateToFolder(projectHandle, folderPath, false);
      if (!folder) return false;
      const fileName = RawMediaService.getDownloadFileName(title);
      await folder.getFileHandle(fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a downloaded file back from the project's Downloads folder
   */
  async getDownloadFile(
    projectHandle: FileSystemDirectoryHandle,
    title: string,
    platform: string
  ): Promise<File | null> {
    try {
      const folderPath = RawMediaService.getDownloadFolderPath(platform);
      const folder = await this.fileStorage.navigateToFolder(projectHandle, folderPath, false);
      if (!folder) return null;
      const fileName = RawMediaService.getDownloadFileName(title);
      const fileHandle = await folder.getFileHandle(fileName, { create: false });
      return await fileHandle.getFile();
    } catch {
      return null;
    }
  }

  /**
   * Save a downloaded video to the project's Downloads/<platform> folder
   * Returns the File object with correct name for timeline use
   */
  async saveDownload(
    projectHandle: FileSystemDirectoryHandle,
    blob: Blob,
    title: string,
    platform: string
  ): Promise<File | null> {
    try {
      // Sanitize filename
      const sanitizedTitle = RawMediaService.sanitizeDownloadName(title);
      const fileName = `${sanitizedTitle}.mp4`;

      // Determine subfolder from platform
      const subfolder = RawMediaService.PLATFORM_FOLDERS[platform] || 'Other';
      const folderPath = `Downloads/${subfolder}`;

      // Navigate to (and create) the nested folder
      const folder = await this.fileStorage.navigateToFolder(projectHandle, folderPath, true);
      if (!folder) {
        log.error('Failed to create download subfolder:', folderPath);
        return null;
      }

      // Write the file
      const fileHandle = await folder.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      // Return as File object
      const file = new File([blob], fileName, { type: 'video/mp4' });
      log.debug(`Saved download: ${folderPath}/${fileName}`);
      return file;
    } catch (e) {
      log.error('Failed to save download:', e);
      return null;
    }
  }
}
