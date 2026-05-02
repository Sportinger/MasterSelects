// Proxy frame and audio storage service

import { Logger } from '../../logger';
import { PROJECT_FOLDERS } from '../core/constants';

const log = Logger.create('ProxyStorage');

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

const PROXY_FRAME_EXTENSION = 'jpg';
const PROXY_FRAME_MATCH = /^frame_(\d+)\.(?:jpe?g|webp)$/i;

export interface ProxyFrameWriter {
  saveFrame: (frameIndex: number, blob: Blob) => Promise<boolean>;
}

export interface ProxyFrameScanProgress {
  mediaId: string;
  scanned: number;
  matched: number;
  done: boolean;
}

export type ProxyFrameScanProgressCallback = (progress: ProxyFrameScanProgress) => void;

function getProxyFrameFileName(frameIndex: number, extension = PROXY_FRAME_EXTENSION): string {
  return `frame_${frameIndex.toString().padStart(6, '0')}.${extension}`;
}

export class ProxyStorageService {
  // ============================================
  // VIDEO PROXY OPERATIONS
  // ============================================

  private async getProxyMediaFolder(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    create: boolean
  ): Promise<FileSystemDirectoryHandle> {
    const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY, { create });
    return proxyFolder.getDirectoryHandle(mediaId, { create });
  }

  private async writeProxyFrameToFolder(
    projectName: string,
    mediaId: string,
    mediaFolder: FileSystemDirectoryHandle,
    frameIndex: number,
    blob: Blob
  ): Promise<boolean> {
    try {
      const fileName = getProxyFrameFileName(frameIndex);
      const fileHandle = await mediaFolder.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      if (frameIndex === 0 || frameIndex === 5) {
        log.debug(`Saved proxy frame ${frameIndex} to ${projectName}/${PROJECT_FOLDERS.PROXY}/${mediaId}/${fileName} (${blob.size} bytes)`);
      }
      return true;
    } catch (e) {
      log.error('Failed to save proxy frame:', e);
      return false;
    }
  }

  async createProxyFrameWriter(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<ProxyFrameWriter | null> {
    try {
      const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, true);
      return {
        saveFrame: (frameIndex, blob) =>
          this.writeProxyFrameToFolder(projectHandle.name, mediaId, mediaFolder, frameIndex, blob),
      };
    } catch (e) {
      log.error('Failed to create proxy frame writer:', e);
      return null;
    }
  }

  /**
   * Save proxy frame
   */
  async saveProxyFrame(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    frameIndex: number,
    blob: Blob
  ): Promise<boolean> {
    try {
      const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, true);
      return this.writeProxyFrameToFolder(projectHandle.name, mediaId, mediaFolder, frameIndex, blob);
    } catch (e) {
      log.error('Failed to save proxy frame:', e);
      return false;
    }
  }

  /**
   * Get proxy frame
   */
  async getProxyFrame(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    frameIndex: number
  ): Promise<Blob | null> {
    try {
      const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, false);
      const fileNames = [
        getProxyFrameFileName(frameIndex),
        getProxyFrameFileName(frameIndex, 'webp'),
      ];

      for (const fileName of fileNames) {
        try {
          const fileHandle = await mediaFolder.getFileHandle(fileName);
          return await fileHandle.getFile();
        } catch {
          // Try next extension.
        }
      }
    } catch (e) {
      // No proxy folder exists
    }
    return null;
  }

  /**
   * Check if proxy exists for media
   */
  async hasProxy(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<boolean> {
    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      await proxyFolder.getDirectoryHandle(mediaId);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get proxy frame count for a media file (by hash or ID)
   * Returns 0 if no proxy exists
   */
  async getProxyFrameCount(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<number> {
    try {
      const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, false);
      const indices = new Set<number>();
      for await (const entry of (mediaFolder as IterableDirectoryHandle).values()) {
        if (entry.kind === 'file') {
          const match = entry.name.match(PROXY_FRAME_MATCH);
          if (match) {
            indices.add(parseInt(match[1], 10));
          }
        }
      }
      return indices.size;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Get proxy frame indices for a media file
   * Returns Set of frame indices found on disk
   */
  async getProxyFrameIndices(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    onProgress?: ProxyFrameScanProgressCallback
  ): Promise<Set<number>> {
    const indices = new Set<number>();
    let scanned = 0;

    const emit = (done = false) => {
      onProgress?.({
        mediaId,
        scanned,
        matched: indices.size,
        done,
      });
    };

    try {
      const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, false);

      for await (const entry of (mediaFolder as IterableDirectoryHandle).values()) {
        scanned++;
        if (entry.kind === 'file') {
          const match = entry.name.match(PROXY_FRAME_MATCH);
          if (match) {
            indices.add(parseInt(match[1], 10));
          }
        }
        if (scanned % 100 === 0) {
          emit();
        }
      }
    } catch {
      // No proxy folder exists
    }
    emit(true);
    return indices;
  }

  // ============================================
  // VIDEO PROXY (MP4) OPERATIONS
  // ============================================

  /**
   * Save proxy video MP4 file
   */
  async saveProxyVideo(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    blob: Blob
  ): Promise<boolean> {
    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY, { create: true });
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId, { create: true });

      const fileHandle = await mediaFolder.getFileHandle('proxy.mp4', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      log.debug(`Saved proxy video to ${projectHandle.name}/${PROJECT_FOLDERS.PROXY}/${mediaId}/proxy.mp4 (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      return true;
    } catch (e) {
      log.error('Failed to save proxy video:', e);
      return false;
    }
  }

  /**
   * Get proxy video MP4 file
   */
  async getProxyVideo(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<File | null> {
    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      const fileHandle = await mediaFolder.getFileHandle('proxy.mp4');
      return await fileHandle.getFile();
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if proxy video MP4 exists for media
   */
  async hasProxyVideo(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<boolean> {
    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      await mediaFolder.getFileHandle('proxy.mp4');
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================
  // AUDIO PROXY OPERATIONS
  // ============================================

  /**
   * Save audio proxy file (extracted audio for fast playback)
   */
  async saveProxyAudio(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    blob: Blob
  ): Promise<boolean> {
    try {
      // Get or create media subfolder in Proxy/
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY, { create: true });
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId, { create: true });

      const fileName = 'audio.m4a';
      const fileHandle = await mediaFolder.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      log.debug(`Saved audio proxy to ${projectHandle.name}/${PROJECT_FOLDERS.PROXY}/${mediaId}/${fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      return true;
    } catch (e) {
      log.error('Failed to save audio proxy:', e);
      return false;
    }
  }

  /**
   * Get audio proxy file
   */
  async getProxyAudio(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<File | null> {
    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      const fileHandle = await mediaFolder.getFileHandle('audio.m4a');
      return await fileHandle.getFile();
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if audio proxy exists for media
   */
  async hasProxyAudio(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<boolean> {
    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      await mediaFolder.getFileHandle('audio.m4a');
      return true;
    } catch (e) {
      return false;
    }
  }
}
