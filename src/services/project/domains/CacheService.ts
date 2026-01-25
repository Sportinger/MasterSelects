// Thumbnail and waveform caching service

import { FileStorageService } from '../core/FileStorageService';

export class CacheService {
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  // ============================================
  // THUMBNAIL OPERATIONS
  // ============================================

  /**
   * Save thumbnail by file hash (for deduplication)
   */
  async saveThumbnail(
    projectHandle: FileSystemDirectoryHandle,
    fileHash: string,
    blob: Blob
  ): Promise<boolean> {
    return this.fileStorage.writeFile(projectHandle, 'CACHE_THUMBNAILS', `${fileHash}.jpg`, blob);
  }

  /**
   * Get thumbnail by file hash
   */
  async getThumbnail(
    projectHandle: FileSystemDirectoryHandle,
    fileHash: string
  ): Promise<Blob | null> {
    return this.fileStorage.readFile(projectHandle, 'CACHE_THUMBNAILS', `${fileHash}.jpg`);
  }

  /**
   * Check if thumbnail exists by file hash
   */
  async hasThumbnail(
    projectHandle: FileSystemDirectoryHandle,
    fileHash: string
  ): Promise<boolean> {
    const thumb = await this.getThumbnail(projectHandle, fileHash);
    return thumb !== null && thumb.size > 0;
  }

  // ============================================
  // WAVEFORM OPERATIONS
  // ============================================

  /**
   * Save waveform data for a media file
   */
  async saveWaveform(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    waveformData: Float32Array
  ): Promise<boolean> {
    const blob = new Blob([waveformData.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    return this.fileStorage.writeFile(projectHandle, 'CACHE_WAVEFORMS', `${mediaId}.waveform`, blob);
  }

  /**
   * Get waveform data for a media file
   */
  async getWaveform(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<Float32Array | null> {
    const file = await this.fileStorage.readFile(projectHandle, 'CACHE_WAVEFORMS', `${mediaId}.waveform`);
    if (!file) return null;

    const buffer = await file.arrayBuffer();
    return new Float32Array(buffer);
  }
}
