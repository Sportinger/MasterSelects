// Proxy frame and audio storage service

import { Logger } from '../../logger';
import { PROJECT_FOLDERS } from '../core/constants';
import {
  createEmptyPackIndex,
  getNextPackOrdinal,
  getProxyPackFileName,
  PROXY_PACK_FRAME_MIME_TYPE,
  PROXY_PACK_MAX_BYTES,
  readProxyPackIndexFromFolder,
  writeProxyPackIndex,
  type ProxyPackFileEntry,
  type ProxyPackRuntimeIndex,
} from './proxyStorage/proxyPackIndex';

const log = Logger.create('ProxyStorage');

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

const PROXY_FRAME_EXTENSION = 'jpg';
const PROXY_FRAME_MATCH = /^frame_(\d+)\.(?:jpe?g|webp)$/i;
const JPEG_PROXY_FRAMES_ENABLED = true;
const PROXY_VIDEO_FILE_NAME = 'proxy.mp4';
const AUDIO_PROXY_EXTENSION = 'wav';
const LEGACY_AUDIO_PROXY_FILE_NAME = 'audio.m4a';

export interface ProxyFrameWriter {
  saveFrame: (frameIndex: number, blob: Blob) => Promise<boolean>;
  close?: () => Promise<void>;
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

export function getAudioProxyFileName(mediaId: string): string {
  const safeId = mediaId
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 180) || 'audio';
  return `${safeId}.${AUDIO_PROXY_EXTENSION}`;
}

export class ProxyStorageService {
  private readonly packIndexCache = new WeakMap<
    FileSystemDirectoryHandle,
    Map<string, Promise<ProxyPackRuntimeIndex | null>>
  >();

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

  private getProjectPackIndexCache(projectHandle: FileSystemDirectoryHandle): Map<string, Promise<ProxyPackRuntimeIndex | null>> {
    let cache = this.packIndexCache.get(projectHandle);
    if (!cache) {
      cache = new Map();
      this.packIndexCache.set(projectHandle, cache);
    }
    return cache;
  }

  private invalidateProxyPackIndex(projectHandle: FileSystemDirectoryHandle, mediaId: string): void {
    this.getProjectPackIndexCache(projectHandle).delete(mediaId);
  }

  private async getProxyPackIndex(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<ProxyPackRuntimeIndex | null> {
    const cache = this.getProjectPackIndexCache(projectHandle);
    const cached = cache.get(mediaId);
    if (cached) return cached;

    const promise = (async () => {
      try {
        const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, false);
        return readProxyPackIndexFromFolder(mediaFolder, mediaId);
      } catch {
        return null;
      }
    })();

    cache.set(mediaId, promise);
    return promise;
  }

  async createProxyFrameWriter(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<ProxyFrameWriter | null> {
    if (!JPEG_PROXY_FRAMES_ENABLED) {
      log.warn('JPEG proxy frame writer is disabled; use proxy.mp4 video proxies instead', { mediaId });
      return null;
    }

    try {
      const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, true);
      const runtime = await readProxyPackIndexFromFolder(mediaFolder, mediaId)
        ?? createEmptyPackIndex(mediaId);
      let nextPackOrdinal = getNextPackOrdinal(runtime);
      let currentWritable: FileSystemWritableFileStream | null = null;
      let currentPack: ProxyPackFileEntry | null = null;
      let currentPackBytes = 0;
      let queue = Promise.resolve();
      let fatalError: unknown = null;
      let closed = false;

      const closeCurrentPack = async () => {
        if (!currentWritable) return;
        await currentWritable.close();
        currentWritable = null;

        if (currentPack && currentPack.frameCount > 0) {
          log.debug(`Saved proxy pack ${currentPack.name} for ${mediaId}: ${currentPack.frameCount} frames, ${(currentPack.byteLength / 1024 / 1024).toFixed(2)} MB`);
          await writeProxyPackIndex(mediaFolder, runtime);
          this.invalidateProxyPackIndex(projectHandle, mediaId);
        }

        currentPack = null;
        currentPackBytes = 0;
      };

      const openNextPack = async () => {
        await closeCurrentPack();
        const packName = getProxyPackFileName(nextPackOrdinal++);
        const fileHandle = await mediaFolder.getFileHandle(packName, { create: true });
        currentWritable = await fileHandle.createWritable();
        currentPack = {
          name: packName,
          byteLength: 0,
          frameCount: 0,
        };
        runtime.file.packs.push(currentPack);
        runtime.packMap.set(packName, currentPack);
        currentPackBytes = 0;
      };

      const writeFrame = async (frameIndex: number, blob: Blob): Promise<boolean> => {
        if (closed) {
          log.warn('Ignoring proxy frame write after writer close', { mediaId, frameIndex });
          return false;
        }
        if (runtime.frameMap.has(frameIndex)) {
          return true;
        }

        if (!currentWritable || !currentPack) {
          await openNextPack();
        } else if (currentPackBytes > 0 && currentPackBytes + blob.size > PROXY_PACK_MAX_BYTES) {
          await openNextPack();
        }

        if (!currentWritable || !currentPack) {
          throw new Error('Proxy pack writer did not open a writable file');
        }

        const offset = currentPackBytes;
        await currentWritable.write(blob);
        currentPackBytes += blob.size;
        currentPack.byteLength = currentPackBytes;
        currentPack.frameCount += 1;

        runtime.frameMap.set(frameIndex, {
          frameIndex,
          pack: currentPack.name,
          offset,
          size: blob.size,
          mimeType: blob.type || PROXY_PACK_FRAME_MIME_TYPE,
        });

        if (frameIndex === 0 || frameIndex === 5) {
          log.debug(`Packed proxy frame ${frameIndex} to ${projectHandle.name}/${PROJECT_FOLDERS.PROXY}/${mediaId}/${currentPack.name} @ ${offset} (${blob.size} bytes)`);
        }
        return true;
      };

      const enqueue = (operation: () => Promise<boolean>): Promise<boolean> => {
        const result = queue.then(async () => {
          if (fatalError) return false;
          try {
            return await operation();
          } catch (error) {
            fatalError = error;
            log.error('Failed to write proxy frame pack:', error);
            return false;
          }
        });
        queue = result.then(() => undefined, () => undefined);
        return result;
      };

      return {
        saveFrame: (frameIndex, blob) => enqueue(() => writeFrame(frameIndex, blob)),
        close: async () => {
          closed = true;
          await queue;
          await closeCurrentPack();
          await writeProxyPackIndex(mediaFolder, runtime);
          this.invalidateProxyPackIndex(projectHandle, mediaId);
        },
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
    if (!JPEG_PROXY_FRAMES_ENABLED) {
      log.warn('JPEG proxy frame save is disabled; use proxy.mp4 video proxies instead', { mediaId, frameIndex });
      return false;
    }

    const writer = await this.createProxyFrameWriter(projectHandle, mediaId);
    if (!writer) return false;

    try {
      const saved = await writer.saveFrame(frameIndex, blob);
      await writer.close?.();
      return saved;
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
    if (!JPEG_PROXY_FRAMES_ENABLED) {
      return null;
    }

    const packIndex = await this.getProxyPackIndex(projectHandle, mediaId);
    const packEntry = packIndex?.frameMap.get(frameIndex);
    if (packEntry) {
      try {
        const mediaFolder = await this.getProxyMediaFolder(projectHandle, mediaId, false);
        const packHandle = await mediaFolder.getFileHandle(packEntry.pack);
        const packFile = await packHandle.getFile();
        return packFile.slice(
          packEntry.offset,
          packEntry.offset + packEntry.size,
          packEntry.mimeType || PROXY_PACK_FRAME_MIME_TYPE
        );
      } catch (e) {
        log.warn('Failed to read packed proxy frame; trying legacy frame file', { mediaId, frameIndex, error: e });
      }
    }

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
    if (!JPEG_PROXY_FRAMES_ENABLED) {
      return 0;
    }

    return (await this.getProxyFrameIndices(projectHandle, mediaId)).size;
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

    if (!JPEG_PROXY_FRAMES_ENABLED) {
      emit(true);
      return indices;
    }

    const packIndex = await this.getProxyPackIndex(projectHandle, mediaId);
    if (packIndex) {
      for (const frameIndex of packIndex.frameMap.keys()) {
        indices.add(frameIndex);
      }
      scanned += packIndex.frameMap.size;
      emit();
    }

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

      const fileHandle = await mediaFolder.getFileHandle(PROXY_VIDEO_FILE_NAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      log.debug(`Saved proxy video to ${projectHandle.name}/${PROJECT_FOLDERS.PROXY}/${mediaId}/${PROXY_VIDEO_FILE_NAME} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
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
      const fileHandle = await mediaFolder.getFileHandle(PROXY_VIDEO_FILE_NAME);
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
      await mediaFolder.getFileHandle(PROXY_VIDEO_FILE_NAME);
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
      const audioProxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.AUDIO_PROXIES, { create: true });
      const fileName = getAudioProxyFileName(mediaId);
      const fileHandle = await audioProxyFolder.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      log.debug(`Saved audio proxy to ${projectHandle.name}/${PROJECT_FOLDERS.AUDIO_PROXIES}/${fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
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
      const audioProxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.AUDIO_PROXIES);
      const fileHandle = await audioProxyFolder.getFileHandle(getAudioProxyFileName(mediaId));
      return await fileHandle.getFile();
    } catch (e) {
      // Fall through to legacy proxy files.
    }

    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      const fileHandle = await mediaFolder.getFileHandle('audio.wav');
      return await fileHandle.getFile();
    } catch (e) {
      // Fall through to older AAC proxy files.
    }

    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      const fileHandle = await mediaFolder.getFileHandle(LEGACY_AUDIO_PROXY_FILE_NAME);
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
      const audioProxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.AUDIO_PROXIES);
      await audioProxyFolder.getFileHandle(getAudioProxyFileName(mediaId));
      return true;
    } catch (e) {
      // Fall through to legacy proxy files.
    }

    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      await mediaFolder.getFileHandle('audio.wav');
      return true;
    } catch (e) {
      // Fall through to older AAC proxy files.
    }

    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      const mediaFolder = await proxyFolder.getDirectoryHandle(mediaId);
      await mediaFolder.getFileHandle(LEGACY_AUDIO_PROXY_FILE_NAME);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Delete all proxy artifacts for a media storage key.
   */
  async deleteProxy(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<boolean> {
    let deleted = false;

    try {
      const audioProxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.AUDIO_PROXIES);
      await audioProxyFolder.removeEntry(getAudioProxyFileName(mediaId));
      deleted = true;
    } catch {
      // Audio proxy may not exist.
    }

    try {
      const proxyFolder = await projectHandle.getDirectoryHandle(PROJECT_FOLDERS.PROXY);
      await proxyFolder.removeEntry(mediaId, { recursive: true });
      deleted = true;
    } catch {
      // Video proxy may not exist.
    }

    return deleted;
  }
}
