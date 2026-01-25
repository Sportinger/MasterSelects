// Transcript persistence service

import { FileStorageService } from '../core/FileStorageService';

export class TranscriptService {
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  /**
   * Save transcript for a media file
   */
  async saveTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    transcript: unknown
  ): Promise<boolean> {
    const json = JSON.stringify(transcript, null, 2);
    return this.fileStorage.writeFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`, json);
  }

  /**
   * Get transcript for a media file
   */
  async getTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<unknown | null> {
    const file = await this.fileStorage.readFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`);
    if (!file) return null;

    try {
      const text = await file.text();
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }
}
