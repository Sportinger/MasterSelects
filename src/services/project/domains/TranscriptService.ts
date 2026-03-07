// Transcript persistence service

import { FileStorageService } from '../core/FileStorageService';

/**
 * Stored transcript format.
 * Backward compatible: old format was just TranscriptWord[], new format is { words, transcribedRanges }.
 */
interface StoredTranscript {
  words: unknown[];
  transcribedRanges?: [number, number][];
}

export class TranscriptService {
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  /**
   * Save transcript with optional transcribed ranges
   */
  async saveTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string,
    transcript: unknown,
    transcribedRanges?: [number, number][]
  ): Promise<boolean> {
    // If transcript is already in new format (object with words), use it directly
    const data: StoredTranscript = Array.isArray(transcript)
      ? { words: transcript, transcribedRanges }
      : { ...(transcript as StoredTranscript), transcribedRanges: transcribedRanges ?? (transcript as StoredTranscript).transcribedRanges };

    const json = JSON.stringify(data, null, 2);
    return this.fileStorage.writeFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`, json);
  }

  /**
   * Get transcript for a media file
   * Returns { words, transcribedRanges } — handles both old (array) and new (object) formats
   */
  async getTranscript(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<StoredTranscript | null> {
    const file = await this.fileStorage.readFile(projectHandle, 'TRANSCRIPTS', `${mediaId}.json`);
    if (!file) return null;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Old format: just an array of words
      if (Array.isArray(parsed)) {
        return { words: parsed };
      }

      // New format: { words, transcribedRanges }
      return parsed as StoredTranscript;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get transcribed ranges for a media file
   */
  async getTranscribedRanges(
    projectHandle: FileSystemDirectoryHandle,
    mediaId: string
  ): Promise<[number, number][]> {
    const data = await this.getTranscript(projectHandle, mediaId);
    return data?.transcribedRanges ?? [];
  }
}
